# Testing outbound mail locally

Outbound mail is **best-effort infrastructure** and **off by default**. `sendMail()`
never throws and never fails a request: when mail is disabled it just logs the
would-send line and resolves `true`. Two ways to exercise it locally.

## 1. Default: log-only (nothing to configure)

With `MAIL_ENABLED` unset (or not exactly `true`), every send is a no-op that logs:

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

Point the backend at it. For a **host-run backend** (VS Code "Backend (tsx)" debug),
add to your shell env or `.env`:

```bash
MAIL_ENABLED=true
SMTP_HOST=localhost
SMTP_PORT=1025
# SMTP_SECURE stays false (mailpit speaks plain SMTP / STARTTLS)
# No SMTP_USER/SMTP_PASS — mailpit accepts unauthenticated mail
```

For a **backend running inside compose**, use the service name instead:

```bash
SMTP_HOST=mailpit
SMTP_PORT=1025
```

Then trigger any code path that sends mail and watch it land in the UI at
http://localhost:8025 (subject, from, to, and the rendered body).

## What to verify

- **Disabled is a true no-op**: with `MAIL_ENABLED` unset, sends only log
  `[MAIL disabled] …` and never open a socket.
- **Enabled + mailpit**: messages appear in http://localhost:8025 with the
  configured `MAIL_FROM` (default `IdeaHub <no-reply@ideahub.local>`).
- **Enabled but no `SMTP_HOST`**: the backend boot **fails fast** outside
  development (`FATAL: MAIL_ENABLED=true but SMTP_HOST is not set. Exiting.`); in
  development it logs a `WARNING` and the mailer stays in log-only mode.
- **Dead relay never breaks a request**: point `SMTP_HOST` at a black hole (e.g.
  `192.0.2.1`) with `MAIL_ENABLED=true` — the send logs `[MAIL] send failed …`
  after the ~10s timeout and resolves `false`; the triggering request still succeeds.

## Cleanup / notes

```bash
docker compose --profile mail down   # stop mailpit (add -v to wipe, though it keeps no volume)
```

- mailpit binds to `127.0.0.1` only; dev-only, never reuse outside localhost.
- The **corporate relay's real host / port / auth are TBD with the infra team.**
  Once known, set `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` and (only if the relay
  is not IP-allowlisted) `SMTP_USER` / `SMTP_PASS`. See the `Mail` section of
  `.env.example` and the configuration table in `README.md`.
