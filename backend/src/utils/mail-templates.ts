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
    description: input.description.slice(0, DESCRIPTION_PREVIEW_CHARS),
    link: input.link,
  });

  return { subject, text };
}
