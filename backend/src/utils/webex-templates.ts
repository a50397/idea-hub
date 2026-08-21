// Webex notification wording (markdown message bodies) — the Webex analogue of
// utils/mail-templates.ts.
//
// Same install-wide language selection ('sk' default for Webex, 'en' supported),
// the same events, and the SAME included fields as the mail templates, but the
// output is Webex MARKDOWN and there is NO subject (Webex messages have none, so
// the admin `subjectTemplate` does not apply here at all).
//
// INJECTION SAFETY (critical), two independent layers, exactly as the mail
// templates:
//   1. Placeholder substitution is SINGLE-PASS (see interpolate()): a user value
//      that itself looks like a placeholder is emitted verbatim, never re-scanned.
//   2. Every user-controlled interpolation (title, names, description, step note)
//      is MARKDOWN-ESCAPED (see escapeMarkdown()) before substitution, so a value
//      cannot inject a link, formatting, blockquote, heading, or HTML into the
//      rendered message. Free-text blocks (description, step note) are ADDITIONALLY
//      line-quoted with "> " so a multi-line value cannot forge a system line.
//   3. Every user-supplied value is additionally URL-DEFANGED (see defangUrls())
//      so Webex's auto-linker cannot turn a BARE hostname/URL/IP in user text
//      (e.g. "evil.com" — which markdown-escaping alone may not stop Webex from
//      auto-linking) into a clickable link inside the trusted bot message. The
//      admin-set department name is escaped but NOT defanged — it is trusted.
// The trusted, hardcoded template text and the system-built link are the ONLY
// unescaped parts.

import type { WebexLang } from './webex';

export interface BuiltWebexMessage {
  markdown: string;
}

// Longest description excerpt carried in the new-idea message body. Kept identical
// to the mail template's DESCRIPTION_PREVIEW_CHARS so the two channels include the
// same amount of the description.
const DESCRIPTION_PREVIEW_CHARS = 200;

// Markdown metacharacters that could let a user value inject structure (links,
// images, emphasis, code, blockquote, headings, list markers, tables, HTML) into
// the rendered message. Escaped with a leading backslash; a CommonMark-style
// renderer (Webex's markdown) renders "\x" as the literal "x", so escaping is
// visually transparent while neutralizing every metacharacter. `=` is included
// because it is the setext-heading underline char ("Title\n===" renders as an H1),
// so an unescaped `=` line under a value could forge a heading.
const MARKDOWN_SPECIAL = /[\\`*_{}[\]()#+\-.!<>|~=]/g;

/**
 * Escape markdown metacharacters in a user-supplied value. Applied to the value
 * BEFORE interpolation, so the single-pass guarantee is unchanged — the escaped
 * value is emitted verbatim and never re-scanned for placeholders.
 */
function escapeMarkdown(text: string): string {
  return text.replace(MARKDOWN_SPECIAL, '\\$&');
}

/**
 * Defuse URL-, hostname- and IP-looking substrings in a user-supplied value so
 * Webex does NOT auto-link them into a clickable link inside a trusted bot DM.
 *
 * escapeMarkdown() already neutralizes EXPLICIT markdown/HTML links ("[t](u)",
 * "<u>"), but Webex ADDITIONALLY auto-links BARE URLs, hostnames and IPs it finds
 * in rendered text ("evil.com" becomes a link), which the backslash-escape may not
 * suppress. This inserts the standard "[.]" defang break (and neutralizes "://"),
 * structurally breaking the auto-link pattern while staying human-readable. It runs
 * on the RAW value BEFORE escapeMarkdown, so the inserted "[" "]" are themselves
 * escaped and render as literal characters.
 *
 * Heuristic, defense-in-depth: it errs toward defusing anything host-like, so a
 * legitimate URL in a notification renders non-clickable (acceptable — recipients
 * open the idea in-app). It deliberately spares prose: the bare-host rule requires
 * the final label to be >=2 letters, so "e.g.", "i.e.", decimals ("2.5") and
 * version strings ("v2.4.1") keep their dots untouched.
 */
function defangUrls(text: string): string {
  const breakDots = (m: string): string => m.replace(/\./g, '[.]');
  return text
    // Neutralize an explicit scheme separator ("http://" -> "http[:]//").
    .replace(/:\/\//g, '[:]//')
    // IPv4 dotted quads.
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, breakDots)
    // Bare hostnames: one or more "label." runs ending in a >=2-letter TLD-ish
    // label (spares "e.g."/"i.e."/"v2.4"/decimals, whose final label is 1 char or
    // numeric).
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi, breakDots);
}

/**
 * Single-pass placeholder substitution — identical in spirit to
 * mail-templates.ts. Scans `template` exactly once for the `{name}` tokens named
 * by the keys of `values` and replaces each via a replacer callback, so a value
 * that itself contains "{...}" is emitted verbatim (the injection-safety
 * guarantee). The regex is assembled only from the trusted, hardcoded token NAMES.
 */
function interpolate(template: string, values: Record<string, string>): string {
  const tokens = Object.keys(values);
  if (tokens.length === 0) return template;
  const pattern = new RegExp(tokens.map((t) => `\\{${t}\\}`).join('|'), 'g');
  return template.replace(pattern, (match) => values[match.slice(1, -1)]);
}

/**
 * Line-quote a (already markdown-escaped) free-text block with "> " so it renders
 * as a Webex blockquote AND a multi-line value cannot forge a system line. Applied
 * to the escaped value, so the single-pass guarantee is preserved.
 */
function quoteBlock(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

/**
 * Prepare a single-LINE user value (title, names) for a NON-blockquoted
 * interpolation. Unlike the free-text blocks (description, step note) that
 * quoteBlock protects with a "> " prefix per line, an inline value shares its line
 * with trusted template text, so a raw newline in it could break out and forge a
 * system line. Collapse every newline run (with surrounding whitespace) to a single
 * space BEFORE escaping, then URL-defang, then markdown-escape — keeping the
 * single-pass guarantee (the escaped value is emitted verbatim, never re-scanned).
 */
function inline(value: string): string {
  return escapeMarkdown(defangUrls(value.replace(/\s*(?:\r\n|\r|\n)\s*/g, ' ')));
}

interface Wording {
  /** Body template. Placeholders vary per template; see each builder. */
  body: string;
}

export interface NewIdeaWebexInput {
  departmentName: string;
  title: string;
  submitterName: string;
  description: string;
  link: string;
  /** Active notification language (from the Webex settings). */
  language: WebexLang;
}

// Built-in new-idea wording per language. Mirrors mail-templates.ts's fields
// (department, title, submitter, department again, description, link) but as
// markdown. SK uses the same house vocabulary as the mail template.
const NEW_IDEA_WORDING: Record<WebexLang, Wording> = {
  en: {
    body:
      'A new idea has been submitted for the **{department}** department.\n\n' +
      '**Title:** {title}\n' +
      '**Submitted by:** {submitterName}\n' +
      '**Department:** {department}\n\n' +
      '**Description:**\n{description}\n\n' +
      '[View the idea]({link})',
  },
  sk: {
    body:
      'Pre oddelenie **{department}** bol odoslaný nový nápad.\n\n' +
      '**Názov:** {title}\n' +
      '**Odoslal/a:** {submitterName}\n' +
      '**Oddelenie:** {department}\n\n' +
      '**Popis:**\n{description}\n\n' +
      '[Zobraziť nápad]({link})',
  },
};

/**
 * Build the department "new idea" Webex message (markdown). Body always comes from
 * the built-in wording for the active language, with the description truncated to
 * DESCRIPTION_PREVIEW_CHARS. User values are markdown-escaped; the description is
 * additionally line-quoted. Never throws for string inputs.
 */
export function newIdeaWebexMessage(input: NewIdeaWebexInput): BuiltWebexMessage {
  const lang: WebexLang = input.language === 'en' ? 'en' : 'sk';
  const wording = NEW_IDEA_WORDING[lang];

  const markdown = interpolate(wording.body, {
    department: escapeMarkdown(input.departmentName),
    // Inline values share a line with trusted template text: flatten newlines then escape.
    title: inline(input.title),
    submitterName: inline(input.submitterName),
    // Truncate the RAW text (parity with the mail preview), then defang URLs, escape, quote.
    description: quoteBlock(
      escapeMarkdown(defangUrls(input.description.slice(0, DESCRIPTION_PREVIEW_CHARS)))
    ),
    // The link is system-built (FRONTEND_URL + a hex idea id): trusted, not escaped.
    link: input.link,
  });

  return { markdown };
}

// Mirrors mail-templates.ts's IdeaLifecycleEvent one-for-one (same events, same
// meaning): five in-app transitions plus the three Jira MILESTONES the poller
// mirrors, which have no human actor and name the issue key instead.
export type IdeaLifecycleEvent =
  | 'APPROVED'
  | 'REJECTED'
  | 'CLAIMED'
  | 'COMPLETED'
  | 'STEP_ADDED'
  | 'JIRA_STARTED'
  | 'JIRA_COMPLETED'
  | 'JIRA_CANCELLED';

export interface IdeaLifecycleWebexInput {
  event: IdeaLifecycleEvent;
  title: string;
  /** Name of the user who performed the change ("Jira" for the JIRA_* events). */
  actorName: string;
  /**
   * The progress-step text (STEP_ADDED) or the mandatory completion reason
   * (COMPLETED, when the mark-done override closed the idea).
   */
  stepText?: string;
  /** The Jira issue key; used only by the JIRA_* events ('' elsewhere). */
  jiraKey?: string;
  link: string;
  /** Active notification language (from the Webex settings). */
  language: WebexLang;
}

// Built-in lifecycle wording per language per event. Mirrors the mail lifecycle
// wording one-for-one (same sentence per event), as markdown, with a trailing
// markdown link. Placeholders: {title}, {actorName}, {stepText} (STEP_ADDED only),
// {reasonBlock} (COMPLETED only — a labeled, quoted block when a completion reason
// exists, EMPTY otherwise), {link}.
const LIFECYCLE_WORDING: Record<WebexLang, Record<IdeaLifecycleEvent, Wording>> = {
  en: {
    APPROVED: {
      body: 'Your idea "{title}" has been approved by {actorName}.\n\n[View the idea]({link})',
    },
    REJECTED: {
      body: 'Your idea "{title}" has been rejected by {actorName}.\n\n[View the idea]({link})',
    },
    CLAIMED: {
      body: '{actorName} has started working on your idea "{title}".\n\n[View the idea]({link})',
    },
    COMPLETED: {
      body: 'Your idea "{title}" has been completed by {actorName}.\n\n{reasonBlock}[View the idea]({link})',
    },
    STEP_ADDED: {
      body:
        '{actorName} added a progress update to your idea "{title}":\n\n' +
        '{stepText}\n\n' +
        '[View the idea]({link})',
    },
    // Jira milestones: no human actor — the wording names the ISSUE, never the
    // remote assignee.
    JIRA_STARTED: {
      body:
        'Work has started on your idea "{title}" (Jira issue {jiraKey}).\n\n' +
        '[View the idea]({link})',
    },
    JIRA_COMPLETED: {
      body:
        'Your idea "{title}" has been completed (Jira issue {jiraKey}).\n\n' +
        '[View the idea]({link})',
    },
    JIRA_CANCELLED: {
      body:
        'Work on your idea "{title}" was cancelled (Jira issue {jiraKey}). ' +
        'The idea is approved again and can be picked up anew.\n\n' +
        '[View the idea]({link})',
    },
  },
  sk: {
    APPROVED: {
      body: 'Váš nápad "{title}" schválil/a {actorName}.\n\n[Zobraziť nápad]({link})',
    },
    REJECTED: {
      body: 'Váš nápad "{title}" zamietol/la {actorName}.\n\n[Zobraziť nápad]({link})',
    },
    CLAIMED: {
      body: 'Na Vašom nápade "{title}" začal/a pracovať {actorName}.\n\n[Zobraziť nápad]({link})',
    },
    COMPLETED: {
      body: 'Váš nápad "{title}" dokončil/a {actorName}.\n\n{reasonBlock}[Zobraziť nápad]({link})',
    },
    STEP_ADDED: {
      body:
        '{actorName} pridal/a aktualizáciu pokroku k Vášmu nápadu "{title}":\n\n' +
        '{stepText}\n\n' +
        '[Zobraziť nápad]({link})',
    },
    // Míľniky z Jiry: bez ľudského aktéra — text uvádza ÚLOHU, nikdy meno
    // priradeného používateľa zo vzdialeného systému.
    JIRA_STARTED: {
      body:
        'Na Vašom nápade "{title}" sa začalo pracovať (úloha v Jire {jiraKey}).\n\n' +
        '[Zobraziť nápad]({link})',
    },
    JIRA_COMPLETED: {
      body:
        'Váš nápad "{title}" bol dokončený (úloha v Jire {jiraKey}).\n\n' +
        '[Zobraziť nápad]({link})',
    },
    JIRA_CANCELLED: {
      body:
        'Práca na Vašom nápade "{title}" bola zrušená (úloha v Jire {jiraKey}). ' +
        'Nápad je opäť schválený a môže sa začať nanovo.\n\n' +
        '[Zobraziť nápad]({link})',
    },
  },
};

/**
 * Build a submitter lifecycle-notification Webex message (markdown) for the given
 * event. Body comes from the built-in per-event wording for the active language.
 * User values are markdown-escaped; the step note (STEP_ADDED) is additionally
 * line-quoted. Same single-pass, injection-safe interpolation as
 * newIdeaWebexMessage. Never throws for string inputs.
 */
export function ideaLifecycleWebexMessage(input: IdeaLifecycleWebexInput): BuiltWebexMessage {
  const lang: WebexLang = input.language === 'en' ? 'en' : 'sk';
  const wording = LIFECYCLE_WORDING[lang][input.event];

  const markdown = interpolate(wording.body, {
    // Inline values share a line with trusted template text: flatten newlines then escape.
    title: inline(input.title),
    actorName: inline(input.actorName),
    // User-supplied free text (STEP_ADDED body only): defang URLs, escape, line-quote.
    stepText: quoteBlock(escapeMarkdown(defangUrls(input.stepText ?? ''))),
    // Optional completion reason (COMPLETED body only; the mark-done override
    // passes its mandatory note as stepText, the legacy completion passes nothing):
    // same sanitization chain as a step note, labeled, with its own blank line —
    // or the empty string, so a reason-less completion renders exactly as before.
    reasonBlock:
      input.event === 'COMPLETED' && input.stepText
        ? `${lang === 'sk' ? 'Dôvod' : 'Reason'}:\n${quoteBlock(escapeMarkdown(defangUrls(input.stepText)))}\n\n`
        : '',
    // The Jira issue key is a REMOTE value (JIRA_* bodies only). It was already
    // normalized at the ingest boundary (utils/jira.ts), but it is treated exactly
    // like any other untrusted inline value here — flattened, defanged and
    // markdown-escaped — so it can never inject structure into the bot message.
    jiraKey: inline(input.jiraKey ?? ''),
    // System-built link: trusted, not escaped.
    link: input.link,
  });

  return { markdown };
}
