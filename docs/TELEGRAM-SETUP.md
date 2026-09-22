# Telegram bot — go-live runbook (the WhatsApp-free reply channel)

Telegram is the **live** reply channel of the delegation loop: same seams as the WhatsApp
door (`Notifier` + signed-ish webhook + shared `applyRequestResponse`), but a bot token from
`@BotFather` stands it up in minutes with **no business verification, no Meta throttle**.
CareCircle asks a member to take a job on → the ask arrives in their Telegram chat with the
bot → they reply "yes"/"can't" → the board updates.

- **Webhook URL:** `https://ypq2dfq2p7.us-east-1.awsapprunner.com/telegram/webhook`
- **Secrets rule:** every value below lives in the gitignored `.env` and, in production, in
  App Runner env vars. Never commit or paste a token.

---

## 1. Create the bot (Telegram app → @BotFather)

1. Message **`@BotFather`** → `/newbot` → give it a name and a username ending in `bot`.
2. BotFather replies with the **bot token** (`123456:ABC-DEF...`) → `TELEGRAM_BOT_TOKEN`.

## 2. Get each recipient's chat id

A bot **cannot** open a chat — the person must message it first.

1. Each person opens the bot (the `t.me/<yourbot>` link BotFather gives) and taps **Start**.
2. Read the chat ids Telegram now has:
   ```bash
   curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates" | python3 -m json.tool
   ```
   Each `result[].message.chat.id` is that person's numeric chat id.
3. Build `TELEGRAM_RECIPIENTS` — a JSON map of **CareCircle member id → chat id**, e.g.
   `{"m_renee":"987654321"}`.

## 3. Pick a webhook secret

Any string you choose (e.g. `carecircle-tg-2026`) → `TELEGRAM_WEBHOOK_SECRET`. Telegram
echoes it back in the `X-Telegram-Bot-Api-Secret-Token` header on every call; our webhook
compares it constant-time and rejects anything else. This is the gate (Telegram does not sign
the body the way Meta does).

## 4. Set the env vars (`.env`)

```
TELEGRAM_BOT_TOKEN=123456:ABC-...
TELEGRAM_RECIPIENTS={"m_renee":"987654321"}
TELEGRAM_WEBHOOK_SECRET=carecircle-tg-2026
TELEGRAM_HOUSEHOLD_ID=...        # which household inbound replies land in (defaults to the Ring household)
```

Once set, `notifierFromEnv` **prefers Telegram** over WhatsApp/SNS/record-only — the agent's
ask goes out over Telegram automatically.

## 5. Register the webhook with Telegram

```bash
curl -s "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://ypq2dfq2p7.us-east-1.awsapprunner.com/telegram/webhook" \
  -d "secret_token=carecircle-tg-2026"
```
Expect `{"ok":true,"result":true,...}`. Check anytime with `.../getWebhookInfo`.

## 6. Deploy the env vars to App Runner

Env-only `update-service` on **`carecircle-mcp`** (`ypq2dfq2p7`, us-east-1). Derive the payload
from the live `describe-service` config and add only the four keys, piping file→file so no
value is printed, and preserve `AuthenticationConfiguration.AccessRoleArn` + every existing
secret (the self-signup rollback trap; see `docs/HANDOFF.md`).

## 7. Prove it end-to-end

1. From the sim, have the agent ask the mapped member → the ask arrives in their Telegram.
2. Reply **"yes"** (or 👍) → the webhook (secret-token checked) → `applyRequestResponse` with
   `channel:'telegram'` assigns the obligation → the board updates.
3. Reply from an un-mapped chat → acknowledged, acts on nothing (trust gate holds).

No platform verification, no lead time — this is the one to demo live.
