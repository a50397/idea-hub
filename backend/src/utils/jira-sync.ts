// Jira -> IdeaHub status mirror (the POLLER).
//
// The app runs in a firewalled segment, so Jira cannot call in: there are no
// webhooks. Instead a timer (registered in index.ts) calls maybeRunJiraSync(), which
// — when due, not backing off and not already running — asks Jira for the current
// state of every dispatched idea and mirrors it back:
//
//   Jira status CATEGORY   ->  canonical IdeaStatus
//     new (To Do)          ->  APPROVED   (dispatched, work not started yet)
//     indeterminate        ->  IN_PROGRESS
//     done + resolution    ->  DONE, or APPROVED again for a "cancel" resolution
//
// The raw Jira status NAME, the assignee and the resolution are stored alongside for
// display; the category is what drives the lifecycle. Every mapped change also
// writes ONE timeline event, and the three MILESTONES (work started / completed /
// cancelled) additionally fire the submitter's existing notifyOnChange notification.
//
// Safety properties this module is responsible for (security review):
//   F3  Anti-amplification: at most ONE event per idea per tick, and a JIRA_STARTED
//       notification only when `startedAt` was still null (once per dispatch cycle);
//       completed/cancelled switch the sync OFF, so they are inherently once.
//   F4  Bounded work: <=500 ideas per run (oldest jiraLastSyncAt first), the client
//       chunks them <=50 per request, and deletion-confirm probes are capped.
//   F5  Every remote string was sanitized at the client's ingest boundary; remote
//       JSON is never spread into a Prisma payload, and notifications use the
//       constant actor "Jira" — never the remote assignee's display name.
//   F6  A stale dispatch claim (claimed but no issue id for >10 min — i.e. a crash
//       between the claim and the create) is released so the idea is dispatchable
//       again.
//   F11 A missing issue is cancelled only after TWO consecutive CONFIRMED 404s, so
//       a transient search lag or a permission blip cannot mass-cancel ideas.
//   F13 A 429 (Retry-After) or 5xx sets a module-level backoff that later ticks
//       honor — from the batch search AND from a deletion-confirm probe, which also
//       ends the probing for that run; a not-effectively-enabled installation does
//       no work at all.
//
// Every write is an OPTIMISTIC updateMany keyed on the state this run observed
// (`{ id, jiraIssueId: <the id we polled>, jiraSyncActive: true }`). Matching zero
// rows means the idea changed underneath us (re-dispatched, cancelled, deleted), so
// the run silently skips its event and notification for that idea instead of
// writing history for a state that no longer exists.
//
// HEALTH REPORTING: nobody watches a timer. Every run therefore records its OUTCOME
// on the JiraSettings singleton (lastSyncOk/lastSyncReason/lastSyncAt), which the
// admin settings page and the admin banner read — see recordSyncOutcome() below.

import { EventType, IdeaStatus, Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import {
  getEffectiveJiraConfig,
  getJiraSettingsRecord,
  JIRA_SETTINGS_SINGLETON,
  type EffectiveJiraConfig,
} from '../config/jira';
import {
  getJiraIssue,
  searchJiraIssuesByIds,
  type JiraFailureReason,
  type JiraIssueSnapshot,
} from './jira';
import { maybeNotifySubmitter, JIRA_ACTOR_NAME } from './lifecycle-notify';
import type { IdeaLifecycleEvent } from './mail-templates';

// Max ideas polled per run, oldest jiraLastSyncAt first (F4). A larger backlog is
// simply picked up over the following runs — never in one unbounded burst.
const MAX_IDEAS_PER_RUN = 500;

// A dispatch claim without an issue id older than this is considered abandoned
// (the process died between the atomic claim and the issue creation) and released
// so the idea can be dispatched again (F6). Comfortably longer than the client's
// 10s timeout plus any plausible retry.
const STALE_CLAIM_MS = 10 * 60 * 1000;

// Consecutive CONFIRMED 404s required before an issue counts as gone (F11). A
// single 404 is ambiguous: it is also what Jira answers when the tech user loses
// permission, and search is eventually consistent.
const MISSING_TICKS_BEFORE_CANCEL = 2;

// Deletion-confirm probes per run. Each missing issue costs one extra HTTP call, so
// a whole-project permission loss would otherwise turn one tick into hundreds of
// sequential requests. Ideas beyond the cap are simply left untouched — their
// jiraLastSyncAt is not bumped, so the oldest-first ordering probes them first on
// the next run.
const MAX_MISSING_PROBES_PER_RUN = 25;

// ---------------------------------------------------------------------------
// Module-level scheduling state
// ---------------------------------------------------------------------------

// Re-entrancy latch: a run that outlives its tick must never overlap the next one.
let running = false;
// Epoch ms of the last STARTED run, for the due check.
let lastRunAt = 0;
// Epoch ms until which every run is skipped (set from a 429's Retry-After or after
// a 5xx — F13).
let backoffUntil = 0;

/**
 * Clear the in-memory scheduling state (latch, due timestamp, backoff).
 *
 * Exists for tests, which need each case to start from a known scheduling state.
 * It is safe by construction: it touches no database state and only ever makes the
 * next tick run EARLIER, never changes what a run does.
 */
export function resetJiraSyncState(): void {
  running = false;
  lastRunAt = 0;
  backoffUntil = 0;
}

/** Current backoff deadline (epoch ms; 0 = none). Exposed for assertions/logging. */
export function getJiraSyncBackoffUntil(): number {
  return backoffUntil;
}

/**
 * Park every later tick until the advised deadline (F13). ONE place, because both
 * things that can earn a backoff — the batch search and a deletion-confirm probe —
 * have to park the SAME module-level clock; a second, private "wait" in either path
 * would be a backoff Jira asked for and the poller ignored.
 *
 * `retryAfterSeconds` is already clamped to [1s, 1h] by the client, so a hostile or
 * broken Retry-After can neither hot-loop the poller nor silence it for days.
 */
function applyBackoff(retryAfterSeconds: number, reason: JiraFailureReason): void {
  backoffUntil = Date.now() + retryAfterSeconds * 1000;
  console.warn(`[JIRA] sync backing off for ${retryAfterSeconds}s (reason=${reason})`);
}

// ---------------------------------------------------------------------------
// Sync health: making a failing poller VISIBLE
// ---------------------------------------------------------------------------
//
// A failed run used to exist only as a console line. That is fine for a request —
// somebody is waiting for the response — but this runs on a timer, so an expired API
// token, a revoked permission or (the motivating case) a ROTATED MAIL_SETTINGS_KEY
// that leaves the stored token undecryptable would stop the mirroring silently: the
// UI keeps showing whatever Jira last said, forever.
//
// So each run records its outcome on the JiraSettings singleton, which
// GET /api/jira-settings surfaces on the admin settings page and GET /api/options
// turns into the admin-only `jiraSyncFailing` banner flag.
//
// Written on TRANSITION ONLY: an outcome identical to the stored one writes nothing.
// A 5-minute poll would otherwise rewrite the same row ~288 times a day for no
// information, and — more importantly — it is what lets `lastSyncAt` mean "in this
// state SINCE" (the admin sees how long it has been broken) rather than the useless
// "we tried again just now".

/** What one run has to say about itself. `null` = nothing worth recording. */
type SyncOutcome = { ok: true } | { ok: false; reason: JiraFailureReason };

/**
 * The outcome for a run that will NOT poll because the integration is not
 * effectively enabled.
 *
 * Almost every such state is intentional (Jira switched off, or configured only
 * half-way while an admin is still filling the form) and reporting it would be
 * noise — those record NOTHING, leaving whatever the last real run said.
 *
 * The ONE exception is the reason this reporting exists: `enabled` is on and a token
 * IS stored, but it no longer DECRYPTS. That means the encryption key changed under
 * a working installation (MAIL_SETTINGS_KEY rotated), which is invisible everywhere
 * else — the admin page still shows `hasToken: true`, the config just quietly stops
 * being "effective". It is reported as `config_error`, the same closed code the
 * connection test returns for an unusable configuration (never any detail about the
 * secret itself).
 */
function outcomeWhenNotEffectivelyEnabled(cfg: EffectiveJiraConfig): SyncOutcome | null {
  if (!cfg.enabled) return null; // switched off on purpose
  if (cfg.hasToken && !cfg.tokenDecryptable) return { ok: false, reason: 'config_error' };
  return null; // enabled but simply not (yet) configured
}

/**
 * Persist a run's outcome on the settings singleton, IF it differs from the stored
 * one.
 *
 * Never throws and never rejects: the health record is a diagnostic, so a failure to
 * write it is logged and the run carries on (the poller's never-throws discipline).
 * Nothing here touches the token, and only the closed reason CODE is stored — the
 * status write cannot leak configuration or upstream error text (F9).
 */
async function recordSyncOutcome(outcome: SyncOutcome | null): Promise<void> {
  if (outcome === null) return;

  const reason = outcome.ok ? null : outcome.reason;
  try {
    // Read the CURRENT stored status rather than trusting the config snapshot this
    // run started with: this is the value the transition is defined against.
    const stored = await getJiraSettingsRecord();
    if (stored.lastSyncOk === outcome.ok && stored.lastSyncReason === reason) {
      return; // same state as before — keep lastSyncAt pointing at when it began
    }

    // A first success after failures is a transition like any other: it clears the
    // reason and re-stamps lastSyncAt, so "healthy since ..." is equally true.
    const data = { lastSyncOk: outcome.ok, lastSyncReason: reason, lastSyncAt: new Date() };
    await prisma.jiraSettings.upsert({
      where: { singleton: JIRA_SETTINGS_SINGLETON },
      // The create branch is a race-only path (the document existed a moment ago —
      // `enabled` is read from it). It writes ONLY status fields; everything else
      // falls back to the schema defaults, i.e. a disabled integration, so a
      // resurrected document can never re-enable anything or invent a credential.
      create: data,
      update: data,
    });
  } catch (error) {
    // Includes the P2002 a concurrent first-create would raise here: the next run
    // records the outcome anyway, so there is nothing to recover.
    console.error(`[JIRA] recording the sync outcome failed (ok=${outcome.ok}):`, error);
  }
}

/**
 * The `JIRA_POLL_INTERVAL_MS` override in milliseconds, or null when it is absent,
 * unusable (non-numeric / <= 0) or — the enforcement — this is not a test run.
 *
 * TEST-ONLY, ENFORCED (not by convention), for the same reason config/jira.ts gates
 * JIRA_API_BASE_URL: outside a test run this variable is a lever on how often a
 * production installation talks to Jira, settable from the environment, that no
 * admin can see in the UI. Every tier that legitimately uses it runs with
 * NODE_ENV=test (the unit tier, the integration tier, and the e2e backend via
 * e2e/support/config.ts).
 *
 * `env` is a parameter so the predicate below is PURE and directly unit-testable.
 */
export function jiraPollIntervalOverrideMs(env: NodeJS.ProcessEnv = process.env): number | null {
  if (env.NODE_ENV !== 'test') return null;
  const override = Number(env.JIRA_POLL_INTERVAL_MS);
  return Number.isFinite(override) && override > 0 ? override : null;
}

/**
 * Should index.ts register the poll timer at all?
 *
 * NORMALLY YES — a production (or dev, or staging) installation must poll, or
 * dispatched ideas silently stop being mirrored. Under NODE_ENV=test it registers
 * ONLY when a usable JIRA_POLL_INTERVAL_MS override is present: that override is the
 * e2e enabler (the e2e backend runs with NODE_ENV=test), while the unit and
 * integration tiers — which boot this same app — must stay free of a background
 * timer that would race their fixtures.
 *
 * Lives here, exported and pure, precisely because it is a one-line condition whose
 * inversion is invisible: flipping it the wrong way leaves every suite green while
 * production quietly stops dispatching. Its four arms are unit-tested.
 */
export function shouldRegisterJiraPollTimer(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== 'test') return true;
  return jiraPollIntervalOverrideMs(env) !== null;
}

/**
 * How long between runs. The JIRA_POLL_INTERVAL_MS override (test runs only, see
 * above) wins over the admin-configured period.
 */
function duePeriodMs(cfg: EffectiveJiraConfig): number {
  return jiraPollIntervalOverrideMs() ?? cfg.pollIntervalMinutes * 60_000;
}

/**
 * The timer entry point: run one sync IF one is due, nothing is already running and
 * no backoff is in effect. Never throws (a rejection here would surface as an
 * unhandled rejection in a bare setInterval callback).
 */
export async function maybeRunJiraSync(): Promise<void> {
  if (running) return; // a previous run is still going
  const now = Date.now();
  if (now < backoffUntil) return; // Jira told us to wait (F13)

  running = true;
  try {
    // Read the settings fresh every tick so enabling/disabling Jira or changing the
    // interval takes effect without a restart.
    const cfg = await getEffectiveJiraConfig();
    if (!cfg.effectiveEnabled) {
      // Dark installation: no polling work at all — but an installation that is
      // enabled with an UNDECRYPTABLE token is broken, not dark, and says so.
      await recordSyncOutcome(outcomeWhenNotEffectivelyEnabled(cfg));
      return;
    }
    if (now - lastRunAt < duePeriodMs(cfg)) return; // not due yet
    lastRunAt = now;
    await runJiraSyncOnce(cfg);
  } catch (error) {
    console.error('[JIRA] sync tick failed:', error);
  } finally {
    running = false;
  }
}

// The idea shape one run works with — exactly the fields the mapping, the event and
// the notification need (never `select: *`).
const SYNC_IDEA_SELECT = {
  id: true,
  title: true,
  status: true,
  notifyOnChange: true,
  submitterId: true,
  startedAt: true,
  completedAt: true,
  jiraIssueId: true,
  jiraIssueKey: true,
  jiraStatus: true,
  jiraStatusCategory: true,
  jiraAssignee: true,
  jiraResolution: true,
  jiraMissingCount: true,
  submitter: { select: { id: true, name: true, email: true } },
} as const;

type SyncIdea = Prisma.IdeaGetPayload<{ select: typeof SYNC_IDEA_SELECT }>;

/** What one idea's tick decided to do. `data` always carries at least the timestamp. */
interface SyncDecision {
  data: Prisma.IdeaUpdateManyMutationInput;
  /** At most ONE timeline event per idea per tick (F3). */
  event: { type: EventType; note: string } | null;
  /** Milestone notification to fire after the write actually applied. */
  notify: Extract<IdeaLifecycleEvent, 'JIRA_STARTED' | 'JIRA_COMPLETED' | 'JIRA_CANCELLED'> | null;
}

/** "Old → New" note text for a status transition; a missing name renders as "-". */
function transitionNote(previous: string | null, next: string | null): string {
  return `${previous ?? '-'} → ${next ?? '-'}`;
}

/**
 * Decide what a still-present issue means for the idea. PURE: no I/O, no clock read
 * (the caller passes `now`), so the whole transition matrix is unit-testable.
 *
 * Rules (see the module header for the mapping):
 *   - the raw mirrored fields are updated whenever they differ,
 *   - a CATEGORY transition additionally moves the canonical status and writes one
 *     event; the milestones also request a notification,
 *   - a status-NAME-only change writes an event but never notifies,
 *   - an assignee/resolution-only change writes neither,
 *   - a tick that changes nothing still bumps jiraLastSyncAt and clears the
 *     missing-tick counter.
 * When Jira reports no usable category (a malformed payload) the canonical status is
 * deliberately left alone — mirroring only what we understood.
 */
function decidePresentIssue(
  idea: SyncIdea,
  snapshot: JiraIssueSnapshot,
  cancelResolutions: string[],
  now: Date
): SyncDecision {
  const data: Prisma.IdeaUpdateManyMutationInput = {
    jiraLastSyncAt: now,
    // The issue answered, so any earlier "missing" streak is void (F11).
    jiraMissingCount: null,
  };

  // An issue key CHANGES when the issue moves to another project — refresh it (the
  // numeric id we poll by is what stays stable).
  if (snapshot.key !== null && snapshot.key !== idea.jiraIssueKey) {
    data.jiraIssueKey = snapshot.key;
  }

  const statusNameChanged = snapshot.statusName !== idea.jiraStatus;
  if (statusNameChanged) data.jiraStatus = snapshot.statusName;
  if (snapshot.assignee !== idea.jiraAssignee) data.jiraAssignee = snapshot.assignee;
  if (snapshot.resolution !== idea.jiraResolution) data.jiraResolution = snapshot.resolution;

  const previousCategory = idea.jiraStatusCategory;
  const category = snapshot.categoryKey;
  if (category !== null && category !== previousCategory) data.jiraStatusCategory = category;

  const note = transitionNote(idea.jiraStatus, snapshot.statusName);

  // --- work STARTED -------------------------------------------------------
  if (category === 'indeterminate' && previousCategory !== 'indeterminate') {
    // F3 latch: startedAt is set exactly once per dispatch cycle (a cancel resets
    // it), so a status flapping in and out of "In Progress" notifies only the first
    // time while still recording every transition as an event.
    const startedWasUnset = idea.startedAt === null;
    data.status = IdeaStatus.IN_PROGRESS;
    if (startedWasUnset) data.startedAt = now;
    return {
      data,
      event: { type: EventType.JIRA_STATUS_CHANGED, note },
      notify: startedWasUnset ? 'JIRA_STARTED' : null,
    };
  }

  // --- reached a FINAL state ---------------------------------------------
  if (category === 'done' && previousCategory !== 'done') {
    const resolution = snapshot.resolution;
    // The cancel list matches the RESOLUTION when Jira provides one, and ALSO the
    // raw STATUS NAME: team-managed Jira Cloud projects often have no resolution
    // field at all — closing an issue there as "Won't Do" arrives as a
    // done-category status literally named "Won't Do" with resolution: null
    // (observed live 2026-08-20), and keying on the resolution alone counted that
    // as a successful completion.
    const cancelled =
      (resolution !== null && cancelResolutions.includes(resolution.toLowerCase())) ||
      (snapshot.statusName !== null &&
        cancelResolutions.includes(snapshot.statusName.toLowerCase()));

    if (cancelled) {
      // Unsuccessful final state: the idea returns to APPROVED and may be
      // dispatched again. The execution timestamps are cleared because no execution
      // happened; the timeline keeps the record.
      data.status = IdeaStatus.APPROVED;
      data.startedAt = null;
      data.completedAt = null;
      data.jiraSyncActive = false; // final: stop polling this idea
      // The RAW mirror fields are cleared too (overriding whatever this same tick
      // set above). They describe a live Jira issue, and this idea no longer has
      // one: keeping them would leave a re-dispatchable APPROVED idea wearing the
      // closing status — the FE renders its chip off `jiraStatus`, so a cancelled
      // idea would sit in the approved list showing a green "Done". The issue
      // id/key are deliberately KEPT (that is the history of which issue it was),
      // and the closing status + resolution are preserved in the event note below.
      data.jiraStatus = null;
      data.jiraStatusCategory = null;
      data.jiraAssignee = null;
      data.jiraResolution = null;
      return {
        data,
        event: {
          type: EventType.JIRA_CANCELLED,
          // No resolution suffix when the cancel matched on the status name alone.
          note: resolution !== null ? `${note} (resolution: ${resolution})` : note,
        },
        notify: 'JIRA_CANCELLED',
      };
    }

    // Successful final state (including a done category with no resolution).
    data.status = IdeaStatus.DONE;
    if (idea.completedAt === null) data.completedAt = now;
    data.jiraSyncActive = false; // final: stop polling this idea
    return {
      data,
      event: { type: EventType.JIRA_STATUS_CHANGED, note },
      notify: 'JIRA_COMPLETED',
    };
  }

  // --- work UN-started (moved back to To Do) ------------------------------
  // `previousCategory !== null` keeps a first sighting from looking like a
  // regression. startedAt is deliberately KEPT: work did start once, and the value
  // feeds the reports. Sync stays on — this is not a final state.
  if (category === 'new' && previousCategory !== null && previousCategory !== 'new') {
    data.status = IdeaStatus.APPROVED;
    return { data, event: { type: EventType.JIRA_STATUS_CHANGED, note }, notify: null };
  }

  // --- no category transition --------------------------------------------
  // A raw status-NAME change inside the same category is worth a timeline entry
  // ("In Progress → In Review"), but the FIRST SIGHTING is not: right after dispatch
  // the stored raw name is still null (only the category is known), so the first
  // tick would otherwise write a meaningless "- → To Do" entry directly under
  // "Jira task created". Suppressing it keeps the timeline honest and cuts one more
  // event per dispatch (F3). Nothing is lost: a first tick that ALSO carries a
  // category transition is handled by the branches above, which do write their event.
  const firstSighting = idea.jiraStatus === null;
  return {
    data,
    event: statusNameChanged && !firstSighting ? { type: EventType.JIRA_STATUS_CHANGED, note } : null,
    notify: null,
  };
}

/**
 * Apply one idea's decision.
 *
 * The where-clause is the OPTIMISTIC guard: it pins the idea to the exact issue id
 * this run polled and to an active sync. Zero matched rows means the idea moved on
 * (re-dispatched, already finalized, deleted) — the caller then skips the event and
 * the notification rather than writing history for a state that no longer exists.
 * The event is written inside the SAME transaction as the update, so an idea can
 * never end up with a mirrored status but no timeline entry.
 *
 * Returns true when the write applied.
 */
async function applyDecision(idea: SyncIdea, decision: SyncDecision): Promise<boolean> {
  const where = {
    id: idea.id,
    jiraIssueId: idea.jiraIssueId,
    jiraSyncActive: true,
  };

  if (decision.event === null) {
    const result = await prisma.idea.updateMany({ where, data: decision.data });
    return result.count > 0;
  }

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const result = await tx.idea.updateMany({ where, data: decision.data });
    if (result.count === 0) return false;
    await tx.ideaEvent.create({
      data: {
        ideaId: idea.id,
        type: decision.event!.type,
        // No human actor: this is the poller. The event-type set is what partitions
        // the actor (see prisma/schema.prisma EventType) — JIRA_STATUS_CHANGED and
        // JIRA_CANCELLED are ALWAYS user-less, which the timeline renders as "Jira".
        byUserId: null,
        note: decision.event!.note,
      },
    });
    return true;
  });
}

/**
 * Fire the milestone notification for an applied decision. Best-effort and
 * fire-and-forget, exactly like the request-path notifications.
 *
 * The actor is the CONSTANT "Jira" (F5) — never the remote assignee's display name —
 * and `actorUserId` is null, which the self-notification guard treats as "not the
 * submitter" so an idea whose submitter happens to be the Jira assignee is still
 * notified.
 */
function notifyMilestone(idea: SyncIdea, decision: SyncDecision, issueKey: string | null): void {
  if (decision.notify === null) return;
  maybeNotifySubmitter({
    idea: {
      id: idea.id,
      title: idea.title,
      notifyOnChange: idea.notifyOnChange,
      submitterId: idea.submitterId,
      submitter: idea.submitter,
    },
    event: decision.notify,
    actorUserId: null,
    actorName: JIRA_ACTOR_NAME,
    jiraKey: issueKey ?? '',
  });
}

/**
 * Handle an idea whose issue was NOT in the search result.
 *
 * A search miss is NOT proof of deletion (Jira search is eventually consistent), so
 * the issue is re-read directly. Only an HTTP 404 counts as gone, and even then only
 * on the SECOND consecutive confirmed tick (F11) — a 404 also appears when the tech
 * user merely loses permission, and cancelling every idea of a project over a
 * permission blip would be catastrophic. Any other failure skips the tick entirely
 * (the streak is cleared, since we did not confirm anything).
 *
 * Returns TRUE when the run must stop probing: the probe came back with an advisory
 * wait (a 429's Retry-After, or a 5xx), which has now been applied to the module
 * backoff. See the call site.
 */
async function handleMissingIssue(
  cfg: EffectiveJiraConfig,
  idea: SyncIdea,
  cancelResolutions: string[],
  now: Date
): Promise<boolean> {
  const probe = await getJiraIssue(cfg, idea.jiraIssueId as string);

  if (!probe.ok) {
    // Unconfirmed: the probe itself failed (timeout, 5xx, permission). Bump the
    // timestamp and RESET the streak — nothing was proven this tick.
    await applyDecision(idea, {
      data: { jiraLastSyncAt: now, jiraMissingCount: null },
      event: null,
      notify: null,
    });
    // F13: these probes are single-issue GETs made in a loop, so they are exactly
    // the traffic a rate limit is aimed at — and the batch search that preceded them
    // succeeded, so nothing else in this run would have noticed. Honoring the wait
    // here parks later ticks AND (via the return) stops the remaining probes of this
    // run, instead of firing up to MAX_MISSING_PROBES_PER_RUN more requests at a Jira
    // that just asked us to stop.
    if (probe.retryAfterSeconds !== undefined) {
      applyBackoff(probe.retryAfterSeconds, probe.reason);
      return true;
    }
    return false;
  }

  if (probe.found) {
    // Search lag only: the issue is alive. Treat exactly like a present issue.
    const decision = decidePresentIssue(idea, probe.issue, cancelResolutions, now);
    const applied = await applyDecision(idea, decision);
    if (applied) notifyMilestone(idea, decision, probe.issue.key ?? idea.jiraIssueKey);
    return false;
  }

  // Confirmed 404 on this tick.
  const streak = (idea.jiraMissingCount ?? 0) + 1;
  if (streak < MISSING_TICKS_BEFORE_CANCEL) {
    await applyDecision(idea, {
      data: { jiraLastSyncAt: now, jiraMissingCount: streak },
      event: null,
      notify: null,
    });
    return false;
  }

  // Two consecutive confirmed 404s: treat as an unsuccessful final state. The idea
  // returns to APPROVED (re-dispatch allowed) and sync stops, so this can notify at
  // most once per dispatch cycle. The raw mirror fields are cleared for the same
  // reason as the cancel-resolution path above (a re-dispatchable idea must not keep
  // showing the dead issue's status); the id/key stay as history and the event note
  // records what happened.
  const decision: SyncDecision = {
    data: {
      status: IdeaStatus.APPROVED,
      startedAt: null,
      completedAt: null,
      jiraSyncActive: false,
      jiraMissingCount: null,
      jiraLastSyncAt: now,
      jiraStatus: null,
      jiraStatusCategory: null,
      jiraAssignee: null,
      jiraResolution: null,
    },
    event: {
      type: EventType.JIRA_CANCELLED,
      note: `Jira task ${idea.jiraIssueKey ?? idea.jiraIssueId} was deleted or is no longer accessible`,
    },
    notify: 'JIRA_CANCELLED',
  };
  const applied = await applyDecision(idea, decision);
  if (applied) notifyMilestone(idea, decision, idea.jiraIssueKey);
  return false;
}

/**
 * One full sync pass. Exported so the integration tier can drive it deterministically
 * (no timer, no waiting). NEVER throws: a per-idea failure is logged and the run
 * continues with the next idea, and a config/search failure ends the run cleanly.
 *
 * `cfgOverride` lets maybeRunJiraSync pass the settings it already read (one read
 * per tick); a direct caller gets a fresh read.
 */
export async function runJiraSyncOnce(cfgOverride?: EffectiveJiraConfig): Promise<void> {
  let cfg: EffectiveJiraConfig;
  try {
    cfg = cfgOverride ?? (await getEffectiveJiraConfig());
  } catch (error) {
    console.error('[JIRA] sync settings read failed:', error);
    // Nothing is recorded here on purpose: the settings document is exactly what
    // could not be read, so the status write would fail the same way.
    return;
  }
  if (!cfg.effectiveEnabled) {
    await recordSyncOutcome(outcomeWhenNotEffectivelyEnabled(cfg));
    return;
  }

  const now = new Date();

  // --- F6: release abandoned dispatch claims ------------------------------
  // The dispatch endpoint claims an idea (jiraSyncActive=true, jiraIssueId=null)
  // BEFORE calling Jira. If the process dies in between, that claim would block the
  // idea forever; releasing it here is the only recovery path. Matching an EXPLICIT
  // null issue id is what the endpoint writes it for.
  try {
    const released = await prisma.idea.updateMany({
      where: {
        jiraSyncActive: true,
        jiraIssueId: null,
        updatedAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) },
      },
      data: { jiraSyncActive: false },
    });
    if (released.count > 0) {
      console.log(`[JIRA] released ${released.count} stale Jira dispatch claim(s)`);
    }
  } catch (error) {
    // Non-fatal: the sweep is recovery, not the main job.
    console.error('[JIRA] stale dispatch claim sweep failed:', error);
  }

  // --- load the batch -----------------------------------------------------
  // `isSet` (not a bare `not: null`) because a document that PREDATES the Jira
  // fields has no such field at all, and a Prisma+Mongo where-clause does not match
  // a missing scalar. Oldest-first + a hard cap bound the work per run (F4).
  let ideas: SyncIdea[];
  try {
    ideas = await prisma.idea.findMany({
      where: {
        jiraSyncActive: true,
        jiraIssueId: { isSet: true, not: null },
      },
      select: SYNC_IDEA_SELECT,
      orderBy: { jiraLastSyncAt: 'asc' },
      take: MAX_IDEAS_PER_RUN,
    });
  } catch (error) {
    console.error('[JIRA] sync could not load dispatched ideas:', error);
    // Same reasoning as the settings read above: the database is what failed, so
    // there is no point (and no way) to record a Jira health verdict about it.
    return;
  }

  // A run with nothing dispatched still COMPLETED — the integration is healthy, it
  // simply had no work. Recording it is what lets a freshly configured installation
  // report "ok" before the first idea is ever dispatched.
  if (ideas.length === 0) {
    await recordSyncOutcome({ ok: true });
    return;
  }

  // --- ask Jira -----------------------------------------------------------
  const ids = ideas
    .map((idea) => idea.jiraIssueId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  const search = await searchJiraIssuesByIds(cfg, ids);
  if (!search.ok && search.reason !== 'invalid_request') {
    // A partial result would look like deletions, so a failed chunk aborts the whole
    // run. A 429 (Retry-After) or a 5xx additionally parks the poller (F13).
    if (search.retryAfterSeconds !== undefined) {
      applyBackoff(search.retryAfterSeconds, search.reason);
    } else {
      console.error(`[JIRA] sync search failed (reason=${search.reason})`);
    }
    // The run was ABORTED: the ideas in this batch were not mirrored. This is the
    // failure an admin has to see (bad credential, unreachable host, rate limit),
    // reported as the same closed reason code the log carries.
    await recordSyncOutcome({ ok: false, reason: search.reason });
    return;
  }

  // invalid_request means Jira rejected the JQL itself — and one DELETED issue id
  // does exactly that: `id in (...)` 400s when an id no longer resolves, so a
  // single deleted task used to abort every subsequent run, wedging its idea in
  // APPROVED with sync active (no re-dispatch button) and freezing every other
  // synced idea with it (observed live 2026-08-20). Degrade such a run to an empty
  // result instead: every idea then takes the missing path below, whose per-issue
  // GET probes still fully sync the alive ones (found → decidePresentIssue) while
  // a real deletion confirms via 404 on two consecutive ticks (F11), stops syncing,
  // and thereby leaves the batch — the JQL heals itself.
  if (!search.ok) {
    console.error('[JIRA] batch search rejected (invalid_request) — probing issues individually this run');
  }
  const issuesById = search.ok ? search.issues : new Map<string, JiraIssueSnapshot>();

  // --- apply --------------------------------------------------------------
  let missingProbes = 0;
  // Set once a probe came back with an advisory wait (F13): the remaining missing
  // ideas of this run are then treated exactly like the ones past the probe cap.
  let probesParked = false;
  for (const idea of ideas) {
    // Each idea is independent: one failure must not abort the batch.
    try {
      const snapshot = issuesById.get(idea.jiraIssueId as string);

      if (snapshot === undefined) {
        if (probesParked || missingProbes >= MAX_MISSING_PROBES_PER_RUN) {
          // Leave this idea completely untouched (its jiraLastSyncAt stays old, so
          // the oldest-first ordering picks it up first next run).
          continue;
        }
        missingProbes++;
        probesParked = await handleMissingIssue(cfg, idea, cfg.cancelResolutions, now);
        continue;
      }

      const decision = decidePresentIssue(idea, snapshot, cfg.cancelResolutions, now);
      const applied = await applyDecision(idea, decision);
      // A zero-row update means this run raced a concurrent change: skip the event
      // (already skipped inside the transaction) and the notification.
      if (applied) notifyMilestone(idea, decision, snapshot.key ?? idea.jiraIssueKey);
    } catch (error) {
      console.error(`[JIRA] sync failed for ideaId=${idea.id}:`, error);
    }
  }

  // The run reached the end: Jira answered and every idea was given its tick. A
  // single idea's own failure (logged above, isolated by design) does NOT make the
  // integration "failing" — that verdict is reserved for a run that could not talk
  // to Jira at all, which is the state an admin can actually act on.
  await recordSyncOutcome({ ok: true });
}
