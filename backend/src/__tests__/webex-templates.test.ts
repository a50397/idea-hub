// Unit coverage for utils/webex-templates.ts — the Webex markdown message
// builders. Two invariants dominate, mirroring mail-templates.test.ts:
//   1. Localization: en + sk wording per event, and sk leaks no English fragment.
//   2. Injection safety, two layers: SINGLE-PASS interpolation (a user value that
//      itself looks like a placeholder is emitted verbatim) AND markdown escaping
//      of every user-supplied value (a value cannot inject a link/emphasis/etc.).
// Plus: there is NO subject (Webex messages have none).

import {
  newIdeaWebexMessage,
  ideaLifecycleWebexMessage,
  type NewIdeaWebexInput,
  type IdeaLifecycleWebexInput,
  type IdeaLifecycleEvent,
} from '../utils/webex-templates';

// Deliberately Slovak-flavoured user values so that, in language='sk' cases, ANY
// English text in the output can only be a leaked template fragment.
const baseNewIdea = {
  departmentName: 'Marketing',
  title: 'Testovací nápad',
  submitterName: 'Ján Novák',
  description: 'Toto je popis.',
  link: 'http://localhost:5173/ideas/abc123',
};

function buildNewIdea(overrides: Partial<NewIdeaWebexInput> = {}): NewIdeaWebexInput {
  return { ...baseNewIdea, language: 'sk', ...overrides };
}

const lifeBase = {
  title: 'Testovací nápad',
  actorName: 'Ján Novák',
  stepText: 'Dokončil som prvú časť riešenia.',
  link: 'http://localhost:5173/ideas/abc123',
};

function buildLife(
  event: IdeaLifecycleEvent,
  language: 'en' | 'sk',
  overrides: Partial<IdeaLifecycleWebexInput> = {}
): IdeaLifecycleWebexInput {
  return { event, language, ...lifeBase, ...overrides };
}

const EVENTS: IdeaLifecycleEvent[] = ['APPROVED', 'REJECTED', 'CLAIMED', 'COMPLETED', 'STEP_ADDED'];

describe('newIdeaWebexMessage', () => {
  it('returns ONLY a markdown field (Webex has no subject)', () => {
    const msg = newIdeaWebexMessage(buildNewIdea({ language: 'en' }));
    expect(Object.keys(msg)).toEqual(['markdown']);
    expect(msg).not.toHaveProperty('subject');
  });

  it('includes the department, title, submitter and a markdown link (English)', () => {
    const md = newIdeaWebexMessage(buildNewIdea({ language: 'en' })).markdown;
    expect(md).toContain('Marketing');
    expect(md).toContain('Testovací nápad');
    expect(md).toContain('Ján Novák');
    // System-built link is a real markdown link (unescaped).
    expect(md).toContain('[View the idea](http://localhost:5173/ideas/abc123)');
    // The description is rendered as a blockquote (line-quoted with "> "); its
    // trailing "." is markdown-escaped (transparent when rendered).
    expect(md).toContain('> Toto je popis');
  });

  it('produces Slovak wording and leaks no English fragment (language="sk")', () => {
    const md = newIdeaWebexMessage(buildNewIdea({ language: 'sk' })).markdown;
    expect(md).toContain('Pre oddelenie');
    expect(md).toContain('[Zobraziť nápad](http://localhost:5173/ideas/abc123)');
    for (const fragment of ['A new idea has been submitted', 'Submitted by', 'View the idea']) {
      expect(md).not.toContain(fragment);
    }
  });

  it('falls back to Slovak (the Webex default) for an unrecognized language', () => {
    const md = newIdeaWebexMessage(buildNewIdea({ language: 'de' as unknown as 'sk' })).markdown;
    expect(md).toContain('Pre oddelenie');
  });

  it('truncates the description preview to 200 characters', () => {
    const md = newIdeaWebexMessage(buildNewIdea({ description: 'A'.repeat(250) })).markdown;
    expect(md).toContain('A'.repeat(200));
    expect(md).not.toContain('A'.repeat(201));
  });

  it('escapes markdown metacharacters in user values (no link/emphasis injection)', () => {
    const md = newIdeaWebexMessage(
      buildNewIdea({ language: 'en', title: '[x](http://evil.example)', submitterName: '**boss**' })
    ).markdown;
    // The injected link is neutralized: the raw user link never appears, its brackets
    // appear backslash-escaped instead.
    expect(md).not.toContain('[x](http://evil.example)');
    expect(md).not.toContain('](http://evil.example)');
    expect(md).toContain('\\[x\\]');
    // The injected emphasis is escaped, not rendered.
    expect(md).toContain('\\*\\*boss\\*\\*');
    // The genuine system link (with its own real "](") is still present and intact.
    expect(md).toContain('[View the idea](http://localhost:5173/ideas/abc123)');
  });

  it('keeps a title that looks like a placeholder literal (single-pass) and escaped', () => {
    const md = newIdeaWebexMessage(buildNewIdea({ language: 'en', title: '{link}' })).markdown;
    // The fake {link} token in the title is emitted verbatim (escaped braces) and is
    // NOT replaced by the real link...
    expect(md).toContain('\\{link\\}');
    // ...while the real link is still rendered separately.
    expect(md).toContain('http://localhost:5173/ideas/abc123');
  });

  it('flattens newlines in an inline title and escapes "=" so it cannot forge a setext heading', () => {
    const md = newIdeaWebexMessage(
      buildNewIdea({ language: 'en', title: 'Real\n\nFake system line\n===' })
    ).markdown;
    // The whole title collapses onto its single **Title:** line: no newline splits it,
    // so the "===" can never sit on its own line under a text line (a setext H1).
    const titleLine = md.split('\n').find((l) => l.startsWith('**Title:**'))!;
    expect(titleLine).toContain('Real Fake system line');
    // No line anywhere is a bare "===" underline, and the "=" chars are escaped.
    expect(md).not.toMatch(/^=+$/m);
    expect(titleLine).toContain('\\=\\=\\=');
  });

  it('doubles a literal backslash in a user value and survives single-pass interpolation unmangled', () => {
    // A value already carrying literal backslashes (e.g. "\*not bold\*"): each "\" is
    // doubled and each "*" escaped, so it renders as the literal text (never bold) and
    // the single-pass substitution never re-scans or mangles the escape sequence.
    const md = newIdeaWebexMessage(buildNewIdea({ language: 'en', title: '\\*not bold\\*' })).markdown;
    // Each literal "\" -> "\\" (doubled) and each "*" -> "\*": the whole value renders
    // as literal "\*not bold\*", and the escape sequence is emitted verbatim.
    expect(md).toContain('\\\\\\*not bold\\\\\\*');
  });

  it('defuses a bare hostname and an explicit URL in user values (no Webex auto-link)', () => {
    const md = newIdeaWebexMessage(
      buildNewIdea({
        language: 'en',
        title: 'Please re-auth at evil.com',
        description: 'Visit http://evil.example/login',
      })
    ).markdown;
    // The clean, linkable forms never survive: the host dot becomes "[.]" (escaped, so
    // it renders as a literal "[.]") and the scheme separator "://" is broken.
    expect(md).not.toContain('evil.com');
    expect(md).toContain('evil\\[\\.\\]com');
    expect(md).not.toContain('http://evil.example');
    expect(md).not.toContain('://evil');
    // The genuine system link is trusted and never defanged.
    expect(md).toContain('[View the idea](http://localhost:5173/ideas/abc123)');
  });

  it('defuses an IPv4 address in a user value', () => {
    const md = newIdeaWebexMessage(buildNewIdea({ language: 'en', title: 'ping 10.1.2.3 daily' })).markdown;
    expect(md).not.toMatch(/\b10\.1\.2\.3\b/);
    expect(md).toContain('10\\[\\.\\]1\\[\\.\\]2\\[\\.\\]3');
  });

  it('leaves ordinary prose (abbreviations, versions, decimals) un-defanged', () => {
    const md = newIdeaWebexMessage(
      buildNewIdea({
        language: 'en',
        title: 'Improve e.g. the v2.4 rollout',
        description: 'Ship by Q3, ~2.5x faster.',
      })
    ).markdown;
    // No defang marker anywhere: "e.g.", "v2.4" and "2.5" keep their dots (merely
    // markdown-escaped), so nothing normal gets a spurious clickable-URL break.
    expect(md).not.toContain('\\[\\.\\]');
  });
});

describe('ideaLifecycleWebexMessage', () => {
  it('returns ONLY a markdown field (no subject)', () => {
    const msg = ideaLifecycleWebexMessage(buildLife('APPROVED', 'en'));
    expect(Object.keys(msg)).toEqual(['markdown']);
  });

  it.each(EVENTS)('English %s carries the title, actor and a markdown link', (event) => {
    const md = ideaLifecycleWebexMessage(buildLife(event, 'en')).markdown;
    expect(md).toContain('Testovací nápad');
    expect(md).toContain('Ján Novák');
    expect(md).toContain('[View the idea](http://localhost:5173/ideas/abc123)');
  });

  it.each(EVENTS)('Slovak %s leaks no English lifecycle fragment', (event) => {
    const md = ideaLifecycleWebexMessage(buildLife(event, 'sk')).markdown;
    for (const fragment of [
      'Your idea',
      'has been approved',
      'has started working',
      'added a progress update',
      'View the idea',
    ]) {
      expect(md).not.toContain(fragment);
    }
    expect(md).toContain('[Zobraziť nápad](http://localhost:5173/ideas/abc123)');
  });

  it('emits a DISTINCT body for every event', () => {
    for (const language of ['en', 'sk'] as const) {
      const bodies = EVENTS.map((e) => ideaLifecycleWebexMessage(buildLife(e, language)).markdown);
      expect(new Set(bodies).size).toBe(EVENTS.length);
    }
  });

  it('line-quotes and escapes the STEP_ADDED step note (blockquote + injection safety)', () => {
    const md = ideaLifecycleWebexMessage(
      buildLife('STEP_ADDED', 'en', { stepText: 'Real progress\n[phish](http://evil.example)' })
    ).markdown;
    // Every step line is a blockquote line ("> "), so a multi-line note cannot forge
    // a system line...
    expect(md).toContain('> Real progress');
    expect(md).toContain('> \\[phish\\]');
    // ...and the injected link is escaped (no raw "](" from the user value).
    expect(md).not.toContain('](http://evil.example)');
    // The genuine system link line remains intact.
    expect(md).toContain('[View the idea](http://localhost:5173/ideas/abc123)');
  });

  it('keeps a title that looks like a placeholder literal (single-pass), both channels-safe', () => {
    const md = ideaLifecycleWebexMessage(buildLife('APPROVED', 'en', { title: '{link}' })).markdown;
    expect(md).toContain('"\\{link\\}"');
    expect(md).toContain('http://localhost:5173/ideas/abc123');
  });

  it('defuses a URL in the STEP_ADDED step note (lifecycle path)', () => {
    const md = ideaLifecycleWebexMessage(
      buildLife('STEP_ADDED', 'en', { stepText: 'Done — details at wiki.evil.com/x' })
    ).markdown;
    expect(md).not.toContain('wiki.evil.com');
    expect(md).toContain('\\[\\.\\]');
    // The genuine system link is untouched.
    expect(md).toContain('[View the idea](http://localhost:5173/ideas/abc123)');
  });
});
