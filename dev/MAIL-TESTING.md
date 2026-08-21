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

## 3. Lifecycle notification mails

Besides the department "new idea" mail, the **submitter** of an idea can opt in to
be emailed every time **their** idea moves through the lifecycle — approved or
rejected by a reviewer, and, since execution moved to Jira, the Jira-driven
milestones: work **started**, **completed**, or **cancelled** (these come from the
constant actor "Jira" and name the issue key). A power user closing an idea with
the **mark-done override** also mails the submitter — that message carries the
mandatory reason as a quoted block. To watch one land end-to-end:

1. Point the backend at mailpit and enable outbound mail (section 2 above).
2. As a regular user, **submit an idea** with the **"Notify me about changes"**
   toggle **on** — it appears on the create form only while mail is enabled.
   Already have an idea? Open its **details page** and flip the same toggle on
   there; the submitter can change the opt-in at any status.
3. As a **different** power user/admin, **approve** (or reject) the idea — that
   mail is immediate. For the Jira milestones: enable the integration (admin →
   **Jira settings**) against a test project, click **Create Jira task** on the
   approved idea (the dialog arrives preselected with the department's project),
   then move the issue in Jira — the started/completed/cancelled mails go out when
   the poller next syncs. Or skip Jira entirely and use **Mark as done** on the
   detail page for the immediate completion mail with the reason.
4. Watch the mail arrive in http://localhost:8025 — one message per action,
   addressed to the submitter (subject e.g. *Your idea was approved*), with a link
   back to the idea.

**"I did the action but no mail came" — the three usual reasons:**

- **Self-notifications are suppressed.** The actor is never mailed about their own
  change, so if the submitter approves or marks done their *own* idea, nothing is
  sent. Use a second account for the human actions. (The Jira-driven milestones
  have no human actor, so they always mail the opted-in submitter.)
- **The opt-in is per-idea and defaults off.** Every idea starts with the toggle
  off (legacy ideas included), so an idea submitted without it — or before mail was
  enabled — sends nothing until you turn it on for *that* idea.
- **Jira milestones wait for the poller.** Started/completed/cancelled mails are
  sent by the sync tick, not by the click in Jira — expect them within the
  configured poll interval (Jira settings → poll interval), not instantly.

**Legacy note:** the old in-app claim flow is gone (claiming was replaced by the
Jira dispatch), so there is no "claimed" mail anymore. Ideas claimed *before* the
Jira switch are grandfathered: their assignee can still add progress steps and
complete them, and those two mails (progress update, completed) still exist for
exactly those ideas.

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
