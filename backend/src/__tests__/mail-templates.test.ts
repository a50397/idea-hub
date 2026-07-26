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

import { newIdeaEmail, type NewIdeaEmailInput } from '../utils/mail-templates';

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
  'Description:\nToto je popis.\n\n' +
  'View the idea: http://localhost:5173/ideas/abc123';

const SK_SUBJECT = '[IdeaHub] Nový nápad pre Marketing: Testovací nápad';
const SK_TEXT =
  'Pre oddelenie Marketing bol odoslaný nový nápad.\n\n' +
  'Názov: Testovací nápad\n' +
  'Odoslal/a: Ján Novák\n' +
  'Oddelenie: Marketing\n\n' +
  'Popis:\nToto je popis.\n\n' +
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
      `Description:\n${baseValues.description.slice(0, 200)}\n\n` +
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
