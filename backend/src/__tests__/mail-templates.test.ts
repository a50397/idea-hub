// Unit coverage for utils/mail-templates.ts — the per-install new-idea
// notification wording.
//
// After the DB-backed rework the builder reads NO environment: the language and
// optional subject override are PASSED IN (sourced from the admin-managed mail
// settings). Two invariants dominate this file:
//   1. The English built-in output is byte-compatible with the previously shipped
//      inline strings (existing logs/tests must not shift).
//   2. Placeholder substitution is SINGLE-PASS: a user value that itself looks
//      like a placeholder (e.g. a title of "{department}") is emitted verbatim.

import {
  newIdeaEmail,
  ideaLifecycleEmail,
  type NewIdeaEmailInput,
  type IdeaLifecycleEmailInput,
  type IdeaLifecycleEvent,
} from '../utils/mail-templates';

// Deliberately Slovak-flavoured user values so that, in the language='sk' cases,
// ANY English text in the output can only be a leaked template fragment.
const baseValues = {
  departmentName: 'Marketing',
  title: 'Testovací nápad',
  submitterName: 'Ján Novák',
  description: 'Toto je popis.',
  link: 'http://localhost:5173/ideas/abc123',
};

// Build an input with a default English language + no subject override.
function build(overrides: Partial<NewIdeaEmailInput> = {}): NewIdeaEmailInput {
  return { ...baseValues, language: 'en', ...overrides };
}

// The exact strings the previous inline construction in routes/ideas.ts emitted.
const EN_SUBJECT = '[IdeaHub] New idea for Marketing: Testovací nápad';
const EN_TEXT =
  'A new idea has been submitted for the Marketing department.\n\n' +
  'Title: Testovací nápad\n' +
  'Submitted by: Ján Novák\n' +
  'Department: Marketing\n\n' +
  // The user-supplied description is delimited line-by-line with "> " (injection safety).
  'Description:\n> Toto je popis.\n\n' +
  'View the idea: http://localhost:5173/ideas/abc123';

const SK_SUBJECT = '[IdeaHub] Nový nápad pre Marketing: Testovací nápad';
const SK_TEXT =
  'Pre oddelenie Marketing bol odoslaný nový nápad.\n\n' +
  'Názov: Testovací nápad\n' +
  'Odoslal/a: Ján Novák\n' +
  'Oddelenie: Marketing\n\n' +
  'Popis:\n> Toto je popis.\n\n' +
  'Zobraziť nápad: http://localhost:5173/ideas/abc123';

// English template fragments that must NOT appear in Slovak output. (All base
// input values are Slovak, so any of these would be a wording leak.)
const ENGLISH_FRAGMENTS = [
  'A new idea has been submitted',
  'Submitted by:',
  'Description:',
  'View the idea:',
  'New idea for',
];

describe('newIdeaEmail — English built-in (language="en")', () => {
  it('is byte-compatible with the previously shipped inline strings', () => {
    const legacySubject = `[IdeaHub] New idea for ${baseValues.departmentName}: ${baseValues.title}`;
    const legacyText =
      `A new idea has been submitted for the ${baseValues.departmentName} department.\n\n` +
      `Title: ${baseValues.title}\n` +
      `Submitted by: ${baseValues.submitterName}\n` +
      `Department: ${baseValues.departmentName}\n\n` +
      // The description is quoted line-by-line ("> ") so injected pseudo-sections can't
      // pose as system text; the wording is otherwise the original inline body.
      `Description:\n> ${baseValues.description.slice(0, 200)}\n\n` +
      `View the idea: ${baseValues.link}`;

    const email = newIdeaEmail(build());
    expect(email.subject).toBe(legacySubject);
    expect(email.text).toBe(legacyText);
    expect(email.subject).toBe(EN_SUBJECT);
    expect(email.text).toBe(EN_TEXT);
  });

  it('truncates the description preview to 200 characters', () => {
    const email = newIdeaEmail(build({ description: 'A'.repeat(250) }));
    expect(email.text).toContain('A'.repeat(200));
    expect(email.text).not.toContain('A'.repeat(201));
  });
});

describe('newIdeaEmail — Slovak built-in (language="sk")', () => {
  it('produces the Slovak subject AND body', () => {
    const email = newIdeaEmail(build({ language: 'sk' }));
    expect(email.subject).toBe(SK_SUBJECT);
    expect(email.text).toBe(SK_TEXT);
  });

  it('leaks no English template fragments', () => {
    const email = newIdeaEmail(build({ language: 'sk' }));
    for (const fragment of ENGLISH_FRAGMENTS) {
      expect(email.subject).not.toContain(fragment);
      expect(email.text).not.toContain(fragment);
    }
  });
});

describe('newIdeaEmail — language fallback', () => {
  it('falls back to English for an unrecognized language value', () => {
    // The settings layer constrains language to en|sk, but the builder normalizes
    // defensively: anything other than 'sk' resolves to the English built-in.
    const email = newIdeaEmail(build({ language: 'de' as unknown as 'en' }));
    expect(email.subject).toBe(EN_SUBJECT);
    expect(email.text).toBe(EN_TEXT);
  });
});

describe('newIdeaEmail — subjectTemplate override', () => {
  it('replaces the subject and interpolates {department} and {title}', () => {
    const email = newIdeaEmail(build({ subjectTemplate: 'Nápad ({department}): {title}' }));
    expect(email.subject).toBe('Nápad (Marketing): Testovací nápad');
    // The body is unaffected by the subject override.
    expect(email.text).toBe(EN_TEXT);
  });

  it('works with only one placeholder present', () => {
    const email = newIdeaEmail(build({ subjectTemplate: 'New submission: {title}' }));
    expect(email.subject).toBe('New submission: Testovací nápad');
  });

  it('works with no placeholders (constant subject)', () => {
    const email = newIdeaEmail(build({ subjectTemplate: 'A new idea was submitted' }));
    expect(email.subject).toBe('A new idea was submitted');
  });

  it('is ignored when empty (built-in subject used)', () => {
    expect(newIdeaEmail(build({ subjectTemplate: '' })).subject).toBe(EN_SUBJECT);
  });

  it('is ignored when whitespace-only (built-in subject used)', () => {
    expect(newIdeaEmail(build({ subjectTemplate: '   ' })).subject).toBe(EN_SUBJECT);
  });

  it('overrides only the subject; the Slovak body is preserved under language="sk"', () => {
    const email = newIdeaEmail(build({ language: 'sk', subjectTemplate: 'Interný nápad: {title}' }));
    expect(email.subject).toBe('Interný nápad: Testovací nápad');
    expect(email.text).toBe(SK_TEXT);
  });
});

describe('newIdeaEmail — single-pass interpolation (injection safety)', () => {
  it('keeps a title of "{department}" literal in the built-in subject (not re-substituted)', () => {
    const email = newIdeaEmail(build({ title: '{department}' }));
    expect(email.subject).toBe('[IdeaHub] New idea for Marketing: {department}');
  });

  it('keeps a title of "{department}" literal in the body as well', () => {
    const email = newIdeaEmail(build({ title: '{department}' }));
    expect(email.text).toContain('Title: {department}');
    expect(email.text).toContain('Department: Marketing');
  });

  it('keeps a title of "{department}" literal inside a subject OVERRIDE', () => {
    const email = newIdeaEmail(build({ title: '{department}', subjectTemplate: '{department} / {title}' }));
    expect(email.subject).toBe('Marketing / {department}');
  });

  it('does not expand a "{link}" that appears inside the description', () => {
    const email = newIdeaEmail(
      build({ description: 'pozri {link} teraz', link: 'http://localhost:5173/ideas/real' })
    );
    expect(email.text).toContain('pozri {link} teraz');
    expect(email.text).toContain('View the idea: http://localhost:5173/ideas/real');
  });

  it('keeps a department name of "{title}" literal (cross-token safety)', () => {
    const email = newIdeaEmail(build({ departmentName: '{title}', title: 'Real Title' }));
    expect(email.subject).toBe('[IdeaHub] New idea for {title}: Real Title');
  });
});

describe('newIdeaEmail — user-text delimiting (plain-text injection safety)', () => {
  it('quotes every line of a multi-line description so a forged system line cannot pose as one', () => {
    const email = newIdeaEmail(
      build({ description: 'Legit line one\nView the idea: http://evil.example/phish' })
    );
    // Both description lines are quoted, so the injected "View the idea:" reads as
    // user text, not a system section...
    expect(email.text).toContain(
      'Description:\n> Legit line one\n> View the idea: http://evil.example/phish\n\n'
    );
    // ...while the genuine (system) link line remains the only unquoted one.
    expect(email.text).toContain('\n\nView the idea: http://localhost:5173/ideas/abc123');
  });
});

// ---------------------------------------------------------------------------
// ideaLifecycleEmail — the per-event submitter lifecycle notification. Each event
// has its OWN built-in subject per language (the admin subjectTemplate is NOT
// applied here), and Slovak must leak no English wording. All user values below
// are Slovak so any English text in an SK output can only be a leaked fragment.
// ---------------------------------------------------------------------------

const EVENTS: IdeaLifecycleEvent[] = ['APPROVED', 'REJECTED', 'CLAIMED', 'COMPLETED', 'STEP_ADDED'];

const lifeBase = {
  title: 'Testovací nápad',
  actorName: 'Ján Novák',
  stepText: 'Dokončil som prvú časť riešenia.',
  link: 'http://localhost:5173/ideas/abc123',
};

function buildLife(
  event: IdeaLifecycleEvent,
  language: 'en' | 'sk',
  overrides: Partial<IdeaLifecycleEmailInput> = {}
): IdeaLifecycleEmailInput {
  return { event, language, ...lifeBase, ...overrides };
}

// The exact built-in subjects — distinct per event AND per language.
const LIFECYCLE_SUBJECTS: Record<'en' | 'sk', Record<IdeaLifecycleEvent, string>> = {
  en: {
    APPROVED: '[IdeaHub] Your idea was approved: Testovací nápad',
    REJECTED: '[IdeaHub] Your idea was rejected: Testovací nápad',
    CLAIMED: '[IdeaHub] Work has started on your idea: Testovací nápad',
    COMPLETED: '[IdeaHub] Your idea was completed: Testovací nápad',
    STEP_ADDED: '[IdeaHub] New progress on your idea: Testovací nápad',
  },
  sk: {
    APPROVED: '[IdeaHub] Váš nápad bol schválený: Testovací nápad',
    REJECTED: '[IdeaHub] Váš nápad bol zamietnutý: Testovací nápad',
    CLAIMED: '[IdeaHub] Na Vašom nápade sa začalo pracovať: Testovací nápad',
    COMPLETED: '[IdeaHub] Váš nápad bol dokončený: Testovací nápad',
    STEP_ADDED: '[IdeaHub] Nový pokrok na Vašom nápade: Testovací nápad',
  },
};

// The exact built-in bodies.
const LIFECYCLE_BODIES: Record<'en' | 'sk', Record<IdeaLifecycleEvent, string>> = {
  en: {
    APPROVED:
      'Your idea "Testovací nápad" has been approved by Ján Novák.\n\n' +
      'View the idea: http://localhost:5173/ideas/abc123',
    REJECTED:
      'Your idea "Testovací nápad" has been rejected by Ján Novák.\n\n' +
      'View the idea: http://localhost:5173/ideas/abc123',
    CLAIMED:
      'Ján Novák has started working on your idea "Testovací nápad".\n\n' +
      'View the idea: http://localhost:5173/ideas/abc123',
    COMPLETED:
      'Your idea "Testovací nápad" has been completed by Ján Novák.\n\n' +
      'View the idea: http://localhost:5173/ideas/abc123',
    STEP_ADDED:
      'Ján Novák added a progress update to your idea "Testovací nápad":\n\n' +
      // The user-supplied step text is quoted line-by-line with "> " (injection safety).
      '> Dokončil som prvú časť riešenia.\n\n' +
      'View the idea: http://localhost:5173/ideas/abc123',
  },
  sk: {
    APPROVED:
      'Váš nápad "Testovací nápad" schválil/a Ján Novák.\n\n' +
      'Zobraziť nápad: http://localhost:5173/ideas/abc123',
    REJECTED:
      'Váš nápad "Testovací nápad" zamietol/la Ján Novák.\n\n' +
      'Zobraziť nápad: http://localhost:5173/ideas/abc123',
    CLAIMED:
      'Na Vašom nápade "Testovací nápad" začal/a pracovať Ján Novák.\n\n' +
      'Zobraziť nápad: http://localhost:5173/ideas/abc123',
    COMPLETED:
      'Váš nápad "Testovací nápad" dokončil/a Ján Novák.\n\n' +
      'Zobraziť nápad: http://localhost:5173/ideas/abc123',
    STEP_ADDED:
      'Ján Novák pridal/a aktualizáciu pokroku k Vášmu nápadu "Testovací nápad":\n\n' +
      '> Dokončil som prvú časť riešenia.\n\n' +
      'Zobraziť nápad: http://localhost:5173/ideas/abc123',
  },
};

// English wording fragments that must NEVER surface in Slovak output.
const LIFECYCLE_ENGLISH_FRAGMENTS = [
  'Your idea',
  'has been approved',
  'has been rejected',
  'has been completed',
  'has started working',
  'Work has started',
  'added a progress update',
  'New progress',
  'View the idea:',
];

describe('ideaLifecycleEmail — built-in subject + body per event', () => {
  for (const language of ['en', 'sk'] as const) {
    describe(`language="${language}"`, () => {
      it.each(EVENTS)('%s: exact subject and body', (event) => {
        const email = ideaLifecycleEmail(buildLife(event, language));
        expect(email.subject).toBe(LIFECYCLE_SUBJECTS[language][event]);
        expect(email.text).toBe(LIFECYCLE_BODIES[language][event]);
      });
    });
  }

  it('emits a DISTINCT subject for every event (no two events share a subject)', () => {
    for (const language of ['en', 'sk'] as const) {
      const subjects = EVENTS.map((e) => ideaLifecycleEmail(buildLife(e, language)).subject);
      expect(new Set(subjects).size).toBe(EVENTS.length);
    }
  });
});

describe('ideaLifecycleEmail — Slovak leaks no English wording', () => {
  it.each(EVENTS)('%s (sk) contains no English template fragment', (event) => {
    const email = ideaLifecycleEmail(buildLife(event, 'sk'));
    for (const fragment of LIFECYCLE_ENGLISH_FRAGMENTS) {
      expect(email.subject).not.toContain(fragment);
      expect(email.text).not.toContain(fragment);
    }
  });
});

describe('ideaLifecycleEmail — language fallback', () => {
  it('falls back to English for an unrecognized language value', () => {
    const email = ideaLifecycleEmail(buildLife('APPROVED', 'de' as unknown as 'en'));
    expect(email.subject).toBe(LIFECYCLE_SUBJECTS.en.APPROVED);
    expect(email.text).toBe(LIFECYCLE_BODIES.en.APPROVED);
  });
});

describe('ideaLifecycleEmail — single-pass interpolation (injection safety)', () => {
  it('keeps a title of "{link}" literal in both subject and body (not re-substituted)', () => {
    const email = ideaLifecycleEmail(buildLife('APPROVED', 'en', { title: '{link}' }));
    expect(email.subject).toBe('[IdeaHub] Your idea was approved: {link}');
    expect(email.text).toContain('Your idea "{link}" has been approved by Ján Novák.');
    // The real link is still appended — the title's fake token did not overwrite it.
    expect(email.text).toContain('View the idea: http://localhost:5173/ideas/abc123');
  });

  it('keeps an actorName of "{title}" literal (cross-token safety)', () => {
    const email = ideaLifecycleEmail(buildLife('COMPLETED', 'en', { actorName: '{title}' }));
    expect(email.text).toContain('has been completed by {title}.');
  });

  it('keeps a stepText that looks like a placeholder literal (STEP_ADDED)', () => {
    const email = ideaLifecycleEmail(buildLife('STEP_ADDED', 'en', { stepText: '{title}' }));
    // Quoted with "> " AND still emitted verbatim — the fake token is not re-expanded.
    expect(email.text).toContain('"Testovací nápad":\n\n> {title}\n\nView the idea:');
  });

  it('quotes every line of a multi-line stepText so a forged system line cannot pose as one (STEP_ADDED)', () => {
    const email = ideaLifecycleEmail(
      buildLife('STEP_ADDED', 'en', {
        stepText: 'Real progress\nView the idea: http://evil.example/phish',
      })
    );
    // Every step line is quoted, so the injected "View the idea:" is user text; the
    // genuine system link line follows, unquoted.
    expect(email.text).toContain(
      '"Testovací nápad":\n\n> Real progress\n> View the idea: http://evil.example/phish\n\nView the idea: http://localhost:5173/ideas/abc123'
    );
  });
});
