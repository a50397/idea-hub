// Notification-email wording (subject + body) for the department "new idea"
// notification.
//
// ONE template per installation: the active language for BOTH the subject and
// the body is chosen by the admin-managed `language` setting ('en' default, 'sk'
// supported), so a single email is never split across two languages. The
// admin-managed `subjectTemplate` optionally overrides ONLY the subject for the
// active language; the body always comes from the built-in wording. Both values
// are PASSED IN by the caller from the DB-backed settings (config/mail.ts) — this
// module reads no environment and holds no config of its own.
//
// INJECTION SAFETY (critical): placeholder substitution is SINGLE-PASS — see
// interpolate(). User-controlled values (idea title, department name, submitter
// name, description) are emitted verbatim and are NEVER re-scanned for
// placeholders, so an idea literally titled "{department}" appears as the
// literal text "{department}" and cannot be turned into the department name.
// Do NOT refactor interpolate() into sequential .replace() calls: that WOULD
// re-scan an already-substituted value and reintroduce the injection.

import type { MailLang } from '../config/mail';

export interface NewIdeaEmailInput {
  departmentName: string;
  title: string;
  submitterName: string;
  description: string;
  link: string;
  /** Active notification language (from the mail settings). */
  language: MailLang;
  /**
   * Optional subject override (from the mail settings). Empty/whitespace-only or
   * omitted -> the built-in subject for the active language is used. Supported
   * placeholders: {department}, {title}.
   */
  subjectTemplate?: string;
}

export interface BuiltEmail {
  subject: string;
  text: string;
}

// Longest description excerpt carried in the notification body. Kept identical to
// the original inline wording so default-env (EN) output stays byte-compatible.
const DESCRIPTION_PREVIEW_CHARS = 200;

interface Wording {
  /** Subject template. Placeholders: {department}, {title}. */
  subject: string;
  /** Body template. Placeholders: {department}, {title}, {submitterName}, {description}, {link}. */
  body: string;
}

// Built-in wording per language. EN is byte-compatible with the previously
// shipped inline strings (do not reword without updating the pinned tests). SK is
// natural, professional Slovak using the frontend locale's house vocabulary
// (Nový nápad / Oddelenie / Názov / Popis / Odoslal-a / Zobraziť nápad).
const WORDING: Record<MailLang, Wording> = {
  en: {
    subject: '[IdeaHub] New idea for {department}: {title}',
    body:
      'A new idea has been submitted for the {department} department.\n\n' +
      'Title: {title}\n' +
      'Submitted by: {submitterName}\n' +
      'Department: {department}\n\n' +
      'Description:\n{description}\n\n' +
      'View the idea: {link}',
  },
  sk: {
    subject: '[IdeaHub] Nový nápad pre {department}: {title}',
    body:
      'Pre oddelenie {department} bol odoslaný nový nápad.\n\n' +
      'Názov: {title}\n' +
      'Odoslal/a: {submitterName}\n' +
      'Oddelenie: {department}\n\n' +
      'Popis:\n{description}\n\n' +
      'Zobraziť nápad: {link}',
  },
};

/**
 * Single-pass placeholder substitution.
 *
 * Scans `template` exactly once for the tokens named by the keys of `values`
 * (each as the literal `{name}`) and replaces every occurrence with its value
 * via a replacer callback. Because String.prototype.replace with a global regex
 * advances through the ORIGINAL template — never re-reading the substituted text
 * — a value that itself contains "{...}" is emitted verbatim and is not
 * re-interpreted. That is the injection-safety guarantee (see file header).
 *
 * The regex is assembled only from the trusted, hardcoded token NAMES supplied
 * by this module; no user-controlled data ever reaches the pattern.
 */
function interpolate(template: string, values: Record<string, string>): string {
  const tokens = Object.keys(values);
  if (tokens.length === 0) return template;
  const pattern = new RegExp(tokens.map((t) => `\\{${t}\\}`).join('|'), 'g');
  // `match` is always one of the tokens above, so the lookup is always defined.
  return template.replace(pattern, (match) => values[match.slice(1, -1)]);
}

/**
 * Visually delimit user-supplied free text by prefixing every line with "> ".
 *
 * These bodies are plain text: a user value (an idea description, a progress-step
 * note) is embedded among system-generated lines. Without a delimiter a multi-line
 * user value could inject lines that read like system sections (e.g. a forged
 * "View the idea: http://evil…"). Quoting every line keeps the whole block
 * unambiguously user-authored. Applied to the VALUE before interpolation, so the
 * single-pass injection guarantee (see file header) is unchanged — the quoted value
 * is still emitted verbatim and never re-scanned for placeholders.
 */
function quoteBlock(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

/**
 * Build the department "new idea" notification email.
 *
 * Subject: the built-in wording for the active language, or `input.subjectTemplate`
 * when it is non-empty (after trimming) — interpolated with {department} and
 * {title} only. Body: always the built-in wording for the active language, with the
 * description truncated to DESCRIPTION_PREVIEW_CHARS. Never throws for string
 * inputs (parity with the original inline template literals).
 */
export function newIdeaEmail(input: NewIdeaEmailInput): BuiltEmail {
  // Defensive normalization: the settings layer already constrains language to
  // en|sk, but guard against any unexpected runtime value.
  const lang: MailLang = input.language === 'sk' ? 'sk' : 'en';
  const wording = WORDING[lang];

  // An empty/whitespace-only override means "use the built-in subject"; a present
  // override is used verbatim (operator spacing preserved) — the same override
  // semantics the config layer applied before this value moved into the settings.
  const override =
    (input.subjectTemplate ?? '').trim().length > 0 ? (input.subjectTemplate as string) : undefined;
  const subjectTemplate = override ?? wording.subject;
  const subject = interpolate(subjectTemplate, {
    department: input.departmentName,
    title: input.title,
  });

  const text = interpolate(wording.body, {
    department: input.departmentName,
    title: input.title,
    submitterName: input.submitterName,
    // User-supplied free text: quote every line so an injected pseudo-section in the
    // description cannot masquerade as a system line in the plain-text body.
    description: quoteBlock(input.description.slice(0, DESCRIPTION_PREVIEW_CHARS)),
    link: input.link,
  });

  return { subject, text };
}

// ---------------------------------------------------------------------------
// Idea LIFECYCLE notification wording (subject + body) — sent to the SUBMITTER
// when their idea is approved, rejected, claimed, completed, or gets a progress
// step (see utils/lifecycle-notify.ts). Same install-wide language selection as
// the new-idea mail above and the SAME single-pass, injection-safe interpolate()
// (a user value that itself looks like a placeholder is emitted verbatim).
//
// DELIBERATELY, the admin `subjectTemplate` is NOT applied here: its placeholders
// ({department}, {title}) are scoped to the new-idea mail and would render
// literally/misleadingly on a lifecycle event, so each event carries its OWN
// built-in subject per language.
// ---------------------------------------------------------------------------

export type IdeaLifecycleEvent = 'APPROVED' | 'REJECTED' | 'CLAIMED' | 'COMPLETED' | 'STEP_ADDED';

export interface IdeaLifecycleEmailInput {
  event: IdeaLifecycleEvent;
  title: string;
  /** Name of the user who performed the change. */
  actorName: string;
  /** The progress-step text; used only by the STEP_ADDED event. */
  stepText?: string;
  link: string;
  /** Active notification language (from the mail settings). */
  language: MailLang;
}

// Built-in wording per language per event. Each event has its OWN subject (the
// admin subjectTemplate is not applied — see the section header). SK is genuine
// formal Slovak using the house vocabulary (nápad / Zobraziť nápad) and the same
// gender-neutral verb suffix as the new-idea mail's "Odoslal/a" (schválil/a,
// zamietol/la, začal/a, dokončil/a, pridal/a). Placeholders: {title}, {actorName},
// {stepText} (STEP_ADDED only), {link}.
const LIFECYCLE_WORDING: Record<MailLang, Record<IdeaLifecycleEvent, Wording>> = {
  en: {
    APPROVED: {
      subject: '[IdeaHub] Your idea was approved: {title}',
      body:
        'Your idea "{title}" has been approved by {actorName}.\n\n' +
        'View the idea: {link}',
    },
    REJECTED: {
      subject: '[IdeaHub] Your idea was rejected: {title}',
      body:
        'Your idea "{title}" has been rejected by {actorName}.\n\n' +
        'View the idea: {link}',
    },
    CLAIMED: {
      subject: '[IdeaHub] Work has started on your idea: {title}',
      body:
        '{actorName} has started working on your idea "{title}".\n\n' +
        'View the idea: {link}',
    },
    COMPLETED: {
      subject: '[IdeaHub] Your idea was completed: {title}',
      body:
        'Your idea "{title}" has been completed by {actorName}.\n\n' +
        'View the idea: {link}',
    },
    STEP_ADDED: {
      subject: '[IdeaHub] New progress on your idea: {title}',
      body:
        '{actorName} added a progress update to your idea "{title}":\n\n' +
        '{stepText}\n\n' +
        'View the idea: {link}',
    },
  },
  sk: {
    APPROVED: {
      subject: '[IdeaHub] Váš nápad bol schválený: {title}',
      body:
        'Váš nápad "{title}" schválil/a {actorName}.\n\n' +
        'Zobraziť nápad: {link}',
    },
    REJECTED: {
      subject: '[IdeaHub] Váš nápad bol zamietnutý: {title}',
      body:
        'Váš nápad "{title}" zamietol/la {actorName}.\n\n' +
        'Zobraziť nápad: {link}',
    },
    CLAIMED: {
      subject: '[IdeaHub] Na Vašom nápade sa začalo pracovať: {title}',
      body:
        'Na Vašom nápade "{title}" začal/a pracovať {actorName}.\n\n' +
        'Zobraziť nápad: {link}',
    },
    COMPLETED: {
      subject: '[IdeaHub] Váš nápad bol dokončený: {title}',
      body:
        'Váš nápad "{title}" dokončil/a {actorName}.\n\n' +
        'Zobraziť nápad: {link}',
    },
    STEP_ADDED: {
      subject: '[IdeaHub] Nový pokrok na Vašom nápade: {title}',
      body:
        '{actorName} pridal/a aktualizáciu pokroku k Vášmu nápadu "{title}":\n\n' +
        '{stepText}\n\n' +
        'Zobraziť nápad: {link}',
    },
  },
};

/**
 * Build a submitter lifecycle-notification email for the given event. Subject and
 * body both come from the built-in per-event wording for the active language; the
 * admin subjectTemplate is deliberately NOT consulted. Interpolation is the same
 * single-pass, injection-safe pass used by newIdeaEmail — a title/actor/step value
 * that itself contains "{...}" is emitted verbatim. Never throws for string inputs.
 */
export function ideaLifecycleEmail(input: IdeaLifecycleEmailInput): BuiltEmail {
  // Defensive normalization (parity with newIdeaEmail): anything other than 'sk'
  // resolves to the English built-in.
  const lang: MailLang = input.language === 'sk' ? 'sk' : 'en';
  const wording = LIFECYCLE_WORDING[lang][input.event];

  const values = {
    title: input.title,
    actorName: input.actorName,
    // User-supplied free text (STEP_ADDED body only): quote every line so an injected
    // pseudo-section in the step note cannot masquerade as a system line. Harmless for
    // the other events, whose bodies never reference {stepText}.
    stepText: quoteBlock(input.stepText ?? ''),
    link: input.link,
  };

  return {
    subject: interpolate(wording.subject, values),
    text: interpolate(wording.body, values),
  };
}
