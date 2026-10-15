# WhatsApp Business Cloud API — go-live runbook

The WhatsApp door is **built and tested**. This is the
purely-operational checklist to make it *live*: collect five values from Meta, set six env
vars, register one webhook. No code changes.

- **Business display number:** `+234XXXXXXXXXX` (already inside a Meta developer app)
- **Webhook URL:** `https://ypq2dfq2p7.us-east-1.awsapprunner.com/whatsapp/webhook`
- **Secrets rule:** every value below lives in the gitignored `.env` and, for production, in
  App Runner env vars. Never commit or paste a token anywhere.

---

## 1. Collect the values (Meta app → WhatsApp → API Setup)

| Env var | What it is | Where |
|---|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | the numeric **Phone number ID** shown *under* `+234XXXXXXXXXX` (NOT the number) | API Setup |
| `WHATSAPP_TOKEN` | access token — "Temporary access token" (24h) is fine for the demo; a System User token is permanent | API Setup |
| `WHATSAPP_APP_SECRET` | signs inbound webhooks; **App Settings → Basic → App Secret → Show** | Settings → Basic |
| `WHATSAPP_VERIFY_TOKEN` | a string **you invent** (e.g. `carecircle-verify-2026`); you paste the *same* string into Meta's webhook config in step 3 | you choose |
| `WHATSAPP_RECIPIENTS` | JSON member→phone map, e.g. `{"m_renee":"+234XXXXXXXXXX"}` — maps a CareCircle member id to the phone that gets the ask | you |
| `WHATSAPP_HOUSEHOLD_ID` | household that inbound replies land in (defaults to the Ring household if unset) | you |

> **Test-number limit:** an unverified number only delivers to **whitelisted recipients**.
> On the API Setup page, add your personal phone under **"To"** first, or no message arrives.
> Sending to arbitrary numbers needs Meta **business verification** (the long-lead item).

## 2. Set them locally (`.env`)

Append to the gitignored `.env` (values are yours; never commit):

```
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_TOKEN=...
WHATSAPP_APP_SECRET=...
WHATSAPP_VERIFY_TOKEN=carecircle-verify-2026
WHATSAPP_RECIPIENTS={"m_renee":"+234XXXXXXXXXX"}
WHATSAPP_HOUSEHOLD_ID=...
```

Once configured, `notifierFromEnv` **prefers WhatsApp** over SNS/record-only automatically —
the agent's ask will buzz the mapped phone.

## 3. Register the webhook (Meta app → WhatsApp → Configuration)

1. **Callback URL:** `https://ypq2dfq2p7.us-east-1.awsapprunner.com/whatsapp/webhook`
2. **Verify token:** the exact string you put in `WHATSAPP_VERIFY_TOKEN`.
3. Click **Verify and save.** Meta sends a GET; our `createWhatsAppVerify` echoes the
   challenge only when the token matches (else 403). A green check = verified.
4. **Subscribe** to the **`messages`** field so inbound replies are delivered.

## 4. Deploy the env vars to App Runner

Env-var changes are an `update-service` on **`carecircle-mcp`** (`ypq2dfq2p7`, us-east-1).
The payload MUST preserve `AuthenticationConfiguration.AccessRoleArn` and every existing
secret — derive it from the live `describe-service` config and add only the six keys, piping
file→file so no value is ever printed. (Dropping them is what once rolled back self-signup.)
Then `start-deployment` is not needed for an env-only update — the
update itself redeploys.

## 5. Prove it end-to-end

1. From the CareCircle sim, have the agent ask the mapped member to take an obligation → the
   ask arrives as a real WhatsApp on `+234XXXXXXXXXX`.
2. Reply **"yes"** (or 👍) from that phone → the signed webhook fires →
   `respond_to_request`-equivalent assigns the obligation → the board updates.
3. Reply from an un-mapped number → acknowledged, acts on nothing (trust gate holds).

On-screen label for the film: *sent via CareCircle's WhatsApp Business line* — the sender is
always the Business number; Meta forbids driving a personal WhatsApp account.
