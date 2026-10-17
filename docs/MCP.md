# Connecting to the We've Got This MCP server

Everything a client needs: how to connect, what the server exposes, who is allowed
to call what, and how to run your own.

We've Got This is a **self-hosted MCP server** over **Streamable HTTP**. It speaks spec
**2025-11-25** (sessions, `@modelcontextprotocol/sdk` 1.30.0) and **2026-07-28** (stateless,
the v2 SDK 2.1.0) on the same endpoint, with the same tools. It exposes 31 tools,
4 resources, 2 prompts, and two interactive views via the
[MCP Apps extension](#the-care-board-mcp-apps).

One idea governs the whole surface, and a client that ignores it will produce
wrong answers that sound right:

> **The server only knows what has been recorded. An absent record is not
> evidence that something did not happen.** Speak tool results as written, and
> never restate a missing record as someone having failed to do something.

The server sends this to every client in its `instructions` on initialize. It is
not decoration - it is the difference between "there's no record of the evening
dose" and an accusation aimed at whoever was supposed to be there.

---

## Endpoint

| | |
|---|---|
| **URL** | `https://ypq2dfq2p7.us-east-1.awsapprunner.com/mcp` |
| **Health** | `https://ypq2dfq2p7.us-east-1.awsapprunner.com/health` |
| **Transport** | Streamable HTTP (POST; responses may be JSON or SSE) |
| **Protocol** | `2025-11-25` |
| **Auth** | `Authorization: Bearer <token>` - required on every request |

The public server runs the demo household (Daddy's care circle) so a client can
be pointed at it and immediately have something real to talk about. It is a demo:
do not put anybody's actual medical information in it.

### Demo credentials

Each token *is* an identity. Which person you authenticate as changes what you are
allowed to do, so pick the one whose authority you want to exercise.

| Token | Member | Role |
|---|---|---|
| `david-token` | Tolu | `primary_caregiver` - full authority |
| `renee-token` | Funmi | `caregiver` |
| `margaret-token` | Daddy | `care_recipient` - the person being cared for |
| `aide-token` | Musa | `helper` - the paid driver, scoped to his own work |
| `kunle-token` | Kunle | `caregiver` - lives in London, gets the evening update, never picked automatically for in-person work |

---

## Client configuration

### Claude (Desktop or claude.ai): custom connector with OAuth

The server supports the full MCP authorization flow, including dynamic client
registration (RFC 7591), so Claude can connect with no config file and no token:

1. **Settings → Connectors → Add custom connector.**
2. Name `We've Got This`, URL `https://ypq2dfq2p7.us-east-1.awsapprunner.com/mcp`. Add.
3. **Connect.** Claude discovers the auth server from the 401, registers itself, and
   opens the We've Got This sign-in page. Pick who you are in the demo household.
4. Ask *"What care gaps still need an owner?"*

The sign-in page is a demo sign-in: it asks which member you are instead of
authenticating you, so it only ever offers the demo household
(`CARECIRCLE_OAUTH_HOUSEHOLD`, default `h_margaret`), never a real family's members.

Each connection gets **its own copy** of the demo family: the same people and the same
week, and nothing you do reaches anyone else's. `get_started` gives the copy's family
code. To put a second agent in the same family, say ChatGPT as Funmi beside Claude as
Tolu, connect it, open **Joining a family another agent already has?** on the sign-in page, and
enter the code. What each agent records says which agent carried it: Funmi's list reads
*"Tolu asked, through Claude, if you can..."*, and the provenance trail keeps the same
line. A copy lasts 30 days, and no token outlives it. Set `CARECIRCLE_OAUTH_COPIES=off`
to have every connection share the one demo household instead.

### Claude Desktop: config file with a demo token

The older path, with no OAuth. Remote servers go through the `mcp-remote` shim. In
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or
`%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "carecircle": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://ypq2dfq2p7.us-east-1.awsapprunner.com/mcp",
        "--header", "Authorization:Bearer renee-token"
      ]
    }
  }
}
```

Restart Claude Desktop, then ask *"What care gaps still need an owner?"*

### MCPJam Inspector

`npx @mcpjam/inspector`, then **Connect → Add Server**: Connection type `HTTP`,
URL as above, Authentication `Bearer Token`, token `renee-token`. MCPJam renders
the Care Board, so this is the quickest way to see the MCP App working.

### Anything else

Any client speaking Streamable HTTP with a bearer header works. The handshake is
ordinary MCP:

```bash
# 1. initialize - the response header carries the session id
curl -sD - -X POST "$URL" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'authorization: Bearer renee-token' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
        "protocolVersion":"2025-11-25","capabilities":{},
        "clientInfo":{"name":"my-client","version":"1.0"}}}'

# 2. notifications/initialized, then any call, both with mcp-session-id
curl -s -X POST "$URL" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'authorization: Bearer renee-token' \
  -H "mcp-session-id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
       "params":{"name":"get_care_gaps","arguments":{}}}'
```

Responses may arrive as SSE (`event: message\ndata: {...}`) rather than plain
JSON, depending on the request. Handle both.

---

## Identity is bound to the session, never to the conversation

This is the part most worth understanding, because it is where a multi-user MCP
server usually goes wrong.

**Who you are is established by the credential, not by anything anyone says.**
There is no `actingAs` parameter on any tool, and no way to tell the server you
are someone else. A model that is talked into believing it is the primary
caregiver still cannot act as one.

- A request with **no credential** → `401` with a `WWW-Authenticate: Bearer` header.
- An **unknown credential** → `401`.
- A **different member's credential inside an existing session** → `403`. Sessions
  cannot be handed between people mid-stream.

These are covered by an adversarial test suite (`src/adversarial.test.ts`), because
in a system that assigns responsibility for someone's medical care, the identity
rules are the product rather than a convenience.

### Roles and capabilities

| Capability | care_recipient | caregiver | primary_caregiver | helper |
|---|:--:|:--:|:--:|:--:|
| `log_own_event` | ● | ● | ● | |
| `log_others_event` | | ● | ● | ● |
| `read_full_state` | | ● | ● | |
| `read_shift` | ● | ● | ● | ● |
| `create_obligation` | ● | ● | ● | |
| `claim_obligation` | | ● | ● | ● |
| `assign_obligation` | | | ● | |
| `confirm_proposal` | | ● | ● | |
| `resolve_obligation` | | ● | ● | ● |
| `escalate` | | | ● | |
| `manage_circle` | | | ● | |
| `make_purchase` | | ● | ● | |

**Denials are written for a model to speak, not for a developer to debug.** They
say what the caller *can* do instead, so a refusal moves the conversation forward:

> *"Only the primary caregiver can assign work to someone else. You can take it on
> yourself instead."*

Treat every `isError` result the same way - the text is an instruction about what
to do next, and should be acted on rather than reported as a failure.

---

## Tools

31 tools. Every one exists because a person says a sentence that needs it; there is
no tool here that mirrors a database table for its own sake.

`?` marks an optional argument.

### Recording what happened

| Tool | Arguments | Notes |
|---|---|---|
| `log_care_event` | `kind`, `medicationName?`, `detail?`, `occurredAt?`, `aboutMemberId?` | `kind` is `medication_taken` \| `check_in`. Logging about someone else needs `log_others_event`. |
| `record_appointment` | `kind`, `startsAt`, `forMemberId?`, `detail?` | May generate `PROPOSED` work (a ride, someone to take notes) that a human must confirm. |
| `add_note` | `note`, `aboutMemberId?`, `unavailable?` | `unavailable` (`memberName`, `from`, `to`) records that someone *cannot* cover a window - work they were quietly covering may stop being covered. |
| `ingest_signal` | `source`, `kind`, `occurredAt?`, `detail?` | The device seam. Any external observation (Ring, a wearable) enters here and becomes an `INFERRED` proposal, never a fact. |

### When care changes

| Tool | Arguments | Notes |
|---|---|---|
| `change_medication` | `medicationName`, `forMemberId?`, `times?`, `until?`, `stopNow?`, `newName?`, `alsoCalled?` | New dose times, a last day, stopped now, or a corrected name. The record keeps what it was; it is just no longer expected. |
| `change_appointment` | `appointment`, `forMemberId?`, `newStartsAt?`, `cancel?` | Moves or cancels one already on the record. What was arranged for it, like a ride, moves or is called off with it, and whoever had it is told. Needs `create_obligation`. |
| `raise_urgent` | `what`, `forMemberId?` | A fall, chest pain, can't be reached: tells everyone in the family at once. It does not call emergency services; it tells the person to, with the local number. |

### Care that comes round again

Medicine is one thing that comes round every day; a meal, someone there at night, help
getting around and the house's diesel, water and electricity are others.

| Tool | Arguments | Notes |
|---|---|---|
| `set_routine` | `what`, `area`, `times?`, `days?`, `forMemberId?`, `mine?`, `orderFrom?`, `stop?` | `area` is `meal` \| `safety` \| `personal` \| `household`. `times` are 24-hour `"HH:MM"`; `days` (`monday`...`sunday`) limits it to those days. `mine` makes every time the speaker's own. `orderFrom` is where it can be ordered from when nobody nearby is free, as the family says it ("Mama Titi's kitchen"); it is only words, never a link to a shop. `stop` ends it; only whoever set it up, or `manage_circle`, can. Needs `create_obligation`. Not for medicine: that is `add_medication`. |

- **Each time is work on the board.** It goes on a day ahead as its own obligation, with no
  owner unless the routine is someone's own. An unowned time is a care gap like any other, and
  the agent asks someone free to take it on.
- **A time that has passed is left alone.** The agent doesn't ask about it, and an ask nobody
  answered before its time is taken back. A day that is over drops off the gaps; its record
  stays.
- **A standing promise isn't nagged.** Whoever said "I'll do it every day" is not checked on
  each time; a time with nothing marked shows as that. A time someone said yes to when asked
  gets the day-before "still on?" and the follow-up like any other yes.
- **Read back without blame.** `get_care_summary` and `get_shift_brief` say each of today's
  times (`routinesToday`): "Bring Daddy lunch at 1 PM: Musa marked it done at 1:10 PM",
  "Funmi has it, and nothing's marked yet", never "nobody came". The person being cared for
  hears the ones that are for them.

### Finding and moving responsibility

Every `obligationId` below should be the id from `get_care_gaps`. When a planner passes
the task's words instead ("the refill", or the whole spoken gap line), the server works
out which one was meant and acts, but only if exactly one open item fits. If two fit,
nothing changes and the error lists both with their ids, so the planner can ask the
person which one.

| Tool | Arguments | Notes |
|---|---|---|
| **`get_care_gaps`** | `withinDays?` | **The core tool.** Everything needing attention with no owner, ranked. Read-only, idempotent. Renders the [Care Board](#the-care-board-mcp-apps). Also the way to resolve "that one" / "yes" / "I've got it" to a specific id. |
| `claim_obligation` | `obligationId` | The speaker takes it on themselves. |
| `assign_obligation` | `obligationId`, `assigneeName` | Gives it to someone else by asking them; theirs once they say yes. Primary caregiver only. |
| `confirm_proposal` | `obligationId`, `confirmed` | Turns a system guess into real work, or dismisses it. |
| `resolve_obligation` | `obligationId`, `note?` | Marks it done. |

### Delegation - asking, not assigning

The circle's defining move: work is *offered* down the circle and only becomes owned
when someone says yes. Being asked is a distinct state (`REQUESTED`) from having agreed
(`ASSIGNED`); a decline is recorded, not erased, and the agent asks the next person
rather than the same one twice.

| Tool | Arguments | Notes |
|---|---|---|
| `request_owner` | `obligationId`, `assigneeName?` | **Asks** someone to take work on; it does not assign. The work stays unowned until they accept. Omit `assigneeName` to have someone suggested, with the reason. |
| `respond_to_request` | `obligationId`, `accepted`, `note?` | The asked person's answer. `accepted: false` is kept as information, not discarded. |
| `get_my_requests` | – | "What have I been asked to do?" Read-only. Use before `respond_to_request` when the id is not known. |
| `run_care_agent` | `dryRun?` | Lets the agent look for slipping work itself and ask an owner - never assigns. `dryRun` reports what it would do without doing it. |

#### The agent's legwork

- **Who's free.** The family calendar is the care record: the work each person has
  already said yes to. Someone with other work due within 2 hours of this is busy then.
  - Free people are asked first, then busy ones; within that, family before paid help,
    then whoever has least on.
  - Busy only ranks a person lower, and never rules them out. Nobody's private calendar
    is read, and silence about the rest of their day is not evidence either way.
  - The reason says so: "already has "Pick up the refill" around then", or "has one
    other thing on, but nothing around then".
  - A busy person is also less likely to say yes, so the agent counts asking them as
    worth less.
- **The day before.** When work someone said yes to is due in the next 24 hours, the
  agent asks them "Still on?" once, by the same arithmetic as any other ask.
  - It asks only about a yes more than 12 hours old, and never about work due within 2
    hours.
  - It never asks between 9 pm and 8 am, or about a social plan like a visit. A
    day-before ask is worth at most 0.3 (0.06 for a social plan); an ask costs at least
    0.12 by day and 1.08 at night.
  - A new yes is a new promise, so it can be asked about again.
  - "yes" keeps the work with them. "can't" hands it back with no owner, records the
    decline, and the agent asks the next free person.
  - Until they answer, `get_promises` reads "there's no answer yet".
- **Ordering in, last.** When nobody nearby can take on a meal, groceries, the diesel, water
  or a refill (a routine with `area` `meal` or `household`, or one with `orderFrom`, counts as
  orderable), the agent asks a family member who lives away "Could you order it in instead?",
  with where it usually comes from. Someone nearby is always asked first, a ride or a visit is
  never offered this way, and the ask is weighed like any other. A yes puts the work on them;
  they then order it wherever they shop and say so with `record_order`. If nobody away can
  either, the heads-up to the primary caregiver says it could be ordered in.
- **Answers over chat.** A "yes" or "can't" to a check-in is answered directly on
  WhatsApp, and on Telegram when the message is to the bot (a DM, a mention, or a reply
  to its message), so family chatter in the group never hands work back. A "yes" after
  the work's time could mean still on or done, so it goes to the model instead.

#### The yes comes from the person (elicitation)

A yes makes a promise, so on a client that can show forms the person gives it themselves.
When the model calls `claim_obligation`, or `respond_to_request` with `accepted: true`, the
server puts a form in front of the person and records only what they press. The model
cannot fill that form in.

| The model calls | The form shows | Choices |
|---|---|---|
| `claim_obligation` | "Take this on?" and the work | Yes, it's mine / Not now |
| `respond_to_request` on an ask | who asked, and the work | Yes, I'll do it / Not this time |
| `respond_to_request` on a "still on?" check-in | "Is this still on?" and the work | Yes, still on / Can't make it after all |

- **What gets recorded:**
  - Yes is recorded, marked as pressed. The promises page and `get_provenance` then say "pressed Yes".
  - The second choice is the person's own no, even though the model heard a yes:
    - for an ask, it is recorded as a decline;
    - for a check-in, it hands the work back;
    - for `claim_obligation`, nothing changes.
  - A form closed without an answer records nothing. The model is told that the work is still waiting for the person's yes.
- **No is never gated.** `respond_to_request` with `accepted: false` never shows a form.
- **Clients without forms are unchanged.** A client that does not declare the `elicitation` capability gets today's spoken path: the model's call is the answer.
- **On MCP 2025-11-25:**
  - The form is an `elicitation/create` request sent on the open tool call's response stream.
  - Only a session whose client declared `elicitation` at initialize gets streamed (SSE) responses. Every other session stays on plain JSON.
- **On MCP 2026-07-28:**
  - The tool answers `input_required` with the form inside, and the client retries with the person's answer.
  - The answer is believed only alongside the server's signed `requestState`. The signature is an HMAC, and the state names the person and the work, and lasts ten minutes. Any instance can verify it.
  - A retry whose state was altered is refused. A yes the server never asked for brings the form back instead.

### Reading the situation

| Tool | Arguments | Notes |
|---|---|---|
| `get_care_summary` | – | How the person being cared for is doing. Read-only. |
| `get_shift_brief` | – | What this shift needs to know. The one read a `helper` is allowed. |
| `get_promises` | – | "What did everyone say yes to this week?" Each promise with its trail: who said yes and when, any "still on?" check-in and its answer, a hand-back, a done, and what the doorbell saw around then. Due work with nothing marked is "nothing's been marked yet", never a promise broken. Read-only; needs `read_full_state`. Renders [its own view](#this-weeks-promises). |
| `get_connections` | – | What the family's record is connected to (Calendar, Gmail, Ring, Bee, WhatsApp, Telegram), each LIVE, CONFIGURED or NOT CONNECTED. A door that has never carried an event is not called live. Read-only. |
| `get_provenance` | `obligationId` | "How do you know that?" Walks the whole chain behind one obligation - how it arose (confirmed, guessed, or no record), the signal it came from, every ownership move - and speaks it without ever stating more certainty than the record carries. Read-only. |
| `notify_member` | `recipientName`, `message` | Records the message, and delivers over SNS when configured. |

### Purchasing

| Tool | Arguments | Notes |
|---|---|---|
| `reorder_prescription` | `medicationName?`, `obligationId?` | Returns a priced **offer** with an ETA. Never charges. Works out *which* medicine from the record ("his prescription" = the refill already waiting) and asks back only when it can't tell. |
| `confirm_purchase` | `offerId?`, `confirmed` | The human decision that makes it real. Without an `offerId` ("yes, place the order" in a new conversation) it finds the waiting order; it places it only for the person who was quoted the price, and reads the price back to anyone else. |

Purchase follows the same discipline as everything else: the offer is a proposal,
and only a confirmation makes it happen. Storefronts are simulated - no real
payment is taken - but the shape is what a real merchant integration would return.

### Ordering in, wherever the family shops

Most of what a family orders in for someone is bought somewhere else: a delivery app, a
pharmacy that delivers, a kitchen down the road, the assistant's own shopping. We've Got
This does not sell, check out, take payment or track a parcel. It records who ordered what
for whom, and keeps the work on a person until someone says it reached them.

| Tool | Arguments | Notes |
|---|---|---|
| `record_order` | `obligationId?`, `what?`, `from?`, `arrives?`, `forMemberId?` | "I ordered Daddy's lunch from Mama Titi's, it'll be there at one." `obligationId` is the work it covers (an id or its words); `what` is the thing ordered when nothing on the board is for it, and becomes new work. `from` defaults to the routine's `orderFrom`. `arrives` is 24-hour `"HH:MM"` (on the covered work's day) or a local date and time. Needs `claim_obligation`. Not for a refill offered by `reorder_prescription`: that is `confirm_purchase`. |

- **On whose name.** The covered work goes to whoever ordered it, unless someone already
  has it; then it stays theirs and the order is only noted.
- **Someone to take it in.** If whoever ordered lives away, a new piece of work goes on the
  board, "Take the delivery from Mama Titi's kitchen in to Daddy", due when it arrives, and
  the agent asks someone nearby, as for any other unowned work.
- **One answer closes both.** Marking the take-in done marks the meal done too, on that
  person's word ("Sandra took it in"). Marking the meal done takes the take-in off the board.
- **The doorbell asks, never closes.** A Ring `delivery_arrived` within 3 hours of the
  arrival time (or within a day of an order with no time) is matched to it: "A delivery
  arrived at Daddy's door. It may be "Bring Daddy lunch", which Kunle ordered from Mama Titi's
  kitchen, due today at 1 PM. Has it reached Daddy?" Ring can say a delivery came; only a
  person can say it reached him.
- **Read back.** The routine's day reads "Bring Daddy lunch at 1 PM: Kunle ordered it from
  Mama Titi's kitchen; Sandra is taking it in", and afterwards "..., and Sandra took it in at
  12:58 PM".
- **Said, not recorded.** An order already on record, work already done or taken off the
  board, a suggestion nobody has confirmed, and a time it can't read are each answered with
  what to tell the person, and nothing is written.
- **Quiet hours are the household's.** An ask to order in is not sent between 9 pm and 8 am
  where the person cared for lives. Members carry no timezone of their own, so a brother in
  Houston can be asked during his night.

### Managing the circle

| Tool | Arguments | Notes |
|---|---|---|
| `get_started` | – | Call first for someone new. Returns the single next setup step, phrased to speak, and on a demo copy its family code. Read-only. |
| `create_household` | `name`, `timezone`, `callerName`, `spokenAs?` | Bootstrap. `timezone` must be a valid IANA name. |
| `add_member` | `name`, `role`, `spokenAs?`, `subject?` | `manage_circle`. |
| `add_medication` | `name`, `times`, `until?`, `forMemberId?`, `alsoCalled?` | `times` are 24-hour `"HH:MM"`. These are what "no record" is measured against. `alsoCalled` is `[{ language, name }]`: what the family calls it in another language (`change_medication` takes it too). A reader in that language hears that name, and it is matched when said. |
| `remove_member` | `memberId` | `manage_circle`. Destructive; releases their work back to unowned. |

### `get_care_gaps` structured output

```jsonc
{
  "gaps": [{
    "id": "gap_unclaimed_obl_…",
    "kind": "UNCLAIMED",        // | UNCONFIRMED | NEEDS_FOLLOW_UP
    "severity": "HIGH",         // | MEDIUM | LOW
    "spoken": "Take Daddy to his eye check-up Thursday at 10 AM - nobody has taken this yet.",
    "because": "Confirmed as needed, originally inferred from eye check-up appointment.",
    "obligationId": "obl_…",    // null when there is nothing to assign yet
    "score": 17,                // round(cost * pDrop * confidence * 100)
    "factors": { "cost": 1, "pDrop": 0.2876, "confidence": 0.6 }
  }]
}
```

`spoken` is written to be read aloud verbatim - no markdown, no ids, long lists
counted rather than recited. `factors` is the score's derivation, exposed so the
ranking can be audited rather than taken on trust:

- **cost** - harm if dropped (medical 1.0, logistical 0.5, social 0.2)
- **pDrop** - probability it is dropped, from deadline and ageing hazards
- **confidence** - `CONFIRMED` 1.0, `NOT_LOGGED` 0.75, `INFERRED` 0.6

`kind` is where the trust model shows up. **`UNCONFIRMED` means there is no record
— it does not mean the thing did not happen**, and must never be rendered as an
accusation. `obligationId` is `null` for these, because there is nothing to assign:
what they need is a person to say what actually happened.

---

## Resources

| URI | MIME | What |
|---|---|---|
| `carecircle://session/me` | `application/json` | Who this credential speaks for, what they may do, and who else is in the circle by name and part. A host reads it once and never asks the person who they are. |
| `carecircle://household/state` | `application/json` | The whole care picture: members, obligations with owner and provenance, today's doses and schedule, gaps, this week's promises, open purchase offers, recent notifications. |
| `ui://carecircle/care-board.html` | `text/html;profile=mcp-app` | The Care Board view. See below. |
| `ui://carecircle/promises.html` | `text/html;profile=mcp-app` | This week's promises, drawn. See below. |

## Prompts

| Name | What it asks |
|---|---|
| `daily-check` | Today's summary, then anything that still has no owner. |
| `weekly-review` | What is going to fall through the cracks this week, then who said yes to what. |

---

## The Care Board (MCP Apps)

`get_care_gaps` is an **MCP App** ([SEP-1865](https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/),
spec dialect `2026-01-26`). A host that supports the extension renders an
interactive board; a host that does not ignores the resource entirely and the
spoken answer is unchanged. The view is an enhancement and never a precondition.

The tool advertises its view in **both** metadata spellings, because hosts in the
wild read one or the other and the wrong one fails silently as a board that simply
never appears:

```jsonc
"_meta": {
  "ui": { "resourceUri": "ui://carecircle/care-board.html" },
  "ui/resourceUri": "ui://carecircle/care-board.html"
}
```

The view is one self-contained document - no CDN, no fonts, no network beyond the
host bridge - so it declares empty CSP domain lists: there is nothing to allowlist
and nothing to inject into a page showing a family's medical coordination.

From the board a user can read each gap's provenance, open the arithmetic behind
its ranking, and claim work with a tap. Claiming issues a real `tools/call` to
`claim_obligation` through the host, down the **same authorisation path as speech**
- there is no weaker permission model for clicks - and then sends
`ui/update-model-context` so the model knows what changed and stops offering work
that is already taken.

Verified rendering in MCPJam against this live server.

### This week's promises

`get_promises` is an MCP App too, declared the same way: both metadata spellings, one
self-contained document, empty CSP domain lists. It draws each promise with where it
stands (said yes, checking in, still on, done, handed back) and a "How we know" trail
under it: the ask, the yes, any "still on?" and its answer, the done, and what the doorbell
saw beside it. It is read-only on purpose. Promising is a person's act, so the view shows
promises and never makes one, and work due with nothing marked is drawn as "Checking in",
never in an alarm colour.

---

## Running your own

```bash
git clone https://github.com/Osiyomeoh/weve-got-this && cd weve-got-this
npm ci
npm run story      # the whole scenario end to end, no AWS and no keys
npm run dev        # the MCP server on :8787 (override with PORT)
npm test           # 814 tests, including adversarial and property-based
```

`npm run story` is the fastest way to understand the system: it plays the demo
household through a full sequence and prints every tool call and result.

### Environment

Everything is optional - with none of it set the server runs in-memory with the
demo household and record-only notifications.

| Variable | Purpose |
|---|---|
| `CARECIRCLE_PROVIDER` | `bedrock` (default) or `gemini`, for the simulator's planner. |
| `AWS_REGION`, `BEDROCK_MODEL_ID` | Bedrock model for the simulator. |
| `GEMINI_API_KEY`, `GEMINI_MODEL_ID` | Gemini alternative. |
| `CARECIRCLE_SNS_TOPIC` | Deliver `notify_member` over SNS instead of recording only. |
| `CARECIRCLE_JWT_CLAIM` | **Opts in to the JWT identity strategy.** The only way to enable it. |
| `CARECIRCLE_MEMBER_MAP` | JSON mapping claim values to member ids. |
| `CARECIRCLE_ALLOW_SELF_SIGNUP` | `true` lets an unknown principal bootstrap a household. Off by default. |
| `PORT` | MCP server port. Defaults to `8787`. |
| `CARECIRCLE_URL`, `SIM_PORT`, `LOG_LEVEL` | Simulator wiring. |

Persistence is in-memory by default and DynamoDB when configured; see
[`PRODUCTION.md`](PRODUCTION.md).

> **Identity in production:** the static bearer tokens are for demos. A real
> deployment sets `CARECIRCLE_JWT_CLAIM` and maps validated claims to members. Do
> not ship opaque shared tokens to real families.

---

## See also

- [`DESIGN.md`](DESIGN.md) - why the model is EVENTS → OBLIGATIONS → OWNERSHIP
- [`FRICTION-LOG.md`](FRICTION-LOG.md) - where the protocol and platform got in the way
- [`FEATURE-REQUESTS.md`](FEATURE-REQUESTS.md) - what we wished existed, and what has since arrived
