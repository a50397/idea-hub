// Admin-managed Webex settings against the real DB + real app (the Webex analogue of
// mail-settings.itest.ts):
//   - the masked GET/PUT roundtrip (the bot token is NEVER present in any response;
//     hasToken flips as the token is set → kept → wiped),
//   - two concurrent first-saves converge to exactly ONE document (atomic singleton
//     upsert on the unique `singleton` key), both callers get 200,
//   - encrypted-at-rest proof: the raw Mongo document stores ciphertext, not the
//     submitted plaintext, and the ciphertext decrypts back to it while GET masks it.
import {
  Role,
  prisma,
  newAgent,
  loginAs,
  withCsrf,
  waitForBoot,
  resetDb,
  createUser,
} from './support/helpers';
import { decrypt } from '../utils/secretbox';

beforeAll(async () => {
  await waitForBoot();
});

beforeEach(async () => {
  await resetDb();
});

async function loggedInAdmin() {
  await createUser({ email: 'admin@webex.test', password: 'adminsecret1', role: Role.ADMIN });
  const agent = newAgent();
  const res = await loginAs(agent, 'admin@webex.test', 'adminsecret1');
  expect(res.status).toBe(200);
  return agent;
}

// Read the raw singleton webex_settings document (bypassing Prisma's projection) so
// we can inspect the stored ciphertext directly.
async function rawWebexSettingsDoc(): Promise<Record<string, unknown> | null> {
  const res = (await prisma.$runCommandRaw({ find: 'webex_settings', filter: {} })) as any;
  const docs: Array<Record<string, unknown>> = res?.cursor?.firstBatch ?? [];
  return docs[0] ?? null;
}

// A body satisfying updateWebexSettingsSchema. `token` is the only optional field:
// absent = KEEP, non-empty = SET, empty string = WIPE.
function fullBody(overrides: Record<string, unknown> = {}) {
  return {
    enabled: false,
    language: 'sk',
    ...overrides,
  };
}

describe('webex settings (real DB)', () => {
  test('GET returns disabled defaults (sk, hasToken=false) when no settings document exists', async () => {
    const admin = await loggedInAdmin();
    const res = await admin.get('/api/webex-settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false, language: 'sk', hasToken: false });
    expect(res.body).not.toHaveProperty('botTokenEnc');
    expect(res.body).not.toHaveProperty('token');
  });

  test('save → GET roundtrip; token never present; hasToken flips set→keep→wipe', async () => {
    const admin = await loggedInAdmin();

    // SET a config WITH a bot token.
    const saved = await withCsrf(admin.put('/api/webex-settings')).send(
      fullBody({ enabled: true, language: 'en', token: 'sup3r-secret-bot-token' })
    );
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ enabled: true, language: 'en', hasToken: true });
    // No secret in the save response.
    expect(saved.body).not.toHaveProperty('botTokenEnc');
    expect(saved.body).not.toHaveProperty('token');
    expect(JSON.stringify(saved.body)).not.toContain('sup3r-secret-bot-token');

    // GET reflects the saved config and still masks the token.
    const got = await admin.get('/api/webex-settings');
    expect(got.body).toMatchObject({ enabled: true, language: 'en', hasToken: true });
    expect(JSON.stringify(got.body)).not.toContain('sup3r-secret-bot-token');
    expect(got.body).not.toHaveProperty('botTokenEnc');

    // KEEP: re-save WITHOUT a token field — hasToken stays true and the stored
    // ciphertext is untouched.
    const rawBeforeKeep = await rawWebexSettingsDoc();
    const kept = await withCsrf(admin.put('/api/webex-settings')).send(
      fullBody({ enabled: true, language: 'en' })
    );
    expect(kept.body.hasToken).toBe(true);
    const rawAfterKeep = await rawWebexSettingsDoc();
    expect(rawAfterKeep?.botTokenEnc).toBe(rawBeforeKeep?.botTokenEnc);

    // WIPE: save with an explicit empty-string token — the stored token is cleared.
    const wiped = await withCsrf(admin.put('/api/webex-settings')).send(
      fullBody({ enabled: false, language: 'en', token: '' })
    );
    expect(wiped.body.hasToken).toBe(false);
    const rawAfterWipe = await rawWebexSettingsDoc();
    expect(rawAfterWipe?.botTokenEnc).toBe('');
  });

  test('two concurrent first-saves converge to exactly ONE settings document (atomic singleton)', async () => {
    const admin = await loggedInAdmin();

    // Empty state (resetDb cleared webex_settings). Fire two PUTs "at once": the
    // DB-enforced unique `singleton` index + upsert must converge to a SINGLE
    // document rather than letting both concurrent first-saves create a duplicate.
    const body = fullBody({ enabled: true, language: 'en', token: 'concurrent-secret' });
    const [a, b] = await Promise.all([
      withCsrf(admin.put('/api/webex-settings')).send(body),
      withCsrf(admin.put('/api/webex-settings')).send(body),
    ]);

    // BOTH saves converge to 200: the winner creates the one document; the loser
    // either updates it or, if it lost the unique-`singleton` race (P2002), re-reads
    // the winner's persisted document and returns it. No spurious 500, no duplicate.
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    // The invariant: exactly ONE document — via Prisma AND a raw find that bypasses
    // Prisma's projection.
    expect(await prisma.webexSettings.count()).toBe(1);
    const rawFind = (await prisma.$runCommandRaw({ find: 'webex_settings', filter: {} })) as any;
    const rawDocs: Array<Record<string, unknown>> = rawFind?.cursor?.firstBatch ?? [];
    expect(rawDocs).toHaveLength(1);

    // The surviving document is coherent — a real, masked save (secret never exposed)
    // that the GET reflects.
    const got = await admin.get('/api/webex-settings');
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({ enabled: true, language: 'en', hasToken: true });
    expect(got.body).not.toHaveProperty('botTokenEnc');
    expect(JSON.stringify(got.body)).not.toContain('concurrent-secret');
    // And the stored secret is genuinely encrypted at rest and reversible.
    expect(decrypt(String(rawDocs[0].botTokenEnc))).toBe('concurrent-secret');
  });

  test('encrypted at rest: the raw document stores ciphertext, not the plaintext; GET never returns it', async () => {
    const admin = await loggedInAdmin();
    const plaintext = 'plaintext-bot-token';

    const res = await withCsrf(admin.put('/api/webex-settings')).send(
      fullBody({ enabled: true, language: 'en', token: plaintext })
    );
    expect(res.status).toBe(200);

    const raw = await rawWebexSettingsDoc();
    expect(raw).not.toBeNull();
    // The ciphertext field exists, differs from the plaintext, and the plaintext
    // appears NOWHERE in the stored document.
    const botTokenEnc = String(raw!.botTokenEnc);
    expect(botTokenEnc.length).toBeGreaterThan(0);
    expect(botTokenEnc).not.toBe(plaintext);
    expect(JSON.stringify(raw)).not.toContain(plaintext);
    expect(raw).not.toHaveProperty('token');
    // And it is genuinely reversible with the configured key.
    expect(decrypt(botTokenEnc)).toBe(plaintext);

    // GET masks it — the plaintext never travels back over the wire.
    const got = await admin.get('/api/webex-settings');
    expect(got.body.hasToken).toBe(true);
    expect(JSON.stringify(got.body)).not.toContain(plaintext);
    expect(got.body).not.toHaveProperty('botTokenEnc');
  });

  test('a non-admin cannot read or write webex settings (403)', async () => {
    await createUser({ email: 'plain@webex.test', password: 'usersecret1', role: Role.USER });
    const user = newAgent();
    await loginAs(user, 'plain@webex.test', 'usersecret1');

    expect((await user.get('/api/webex-settings')).status).toBe(403);
    expect((await withCsrf(user.put('/api/webex-settings')).send(fullBody())).status).toBe(403);
    expect(
      (await withCsrf(user.post('/api/webex-settings/test')).send({ to: 'x@corp.example' })).status
    ).toBe(403);
  });
});
