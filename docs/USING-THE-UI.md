# Using the We've Got This MCP through the UI

We've Got This is an **MCP server** — a set of 25 care tools an AI assistant calls. You never
call those tools by hand: you drive them the way an Alexa+ user would, by **talking to the
console**. The console is an MCP *client*; behind it sits the live production MCP server.
This guide is how to use it.

```
You (speak/type in the console)  →  planner  →  MCP tools on the live server  →  the board updates
                                                        ↑
   real events also arrive here from Ring / Bee / Calendar / Gmail / Telegram (the data doors)
```

---

## The surfaces (live URLs)

Base: `https://krqi2tpsif.us-east-1.awsapprunner.com`

| Path | What it is | Use it to |
|---|---|---|
| `/console` | **The Alexa+ console** — the main way in | Talk or type as a family member and watch the care board react |
| `/setup` | First-run onboarding | Create a fresh care circle from scratch (what a judge drives) |
| `/tv` | Ambient Fire TV surface | The living-room display: big clock, care gaps slide in as notifications |
| `/board` | Full dashboard | A close-up of the whole board for viewing |
| `/` | Landing page | Overview and links |

The **Fire TV app** (React Native, Vega/Fire OS/web from one codebase) renders the same board;
in development it runs at `http://localhost:8082`.

---

## Driving the console (`/console`)

1. **Pick who you are.** The member buttons (Musa, Tolu, Daddy, Funmi) set *who is
   speaking*. This is the identity every tool sees — the app only lets you do what that
   person is allowed to do.
2. **Talk or type.** Tap the **orb** (or the Speak button) and talk, or type in the box.
   Speech uses your browser's recogniser, cleaned up against the household's own names.
3. **Watch it land.** The care board updates live, each item carrying a **provenance chip**:
   - 🟢 **CONFIRMED** — a person stated it
   - 🟣 **INFERRED** — the system guessed it (never counted until someone confirms)
   - 🟠 **NO RECORD** — nothing was logged (which is *not* "it didn't happen")

You are not choosing tools — you speak naturally and the planner picks the right one. Here is
what the common things you can say actually do:

| Say something like… | The MCP tool it drives | What happens |
|---|---|---|
| "What needs doing?" / "Is anything being missed?" | `get_care_gaps` | Lists unowned, missing, or overdue work |
| "Ask Funmi if she can take Daddy to his eye check-up" | `request_owner` | Asks that person — and **messages them on Telegram** |
| "Yes, I'll take it" / "I can't" | `respond_to_request` | Answers a request made of *you*; assigns or reopens it |
| "How do you know that?" / "Who said he needs a ride?" | `get_provenance` | Walks the whole chain behind an item |
| **"What are you connected to?"** | **`get_connections`** | Reports each data door: LIVE / connected / not set up |
| "Daddy used his evening eye drops" | `log_care_event` | Records a dose (as reported) |
| "The eye check-up is Thursday at 10" | `record_appointment` | Records it and *proposes* the ride/companion for a human to confirm |
| "How is he doing?" / "Catch me up" | `get_care_summary` | The day: what's logged, notes, what's coming |
| "What's on my shift?" | `get_shift_brief` | What's assigned to you and due |
| "Check on things" / "Chase the open items" | `run_care_agent` | The agent reviews everything unowned and asks the fairest person |

The full tool set also includes `claim_obligation`, `assign_obligation`, `confirm_proposal`,
`resolve_obligation`, `reorder_prescription`, `confirm_purchase`, `add_note`, `notify_member`,
`ingest_signal`, `add_member`, `add_medication`, `remove_member`, `create_household`,
`get_my_requests`, `get_started`.

---

## Seeing the delegation loop end to end

The strongest thing to show: an ask leaving the app and an answer coming back over a real
channel.

1. As **Tolu**, say: *"Ask Funmi if she can take Daddy to his eye check-up on Thursday."*
2. The app asks Funmi and **sends her a Telegram** (in the family group, if group mode is on).
3. Funmi replies **"yes"** in Telegram → the board flips the ride to **ASSIGNED, owner Funmi**,
   and the bot answers in the chat. No one touched the console for the reply.

The reply travelled the *same* path a spoken "yes" would (`respond_to_request`), so how you
answer never changes what your answer means. See `docs/TELEGRAM-SETUP.md`.

---

## First-run onboarding (`/setup`)

`/setup` drives the real onboarding tools (`create_household`, `add_member`, …) so a new
person can stand up their own care circle and become its primary caregiver. It is the
judge-facing "start from nothing" flow; it writes real state, not a mock.

---

## Direct tool calls (for testing/demo control)

Two HTTP endpoints back the console, useful for scripted demos:

- `POST /api/say` `{ memberId, text }` — natural language through the planner (what the mic/box do).
- `POST /api/act` `{ memberId, tool, args }` — call one tool **directly** with exact arguments,
  bypassing the planner. Deterministic, for setting up a demo precisely — e.g.
  `{"memberId":"m_david","tool":"get_connections","args":{}}`.

Both run as the given member, against the live production MCP server.

---

## Checking the connections from the UI

Ask the console *"what are you connected to?"* (or call `get_connections`). It reports each
data door honestly — **LIVE** (connected and receiving events), **CONFIGURED** (connected but
nothing has arrived yet), or **NOT CONNECTED** — reading the same environment the connectors
require, so it can never claim a connection that isn't really there.
