# CareCircle — Build Plan: real connections, no seed data

> **Status (live):** Google **Calendar** (inbound + write-back) and **Gmail** (invite →
> appointment) are **built, tested, and auto-synced** on a background heartbeat. The
> **Ring** API client (account link + device list) is built; Ring event intake is the
> HMAC-verified webhook, live once the portal callback URL is set + a device fires.
> **Bee** (facts + todos, GET /v1/facts + /v1/todos, Bearer) is **built and tested**
> (2026-09-22): a todo → PROPOSED obligation, a fact → recorded observation, both
> "heard, unconfirmed" via the same INFERRED gate; on the connector heartbeat, gated
> behind `BEE_TOKEN` + `BEE_API_BASE`. **WhatsApp** (the delegation loop's reply
> channel) is **built and tested** (2026-09-22): outbound asks via the Business Cloud
> API, inbound Yes/Can't via a signed webhook → `respond`-equivalent, gated behind
> `WHATSAPP_*`. All five doors' code is on `main`; going live on WhatsApp needs Meta
> Business verification (external, not code).


Goal: connect **real accounts and devices** — your Google Calendar, your Gmail, WhatsApp,
Ring, Bee — so real events flow into CareCircle and it actually works. No seed data, no
`*-simulate` stubs. Every event in the demo is a real event that really happened.

One rule still governs every connection:

> A real event from any source enters as a **CareSignal → INFERRED item** → a human confirms
> → fact. No connection writes a fact directly. That gate is the trust thesis, and it holds
> whether the event is seeded or real.

The film is then a recording of the **real, connected system** — dramatized human footage,
real screens. Nothing on a screen is fabricated because nothing needs to be: it works.

---

## Phase 0 — What we connect onto (already real)

- MCP server, 23 tools, spec 2025-11-25, live on App Runner (`krqi2tpsif...`)
- Bedrock (planner), DynamoDB (store), Transcribe/Polly (voice), SNS (alerts) — all wired
- Ring **adapter** exists (HMAC webhook → INFERRED); now we point it at the **real Ring API**
- `ingest_signal` is source-agnostic — the single front door every real connection lands in
- Fire TV **board** exists as an MCP Apps UI widget (see Fire TV note below)
- 311 tests; refusal + provenance real

---

## The honest connection matrix (read before building)

Not all four "just connect to my account." Two have real platform limits:

| Source | Can we connect the *real* account? | What it actually takes | Constraint to know |
|---|---|---|---|
| **Google Calendar** | ✅ Yes, fully | Google OAuth, Calendar API, read your real calendar + write back | None material. Cleanest. Start here. |
| **Gmail** | ✅ Yes, fully | Google OAuth, Gmail API, read matching emails | Scope to specific senders so it's not noisy. Real. |
| **Ring** | ⚠️ Yes, with a device | Free Ring dev account + Ring API (per resources); real events need a **real Ring device** on your account | Do you own a Ring device? Without one, the API has no real events to emit. |
| **Bee** | ⚠️ Yes, with data | Bee account + Bee API/CLI/MCP (docs.bee.computer); pull your real facts/todos | Needs a Bee wearable/app **actively capturing** your conversations to have real data. |
| **WhatsApp** | ⚠️ Not your *personal* account | WhatsApp **Business** Cloud API (Meta): a business number sends/receives; your personal phone is the real recipient/replier | Meta does **not** allow API access to a personal WhatsApp account. Real messages arrive on your real phone — but the *sender* is a Business number, not "your" WhatsApp. Test number works with whitelisted recipients immediately; production needs Meta business verification (lead time). |

**Plain version:** Google (Calendar+Gmail) is a clean real connection today. Ring and Bee are
real *if you have the device/data*. WhatsApp is real messages to your real phone, but through
a Business number — that's the only way Meta permits, and it's honest to say so on screen.

---

## Phase 1.0 — Alexa+ surface: RESOLVED, no build needed

Organizer ruling (Devpost, 9/1/26): the **Alexa+ MCP Toolkit / Category SDK add-on tools
are "available to select partners only," with no way to apply.** The real Alexa+ web
simulator is therefore **not attainable** — do not pursue it.

The track does **not** require it. Per the organizers, the Alexa+ track is satisfied by any of:
a self-hosted MCP server (spec 2025-11-25+) on the open `modelcontextprotocol.io` standards,
an Agent Skill, or a **simulated Alexa+ experience with your own agentic tools.**

**We already satisfy this:** live self-hosted MCP server (2025-11-25) + our own web-app
Alexa+ sim console. Nothing to build for eligibility. Our sim console **is** the compliant
Alexa+ surface and the one we record for the film. All effort goes to the data doors below.

---

## Phase 1 — Real connections, in build order (leverage ÷ friction)

Each connection = real OAuth/API + a real inbound path into `ingest_signal` + a regression
test asserting it lands as INFERRED (never a direct fact). No simulate command; the test
uses a recorded real payload as a fixture, but the running system uses your live account.

### 1.1 Google Calendar + Gmail (start here — zero platform friction)
- **OAuth:** Google Cloud project, OAuth consent screen, Calendar + Gmail scopes, your account.
- **Calendar inbound:** watch/poll your real calendar → event → `CareSignal(source:'calendar')`
  → INFERRED appointment on the board.
- **Calendar write-back:** `record_appointment`/`claim_obligation` → writes to your shared
  family calendar → shows on every phone. This is the real "it synced to my phone" moment.
- **Gmail inbound:** a real appointment/refill email from a chosen sender → INFERRED item.
- **Proof it works:** you add a real event in Google Calendar on your phone → it appears on
  the CareCircle board within the poll window, as INFERRED, awaiting your confirm.

### 1.2 Ring (real API, needs your device)
- Free Ring developer account + Ring API (resources: `ring-api-helloworld`).
- Point the **existing** HMAC webhook adapter at real Ring events from your device.
- **Proof it works:** a real motion/doorbell/delivery on your Ring → real webhook → INFERRED
  note on the board. No device → we cannot claim this is live; say so.

### 1.3 Bee (real API, needs your captured data) — ✅ BUILT (2026-09-22)
- **Built:** `src/connectors/bee.ts` + `src/domain/bee.ts`. Pulls the account's real
  `GET /v1/facts` and `GET /v1/todos` (Bearer `BEE_TOKEN`, base `BEE_API_BASE`), and
  folds each through the trust gate: an open **todo → PROPOSED obligation** (INFERRED,
  `bee:todo`, always `logistical` — a microphone never gets to assert a medical stake),
  a **fact → recorded observation** (`source:'bee'`, `confidence:'observed'`, "heard,
  unconfirmed"). Idempotent by Bee row id; completed todos are skipped. On the connector
  heartbeat alongside Calendar/Gmail. Tests: `domain/bee.test.ts`, `connectors/bee.test.ts`.
- **To go live:** set `BEE_TOKEN` + `BEE_API_BASE` (Bee's direct API may sit behind a
  private-CA proxy — see docs.bee.computer). No code left; needs your Bee account + a
  wearable actively capturing data.
- **Proof it works:** a real thing you said, captured by Bee, surfaces as a *suggestion*.

### 1.4 WhatsApp (Business Cloud API — real messages, business sender) — ✅ BUILT (2026-09-22)
- **Built.** Outbound: `src/notify/whatsapp.ts` — `WhatsAppNotifier` sits behind the same
  `Notifier` seam as SNS/record-only and is preferred by `notifierFromEnv` when configured,
  so the agent's ask buzzes a real phone via the Graph API. Members map to numbers by an
  explicit env map (`WHATSAPP_RECIPIENTS`), never a field on the person; an unmapped member
  is not messaged (`delivered:false`), never guessed. Inbound: `src/http/whatsapp-webhook.ts`
  — GET verifies the subscription, POST takes signed (`X-Hub-Signature-256`, HMAC-SHA256 of
  the raw body with the app secret) inbound replies; `src/domain/whatsapp.ts` reads Meta's
  payload and interprets Yes/Can't conservatively (ambiguous → nothing). A reply is matched
  only to the **sender's own** outstanding request via `src/domain/request-response.ts` (the
  same transition `respond_to_request` makes), so a "yes" from someone nobody asked assigns
  nothing. Idempotent by Meta message id. Tests: `domain/whatsapp.test.ts`,
  `domain/request-response.test.ts`, `notify/whatsapp.test.ts`, `http/whatsapp-webhook.test.ts`.
- **To go live:** Meta developer app + WhatsApp Business Cloud API number; set `WHATSAPP_TOKEN`,
  `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`,
  `WHATSAPP_RECIPIENTS` (JSON member→phone), `WHATSAPP_HOUSEHOLD_ID`; point Meta's webhook at
  `/whatsapp/webhook`. The *sender* is always the Business line (Meta forbids driving a
  personal account) — state it on screen. Business verification is the long-lead item.
- **Proof it works:** a real WhatsApp message lands on your real phone; your reply updates the
  board. On-screen label: sent via CareCircle's WhatsApp Business line.

### 1.5 Fire TV — decide the real target
- Today the "board" is an MCP Apps UI widget, not a Fire TV app. Two honest options:
  - **A (real Fire TV app):** build a React Native TV app (resources:
    `react-native-multi-tv-app-sample`) that reads the live MCP server and renders the board
    on an actual Fire TV / emulator. This makes the Fire TV *track* submission real, not just
    Alexa+. Bigger scope.
  - **B (keep the MCP Apps board):** it's a real live surface already; present it as the
    shared display without claiming a native Fire TV app.
- Pick based on whether we enter the **Fire TV track** too, or Alexa+ only.

---

## Phase 2 — Prove it end-to-end, live (no seed)

- A written runbook: do each real action (add calendar event, send the WhatsApp, ring the
  doorbell, say the thing Bee hears) and watch the board react — the acceptance test for
  "it actually works."
- Keep `demo:reset` only for clearing *your* test household between takes — not for
  fabricating events. Events come from the real connections.

---

## Phase 3 — Capture the real screens

Record each surface clean, driven by the **real** action:
Google Calendar event you add → board; real WhatsApp on your phone; real Ring event; real Bee
fact; the refusal; provenance; gap clearing across board + calendar + WhatsApp; tests.

---

## Phase 4 — AI human b-roll (screens blank)  ·  Phase 5 — Composite + edit  ·  Phase 6 — Submit

(unchanged in spirit: AI generates the human world, real screens composited in via cutaway +
one Fire-TV hero screen-replacement; Polly VO; captions; disclosure line
*"Dramatization — all on-screen product behavior is the real connected system."*)

**Mini-challenges to bank:** AWS Builder (Bedrock etc. already integrated). Open Source (a
real PR during the window — Hacktoberfest overlaps). Both ride on the primary submission.

---

## Accounts / access to line up (the real critical path)
1. **Google Cloud project + OAuth** (Calendar + Gmail) — do first, no friction.
2. **Meta WhatsApp Business** app + test number — start now, longest lead time.
3. **Ring developer account** — free; confirm you own a Ring device for real events.
4. **Bee account** — confirm the wearable/app is capturing real data to pull.
5. **$150 AWS credit form** — submit early.

## The blocking questions (they decide what's truly "live")
- Do you own a **Ring device**? (No device → Ring can't be a live claim.)
- Do you have a **Bee** actively capturing? (No data → Bee can't be a live claim.)
- Are we entering the **Fire TV track** (build the RN TV app) or **Alexa+ only**?
- WhatsApp: OK that it's a **Business number** sender (the only way Meta allows)?
