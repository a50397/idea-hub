// Fire-and-forget lifecycle notification to an idea's submitter.
//
// Modeled EXACTLY on the create handler's department-notification block
// (routes/ideas.ts): the whole send runs inside an async IIFE with its own
// try/catch AFTER the request has already responded, so it can never gate, delay,
// or fail the caller's request — a mail outage or a settings-read failure is
// logged and swallowed, never surfaced.
//
// Only the submitter is notified, and only when they opted in (notifyOnChange).
// A change the submitter made themselves (actor == submitter) never mails.

import { sendMail } from './mailer';
import { ideaLifecycleEmail, type IdeaLifecycleEvent } from './mail-templates';
import { getEffectiveMailConfig } from '../config/mail';

// The minimal idea shape the notification needs: the opt-in flag, the submitter
// (id for the self-notification guard, email as the recipient), plus title/id for
// the mail body and link. Satisfied by the include shape the lifecycle routes
// already load (submitter selected with id/name/email; all scalars present).
export interface NotifiableIdea {
  id: string;
  title: string;
  notifyOnChange: boolean | null;
  submitterId: string;
  submitter: { id: string; name: string; email: string } | null;
}

export interface MaybeNotifyArgs {
  idea: NotifiableIdea;
  event: IdeaLifecycleEvent;
  /** The user who performed the change (session user). */
  actorUserId: string;
  /** Display name of the actor, for the mail body. */
  actorName: string;
  /** Progress-step text; only meaningful for the STEP_ADDED event. */
  stepText?: string;
}

/**
 * Best-effort: notify the submitter that their idea changed. Returns immediately;
 * the actual send is scheduled as a fire-and-forget IIFE. Bails (no mail) when the
 * submitter opted out (null==false), has no email, is themselves the actor, or
 * outbound mail is not effectively enabled.
 */
export function maybeNotifySubmitter({ idea, event, actorUserId, actorName, stepText }: MaybeNotifyArgs): void {
  // Synchronous bails — cheap, and keep the request path clean when nothing sends.
  if (!idea.notifyOnChange) return; // opted out (or legacy null == false)
  const to = idea.submitter?.email;
  if (!to) return; // no recipient
  if (actorUserId === idea.submitterId) return; // no self-notification

  // Fire-and-forget: read the effective config, build the template, send. Errors
  // are logged and swallowed so the already-sent response is never affected. This
  // mirrors the create handler's mail block one-for-one (same single settings read
  // handed straight to sendMail, same idea-link construction).
  void (async () => {
    try {
      const cfg = await getEffectiveMailConfig();
      if (!cfg.effectiveEnabled) return; // mail off / half-configured: nothing to send
      const link = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/ideas/${idea.id}`;
      const { subject, text } = ideaLifecycleEmail({
        event,
        title: idea.title,
        actorName,
        stepText,
        link,
        language: cfg.language,
      });
      // Pass the config we ALREADY read so sendMail does not read the settings a
      // second time — exactly one settings read per notification.
      await sendMail({ to, subject, text }, cfg);
    } catch (err) {
      console.error(`[MAIL] lifecycle notification failed ideaId=${idea.id} event=${event}:`, err);
    }
  })();
}
