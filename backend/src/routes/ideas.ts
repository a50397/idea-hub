import { Router } from 'express';
import { IdeaStatus, EventType, Role, Prisma } from '@prisma/client';
import { rateLimit } from 'express-rate-limit';
import prisma from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { createIdeaSchema, reviewIdeaSchema, updateIdeaSchema, ideasQuerySchema, createStepSchema, objectIdParamSchema } from '../utils/validation';
import { sendMail } from '../utils/mailer';
import { newIdeaEmail } from '../utils/mail-templates';
import { getEffectiveMailConfig } from '../config/mail';

const router = Router();

// Dedicated limiter for idea creation. A single POST /api/ideas can fan out up to
// ~20 department-notification emails carrying a user-controlled subject/body, so
// this route is a mail amplifier that the general /api limiter alone guards too
// loosely. Mirrors loginLimiter (routes/auth.ts): same express-rate-limit import,
// standardHeaders, and house { error } 429 shape.
//
// CRITICAL skip parity: identical to the general limiter (index.ts) —
// test || development (NOT the auth limiters, which skip test only) — so the
// real-DB integration tier (many creates from one loopback IP) and local dev are
// NOT throttled, while production/staging still are.
const ideaCreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  // 30 is deliberately generous for legitimate use while capping worst-case mail
  // amplification (~20 recipients × 30 creates per window). Tunable.
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development',
  message: { error: 'Too many idea submissions. Please try again later.' },
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
      data: ideas,
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

    res.json(idea);
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

    // Fetch name + notificationEmails alongside the existence check (no second
    // query): name feeds the notification subject, notificationEmails its
    // recipients.
    const department = await prisma.department.findUnique({
      where: { id: data.departmentId },
      select: { name: true, notificationEmails: true },
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
          await sendMail({ to: recipients, subject, text });
        } catch {
          /* best-effort: never affects the already-sent 201 (mailer logs its own failures) */
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

    // TODO: Send notification to submitter
    console.log(`[NOTIFICATION] Idea "${updatedIdea.title}" approved by ${req.session.name}`);

    res.json(updatedIdea);
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
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Claim idea (start working on approved idea)
router.patch('/:id/claim', requireAuth, async (req, res) => {
  try {
    const idParsed = objectIdParamSchema.safeParse(req.params.id);
    if (!idParsed.success) {
      return res.status(400).json({ error: 'Invalid idea ID format' });
    }
    const id = idParsed.data;
    const userId = req.session.userId!;

    const existingIdea = await prisma.idea.findUnique({
      where: { id },
    });

    if (!existingIdea) {
      return res.status(404).json({ error: 'Idea not found' });
    }

    if (existingIdea.status !== IdeaStatus.APPROVED) {
      return res.status(400).json({ error: 'Can only claim ideas in APPROVED status' });
    }

    const updatedIdea = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.idea.update({
        where: { id },
        data: {
          status: IdeaStatus.IN_PROGRESS,
          assigneeId: userId,
          startedAt: new Date(),
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
          type: EventType.CLAIMED,
          byUserId: userId,
          note: 'Claimed and started working on idea',
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

// Add a progress step to an idea (assignee only, IN_PROGRESS only)
router.post('/:id/steps', requireAuth, async (req, res) => {
  try {
    const idParsed = objectIdParamSchema.safeParse(req.params.id);
    if (!idParsed.success) {
      return res.status(400).json({ error: 'Invalid idea ID format' });
    }
    const id = idParsed.data;
    const userId = req.session.userId!;
    const data = createStepSchema.parse(req.body);

    const existingIdea = await prisma.idea.findUnique({
      where: { id },
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
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

export default router;
