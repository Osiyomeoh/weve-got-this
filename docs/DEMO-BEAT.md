# The 40-second beat — the one take that proves it is real

The 3:00 video ([VIDEO.md](VIDEO.md)) earns all four judging axes. This is the **single
continuous 40-second shot** inside it that does the one thing no other assistant does, and
does it **irreversibly, on the real running system, in one take**. If a judge watches only
40 seconds of CareCircle, it is this. If a judge suspects the whole thing is a mockup, this
is the beat that refutes them.

**Why "irreversible" is the whole point.** Everything demo-able can be faked with a slide
deck — except a system committing a change it cannot take back. This beat commits three:
an obligation is *asked* of someone, *declined*, and *accepted* — each written to an
append-only log, each visible on two independent surfaces at once, and none of it undoable.
The proof is not that it looks slick; it is that at 0:40 the recorded history exists and
can be replayed with `get_provenance`. You cannot stage that. That is the argument.

**One rule: one take, no cuts, no alt-tab.** The moment there is an edit, the beat stops
proving the thing it exists to prove. Two windows are arranged before recording rolls; the
camera never leaves them. If a line fumbles, the whole 40 seconds is reshot from the top.

---

## The state the shot opens on

Run `npm run demo:reset` first. The board opens with:

- The **eye check-up appointment**, Thursday, and a **ride nobody owns** — its subject is
  Daddy, who needs accessible transport, so it ranks with the weight that carries.
- No zombie `PROPOSED` rows (dismiss the two dated 2024-12-19 if present — see VIDEO.md).

Two windows, arranged and never left:

- **Left — voice:** the simulated Alexa+ console (`npm run sim`), signed in as **Tolu**.
- **Right — the shared board:** the Fire TV surface, a second live MCP session on the same
  household. It is not a screenshot of the left window; it is an independent reader of the
  same append-only store. That independence is what makes the simultaneous clear mean
  something.

---

## 0:00 – 0:40, second by second

Timings are targets; the spoken lines and the tool calls are exact. Every tool named here
is one of the 23 the server actually exposes — nothing is narrated that the system does not
do.

### 0:00 – 0:06 · The gap, and why it ranks

> **Tolu (voice):** "What's going to fall through the cracks this week?"
> **CareCircle:** "The ride to eye check-up Thursday has no driver yet. It's ranked highest —
> it needs accessible transport, so there are fewer fall-back rides if it slips."

- **Fires:** `get_care_gaps`
- **Right (board):** the ride sits at the top, its score expanded to `cost × p(dropped) ×
  confidence`. **Caption:** `severity is arithmetic — an assumption can never outrank a fact`
- The accessibility clause is spoken **as a logistics fact, never a verdict about him.**
  That refusal is the same one the medication beat makes, one level over.

### 0:06 – 0:16 · Ask, not assign

> **Tolu:** "Ask Funmi to take him."
> **CareCircle:** "I've asked Funmi. Asked isn't agreed, so this is still an open gap."

- **Fires:** `request_owner` (Funmi)
- **Both surfaces, simultaneously:** the ride flips to a `REQUESTED` chip.
  **Caption:** `REQUESTED — asked is not agreed. Still a Care Gap.`
- **This is the first irreversible write.** The request is now in the log with who asked,
  who was asked, and when.

### 0:16 – 0:26 · A "no" is information, not a failure

> **Funmi (voice, second device):** "I can't, I'm working Thursday."
> **CareCircle:** "That's noted — the ride is back with no owner."

- **Fires:** `respond_to_request` (decline)
- **Both surfaces:** Funmi's name clears; the ride returns to an unowned `OPEN` gap.
  **Caption:** `a decline is recorded, never counted as fault`
- The decline is written to the log. It is **not** erased — that permanence is the point,
  and it is why the system asks the *next* person rather than Funmi again.

### 0:26 – 0:34 · The gap clears on both screens at once

> **Tolu:** "Then I'll take it myself."
> **CareCircle:** "Done — you've got the ride to eye check-up Thursday."

- **Fires:** `claim_obligation` (Tolu) → obligation transitions to `ASSIGNED`, `ownerId`
  set to Tolu.
- **The hero frame:** the HIGH card clears on the **left and right windows in the same
  instant**, because both are reading the same committed state. No cut. **Hold it for two
  seconds.**
- **Why Tolu clears it on camera, not the paid aide.** This is a *filming-reliability*
  choice, and it is worth being precise about, because the honest version is more interesting
  than "the aide isn't allowed." Structurally the aide **can** own work: `respond_to_request`
  gates only on being the person asked (not on role), and the aide role even carries
  `claim_obligation`. The headless `npm run beat` proves it — Musa accepts and the gap
  clears. But in a **live, natural-language** take we saw the seam: the aide's session has no
  `read_full_state` (the full care record is the family's), so when Musa said *"yes, I've got
  Thursday"* the planner, unable to see the whole board, deferred — *"the family member who
  coordinates care would need to record that."* Safe, but not the clean clear a one-take needs.
  A **full-role family member (Tolu)** has full visibility, so the planner reliably calls
  `claim_obligation` and the gap clears in-frame. On camera, take the deterministic path; name
  the aide's reduced visibility as the least-privilege model doing its job, not as a block.

### 0:34 – 0:40 · The proof you cannot fake

> **Tolu:** "How do we know it's covered?"
> **CareCircle:** "Funmi was asked Thursday and said she was working, so Tolu took it on.
> Right now Tolu owns it."

- **Fires:** `get_provenance` (the ride)
- **On screen, held to the cut:** the chain — *asked → declined → claimed → owned* — every
  step timestamped, replayed from the append-only log, **not narrated by a model.**
  **Caption:** `every step recorded. nothing invented. reproducible: npm run story`

---

## Why this survives a skeptical judge

- **It is one take.** No edit hides a reset or a retake. The state genuinely moves from
  "nobody owns the ride" to "Tolu owns it" and cannot move back within the shot.
- **Two independent surfaces clear together.** A mockup animates one screen; it cannot make
  a second, separately-connected reader agree in the same frame unless the change is real.
- **The history is replayable.** `get_provenance` at 0:34 reads the actual transition log.
  If any of it were staged, the chain would not exist to show.
- **Every claim is reproducible with no cloud, no keys:** `npm run beat` replays the loop
  headless against the real in-process server (ask → decline → accept → provenance chain). It
  currently has the *aide* accept — which is itself worth showing, because it proves ownership
  is not role-blocked; the on-camera take swaps only that final accept to **Tolu** for a
  deterministic clear (see 0:26–0:34). `npm run story` walks the full seven-beat scenario;
  `npm run trust-benchmark` reproduces the refusal numbers. Told, then provable.

## The numbers this beat is allowed to say (keep honest)

- **23 tools**, live, MCP spec 2025-11-25 — every tool in the beat is one of them.
- **311 tests**, including the adversarial + property suites behind the refusal and the
  accessibility ranking.
- Do **not** say the eval % or imply Ring/Bee did anything here — this beat is voice + board
  only, so there is nothing to overclaim.

## Two staging choices to make before you roll

Both are visible in `npm run beat` today, and both are decisions, not bugs — set them the
way the shot needs:

1. **Severity tier vs. rank.** The ride is always the **top-ranked** gap (accessibility
   uplift lifts it above the pickup — you can hear the reason in its `because`). But the
   HIGH/MEDIUM/LOW *tier* is expected harm, and expected harm rises as the deadline nears:
   a eye check-up ride five days out reads LOW even at rank one. If you want the card to read
   **HIGH** on camera, seed the appointment nearer (within ~2 days). Say "ranked highest"
   (true regardless) rather than naming a tier the board might not show.

2. **What the origin line says.** The seeded ride carries `INFERRED` provenance and is never
   run through `confirm_proposal`, so at 0:34 the chain opens with *"still a suggestion, not
   a fact"* even though the ride is now owned — honest about the origin, but easy to misread
   aloud. If you want the origin to read as human-confirmed, confirm the proposal in the
   opening state first; the ownership steps that carry the beat are unaffected either way.

## If the take breaks

Reshoot from 0:00 — do not splice. A single continuous failure-free take is the deliverable;
a spliced one forfeits the only thing the beat was for. Recovery order between takes:
`npm run demo:reset`, re-confirm the board is in the opening state, then roll.
