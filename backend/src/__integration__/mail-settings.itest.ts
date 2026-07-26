// Admin-managed mail settings against the real DB + real app:
//   - the masked GET/PUT roundtrip (password NEVER present in any response;
//     hasPassword flips as the password is set then wiped),
//   - the save-time enabled-requires-host guard (replaces the old boot guard),
//   - the structured POST /test end-to-end (200 { status:'failed', reason } against
//     a dead relay, with NO secret in the body; { status:'disabled' } when off),
//   - idea-creation still notifies through the DB-backed config while disabled
//     (201 + a '[MAIL disabled]' log),
//   - encrypted-at-rest proof: the raw Mongo document stores ciphertext, not the
//     submitted plaintext, and the ciphertext decrypts back to it.
import {
  Role,
  prisma,
  newAgent,
  loginAs,
  withCsrf,
  waitForBoot,
  resetDb,
  createUser,
  getDefaultDepartmentId,
  validIdeaPayload,
} from './support/helpers';
import { decrypt } from '../utils/secretbox';

beforeAll(async () => {
  await waitForBoot();
});

beforeEach(async () => {
  await resetDb();
});

async function loggedInAdmin() {
  await createUser({ email: 'admin@mail.test', password: 'adminsecret1', role: Role.ADMIN });
  const agent = newAgent();
  const res = await loginAs(agent, 'admin@mail.test', 'adminsecret1');
  expect(res.status).toBe(200);
  return agent;
}

// Read the raw singleton mail_settings document (bypassing Prisma's projection).
async function rawMailSettingsDoc(): Promise<Record<string, unknown> | null> {
  const res = (await prisma.$runCommandRaw({ find: 'mail_settings', filter: {} })) as any;
  const docs: Array<Record<string, unknown>> = res?.cursor?.firstBatch ?? [];
  return docs[0] ?? null;
}

function fullBody(overrides: Record<string, unknown> = {}) {
  return {
    enabled: false,
    host: 'smtp.example.test',
    port: 2525,
    secure: false,
    username: '',
    from: 'IdeaHub <no-reply@ideahub.local>',
    language: 'en',
    subjectTemplate: '',
    ...overrides,
  };
}

describe('mail settings (real DB)', () => {
  test('GET returns disabled defaults when no settings document exists', async () => {
    const admin = await loggedInAdmin();
    const res = await admin.get('/api/mail-settings');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      enabled: false,
      host: '',
      port: 587,
      secure: false,
      username: '',
      language: 'en',
      subjectTemplate: '',
      hasPassword: false,
    });
    expect(res.body).not.toHaveProperty('passwordEnc');
    expect(res.body).not.toHaveProperty('password');
  });

  test('save → GET roundtrip; password never present; hasPassword flips set→keep→wipe', async () => {
    const admin = await loggedInAdmin();

    // Set a full config WITH a password.
    const saved = await withCsrf(admin.put('/api/mail-settings')).send(
      fullBody({
        enabled: true,
        host: 'smtp.corp.example',
        secure: true,
        username: 'relay-user',
        password: 'sup3r-secret',
        language: 'sk',
        subjectTemplate: 'Nápad: {title}',
      })
    );
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      enabled: true,
      host: 'smtp.corp.example',
      port: 2525,
      secure: true,
      username: 'relay-user',
      language: 'sk',
      subjectTemplate: 'Nápad: {title}',
      hasPassword: true,
    });
    // No secret in the save response.
    expect(saved.body).not.toHaveProperty('passwordEnc');
    expect(saved.body).not.toHaveProperty('password');
    expect(JSON.stringify(saved.body)).not.toContain('sup3r-secret');

    // GET reflects the saved config and still masks the password.
    const got = await admin.get('/api/mail-settings');
    expect(got.body).toMatchObject({ host: 'smtp.corp.example', username: 'relay-user', hasPassword: true });
    expect(JSON.stringify(got.body)).not.toContain('sup3r-secret');
    expect(got.body).not.toHaveProperty('passwordEnc');

    // KEEP: re-save without a password field — hasPassword stays true.
    const kept = await withCsrf(admin.put('/api/mail-settings')).send(
      fullBody({ enabled: true, host: 'smtp.corp.example', username: 'relay-user' })
    );
    expect(kept.body.hasPassword).toBe(true);

    // WIPE: save with an empty username — the stored password is cleared.
    const wiped = await withCsrf(admin.put('/api/mail-settings')).send(
      fullBody({ enabled: true, host: 'smtp.corp.example', username: '' })
    );
    expect(wiped.body.hasPassword).toBe(false);
    const rawAfterWipe = await rawMailSettingsDoc();
    expect(rawAfterWipe?.passwordEnc).toBe('');
  });

  test('two concurrent first-saves converge to exactly ONE settings document (atomic singleton)', async () => {
    const admin = await loggedInAdmin();

    // Empty state (resetDb cleared mail_settings). Fire two PUTs "at once": the
    // DB-enforced unique `singleton` index + upsert must converge to a SINGLE
    // document. The old findFirst()+create path let two concurrent first-saves both
    // see null and both create -> duplicate, non-healing config docs.
    const body = fullBody({
      enabled: true,
      host: 'smtp.corp.example',
      username: 'relay-user',
      password: 'concurrent-secret',
    });
    const [a, b] = await Promise.all([
      withCsrf(admin.put('/api/mail-settings')).send(body),
      withCsrf(admin.put('/api/mail-settings')).send(body),
    ]);

    // At least one save completes cleanly. The loser may fail the unique constraint
    // (surfaced as a non-200), but it can NEVER insert a duplicate document.
    expect([a.status, b.status]).toContain(200);

    // The invariant: exactly ONE document — via Prisma AND a raw find that bypasses
    // Prisma's projection (same mechanism rawMailSettingsDoc uses).
    expect(await prisma.mailSettings.count()).toBe(1);
    const rawFind = (await prisma.$runCommandRaw({ find: 'mail_settings', filter: {} })) as any;
    const rawDocs: Array<Record<string, unknown>> = rawFind?.cursor?.firstBatch ?? [];
    expect(rawDocs).toHaveLength(1);

    // The surviving document is coherent — a real, masked save (secret never exposed)
    // that the GET reflects.
    const got = await admin.get('/api/mail-settings');
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({
      enabled: true,
      host: 'smtp.corp.example',
      username: 'relay-user',
      hasPassword: true,
    });
    expect(got.body).not.toHaveProperty('passwordEnc');
    expect(JSON.stringify(got.body)).not.toContain('concurrent-secret');
    // And the stored secret is genuinely encrypted at rest and reversible.
    expect(decrypt(String(rawDocs[0].passwordEnc))).toBe('concurrent-secret');
  });

  test('enabled=true with an empty host is rejected (400) and nothing is persisted', async () => {
    const admin = await loggedInAdmin();
    const res = await withCsrf(admin.put('/api/mail-settings')).send(
      fullBody({ enabled: true, host: '' })
    );
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    // No document created.
    expect(await rawMailSettingsDoc()).toBeNull();
  });

  test('encrypted at rest: the raw document stores ciphertext, not the plaintext', async () => {
    const admin = await loggedInAdmin();
    const plaintext = 'plaintext-relay-password';

    const res = await withCsrf(admin.put('/api/mail-settings')).send(
      fullBody({ enabled: true, host: 'smtp.corp.example', username: 'relay-user', password: plaintext })
    );
    expect(res.status).toBe(200);

    const raw = await rawMailSettingsDoc();
    expect(raw).not.toBeNull();
    // The ciphertext field exists, differs from the plaintext, and the plaintext
    // appears NOWHERE in the stored document.
    const passwordEnc = String(raw!.passwordEnc);
    expect(passwordEnc.length).toBeGreaterThan(0);
    expect(passwordEnc).not.toBe(plaintext);
    expect(JSON.stringify(raw)).not.toContain(plaintext);
    expect(raw).not.toHaveProperty('password');
    // And it is genuinely reversible with the configured key.
    expect(decrypt(passwordEnc)).toBe(plaintext);
  });

  test('POST /test against an unreachable relay: 200 { status: failed } with a connection reason; no secret leaks into the body', async () => {
    const admin = await loggedInAdmin();
    // Enabled + a host that refuses connections quickly (nothing listens on :1),
    // WITH sentinel credentials so we can prove none of them leak into the response.
    const SENTINEL_USER = 'sentinel-relay-user';
    const SENTINEL_PASS = 'sentinel-relay-secret';
    await withCsrf(admin.put('/api/mail-settings')).send(
      fullBody({
        enabled: true,
        host: '127.0.0.1',
        port: 1,
        username: SENTINEL_USER,
        password: SENTINEL_PASS,
      })
    );

    const res = await withCsrf(admin.post('/api/mail-settings/test')).send({ to: 'ops@corp.example' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('failed');
    // A refused TCP connect maps to connection_refused; accept timeout as a
    // timing-tolerant alternative. Either way it is a FIXED category code.
    expect(['connection_refused', 'timeout']).toContain(res.body.reason);

    // Leak probe (the real point of this feature's security rule): the response
    // body carries ONLY the fixed category — never the configured host, username,
    // or password, and no legacy `ok` or free-form error text.
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(SENTINEL_USER);
    expect(serialized).not.toContain(SENTINEL_PASS);
    expect(serialized).not.toContain('127.0.0.1');
    expect(res.body).not.toHaveProperty('ok');
    expect(res.body).not.toHaveProperty('error');
  });

  test('POST /test reports { status: disabled } (no socket opened) when mail is not enabled', async () => {
    const admin = await loggedInAdmin();
    // No settings document (resetDb cleared it) -> the effective config is disabled,
    // so the diagnostic send must report 'disabled' without opening a socket.
    const res = await withCsrf(admin.post('/api/mail-settings/test')).send({ to: 'ops@corp.example' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'disabled' });
  });

  test('POST /test rejects an invalid recipient with 400', async () => {
    const admin = await loggedInAdmin();
    const res = await withCsrf(admin.post('/api/mail-settings/test')).send({ to: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  test('a non-admin cannot read or write mail settings (403)', async () => {
    await createUser({ email: 'plain@mail.test', password: 'usersecret1', role: Role.USER });
    const user = newAgent();
    await loginAs(user, 'plain@mail.test', 'usersecret1');

    expect((await user.get('/api/mail-settings')).status).toBe(403);
    expect((await withCsrf(user.put('/api/mail-settings')).send(fullBody())).status).toBe(403);
    expect(
      (await withCsrf(user.post('/api/mail-settings/test')).send({ to: 'x@corp.example' })).status
    ).toBe(403);
  });

  test('idea creation still notifies through the DB config while mail is disabled (201 + [MAIL disabled] log)', async () => {
    // No mail_settings document -> disabled. A department with recipients means the
    // notification fires; the mailer logs '[MAIL disabled]' and never opens a socket.
    const admin = await loggedInAdmin();
    const defaultId = await getDefaultDepartmentId();
    await withCsrf(admin.patch(`/api/departments/${defaultId}`)).send({
      notificationEmails: ['ops@corp.example'],
    });

    await createUser({ email: 'submitter@mail.test', password: 'submitsecret1' });
    const submitter = newAgent();
    await loginAs(submitter, 'submitter@mail.test', 'submitsecret1');

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const res = await withCsrf(submitter.post('/api/ideas')).send(validIdeaPayload(defaultId));
      expect(res.status).toBe(201);

      // The notification is fire-and-forget (runs after the 201). Poll briefly for
      // the disabled log line to prove the path ran end-to-end.
      let logged = false;
      for (let i = 0; i < 80 && !logged; i++) {
        logged = logSpy.mock.calls.some((c) => String(c[0]).includes('[MAIL disabled]'));
        if (!logged) await new Promise((r) => setTimeout(r, 25));
      }
      expect(logged).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });
});
