// Fire-and-forget lifecycle notification to an idea's submitter, across every
// effectively-enabled channel (mail + Webex).
//
// Modeled on the create handler's department-notification block (routes/ideas.ts):
// each channel's send runs inside its OWN async IIFE with its OWN try/catch AFTER
// the request has already responded, so it can never gate, delay, or fail the
// caller's request — and, critically, the two channels are INDEPENDENT: a mail
// outage (or settings-read failure) never affects the Webex send and vice versa.
// One `notifyOnChange` opt-in fires both channels; each is best-effort and logs +
// swallows its own failures. A channel that is not effectively enabled simply does
// nothing (so when BOTH are off, nothing is sent).
//
// Only the submitter is notified, and only when they opted in (notifyOnChange).
// A change the submitter made themselves (actor == submitter) never notifies.

import { sendMail } from './mailer';
import { ideaLifecycleEmail, type IdeaLifecycleEvent } from './mail-templates';
import { getEffectiveMailConfig } from '../config/mail';
import { sendWebexMessage, getEffectiveWebexConfig } from './webex';
import { ideaLifecycleWebexMessage } from './webex-templates';

// The minimal idea shape the notification needs: the opt-in flag, the submitter
// (id for the self-notification guard, email as the recipient), plus title/id for
// the message body and link. Satisfied by the include shape the lifecycle routes
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
  /** Display name of the actor, for the message body. */
  actorName: string;
  /** Progress-step text; only meaningful for the STEP_ADDED event. */
  stepText?: string;
}

/**
 * Best-effort: notify the submitter that their idea changed, over every
 * effectively-enabled channel. Returns immediately; each channel's send is
 * scheduled as its own fire-and-forget IIFE. Bails (nothing sent, no channel even
 * read) when the submitter opted out (null==false), has no email, or is themselves
 * the actor. Otherwise mail fires when mail is effectively enabled and Webex fires
 * when Webex is effectively enabled — independently, so one failing never affects
 * the other.
 */
export function maybeNotifySubmitter({ idea, event, actorUserId, actorName, stepText }: MaybeNotifyArgs): void {
  // Synchronous bails — cheap, and keep the request path clean when nothing sends.
  // These are the SHARED opt-in / recipient guards; when they pass, each channel
  // independently decides whether it is effectively enabled.
  if (!idea.notifyOnChange) return; // opted out (or legacy null == false)
  const to = idea.submitter?.email;
  if (!to) return; // no recipient
  if (actorUserId === idea.submitterId) return; // no self-notification

  const link = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/ideas/${idea.id}`;

  // Mail channel — independent, best-effort. Reads its own effective config once
  // and hands it straight to sendMail (exactly one settings read per notification);
  // any error is logged and swallowed so neither the already-sent response nor the
  // Webex channel is affected.
  void (async () => {
    try {
      const cfg = await getEffectiveMailConfig();
      if (!cfg.effectiveEnabled) return; // mail off / half-configured: nothing to send
      const { subject, text } = ideaLifecycleEmail({
        event,
        title: idea.title,
        actorName,
        stepText,
        link,
        language: cfg.language,
      });
      await sendMail({ to, subject, text }, cfg);
    } catch (err) {
      console.error(`[MAIL] lifecycle notification failed ideaId=${idea.id} event=${event}:`, err);
    }
  })();

  // Webex channel — symmetric to the mail block and fully independent: its own
  // config read, its own send, its own try/catch, so a Webex outage never affects
  // mail (and vice versa).
  void (async () => {
    try {
      const cfg = await getEffectiveWebexConfig();
      if (!cfg.effectiveEnabled) return; // webex off / no token: nothing to send
      const { markdown } = ideaLifecycleWebexMessage({
        event,
        title: idea.title,
        actorName,
        stepText,
        link,
        language: cfg.language,
      });
      await sendWebexMessage({ toPersonEmail: to, markdown }, cfg);
    } catch (err) {
      console.error(`[WEBEX] lifecycle notification failed ideaId=${idea.id} event=${event}:`, err);
    }
  })();
}
