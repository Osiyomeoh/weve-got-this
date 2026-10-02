# CareCircle

[![CI](https://github.com/Osiyomeoh/carecircle/actions/workflows/ci.yml/badge.svg)](https://github.com/Osiyomeoh/carecircle/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![MCP spec 2025-11-25](https://img.shields.io/badge/MCP-2025--11--25-6f42c1)

**An Alexa+ add-on that hears the care work nobody mentioned, and asks the right person to
take it on.**

> **Daddy:** "I have my eye check-up tomorrow at ten."
>
> **CareCircle:** "Noted - eye check-up for Daddy. Will Daddy need a ride to the eye
> check-up? *I'm guessing from the appointment type, not from anything anyone told me.*"
>
> **Tolu, his son:** "Yes, he'll need one."
>
> **CareCircle:** "Right - Drive Daddy to the eye check-up. Nobody's taken it yet. Do you want
> it?"
>
> **Tolu:** "Ask whoever's free."
>
> **CareCircle:** "I've asked Funmi whether they can drive Daddy to the eye check-up tomorrow
> at 10 AM. I picked Funmi because they're the one who has nothing else on the care board
> right now. It stays unowned until they say yes."
>
> **Funmi, on her phone:** "Yes, I can take him."
>
> **CareCircle:** "Thanks - Drive Daddy to the eye check-up is yours now."

Nobody typed a task. Care tools start from one: a to-do someone wrote, a
reminder someone set, a change someone reported. CareCircle starts from the sentence
before that. In a family where everyone helps and nobody is in charge, the thing that
fails is not the thing someone forgot. It's the thing **nobody knew was theirs.**

```
EVENTS            ->   OBLIGATIONS       ->   OWNERSHIP
what happened          what must happen        who has it
"eye check-up          someone has to          ...nobody
 Thursday at 10"       take him                has claimed it
```

### What only CareCircle does

- **It notices work nobody said out loud.** A medical appointment implies a ride, and someone
  to go along and take notes. Each inference says it is a guess, and counts only once a person
  confirms it.
- **It asks; it never assigns.** It picks who has room (whoever has least on the care board),
  asks them, and the work stays unowned until they say yes. Left alone, it only interrupts
  someone when arithmetic you can read says it's worth it: the harm a slipped task would do,
  against the cost of the interruption. If they can't, it names who to ask next, and it asks the
  same person less often the more it has already asked them.
- **It never turns silence into blame.** A missing record is "there's no record", never "he
  missed it": **0%** false accusations, where the raw model it plans with makes them **50%** of
  the time on the same cases.
- **It works across borders.** The Echo sits with whoever coordinates; everyone else talks to
  CareCircle in Telegram, in any country. With no Echo in the house, Daddy tells the bot "I used
  my eye drops" himself, and a brother abroad gets an evening update instead of being asked to
  drive.
- **It keeps up with real life.** The doctor stops the drops after two weeks; the check-up
  moves to Friday, and the ride moves with it, and whoever was driving is told. A dose logged
  twice is flagged before it becomes a second dose. "Daddy has fallen" reaches every phone at
  once, not only a group chat someone has muted, and says to call 112. A family caring for two
  people is asked "Dad or Grandma?" instead of guessed at. And after eye surgery, when reading
  a phone is hard, Daddy sends a voice note and gets one back, with what it heard shown so a
  misheard word is caught.
- **It holds up under an assistant it did not write.** Tool choice is measured on three models,
  and under the system prompt of an Alexa Skill bridge instead of our own (Kay Lerch's
  open-source [alexa-skill-mcp-bridge](https://github.com/KayLerch/alexa-skill-mcp-bridge),
  which we use to test on Alexa before add-ons open): **93.1%** on Amazon
  Nova Pro, against 94.4% under ours. The tool descriptions do the work, so it should carry to
  Alexa+.

### Why I built this

> I'm from Lagos, Nigeria. We're a family of five, and our dad. Our mum has passed. In
> Nigeria we take care of our parents, and we still have to work to make a living. My dad
> is going on seventy. He just had surgery and had to time his own medication, and he
> wanted to know what was going on. He has medications, supplements, check-ups and the rest his
> doctors prescribe, and getting around isn't easy anymore. We all want to help. But
> nobody is in charge - so the thing that fails isn't the thing someone forgot. It's the
> thing **nobody knew was theirs.**

A brother in the UK wants updates on Dad's health too. So family far away get a short
evening update on the day, and CareCircle never asks them to drive anyone to a clinic in
Lagos. And the person being cared for is a **participant, not a patient on a dashboard**: he
doesn't want to be watched, he wants to know what's going on, so he logs his own care by
talking.

**Built in Lagos, for every family that shares care across a few people and a few places,
including millions of American ones.** 53% of US family caregivers say someone else also
helps the same person, and 58% do medical or nursing tasks such as managing medications
([AARP & NAC, 2020](docs/EVIDENCE.md)). Alexa+ runs in the home of whoever coordinates the
care, and it launched in the US. Everyone else joins over Telegram or WhatsApp, which work
in any country. A daughter in Houston asks her Echo what nobody has taken on; her dad and
sister in Lagos and her brother in London answer in the family group.

**Next: a real family, for a week.** Demos prove the mechanism; they don't prove a family
will use it. So a real circle runs it before submission, and `npm run pilot:report` turns
their record into numbers: doses logged and by whom, asks answered and how fast, and every
"no record" that someone filled in later. Those numbers go here, including whatever didn't
work.

The demo family (Daddy, his children Tolu and Funmi, Kunle in London, and Musa the
driver) is fictional and modelled on mine. No real names or medical details are used.

**And it is real - not a mockup.** Live MCP server you can hit right now, **575 tests**
(including property-based proofs of the risk model), **94.8%** measured tool-selection
accuracy on Amazon Bedrock (147/155; 94.0% on held-out phrasings never tuned against),
**94.4% on Amazon Nova Pro** (on the earlier 144 cases), and an append-only care record that
keeps who said what. On Amazon's own MASSIVE test set, 2,974 everyday Alexa requests, it leaves
**87.6%** of the ones that are not about care alone (up from 76.6%; not held out, see
`evals/results/README.md`).

### Try it live in your browser - no clone, no keys

**[https://krqi2tpsif.us-east-1.awsapprunner.com](https://krqi2tpsif.us-east-1.awsapprunner.com)** - the Alexa+ console, running on Amazon
Bedrock. Click **"Open the live demo"**, pick a household member (top-left), and type or
speak. Every visitor gets their own private copy of the demo family, so nothing you do
reaches anyone else; **Start over** gives you a fresh one. Three things to try, a minute
in all:

1. **As Tolu:** *"Did Daddy use his evening eye drops?"* It tells you there's no record of
   that dose, and **never** *"he missed it."* That refusal is the whole product.
2. **As Tolu:** *"Ask Funmi if she can take Daddy to his check-up."* It **asks**, it doesn't
   assign: the board shows Funmi was asked, and the check-up stays unowned. Now switch to
   **Funmi** and say *"Yes, I can take him"*. It's hers, and the board says so.
3. **As Kunle, the brother in London:** *"How was Daddy's day?"* He gets the whole picture,
   with who logged what. CareCircle never picks him for a ride; he gets an evening update
   instead.

The console drives the same append-only care record the voice surface and the Fire TV board
read, so a claim you make in the browser shows up everywhere at once.

### Or run the whole story locally in ~60 seconds

```bash
git clone https://github.com/Osiyomeoh/carecircle && cd carecircle
npm ci && npm run story
```

MCP endpoint (for your own client): `https://ypq2dfq2p7.us-east-1.awsapprunner.com/mcp`
(returns 401 without a token - it enforces OAuth) · health: `/health`

**Want to point your own client at it?** [`docs/MCP.md`](docs/MCP.md) is the
integration guide: endpoint and handshake, ready-made Claude Desktop and MCPJam
configuration, all 25 tools with their arguments, the resources and prompts, the
role/capability matrix, and how to run your own instance.

---

## The thesis, in one paragraph

> **CareCircle is a shared responsibility graph that turns everyday events into owned,
> actionable care — while structurally refusing to turn silence into accusation.**
> Alexa+ talks to it. Ring feeds evidence into it. Fire TV shows it. One graph,
> three surfaces, and a trust model that is arithmetic, not a promise.

## What this is *not* (scope, on purpose)

Not a medication tracker, a family calendar, elder monitoring or reminders: those exist
and are well served. CareCircle does one thing: it finds responsibilities hidden inside
everyday conversation, surfaces the ones nobody owns, and gets a person to own them.

A submission is judged as much by what it refuses to claim as by what it builds. We drew
these lines deliberately and held to them:

- **No multi-agent swarm.** One deterministic policy (`deliberate()`) decides; the LLM only
  turns a spoken sentence into a tool call. The safety-critical reasoning is arithmetic we
  can test, not an emergent behaviour we hope for.
- **No computer vision, robotics, or silent physical actuation.** CareCircle never *does* a
  physical thing on its own. It asks a human, and a human acts.
- **No phone-first app as the story.** The person being cared for talks; he never touches a
  screen. A dashboard exists for the family, but it is a *reader*, not the product.
- **No Bee integration.** We are submitting **Alexa+**, and the rules require showing *live*
  Bee-device data being used. We have no device, so we do not claim one — Ring is the single
  external-evidence seam, exercised end-to-end with Ring's real HMAC-signed payload shape.
- **No overclaimed production integrations.** Where a surface is simulated (the Ring device,
  the Alexa+ console), the docs and the video say so plainly. What is simulated is the
  device; what is exercised is the integration.
- **No number we cannot reproduce.** Every figure in this README is regenerated by a command
  in it, and quoted as the range it actually occupies, not a flattering point estimate.

---

## Known is not Assumed

The rule the whole system is built on:

> **The absence of a record is never treated as proof that something did not happen.**

CareCircle will say *"there's no record of his evening dose"*. It will never say
*"he missed his evening dose"*, because it does not know that. Every fact carries
provenance and the four states are never collapsed:

| State | Meaning |
|---|---|
| `CONFIRMED` | A human asserted it. The only thing treated as fact. |
| `NOT_LOGGED` | No record exists. Not evidence of anything. |
| `INFERRED` | The system guessed, by a named rule. Never counts until confirmed. |
| `RESOLVED` | An obligation was discharged. |

This is enforced by a test, not by good intentions:

```js
assert.doesNotMatch(gap.spoken, /did ?n[o']t take|missed|forgot|failed/i);
```

In a domain that runs on family guilt, a system that turns silence into an accusation
is worse than no system. So ours structurally cannot.

**We measured how much this matters.** Given a care log with a dose that has no record
and the question "did she take it?", a raw Claude Sonnet 4.5 - the *same* model
CareCircle plans with - asserted the accusation ("she missed it", "she hasn't taken
it") in **6 of 12 cases (50%)**. CareCircle's deterministic engine: **0%**, on the same
scenarios, because it can only say "there's no record." Every answer is printed and
auditable; reproduce with `npm run trust-benchmark`. The trust model is not a slogan -
it is a measurable, ~50-point swing on whether a sick, elderly woman gets accused of
missing her heart medication.

**Inference proposes, humans dispose.** Obligations the system infers enter as
`PROPOSED` and are excluded from Care Gaps entirely until a person confirms them.
The system is allowed to notice that an appointment probably needs a ride. It is not
allowed to decide that on the family's behalf.

---

## One record, four relationships

The household - not the individual - is the unit of state. The same server serves
everyone in the circle with different authority, and **identity comes from the
session credential, never from the conversation**: a model can be talked into
believing anything about who is speaking, and this server assigns responsibility for
someone's medical care.

| Member | Role | Can |
|---|---|---|
| Daddy, going on 70 | `care_recipient` | Log his own events; hear his own day |
| Tolu | `primary_caregiver` | Everything: claim, assign, confirm, escalate |
| Funmi | `caregiver` | Claim, add, confirm - but not assign to others |
| Musa (the driver, paid help) | `helper` | Only today's work, and only work he owns |
| Kunle, in London | `caregiver` | Same as Funmi; gets the evening update, and is never picked automatically for work that needs someone there |

Denials are written to be spoken, and say what the person *can* do instead:

> "Only the primary caregiver can assign work to someone else. You can take it on
> yourself instead."

---

## Architecture

The one model everything else serves is the **responsibility graph** -
`ENTITY → EVENT → OBLIGATION → OWNERSHIP → STATE`, where no obligation can exist without
provenance. It has its own deep dive: [`docs/RESPONSIBILITY-GRAPH.md`](docs/RESPONSIBILITY-GRAPH.md).

![CareCircle system architecture](docs/architecture.svg)

Signals (Alexa+, Ring) are **captured** by the MCP server into one **shared responsibility
graph**; deterministic engines **reason** over it (gap ranking, agent policy, the trust
guard) and **act** through Fire TV, notifications, and voice. Every write carries provenance,
and a human always confirms an inferred obligation - the dashed feedback loop.

```
                    Alexa+ / any MCP host
                            |
                   MCP  (Streamable HTTP, spec 2025-11-25)
                            v
                +-----------------------+
                |   CareCircle server   |
                +-----------+-----------+
                            |
       +-------------+------+------+--------------+
       v             v             v              v
   Resources       Tools        Prompts      MCP App
   who I am,     25 tools    daily check    the Care Board,
   care state                weekly review  drawn in the host
       |             |
       +------+------+
              v
      Care Gap engine        <- deterministic. Not model narration.
      provenance, severity,     The model speaks the result;
      ranking, reasons          it does not invent it.
              v
      Append-only event store
```

**Care Gap detection is server logic, not a prompt.** The model receives ranked,
reasoned, structured gaps and speaks them. That keeps the reasoning auditable, makes
the ordering inspectable (every gap carries its `score` and a plain-language
`because`), and means the server is useful to any client - not only an LLM.

### Code map

```
src/
  domain/        the product: pure, deterministic, no I/O
    gaps.ts            Care Gap detection and expected-harm ranking
    delegation.ts      who to ask next (family first, never someone far away)
    agent.ts           the autonomous policy: value = harm avoided - interruption cost
    attribution.ts     "Musa logged it for Daddy" is never shortened to "Daddy did"
    commerce.ts        priced offers; what "refill his prescription" means
    daily-update.ts    the evening update for family far away
  mcp/
    server.ts          assembles one server per session (tools listed in order)
    tools/             the 25 tools, grouped: record, ownership, delegation,
                       insight, signals, commerce, onboarding
    output-schemas.ts  every tool's output contract, strictly enforced
  http/          Streamable HTTP, OAuth 2.1 + PKCE, Ring and Telegram webhooks
  store/         append-only event log; DynamoDB or a local file
  notify/        Telegram, WhatsApp, SNS - or record-only, honestly labelled
  connectors/    Google Calendar, Gmail, Ring (and a Bee seam, unclaimed: no device)
  sim/           the Alexa+ console: a real MCP host driving Bedrock
  evals/         the 155-case tool-selection harness
packages/care-events/   the device-adapter seam, published separately
```

### Severity is expected harm, not tuned points

A gap's rank is not a hand-set number. Each gap's `score` estimates **expected harm**,
`risk = Cost × P(dropped) × Confidence`, every term in `[0,1]` ([`src/domain/gaps.ts`](src/domain/gaps.ts)):

- **Cost** - normalized harm if the work is dropped: medical `1.0`, logistical `0.5`,
  social `0.2`.
- **P(dropped)** - a continuous exponential *hazard* on the deadline
  (`exp(-hoursUntil / 48h)`, → 1 once overdue), OR-combined with an aging hazard
  (`1 - exp(-age / 72h)`) for unowned work. No bucket staircase, so ranking is monotone
  and never jumps at an edge.
- **Confidence** - a Bayesian posterior on the evidence: `CONFIRMED 1.0`,
  `NOT_LOGGED 0.75`, `INFERRED 0.6`, multiplied in - so **an assumption can never
  outrank a fact.** This is "Known ≠ Assumed" expressed as arithmetic.

`HIGH / MEDIUM / LOW` are risk tertiles of the `0-100` score, not magic cutoffs, and
every gap carries its `factors {cost, pDrop, confidence}` so a card can show *why* it
ranks where it does. When a judge asks "why 85?", the answer is a derivation, not a vibe.

**The model's laws are proven, not just exemplified.**
[`src/domain/gaps.props.test.ts`](src/domain/gaps.props.test.ts) uses `fast-check` to
assert boundedness, determinism, confidence dominance (Known ≥ Assumed), imminence
monotonicity, and cost ordering over thousands of generated states.

---

## The Care Board: the same answer, drawn instead of spoken

A voice turn carries about three items before a person stops holding the list. But the
real answer to *"what's falling through the cracks?"* is a **ranked list with state** —
severity, owner, due time, why it was flagged, and how sure we are. Spoken, all of that
structure gets flattened into a sentence and thrown away.

So `get_care_gaps` is also an **MCP App** ([SEP-1865](https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/),
spec dialect `2026-01-26`). The tool points at a `ui://` resource, the resource returns a
self-contained HTML view, and a host that supports the extension renders it in a sandboxed
iframe that talks back over the same JSON-RPC. See
[`src/mcp/app/`](src/mcp/app/).

Three things it does that a card normally does not:

**It shows its provenance.** Every row says how we came to believe it — a person told us,
we inferred it by a named rule, or we simply have **no record**. That last chip is drawn
quietly on purpose, and it says so on hover: *an absence of information is not evidence.*
The trust model isn't in the README, it's on the screen.

**The ranking explains itself.** Tap a score and it expands into the actual arithmetic —
`cost × p(dropped) × confidence`. The score is a deterministic engine's output, not a
model's opinion, and the view will show you its working. A ranking over someone's medical
care that can't be audited shouldn't be trusted.

**Claiming closes the loop.** Voice is the right input for *capture* and the wrong one for
*disambiguating among similar items* — "I'll take the check-up one" makes the model
resolve a referring expression to an id, and it will sometimes get that wrong. A tap can't.
The button makes a real `tools/call` to `claim_obligation` down the same authorisation path
as speech (no weaker permission model for clicks), then tells the model what changed via
`ui/update-model-context`, so the conversation doesn't go on offering work already taken.

The view reaches **no origin but its host** — no CDN, no fonts, no network at all — so
there is nothing to allowlist and nothing to inject into a page showing a family's medical
coordination. And it is strictly an *enhancement*: a host that can't draw ignores the
resource, and the spoken answer is untouched. There's a test asserting the spoken text
never says "tap", "click" or "below", so the view can never quietly become load-bearing.

> This is also us answering our own [feature request](docs/FEATURE-REQUESTS.md). "A
> structured visual return channel for MCP results" was the loudest thing in that file.
> The protocol half now exists, so we built against it rather than keep complaining. The
> half that's still open is the one only Amazon can close: **Alexa+ adopting the
> extension**, so the board a desktop host already draws today reaches an Echo Show — and
> degrades to our existing speech on a headless one. We built the card once, to the open
> standard.

---

## Sources and surfaces, one responsibility layer

The things around Daddy are not integrations bolted on. They are *kinds of evidence*
and one *shared display*, feeding and reading **one** responsibility layer - and **MCP is
the seam** that lets entirely different surfaces participate in the same system. Every
inbound source lands through the same gate: it becomes an `INFERRED` proposal or an
`observed` appointment - a *suggestion*, never a fact - and a human confirms it. Nothing
is a fact until a person says so.

| Source | Kind of evidence | Status |
|---|---|---|
| **Alexa+** | DECLARED - someone says it | **LIVE** (real MCP host + Bedrock) |
| **Google Calendar** | SCHEDULED - a dated commitment | **LIVE, two-way** (OAuth): events in as `observed` appointments; owned work written back to the shared calendar. Auto-synced on a heartbeat. |
| **Gmail** | SCHEDULED - a calendar invite (.ics) | **LIVE** (OAuth read): an appointment-confirmation email's invite becomes an appointment. Never guesses a date from prose. |
| **Ring** | PHYSICAL - a sensor observed it | **Real** HMAC-verified webhook → `INFERRED`, plus a real API client ([`src/connectors/ring.ts`](src/connectors/ring.ts)); a live doorbell event needs the webhook URL set in the Ring portal + a device. |
| Bee / other sensors | AMBIENT | Not built - but `ingest_signal` is source-agnostic, so any sensor enters the same way. |
| Fire TV | not evidence: the SHARED DISPLAY | Live ambient TV screen (below) |

The Google doors are real inbound/outbound connectors ([`src/connectors/`](src/connectors/)):
given a linked Google account they read the real calendar and invite emails, and write
owned, dated work back to the shared calendar so it appears on every family member's phone.
A background loop keeps them in step without anyone running a command. Set them up with
`npm run google:auth` (see [Running it](#running-it)).

A physical signal is **evidence, not a verdict**: a Ring delivery becomes an `INFERRED`
proposal that *"the prescription pickup may be done"* - a human confirms it; the system
never closes a medical obligation on a sensor alone. It enters the same pipeline as a
ride inferred from an appointment, which is exactly why it needs no change to the gap
engine or the trust model. Ring has no polling API, so events arrive only by the
HMAC-verified webhook; the API client verifies the account link and lists devices.

**The shared display.** Fire TV is the third surface - not more evidence, but where the
assembled truth is *seen*. It is one real React Native screen (rendered on Fire TV /
Android TV / web from the same code) built as **ambient TV content**: a calm clock over
which care gaps arrive as sliding notification cards, the way a TV OS surfaces an alert -
not a dashboard a family has to read. It polls the same live `/api/state` the voice
surface does. Try it: **[`/tv-native/`](https://krqi2tpsif.us-east-1.awsapprunner.com/tv-native/)**.

---

## Running it

### Quickstart for judges - no credentials, no AWS, ~60 seconds

Either open a live surface, hit the deployed server, or clone and run the
self-contained demo.

**Live surfaces (nothing to install):**
- Voice console + care board: `https://krqi2tpsif.us-east-1.awsapprunner.com/console`
- Ambient TV surface: `https://krqi2tpsif.us-east-1.awsapprunner.com/tv-native/`
- MCP server health: `https://ypq2dfq2p7.us-east-1.awsapprunner.com/health`

```bash
# Option A - hit the live MCP server, nothing to install
curl https://ypq2dfq2p7.us-east-1.awsapprunner.com/health

# Option B - clone and reproduce locally (no AWS needed)
git clone https://github.com/Osiyomeoh/carecircle && cd carecircle
npm ci
npm run lint      # eslint (typescript-eslint, strict) - 0 findings
npm run typecheck # tsc under strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes
npm test          # 575 tests (unit, adversarial, and property-based)
npm run story     # the whole one-day story, end to end, over real MCP
```

`npm run story` is the fastest way to see it work: it seeds the demo family, starts
the real MCP server in-process, and plays every beat through real MCP clients - **no
AWS, no API keys, no external services.** Deterministic, so you see exactly what the
video shows.

### Full experience (needs AWS Bedrock)

```bash
npm run dev      # MCP server on :8787
npm run sim      # simulated Alexa+ experience on :5173  (needs Bedrock)
npm run e2e      # the story through a real MCP client   (needs the server on :8787)
npm run evals    # published tool-selection accuracy      (needs Bedrock)
```

The simulator and the evals need AWS credentials with Bedrock access:

```bash
export AWS_PROFILE=conductor
export AWS_REGION=us-east-1
export BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-5-20250929-v1:0
```

See `.env.example`. Bedrock daily token quotas are per region, so a second region
with model access enabled is a useful fallback when one is exhausted.

### Connect real sources (optional)

The Google and Ring doors read real accounts. They are off until configured, so the
demo above needs none of this.

```bash
# Google Calendar + Gmail — one consent covers read, calendar write-back, and Gmail read
GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npm run google:auth   # prints a refresh token
# then, with GOOGLE_REFRESH_TOKEN in .env:
CARECIRCLE_HOUSEHOLD=h_margaret npm run calendar:sync   # real events  -> board (INFERRED)
CARECIRCLE_HOUSEHOLD=h_margaret npm run calendar:push   # owned work   -> shared calendar
CARECIRCLE_HOUSEHOLD=h_margaret npm run email:sync      # invite email -> appointment

# Ring — verify the account link and list real devices
npm run ring:check     # needs RING_ACCESS_TOKEN (Ring Developer Playground) or a refresh token
```

Set `CARECIRCLE_CONNECTOR_INTERVAL_MS` (e.g. `300000`) and the server syncs the Google
doors automatically on a heartbeat - no CLI needed. Ring device events arrive by webhook:
point the Ring Developer Portal's callback at `https://<your public URL>/ring/webhook`
(HMAC-verified with `RING_HMAC_KEY`).

## Preflight

```bash
npm run preflight
```

Bedrock reports an exhausted quota and a quota of zero with the same error -
`ThrottlingException: Too many tokens per day`. They are opposite situations: a
budget refills, a zero quota never will. Clients retry `ThrottlingException` by
default, so an account with no allocation retries forever.

The preflight reads the applied quota values and says which case you are in,
including whether a zero is an `ACCOUNT`-level override that only AWS Support can
lift. The simulator runs the same check automatically when a turn is throttled, so
the error explains itself rather than advising a wait that will never end.

Working this out by hand cost the better part of a day. See
[`docs/FRICTION-LOG.md`](docs/FRICTION-LOG.md).

## Measured tool selection

An MCP server lives or dies on whether a model picks the right tool from the
descriptions alone, so we measure it rather than assert it:

```bash
npm run demo:reset && npm run dev   # in one shell
npm run evals                       # in another
```

**Result: 94.8% first-tool accuracy (147 / 155, 0 errored) - Claude Sonnet 4.5 on Amazon
Bedrock, 2026-09-23, with 28 tools.** That is one run, and every case of it is in
[`evals/results/`](evals/results/). It is the run that added three tools for when care changes
(`change_medication`, `change_appointment`, `raise_urgent`) and 11 cases for them, including
"Daddy fell asleep early tonight", which must not alert the family (it didn't). On the 25-tool
set before them the corpus scored 138/144, and 139 before that. The planner runs at temperature 0, yet a borderline
case or two still flips run-to-run: the previous corpus measured 124-126 / 135 across
repeated runs (~92-93%) and the same 135 now score 130. A live model is not perfectly
reproducible and we don't pretend it is.

The corpus is deliberately split so the number cannot be gamed, and `npm run evals`
prints each part on its own:

- **79 authored cases**, used while tuning the tool descriptions - **75/79**. Two of the four
  misses are the planner asking a fair question rather than acting ("which medication?",
  "what's the change?"), which the strict grader counts as wrong.
- **67 held-out cases never tuned against** (harder phrasings, multi-intent, wrong-role
  attempts, and out-of-scope lines that name care words on purpose) - **63/67, 94.0%**.
  This is the honest number. One of the four misses, "move his eye check-up to Friday
  instead", chose the new `change_appointment`, which is right; its answer key predated the
  tool. We widened that key after the run and marked the case `seen`, so from the next run it
  no longer counts as unseen.
- **9 held-out cases we later looked at while fixing the server** - **9/9**, reported
  apart. Eight are purchases: they failed because the planner asked "which medication?"
  instead of letting the server work it out, so we fixed the purchase tools (see the
  friction log), marked them `seen`, and wrote **9 fresh purchase phrasings** before
  running again, including a decline and a helper who may not buy. Those count in the
  held-out figure above. The ninth, "Dropped him at the clinic and he's home now", we
  read while fixing "that's done" (below), so it moved out of the held-out set too.

The model receives the real tool definitions and one utterance, using the exact
planner prompt the simulator ships (imported, not a friendlier copy written to
score well); we record its first tool choice and execute nothing. Cases that never
reach the model - credentials, throttling - are excluded from the figure rather than
counted as wrong, because a number that can lie is worse than no number.

**Honest limitations** (the held-out misses, unfixed on purpose): vague-time scheduling
("a flu shot next week sometime" gets asked which day, which our own never-guess-a-date rule
requires), "my grandson's graduation is on the 20th" noted rather than scheduled, "count me
out this weekend" answered with a question, and the reschedule above. Across runs a borderline
case or two flips: "he had everything that was due before noon" and "something's come up, I
can't do Thursday" failed last time and passed this time. Several misses are defensible
behaviour the strict grader still counts as wrong. These are the edges a
larger corpus would harden next.

**On Amazon Nova, and under a prompt we didn't write.** These runs are the 144 cases and 25
tools from before the care-change tools (2026-09-23); Nova has not yet been re-run on the 155. The last row swaps our planner prompt for the system prompt of
an Alexa Skill bridge (a Strands agent that stands in for the Alexa+ orchestrator), because
real Alexa+ will not use our prompt either:

| Planner, on Amazon Bedrock | All 144 | Held-out, never tuned against (67) |
|---|---|---|
| Claude Sonnet 4.5 | 95.8% (138) | 92.5% (62) |
| **Amazon Nova Pro** | **94.4% (136)** | 91.0% (61) |
| Amazon Nova 2 Lite | 83.3% (120) | 77.6% (52) |
| Amazon Nova Pro, the bridge's prompt | 93.1% (134) | 91.0% (61) |

Under someone else's prompt Nova Pro loses two cases and none of the held-out ones, so the
tool descriptions, not our prompt, are doing the work. That run also found the one weak
spot shared by both prompts: "picked up the prescription" or "took him to the clinic, all
done" logged as an event instead of closing the task. We sharpened those two descriptions
and re-ran all four. Nova Pro went from 132 to 136, the bridge run from 131 to 134, Nova 2
Lite from 117 to 120, and Claude from 139 to 138, a case that flips from run to run and
isn't one of the two tools we changed.
Nova 2 Lite, the small model, mostly checks the board before acting: right instinct,
wrong first tool. Run it with `BEDROCK_MODEL_ID=us.amazon.nova-pro-v1:0 npm run evals`, and
see [`evals/results/`](evals/results/) for the bridge prompt. Nova Premier
is still listed in the account's inference profiles but Bedrock refuses it as retired, so
it isn't measured.

We went from an early 85.3% to 100% on the authored set by finding the exact failures
the harness named and rewriting the ambiguous descriptions - then re-measured on the
held-out set to get the honest number.

Demo credentials (one per member - the identity model in miniature):

| Member | Token |
|---|---|
| Daddy | `margaret-token` |
| Tolu | `david-token` |
| Funmi | `renee-token` |
| Musa | `aide-token` |
| Kunle | `kunle-token` |

---

## The tools

Every tool exists because a person says a sentence that needs it.

| Tool | The sentence |
|---|---|
| `log_care_event` | "I used my eye drops" |
| `record_appointment` | "Cardiology is Thursday at ten" |
| `add_note` | "Daddy asked who is taking him on Thursday" |
| **`get_care_gaps`** | **"What's going to fall through the cracks this week?"** |
| `claim_obligation` | "I'll take it" |
| `assign_obligation` | "Give the pharmacy run to Funmi" |
| `confirm_proposal` | "Yes, he'll need a ride" |
| `resolve_obligation` | "Picked up the prescription" |
| `get_shift_brief` | "What do I need to know today?" |
| `notify_member` | "Tell Funmi I'm taking Daddy Thursday" - records it, and delivers over SNS when configured |
| `change_medication` | "The doctor says he can stop the drops after Sunday" |
| `change_appointment` | "The check-up has moved to Friday at two" - the ride moves with it, and whoever had it is told |
| `raise_urgent` | "Daddy has fallen" - every phone at once, and "call 112" |

Tool design follows four rules, because the model is the user:

- **Descriptions disambiguate near-neighbours** - `log_care_event` vs
  `record_appointment` vs `add_note`; `claim` vs `assign`.
- **Errors instruct rather than report.** Two medications match "drops"? The tool
  returns *"ask which one they mean, then call this again"* - it never guesses.
- **Ambiguity is a question, not a default.**
- **Results are written to be spoken verbatim.** No markdown, no ids read aloud, and
  long lists are counted rather than recited.

---

## What Alexa+ MCP needs for this to be great

Product feedback, written while building. Full detail in
[`docs/FEATURE-REQUESTS.md`](docs/FEATURE-REQUESTS.md) and
[`docs/FRICTION-LOG.md`](docs/FRICTION-LOG.md).

1. **Rich cards.** Our core answer is a ranked list with state - severity, owner or
   the absence of one, due time, reason. Spoken, the usable ceiling is about three
   items. On a screen a family absorbs twelve and points at the one they mean. We
   compute all of it and discard it at the speech boundary.
2. **Actionable cards.** Voice is the right input for *capture* and the wrong input
   for *disambiguating among similar items*. A misheard referring expression assigning
   a hospital trip to the wrong person is not an acceptable failure.
3. **Confirmation as a surface.** Before Thursday's check-up run is assigned to Funmi,
   Funmi's name should be on screen.
4. **Multi-person identity.** Families are not single users. Speaker identity should be
   available - and explicitly unknown when it is not, rather than assumed.
5. **Ambient state.** The most valuable moment is not a conversation. It is someone
   walking past the kitchen Echo and noticing Thursday still has no driver.

---

## Scaling and protocol roadmap

CareCircle speaks **MCP 2025-11-25**, the revision the Alexa+ ecosystem and today's clients
speak, and **2026-07-28** alongside it.

**Built and tested, 2026-09-24:**
1. **A care record that is safe with more than one writer.** The table carries a version. A
   save is one DynamoDB transaction that moves the version on only if it is still the one this
   process read; if another process wrote first, the whole save is refused, the store reads the
   record again, and the tool tells the caller to look again and act only if it still applies.
   Before every request and every background tick, one small consistent read checks the
   version, and the record is reloaded only if it moved. Checked against real DynamoDB
   (`scripts/dynamo-concurrency-check.ts`) and in tests with two stores over one table.
2. **The 2026-07-28 revision alongside 2025-11-25.** 2026-07-28 drops the `initialize`
   handshake and per-connection sessions: each request carries its version and is answered by
   a server built for that request alone (v2 TypeScript SDK, `createMcpHandler`), for the member
   its credential names. 2025-era requests, told apart by the SDK's own `isLegacyRequest`, keep
   the session-based path unchanged, so no 2025-11-25 client, Alexa's bridge included, loses
   anything. One registration fills both, so they offer the same 28 tools word for word. Tested
   with two instances over one table: a dose logged through one is read back through the other.

**What still holds it to one instance.** Some state still lives in one process: 2025-11-25
sessions, OAuth codes, webhook de-duplication and the background loops (the agent, reminders,
connectors). App Runner's default would scale out to 25 instances under load, so **both
services stay pinned to one instance** (`carecircle-single`, set by `infra/deploy-mcp.sh`)
until that state is shared too. An earlier version of this section said scaling needed "only
session affinity"; that was wrong. Tool count (28) sits well under the ~50 where model
tool-selection degrades, so no routing filter is needed.

---

## License

MIT. See [LICENSE](LICENSE).
