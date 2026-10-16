# Google (Calendar + Gmail) — go-live runbook

Both Google doors share **one OAuth refresh grant**, so this single setup connects Calendar
(read upcoming events + write owned work back) and Gmail (read invite/refill emails). No
device, no cost. Scopes are read-mostly: `calendar.events` and `gmail.readonly` — no access to
settings, and no ability to send mail.

- **Values needed:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`
- **Secrets rule:** all three live only in the gitignored `.env`, never committed.

---

## 1. Google Cloud console (once)

1. Create a project: `https://console.cloud.google.com/projectcreate`
2. Enable both APIs (for the selected project):
   - Google Calendar API — `https://console.cloud.google.com/apis/library/calendar-json.googleapis.com`
   - Gmail API — `https://console.cloud.google.com/apis/library/gmail.googleapis.com`
3. OAuth consent screen (`…/apis/credentials/consent`): User type **External** → fill the
   app name + your email → on the **Test users** step, **add your own Google account**. (Test
   mode is enough; no verification needed while you're the only user.)
4. Create the client: **Credentials → Create credentials → OAuth client ID** → Application
   type **Desktop app** → Create. Copy the **Client ID** and **Client secret**.

## 2. Mint the refresh token (locally)

From the repo root, with the two values from step 1:

```bash
GOOGLE_CLIENT_ID=<id> GOOGLE_CLIENT_SECRET=<secret> npm run google:auth
```

This runs the standard OAuth loopback flow: it prints a Google consent URL, you authorize in
your browser as your test-user account, and it prints:

```
GOOGLE_REFRESH_TOKEN=1//0g...
```

The refresh token is the only durable secret; the local server exists for those few seconds.

## 3. Put it all in `.env`

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=1//0g...
CARECIRCLE_CONNECTOR_INTERVAL_MS=300000     # poll every 5 min (the heartbeat is OFF when unset)
# optional:
# GOOGLE_CALENDAR_ID=primary                # which calendar to read (default: your primary)
# GMAIL_QUERY=...                           # narrow which emails count (default: a scoped query)
```

> The connector heartbeat only runs when **both** a Google account is configured **and**
> `CARECIRCLE_CONNECTOR_INTERVAL_MS` is set — so that last line is required to actually sync.

## 4. Deploy

Env-only, on `carecircle-mcp`. `infra/deploy-mcp.sh` now passes the `GOOGLE_*` keys and the
connector interval through; source `.env` and run it, then `start-deployment` only if the
image changed (an env-only change redeploys on its own). Secrets and the ECR access role are
preserved from the live config.

## 5. Prove it works

1. On your phone, add a real event to your Google Calendar (e.g. "Dentist Friday 3pm").
2. Within the poll window (5 min), it appears on the board as an **INFERRED**
   appointment, awaiting a human confirm — never written as a fact.
3. Ask the console *"what are you connected to?"* → `get_connections` now shows **Google
   Calendar: live** and **Gmail: live** once an event/email has landed.
