import { Router, type Request } from 'express';
import { IdeaStatus, EventType, Role, Prisma, Effort } from '@prisma/client';
import { rateLimit } from 'express-rate-limit';
import prisma from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { createIdeaSchema, reviewIdeaSchema, markDoneSchema, dispatchJiraTaskSchema, updateIdeaSchema, ideasQuerySchema, createStepSchema, objectIdParamSchema, notifyToggleSchema } from '../utils/validation';
import { sendMail } from '../utils/mailer';
import { newIdeaEmail } from '../utils/mail-templates';
import { getEffectiveMailConfig } from '../config/mail';
import { sendWebexMessage, getEffectiveWebexConfig, WEBEX_SEND_CONCURRENCY } from '../utils/webex';
import { runBounded } from '../utils/concurrency';
import { newIdeaWebexMessage } from '../utils/webex-templates';
import { maybeNotifySubmitter, type NotifiableIdea, type MaybeNotifyArgs } from '../utils/lifecycle-notify';
import { getEffectiveJiraConfig } from '../config/jira';
import { createJiraIssue, buildJiraBrowseUrl } from '../utils/jira';

const router = Router();

// An idea as it leaves this router, optionally carrying the browser-facing Jira
// link. `jiraBrowseUrl` is a DERIVED field (not a column): it is the effective Jira
// base URL joined with the stored issue key, and it is OMITTED ENTIRELY whenever it
// cannot be built safely (see the F7 protocol rule in utils/jira.ts
// buildJiraBrowseUrl) — never emitted as null/'' that a client might still render.
type WithJiraBrowseUrl<T> = T & { jiraBrowseUrl?: string };

/**
 * Attach `jiraBrowseUrl` to every idea in the list that has been dispatched.
 *
 * The base URL lives in the admin settings (or the JIRA_API_BASE_URL override), so
 * the link is built SERVER-SIDE and handed to the SPA ready-made — the FE never
 * learns the base URL and never concatenates a URL itself. The settings read is
 * skipped entirely when no idea on the page carries an issue key, so an
 * installation that does not use Jira pays nothing on the list endpoints, and a
 * settings-read failure only means "no links" (it can never fail the request).
 */
async function attachJiraBrowseUrls<T extends { jiraIssueKey: string | null }>(
  ideas: T[]
): Promise<Array<WithJiraBrowseUrl<T>>> {
  const anyDispatched = ideas.some((idea) => typeof idea.jiraIssueKey === 'string' && idea.jiraIssueKey.length > 0);
  if (!anyDispatched) return ideas;

  let cfg;
  try {
    cfg = await getEffectiveJiraConfig();
  } catch (error) {
    console.error('Error reading jira config for browse URLs:', error);
    return ideas;
  }

  return ideas.map((idea) => {
    const browseUrl = buildJiraBrowseUrl(cfg, idea.jiraIssueKey);
    return browseUrl === null ? idea : { ...idea, jiraBrowseUrl: browseUrl };
  });
}

// Effort wording for the Jira task description — Slovak, because Slovak staff are
// who reads the created tasks; values mirror the frontend's sk `effort.*` catalog.
const JIRA_EFFORT_LABELS: Record<Effort, string> = {
  [Effort.LESS_THAN_ONE_DAY]: '< 1 deň',
  [Effort.ONE_TO_THREE_DAYS]: '1-3 dni',
  [Effort.MORE_THAN_THREE_DAYS]: '> 3 dni',
};

// Best-effort, fire-and-forget submitter notification, built from the actor in req.session.
function notifySubmitter(req: Request, idea: NotifiableIdea, event: MaybeNotifyArgs['event'], stepText?: string): void {
  maybeNotifySubmitter({
    idea,
    event,
    actorUserId: req.session.userId!,
    actorName: req.session.name ?? '',
    stepText,
  });
}

// Dedicated limiter for idea creation. A single POST /api/ideas now fans out across
// BOTH notification channels: up to ~20 department-notification emails (one message to
// the whole list) PLUS, on Webex, up to ~20 1:1 bot DMs (one per notificationEmails
// recipient) and up to 50 room/space posts (one per webexRoomIds entry) — roughly ~90
// user-triggered outbound sends per create, each carrying a user-controlled
// subject/body. That makes this route a notification amplifier the general /api limiter
// alone guards too loosely. Mirrors loginLimiter (routes/auth.ts): same
// express-rate-limit import, standardHeaders, and house { error } 429 shape.
//
// CRITICAL skip parity: identical to the general limiter (index.ts) —
// test || development (NOT the auth limiters, which skip test only) — so the
// real-DB integration tier (many creates from one loopback IP) and local dev are
// NOT throttled, while production/staging still are.
const ideaCreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  // 30 is deliberately generous for legitimate use while capping worst-case
  // notification amplification (~90 outbound sends × 30 creates per window). Tunable.
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development',
  message: { error: 'Too many idea submissions. Please try again later.' },
});

// Dedicated limiter for progress-step creation, mirroring ideaCreateLimiter exactly.
// A POST /:id/steps fires a best-effort lifecycle notification to the (opted-in)
// submitter, so a burst of step posts is a mail amplifier toward that submitter —
// the same class of abuse the create route already caps, which is why it gets its
// own limiter here. Identical window/max and the SAME test||development skip parity
// (index.ts's general limiter) so the real-DB integration tier and local dev are
// never throttled, while production/staging still are.
const stepCreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development',
  message: { error: 'Too many progress updates. Please try again later.' },
});

// Dedicated limiter for Jira dispatch, cloning the two above exactly (window, max,
// headers, and the SAME test||development skip parity so the integration tier and
// local dev are never throttled). This route is the only one that makes an
// OUTBOUND, state-changing call to a third-party system on user demand: each POST
// creates a real Jira issue. Even though it is POWER_USER/ADMIN-gated, a per-IP cap
// bounds both the burst of remote writes (and the 429 it would earn from Jira) and
// the amount of noise a compromised elevated session can create over there.
const jiraTaskLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development',
  message: { error: 'Too many Jira task requests. Please try again later.' },
});

// Get all ideas with filters
router.get('/', requireAuth, async (req, res) => {
  try {
    const parsed = ideasQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const data = parsed.data;
    const page = data.page as number;
    const limit = data.limit as number;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (data.status) {
      where.status = data.status;
    }
    if (data.submitterId) {
      where.submitterId = data.submitterId;
    }
    if (data.assigneeId) {
      where.assigneeId = data.assigneeId;
    }
    if (data.departmentId) {
      where.departmentId = data.departmentId;
    }
    if (data.tags) {
      where.tags = {
        hasSome: Array.isArray(data.tags) ? data.tags : [data.tags],
      };
    }

    const [ideas, total] = await Promise.all([
      prisma.idea.findMany({
        where,
        include: {
          submitter: {
            select: { id: true, name: true, email: true },
          },
          approver: {
            select: { id: true, name: true, email: true },
          },
          assignee: {
            select: { id: true, name: true, email: true },
          },
          department: {
            select: { id: true, name: true },
          },
        },
        orderBy: { submittedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.idea.count({ where }),
    ]);

    res.json({
      // Dispatched ideas carry the ready-made Jira link (the card renders it as a
      // chip); ideas without an issue key are returned untouched.
      data: await attachJiraBrowseUrls(ideas),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching ideas:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single idea
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const parsed = objectIdParamSchema.safeParse(req.params.id);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid idea ID format' });
    }
    const id = parsed.data;

    const idea = await prisma.idea.findUnique({
      where: { id },
      include: {
        submitter: {
          select: { id: true, name: true, email: true },
        },
        approver: {
          select: { id: true, name: true, email: true },
        },
        assignee: {
          select: { id: true, name: true, email: true },
        },
        department: {
          select: { id: true, name: true },
        },
        events: {
          include: {
            byUser: {
              select: { id: true, name: true, email: true },
            },
          },
          orderBy: { timestamp: 'asc' },
        },
        steps: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!idea) {
      return res.status(404).json({ error: 'Idea not found' });
    }

    // Same derived Jira link as the list endpoint (single-element list so the rule
    // and the settings-read guard live in exactly one place).
    const [serialized] = await attachJiraBrowseUrls([idea]);
    res.json(serialized);
  } catch (error) {
    console.error('Error fetching idea:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new idea. ideaCreateLimiter runs before requireAuth so the per-IP cap
// applies to the amplifier regardless of session state (cast `as any` to bridge
// express-rate-limit's handler type, exactly as routes/auth.ts does).
router.post('/', ideaCreateLimiter as any, requireAuth, async (req, res) => {
  try {
    const data = createIdeaSchema.parse(req.body);
    const userId = req.session.userId!;

    // Fetch name + notificationEmails + webexRoomIds alongside the existence check
    // (no second query): name feeds the notification subject/body, notificationEmails
    // the mail + Webex-DM recipients, and webexRoomIds the Webex room/space posts.
    const department = await prisma.department.findUnique({
      where: { id: data.departmentId },
      select: { name: true, notificationEmails: true, webexRoomIds: true },
    });
    if (!department) {
      return res.status(400).json({ error: 'Unknown department' });
    }

    const idea = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.idea.create({
        data: {
          ...data,
          submitterId: userId,
          status: IdeaStatus.SUBMITTED,
          // Strict opt-out default: persist an explicit boolean even when the
          // client omits the flag, so the field is never absent on a new doc.
          notifyOnChange: data.notifyOnChange ?? false,
          // Explicit not-dispatched default, for the SAME missing-vs-null reason:
          // the Jira dispatch endpoint claims the idea with
          // `updateMany({ where: { ..., jiraSyncActive: false } })`, and a
          // Prisma+Mongo where-clause does NOT match a *missing* scalar — a new idea
          // without this field would be permanently un-dispatchable (409). Legacy
          // documents are covered by the boot backfill (utils/init-idea-jira.ts).
          jiraSyncActive: false,
        },
        include: {
          submitter: {
            select: { id: true, name: true, email: true },
          },
          department: {
            select: { id: true, name: true },
          },
        },
      });

      await tx.ideaEvent.create({
        data: {
          ideaId: created.id,
          type: EventType.SUBMITTED,
          byUserId: userId,
          note: 'Initial submission',
        },
      });

      return created;
    });

    res.status(201).json(idea);

    // Fire-and-forget department notification (creation only). This runs AFTER the
    // response so it can never gate, delay, or alter the 201 — the 201 is identical
    // whether mail is disabled, succeeds, or fails. The whole block is wrapped in an
    // async IIFE with its own try/catch: reading the DB-backed mail settings is now
    // async, and neither that read nor the best-effort send may ever surface as an
    // unhandledRejection on the already-sent response. An empty recipient list sends
    // nothing. The wording (language + optional subject override) comes from the
    // admin-managed mail settings (config/mail.ts) and flows through the template
    // module (utils/mail-templates.ts) transparently.
    const recipients = department.notificationEmails ?? [];
    const roomIds = department.webexRoomIds ?? [];

    // Mail channel: ONE message to the whole recipient list. Its own fire-and-forget
    // IIFE, gated on there being at least one email recipient (mail has no room
    // concept). An empty list sends nothing.
    if (recipients.length > 0) {
      void (async () => {
        try {
          const mailCfg = await getEffectiveMailConfig();
          const link = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/ideas/${idea.id}`;
          const { subject, text } = newIdeaEmail({
            departmentName: department.name,
            title: idea.title,
            submitterName: idea.submitter.name,
            description: idea.description,
            link,
            language: mailCfg.language,
            subjectTemplate: mailCfg.subjectTemplate,
          });
          // Pass the config we ALREADY read (above) so sendMail does NOT read the
          // settings a second time — exactly one settings read per notification.
          await sendMail({ to: recipients, subject, text }, mailCfg);
        } catch (err) {
          console.error(`[MAIL] department notification failed ideaId=${idea.id}:`, err);
        }
      })();
    }

    // Fire-and-forget Webex department notification — an INDEPENDENT channel, in its
    // own IIFE with its own try/catch so a Webex outage never affects the mail send
    // (or the already-sent 201). Webex targets BOTH the notificationEmails (as 1:1
    // bot DMs — one per recipient, since Webex has no bulk "to") AND the department's
    // webexRoomIds (as room/space posts). It fires whenever there is at least one DM
    // recipient OR at least one room, so a rooms-only department (no
    // notificationEmails) still gets its room posts. A SINGLE effective-config read
    // guards and feeds every send, and the SAME rendered markdown goes to every DM
    // and every room.
    if (recipients.length > 0 || roomIds.length > 0) {
      void (async () => {
        try {
          const webexCfg = await getEffectiveWebexConfig();
          if (!webexCfg.effectiveEnabled) return;
          const link = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/ideas/${idea.id}`;
          const { markdown } = newIdeaWebexMessage({
            departmentName: department.name,
            title: idea.title,
            submitterName: idea.submitter.name,
            description: idea.description,
            link,
            language: webexCfg.language,
          });

          // DM fan-out: one 1:1 DM per DISTINCT recipient. Dedupe case-insensitively
          // (keeping the first-seen original casing) so a list that repeats an address
          // in different case never double-DMs the same person.
          const seenEmail = new Set<string>();
          const uniqueRecipients = recipients.filter((to) => {
            const key = to.toLowerCase();
            if (seenEmail.has(key)) return false;
            seenEmail.add(key);
            return true;
          });

          // Room fan-out: one post per DISTINCT room. Room ids are OPAQUE, so they are
          // deduped CASE-SENSITIVELY (exact match — 'ROOM-A' and 'room-a' are distinct
          // rooms), exactly as validation stored them.
          const seenRoom = new Set<string>();
          const uniqueRoomIds = roomIds.filter((roomId) => {
            if (seenRoom.has(roomId)) return false;
            seenRoom.add(roomId);
            return true;
          });

          // DMs and room posts are independent, best-effort sends (sendWebexMessage
          // never throws), so both go through ONE bounded fan-out. runBounded keeps at
          // most WEBEX_SEND_CONCURRENCY in flight — a maxed-out department (20 DMs + 50
          // rooms) can no longer burst 70 simultaneous Webex calls and invite a 429 —
          // while still running EVERY send regardless of what the others do. DMs are
          // queued ahead of the room posts so directly-addressed people go first. Pass
          // the config we ALREADY read so no send re-reads the settings.
          await runBounded(
            [
              ...uniqueRecipients.map(
                (to) => () => sendWebexMessage({ toPersonEmail: to, markdown }, webexCfg)
              ),
              ...uniqueRoomIds.map(
                (roomId) => () => sendWebexMessage({ roomId, markdown }, webexCfg)
              ),
            ],
            WEBEX_SEND_CONCURRENCY,
            (err) => console.error(`[WEBEX] department notification send threw ideaId=${idea.id}:`, err)
          );
        } catch (err) {
          console.error(`[WEBEX] department notification failed ideaId=${idea.id}:`, err);
        }
      })();
    }
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Update idea (only by submitter)
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const idParsed = objectIdParamSchema.safeParse(req.params.id);
    if (!idParsed.success) {
      return res.status(400).json({ error: 'Invalid idea ID format' });
    }
    const id = idParsed.data;
    const userId = req.session.userId!;
    const data = updateIdeaSchema.parse(req.body);

    const existingIdea = await prisma.idea.findUnique({
      where: { id },
    });

    if (!existingIdea) {
      return res.status(404).json({ error: 'Idea not found' });
    }

    // Only submitter can update, and only if not yet approved/rejected
    if (existingIdea.submitterId !== userId) {
      return res.status(403).json({ error: 'You can only update your own ideas' });
    }

    if (existingIdea.status !== IdeaStatus.SUBMITTED) {
      return res.status(400).json({ error: 'Can only update ideas in SUBMITTED status' });
    }

    if (data.departmentId) {
      const department = await prisma.department.findUnique({
        where: { id: data.departmentId },
      });
      if (!department) {
        return res.status(400).json({ error: 'Unknown department' });
      }
    }

    const updatedIdea = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.idea.update({
        where: { id },
        data,
        include: {
          submitter: {
            select: { id: true, name: true, email: true },
          },
          department: {
            select: { id: true, name: true },
          },
        },
      });

      await tx.ideaEvent.create({
        data: {
          ideaId: id,
          type: EventType.UPDATED,
          byUserId: userId,
          note: 'Idea updated',
        },
      });

      return updated;
    });

    res.json(updatedIdea);
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Toggle the submitter's lifecycle-mail opt-in. Separate from the generic
// PATCH /:id (which is submitter-only WHILE SUBMITTED) because the submitter must
// be able to opt in/out in ANY status. Submitter-only; writes NO IdeaEvent (this
// is a preference change, not a lifecycle action); returns the idea in the usual
// include shape, through the SAME jiraBrowseUrl serialization as the read
// endpoints — the FE replaces its idea state from this response, so skipping it
// would silently drop the Jira link from an already-dispatched idea.
router.patch('/:id/notify', requireAuth, async (req, res) => {
  try {
    const idParsed = objectIdParamSchema.safeParse(req.params.id);
    if (!idParsed.success) {
      return res.status(400).json({ error: 'Invalid idea ID format' });
    }
    const id = idParsed.data;
    const userId = req.session.userId!;
    const { enabled } = notifyToggleSchema.parse(req.body);

    const existingIdea = await prisma.idea.findUnique({
      where: { id },
    });

    if (!existingIdea) {
      return res.status(404).json({ error: 'Idea not found' });
    }

    if (existingIdea.submitterId !== userId) {
      return res.status(403).json({ error: 'You can only change notifications for your own ideas' });
    }

    const updatedIdea = await prisma.idea.update({
      where: { id },
      data: { notifyOnChange: enabled },
      include: {
        submitter: {
          select: { id: true, name: true, email: true },
        },
        approver: {
          select: { id: true, name: true, email: true },
        },
        assignee: {
          select: { id: true, name: true, email: true },
        },
        department: {
          select: { id: true, name: true },
        },
      },
    });

    const [serialized] = await attachJiraBrowseUrls([updatedIdea]);
    res.json(serialized);
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Approve idea (Power User or Admin only)
router.patch('/:id/approve', requireRole(Role.POWER_USER, Role.ADMIN), async (req, res) => {
  try {
    const idParsed = objectIdParamSchema.safeParse(req.params.id);
    if (!idParsed.success) {
      return res.status(400).json({ error: 'Invalid idea ID format' });
    }
    const id = idParsed.data;
    const userId = req.session.userId!;
    const { note } = reviewIdeaSchema.parse(req.body);

    const existingIdea = await prisma.idea.findUnique({
      where: { id },
    });

    if (!existingIdea) {
      return res.status(404).json({ error: 'Idea not found' });
    }

    if (existingIdea.status !== IdeaStatus.SUBMITTED) {
      return res.status(400).json({ error: 'Can only approve ideas in SUBMITTED status' });
    }

    const updatedIdea = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.idea.update({
        where: { id },
        data: {
          status: IdeaStatus.APPROVED,
          approverId: userId,
          approvedAt: new Date(),
        },
        include: {
          submitter: {
            select: { id: true, name: true, email: true },
          },
          approver: {
            select: { id: true, name: true, email: true },
          },
          department: {
            select: { id: true, name: true },
          },
        },
      });

      await tx.ideaEvent.create({
        data: {
          ideaId: id,
          type: EventType.APPROVED,
          byUserId: userId,
          note: note || 'Idea approved',
        },
      });

      return updated;
    });

    res.json(updatedIdea);

    // Best-effort, fire-and-forget submitter notification (after the response).
    notifySubmitter(req, updatedIdea, 'APPROVED');
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Reject idea (Power User or Admin only)
router.patch('/:id/reject', requireRole(Role.POWER_USER, Role.ADMIN), async (req, res) => {
  try {
    const idParsed = objectIdParamSchema.safeParse(req.params.id);
    if (!idParsed.success) {
      return res.status(400).json({ error: 'Invalid idea ID format' });
    }
    const id = idParsed.data;
    const userId = req.session.userId!;
    const { note } = reviewIdeaSchema.parse(req.body);

    const existingIdea = await prisma.idea.findUnique({
      where: { id },
    });

    if (!existingIdea) {
      return res.status(404).json({ error: 'Idea not found' });
    }

    if (existingIdea.status !== IdeaStatus.SUBMITTED) {
      return res.status(400).json({ error: 'Can only reject ideas in SUBMITTED status' });
    }

    const updatedIdea = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.idea.update({
        where: { id },
        data: {
          status: IdeaStatus.REJECTED,
          approverId: userId,
          rejectedAt: new Date(),
        },
        include: {
          submitter: {
            select: { id: true, name: true, email: true },
          },
          approver: {
            select: { id: true, name: true, email: true },
          },
          department: {
            select: { id: true, name: true },
          },
        },
      });

      await tx.ideaEvent.create({
        data: {
          ideaId: id,
          type: EventType.REJECTED,
          byUserId: userId,
          note: note || 'Idea rejected',
        },
      });

      return updated;
    });

    res.json(updatedIdea);

    // Best-effort, fire-and-forget submitter notification (after the response).
    notifySubmitter(req, updatedIdea, 'REJECTED');
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Dispatch an APPROVED idea to Jira (Power User or Admin only).
//
// This REPLACES the removed in-app claim flow: execution now happens in Jira. The
// handler creates the issue, records a JIRA_CREATED timeline event and enrols the
// idea in the poller (utils/jira-sync.ts), which mirrors the issue's status back
// onto the idea from then on.
//
// The idea deliberately STAYS APPROVED here: the canonical status follows the Jira
// status CATEGORY, and a freshly created issue is in the `new` category (To Do). It
// becomes IN_PROGRESS only when work actually starts in Jira. `assigneeId` is left
// untouched — a Jira-driven idea never gets an in-app assignee, which is exactly
// what keeps the grandfathered steps/complete endpoints (assignee-gated) closed for
// it while old claim-era ideas keep working.
//
// jiraTaskLimiter runs before requireRole (same ordering and `as any` bridge as the
// create route) so the per-IP cap applies regardless of session state.
router.post('/:id/jira-task', jiraTaskLimiter as any, requireRole(Role.POWER_USER, Role.ADMIN), async (req, res) => {
  try {
    const idParsed = objectIdParamSchema.safeParse(req.params.id);
    if (!idParsed.success) {
      return res.status(400).json({ error: 'Invalid idea ID format' });
    }
    const id = idParsed.data;
    const userId = req.session.userId!;

    // Load the submitter (for the issue description) and the department INCLUDING
    // its optional Jira project override in one query. NOTE: jiraProjectKey is
    // admin-only data — it is used here to pick the target project and is NEVER part
    // of the response (the response include below selects id+name only).
    const existingIdea = await prisma.idea.findUnique({
      where: { id },
      include: {
        submitter: {
          select: { id: true, name: true, email: true },
        },
        department: {
          select: { id: true, name: true, jiraProjectKey: true },
        },
      },
    });

    if (!existingIdea) {
      return res.status(404).json({ error: 'Idea not found' });
    }

    if (existingIdea.status !== IdeaStatus.APPROVED) {
      return res.status(400).json({ error: 'Can only create a Jira task for ideas in APPROVED status' });
    }

    const cfg = await getEffectiveJiraConfig();
    if (!cfg.effectiveEnabled) {
      // Disabled / half-configured: refuse up front rather than opening a socket to
      // nowhere. The FE hides the button on the same flag (GET /api/options).
      return res.status(400).json({ error: 'Jira integration is not configured' });
    }

    // Explicit user choice (dispatch dialog) > per-department override >
    // installation-wide default. The schema uppercased + format-checked the request
    // value; '' (a cleared field) means "no choice". Whether the tech account may
    // CREATE in the chosen project is Jira's call — a refusal comes back as the
    // localized project_not_found/invalid_request reason, and the claim below is
    // released like any other failed dispatch.
    // safeParse, NOT parse: this route's catch deliberately reports 500 (see its
    // comment) — a malformed body must be an explicit 400 of its own.
    const bodyParsed = dispatchJiraTaskSchema.safeParse(req.body ?? {});
    if (!bodyParsed.success) {
      return res.status(400).json({ error: 'Invalid project key' });
    }
    const projectKey =
      (bodyParsed.data.projectKey || undefined) ??
      existingIdea.department?.jiraProjectKey ??
      cfg.defaultProjectKey;
    if (!projectKey) {
      return res.status(400).json({ error: 'No Jira project is configured for this department' });
    }

    // ---------------------------------------------------------------------
    // ATOMIC DISPATCH CLAIM (security review F6).
    //
    // Everything above is a read, so two concurrent dispatches would both pass it
    // and both create a Jira issue (a TOCTOU that produces duplicate external
    // state — unfixable after the fact). This single conditional write is the
    // serialization point: it flips jiraSyncActive false -> true only for an idea
    // that is still APPROVED and NOT already claimed, so exactly one request can
    // win and the loser gets a 409 without ever calling Jira.
    //
    // `jiraIssueId: null` is written EXPLICITLY (not left as-is) for two reasons:
    // it clears a previous issue id after a cancel/re-dispatch cycle, and it makes
    // the claim visible to the poller's stale-claim sweep, which releases a claim
    // that never got an issue id within 10 minutes (a crash between here and the
    // update below).
    //
    // The `jiraSyncActive: false` match relies on the field being EXPLICITLY
    // present — guaranteed by the create handler for new ideas and by the boot
    // backfill (utils/init-idea-jira.ts) for legacy ones, because a Prisma+Mongo
    // where-clause does not match a missing scalar.
    // ---------------------------------------------------------------------
    const claim = await prisma.idea.updateMany({
      where: { id, status: IdeaStatus.APPROVED, jiraSyncActive: false },
      data: { jiraSyncActive: true, jiraIssueId: null },
    });
    if (claim.count === 0) {
      return res.status(409).json({ error: 'A Jira task for this idea is already being created' });
    }

    const link = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/ideas/${existingIdea.id}`;
    // Plain text; utils/jira.ts converts it to ADF (REST v3 rejects a plain-string
    // description). No labels are sent — Jira rejects labels containing whitespace
    // and idea tags are free text, so tags stay in-app. Wording is Slovak, same as
    // the audience of the created tasks.
    const description = [
      existingIdea.description,
      `Prínosy: ${existingIdea.benefits}`,
      `Náročnosť: ${JIRA_EFFORT_LABELS[existingIdea.effort]}`,
      `Oddelenie: ${existingIdea.department?.name ?? '-'}`,
      `Odoslal/a: ${existingIdea.submitter.name}`,
      `IdeaHub: ${link}`,
    ].join('\n');

    const created = await createJiraIssue(cfg, {
      projectKey,
      summary: existingIdea.title,
      description,
    });

    if (!created.ok) {
      // RELEASE the claim so the idea can be dispatched again immediately. Guarded
      // on the claim we made (still active, still without an issue id) so a
      // concurrent winner's state is never clobbered, and wrapped in its own
      // try/catch so a DB hiccup here cannot mask the real failure below.
      try {
        await prisma.idea.updateMany({
          where: { id, jiraSyncActive: true, jiraIssueId: null },
          data: { jiraSyncActive: false },
        });
      } catch (releaseError) {
        console.error(`Failed to release the Jira dispatch claim ideaId=${id}:`, releaseError);
      }
      // 502: the failure is upstream, not the client's. `reason` is one of the
      // CLOSED JiraFailureReason codes (never upstream text — F9); the FE
      // translates it through a te()-guarded lookup.
      return res.status(502).json({ error: 'Failed to create the Jira issue', reason: created.reason });
    }

    const updatedIdea = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.idea.update({
        where: { id },
        data: {
          // Both values already passed the client's ingest sanitizer + id format
          // check; nothing else from the remote response is stored.
          jiraIssueId: created.issueId,
          jiraIssueKey: created.issueKey,
          // A brand-new issue is in the `new` category by definition; the raw status
          // name/assignee/resolution are unknown until the first poll, and stale
          // values from a previous dispatch must not survive a re-dispatch.
          jiraStatus: null,
          jiraStatusCategory: 'new',
          jiraAssignee: null,
          jiraResolution: null,
          jiraSyncActive: true,
          jiraLastSyncAt: new Date(),
          jiraMissingCount: null,
          // status stays APPROVED and assigneeId is untouched — see the header.
        },
        include: {
          submitter: {
            select: { id: true, name: true, email: true },
          },
          approver: {
            select: { id: true, name: true, email: true },
          },
          assignee: {
            select: { id: true, name: true, email: true },
          },
          department: {
            select: { id: true, name: true },
          },
        },
      });

      await tx.ideaEvent.create({
        data: {
          ideaId: id,
          type: EventType.JIRA_CREATED,
          // The dispatching user IS the actor here (unlike the poller-written Jira
          // events, which carry a null actor).
          byUserId: userId,
          note: `Jira task ${created.issueKey} created`,
        },
      });

      return updated;
    });

    // The link the FE opens in a new tab. Built by the client under the F7 protocol
    // rule and OMITTED entirely when it cannot be built safely.
    res.json(created.browseUrl === null ? updatedIdea : { ...updatedIdea, jiraBrowseUrl: created.browseUrl });
  } catch (error) {
    // Unlike the older handlers in this file, nothing here throws on bad INPUT (the
    // id and body are both safeParsed above), so any exception is genuinely
    // internal and must not be reported as a 400.
    console.error('Error creating jira task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Complete idea (only by assignee)
router.patch('/:id/complete', requireAuth, async (req, res) => {
  try {
    const idParsed = objectIdParamSchema.safeParse(req.params.id);
    if (!idParsed.success) {
      return res.status(400).json({ error: 'Invalid idea ID format' });
    }
    const id = idParsed.data;
    const userId = req.session.userId!;
    const { note } = reviewIdeaSchema.parse(req.body);

    const existingIdea = await prisma.idea.findUnique({
      where: { id },
    });

    if (!existingIdea) {
      return res.status(404).json({ error: 'Idea not found' });
    }

    if (existingIdea.status !== IdeaStatus.IN_PROGRESS) {
      return res.status(400).json({ error: 'Can only complete ideas in IN_PROGRESS status' });
    }

    if (existingIdea.assigneeId !== userId) {
      return res.status(403).json({ error: 'Only the assignee can complete this idea' });
    }

    const updatedIdea = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.idea.update({
        where: { id },
        data: {
          status: IdeaStatus.DONE,
          completedAt: new Date(),
        },
        include: {
          submitter: {
            select: { id: true, name: true, email: true },
          },
          approver: {
            select: { id: true, name: true, email: true },
          },
          assignee: {
            select: { id: true, name: true, email: true },
          },
          department: {
            select: { id: true, name: true },
          },
        },
      });

      await tx.ideaEvent.create({
        data: {
          ideaId: id,
          type: EventType.COMPLETED,
          byUserId: userId,
          note: note || 'Idea completed',
        },
      });

      return updated;
    });

    res.json(updatedIdea);

    // Best-effort, fire-and-forget submitter notification (after the response).
    notifySubmitter(req, updatedIdea, 'COMPLETED');
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// The dispatch dialog's PRESELECTION source (Power User or Admin — the dispatch
// audience): the project this idea's dispatch would use when the user picks
// nothing, i.e. the department override ?? the installation default (the same
// resolution POST /:id/jira-task applies). The department's key itself stays
// admin-projected (security review F8/F14); this endpoint reveals only the single
// RESOLVED key the dispatching user is about to write into anyway.
router.get('/:id/jira-target', requireRole(Role.POWER_USER, Role.ADMIN), async (req, res) => {
  try {
    const idParsed = objectIdParamSchema.safeParse(req.params.id);
    if (!idParsed.success) {
      return res.status(400).json({ error: 'Invalid idea ID format' });
    }

    const idea = await prisma.idea.findUnique({
      where: { id: idParsed.data },
      include: { department: { select: { jiraProjectKey: true } } },
    });
    if (!idea) {
      return res.status(404).json({ error: 'Idea not found' });
    }

    const cfg = await getEffectiveJiraConfig();
    res.json({ projectKey: idea.department?.jiraProjectKey ?? (cfg.defaultProjectKey || null) });
  } catch (error) {
    console.error('Error resolving the Jira target project:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Force-done override (Power User or Admin): mark an APPROVED or IN_PROGRESS idea
// DONE. Not SUBMITTED (an unreviewed idea goes through review first — approving is
// one click on the same page), not REJECTED (a rejected idea stays rejected — its
// reviewer sits in `approverId`, and a done idea would relabel that person
// "Approved by"; the path back is a fresh review), not DONE itself. The escape
// hatch for work finished outside the normal flow, or for a Jira project that can
// no longer be synced. The note is MANDATORY: the timeline entry must say why the
// lifecycle was bypassed. An active Jira sync is STOPPED (the poller would otherwise
// overwrite this decision on the next remote transition); the app never writes to
// Jira, so a still-open remote task simply stops being watched — the FE dialog
// says so. Issue key + last-seen raw status stay as history, exactly like an idea
// completed through Jira.
router.patch('/:id/mark-done', requireRole(Role.POWER_USER, Role.ADMIN), async (req, res) => {
  try {
    const idParsed = objectIdParamSchema.safeParse(req.params.id);
    if (!idParsed.success) {
      return res.status(400).json({ error: 'Invalid idea ID format' });
    }
    const id = idParsed.data;
    const userId = req.session.userId!;
    const { note } = markDoneSchema.parse(req.body);

    const existingIdea = await prisma.idea.findUnique({
      where: { id },
    });

    if (!existingIdea) {
      return res.status(404).json({ error: 'Idea not found' });
    }

    if (existingIdea.status === IdeaStatus.DONE) {
      return res.status(400).json({ error: 'Idea is already done' });
    }

    if (existingIdea.status === IdeaStatus.REJECTED) {
      return res.status(400).json({ error: 'A rejected idea cannot be marked as done' });
    }

    if (existingIdea.status === IdeaStatus.SUBMITTED) {
      return res.status(400).json({ error: 'A submitted idea must be reviewed before it can be marked as done' });
    }

    const updatedIdea = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.idea.update({
        where: { id },
        data: {
          status: IdeaStatus.DONE,
          completedAt: existingIdea.completedAt ?? new Date(),
          // Explicit false (never conditional): stops an active watch, and keeps the
          // missing-vs-null rule intact for every jira where-clause.
          jiraSyncActive: false,
          jiraMissingCount: null,
        },
        include: {
          submitter: {
            select: { id: true, name: true, email: true },
          },
          approver: {
            select: { id: true, name: true, email: true },
          },
          assignee: {
            select: { id: true, name: true, email: true },
          },
          department: {
            select: { id: true, name: true },
          },
        },
      });

      await tx.ideaEvent.create({
        data: {
          ideaId: id,
          type: EventType.COMPLETED,
          byUserId: userId,
          note,
        },
      });

      return updated;
    });

    const [serialized] = await attachJiraBrowseUrls([updatedIdea]);
    res.json(serialized);

    // Best-effort, fire-and-forget submitter notification (after the response).
    // The mandatory reason rides along so the message explains WHY the idea was
    // closed outside the normal flow (rendered as a quoted block, like a step note).
    notifySubmitter(req, updatedIdea, 'COMPLETED', note);
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Delete idea (Admin only)
router.delete('/:id', requireRole(Role.ADMIN), async (req, res) => {
  try {
    const idParsed = objectIdParamSchema.safeParse(req.params.id);
    if (!idParsed.success) {
      return res.status(400).json({ error: 'Invalid idea ID format' });
    }
    const id = idParsed.data;

    const existingIdea = await prisma.idea.findUnique({
      where: { id },
    });

    if (!existingIdea) {
      return res.status(404).json({ error: 'Idea not found' });
    }

    await prisma.idea.delete({
      where: { id },
    });

    res.json({ message: 'Idea deleted' });
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Add a progress step to an idea (assignee only, IN_PROGRESS only). stepCreateLimiter
// runs before requireAuth (same ordering and `as any` bridge as the create route)
// so the per-IP cap applies to this mail amplifier regardless of session state.
router.post('/:id/steps', stepCreateLimiter as any, requireAuth, async (req, res) => {
  try {
    const idParsed = objectIdParamSchema.safeParse(req.params.id);
    if (!idParsed.success) {
      return res.status(400).json({ error: 'Invalid idea ID format' });
    }
    const id = idParsed.data;
    const userId = req.session.userId!;
    const data = createStepSchema.parse(req.body);

    // Load the submitter alongside the existence check so the lifecycle
    // notification (below) has the recipient without a second query — unlike the
    // approve/reject/complete paths, this route has no transaction returning it.
    const existingIdea = await prisma.idea.findUnique({
      where: { id },
      include: {
        submitter: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!existingIdea) {
      return res.status(404).json({ error: 'Idea not found' });
    }

    if (existingIdea.status !== IdeaStatus.IN_PROGRESS) {
      return res.status(400).json({ error: 'Can only add steps to ideas in IN_PROGRESS status' });
    }

    if (existingIdea.assigneeId !== userId) {
      return res.status(403).json({ error: 'Only the assignee can add steps' });
    }

    const step = await prisma.ideaStep.create({
      data: {
        ideaId: id,
        text: data.text,
      },
    });

    res.status(201).json(step);

    // Best-effort, fire-and-forget submitter notification (after the response).
    notifySubmitter(req, existingIdea, 'STEP_ADDED', data.text);
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

export default router;
