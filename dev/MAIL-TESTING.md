# Testing outbound mail locally

Outbound mail is **best-effort infrastructure** and **off by default**. It is now
**admin-managed at runtime**: an admin configures the SMTP server on the **Email
settings** page (admin nav → *Email Settings*), and the config — with the SMTP
password encrypted — is stored in the database. There are no `SMTP_*` / `MAIL_*`
environment variables anymore; the only mail-related env is `MAIL_SETTINGS_KEY`
(see below). `sendMail()` never throws and never fails a request: when mail is
disabled it just logs the would-send line and resolves `true`.

## Prerequisite: `MAIL_SETTINGS_KEY`

`MAIL_SETTINGS_KEY` encrypts the stored SMTP password (AES-256-GCM). Outside
development the backend **fails fast** at boot if it is missing (exactly like
`SESSION_SECRET`). In development an ephemeral key is generated with a warning —
fine for a quick test, but a saved password will not survive a restart until you
set a stable key. Generate one and add it to `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# MAIL_SETTINGS_KEY=<the 64-char hex value>
```

## 1. Default: log-only (nothing to configure)

With mail left disabled on the Email settings page (the default when no settings
have been saved), every send is a no-op that logs:

```
[MAIL disabled] to=alice@example.com subject=Your idea was approved
```

This is the default for local dev and for the automated test tiers — no SMTP
server, no sockets. Use it to confirm the call sites fire without standing up a relay.

## 2. Capture real SMTP with mailpit

[mailpit](https://mailpit.axllent.org/) is a throwaway SMTP sink with a web UI. It
lives in `docker-compose.yml` behind the `mail` profile, so a normal `docker compose
up` never starts it.

```bash
docker compose --profile mail up -d mailpit
# SMTP on 127.0.0.1:1025, web UI on http://localhost:8025 (localhost-only, like Mongo/Keycloak)
```

Then configure it through the **UI** (no env vars): sign in as an admin, open
**Email Settings**, and enter:

- **Enable outbound email**: on
- **SMTP host**: `localhost` (host-run backend) or `mailpit` (backend inside compose)
- **SMTP port**: `1025`
- **Use implicit TLS**: off (mailpit speaks plain SMTP / STARTTLS)
- **Username / Password**: leave blank (mailpit accepts unauthenticated mail)

Click **Save settings**, then use the **Send test email** block (it prefills your
own address) to fire a message, and watch it land in the UI at
http://localhost:8025 (subject, from, to, and the rendered body).

## What to verify

- **Disabled is a true no-op**: with mail disabled, sends only log `[MAIL disabled] …`
  and never open a socket.
- **Enabled + mailpit**: messages appear in http://localhost:8025 with the
  configured **From address** (default `IdeaHub <no-reply@ideahub.local>`).
- **Save-time guard**: enabling mail with an empty **SMTP host** is rejected on save
  (`An SMTP host is required when outbound email is enabled`) — this replaces the old
  boot-time check.
- **Best-effort test send**: point the host at a black hole (e.g. `127.0.0.1` port
  `1`, or `192.0.2.1`) and click **Send test email** — the result comes back as
  `status: 'failed'` with a reason category (e.g. `connection_refused` or `timeout`)
  after the send fails/times out, and no request ever crashes. A disabled or
  host-less config instead reports `status: 'disabled'` (nothing is sent).
- **Password is write-only**: the password field is never populated from the server;
  the API returns only whether a password is stored (`hasPassword`). The stored value
  is AES-256-GCM ciphertext — the plaintext never leaves the browser after Save and
  never appears in any API response or log line.

## Cleanup / notes

```bash
docker compose --profile mail down   # stop mailpit (add -v to wipe, though it keeps no volume)
```

- mailpit binds to `127.0.0.1` only; dev-only, never reuse outside localhost.
- The **corporate relay's real host / port / auth are entered by the admin on the
  Email settings page when known** — nothing to redeploy. Only `MAIL_SETTINGS_KEY`
  must be present in the environment (see the `Mail` section of `.env.example` and
  the configuration table in `README.md`).
