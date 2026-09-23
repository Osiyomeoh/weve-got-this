# The demo video - shot list and script

> The continuous 40-second "this is real" beat has its own second-by-second script and an
> executable reproducer (`npm run beat`) in [DEMO-BEAT.md](DEMO-BEAT.md).

**Hard limit 3:00, and judges may stop there or judge on the video alone.** The four
criteria (Tech, Design, Impact, Idea) are weighted equally, so every beat has to earn one
of them. It cannot be a product tour.

**The spine is the delegation loop**, because it is the part no other assistant does: it
finds work **nobody owns** and keeps pursuing it until a person does. In this cut the loop
leaves the screen and happens on **real phones in a real Telegram group**, which is what
separates it from a scripted web demo.

**One rule for the whole video: never show a device doing more than it does.** The Ring
event comes from our signed simulator and is labelled that way. The next ask after a
decline comes from the agent's 15-minute pass, and the cut shows the real clock. A judge
who checks the repo should find the video conservative, not generous.

**One sentence every beat must prove:** *Families don't fail at remembering tasks; they
fail at noticing nobody owns them. CareCircle finds the unowned work, asks the right
person, and never accuses anyone of what it didn't see.*

---

## Before you record

- [ ] **Record before the real-family pilot switches the Telegram door** (see
      `docs/PILOT.md`). This cut needs `TELEGRAM_HOUSEHOLD_ID=h_margaret`.
- [ ] Two phones in the "Magaret's CareCircle" group, mapped in `TELEGRAM_RECIPIENTS`: one
      as **Renee** (already mapped), one as **Tasha** (needs a second Telegram account; map
      it with `npm run telegram:ids`).
- [ ] Fresh demo dates in **production**. `npm run demo:reset` only resets the local
      `carecircle.db.json` file and never touches the live DynamoDB table (and it wipes
      every household, so never point it at production). The live demo household still
      shows December 2024 dates. Use the production-safe reset, which re-seeds only
      `h_margaret`, restarts both services and re-fires a Ring event:
      `AWS_PROFILE=conductor bash infra/demo-reset-prod.sh` (dry run first:
      `AWS_PROFILE=conductor CARECIRCLE_TABLE=carecircle AWS_REGION=us-east-1 npm run demo:reset:prod`).
      Telegram shows "configured" rather than "live" until the group's first reply.
- [ ] **Recording browser in shared mode.** Every console visitor gets a private copy of
      the demo, but the Telegram scene must act on the real demo household. Open
      `https://krqi2tpsif.us-east-1.awsapprunner.com/live?key=<SIM_LIVE_KEY from .env>`
      once in the recording browser; the "your own copy" banner disappears. `/live/off`
      to go back.
- [ ] Console voice pace **gentle** (Polly). Console left, `/tv` right, phones on a stand
      in frame. Never alt-tab on camera.
- [ ] Claude Desktop (or MCPJam) connected to the live `/mcp` endpoint via OAuth, tested
      once before the take.
- [ ] **Your dad's consent** to include his story, and separately to show anything of
      him on camera. Also check your siblings are happy for the family to be described.
- [ ] Burn in captions. The video makes an accessibility argument; it has to be captioned.
- [ ] Say numbers only if they match the repo on record day: tools (`get_started` lists
      them, 25 today), tests (`npm test`, 430 today), trust benchmark
      (`npm run trust-benchmark`).

---

## 0:00-0:20 - Why I built this (Impact, the human story)

**Your own voice, not a narrator.** Every fact below is yours, from what you said;
don't add any. Read it slowly and plainly: it lands because it's true.

> **VO (you):** "I'm from Lagos, Nigeria. We're a family of five, and our dad. Our mum has
> passed. In Nigeria, we take care of our parents, and we still have to work to make a
> living. My dad is going on seventy. He just had surgery, and he had to time his own
> medication. He wanted to know what's going on.
>
> He has drugs, supplements, check-ups, the rest his doctors tell him to take, and
> getting around isn't easy anymore. We all want to help. But nobody is in charge. So what
> fails isn't the thing someone forgot. It's the thing **nobody knew was theirs.**"

**On screen (only with your dad's consent; no face needed):** real, quiet close shots:
his medication and supplements on a table, his hands, a paper schedule if he uses one.
Then your family group chat with one real unanswered question (e.g. *"who's taking
Daddy for his check-up?"*, only if something like it really happened). Blur names and
numbers. Cut hard on "theirs".

> Shorten if it runs long, but don't change facts. Drop a sentence before you speed up.

## 0:20-0:35 - What it is, and why it has no screen (Idea, Design)

**Title card, 2 seconds:** `CareCircle - an Alexa+ add-on, built as an MCP server`

> **VO (you):** "So I built CareCircle for families like mine. My dad doesn't want to be
> watched. He wants to know what's going on. So he doesn't read it or tap it. He talks
> to it, and so does everyone who helps him."

**Live console, the demo family.** Card for 1 second: `Demo family: Margaret, modelled
on caring for my dad.` Margaret, the person being cared for, speaks:

> **Margaret:** "I took my heart pill this morning."
> **CareCircle:** *(Polly, gentle)* "Got it. Logged for this morning."

**Caption:** `CONFIRMED - she said it herself`

## 0:35-0:50 - The refusal (Idea, the most important beat)

> **David:** "Did Mom take her evening pill?"
> **CareCircle:** "There's no record of the evening dose."

Freeze. Two cards, held a full three seconds:

| A normal assistant | CareCircle |
|---|---|
| "She missed it." | "There's no record." |

> **VO:** "It won't turn missing information into an accusation about someone's mother.
> The same model, unguarded, makes that accusation in half of these cases. Ours: zero."

**On screen:** `npm run trust-benchmark - raw model 50% -> CareCircle 0%`

## 0:50-1:05 - The doorbell sees a delivery (Tech, Ring)

Split screen. Right: terminal, `npm run ring:simulate -- --url https://ypq2dfq2p7.us-east-1.awsapprunner.com/ring/webhook --event package`. Left: the board
gets a card, **"a package arrived"**, with an `INFERRED` chip.

**On screen, unmissable:** `Ring simulator - HMAC-signed, same payload as Ring's webhook`

> **VO:** "A doorbell saw a delivery. That's evidence, not a conclusion. A person
> confirms what it meant. No sensor here can close anything on its own."

## 1:05-1:55 - The delegation loop, on real phones (the centrepiece)

The board shows cardiology Thursday **and a ride nobody owns**, ranked high. Tap the
score: `cost x p(dropped) x confidence`.

> **David:** "Who can take Mom to cardiology Thursday?"
> **CareCircle:** "I've asked Renee. She has the fewest things on this week."

**Cut to the phones.** The group lights up:

> **@carecircle0111_bot:** "Renee, David asked if you can take this on:
> Drive Mom to cardiology. Reply "yes" or "can't"."

Renee types **can't**. The bot answers in the group. The board: `OPEN - Renee declined`.

**Caption over a clock jump, real timestamp:** `Next agent pass - nobody asked it to`

> **@carecircle0111_bot:** "Tasha, CareCircle noticed nobody has "Drive Mom to
> cardiology" yet. Can you take it on? Reply "yes" or "can't"."

Tasha types **yes**. On camera, at once: the bot confirms in the group, the console board
flips to `ASSIGNED - Tasha`, and the TV card clears.

**3-second insert:** the ride now on the family's Google Calendar, labelled
`Drive Mom to cardiology - Tasha`.

> **VO:** "Being asked isn't agreeing, so a pending ask still counts as a gap. When
> someone says they can't, it asks the next person on its own, family before the paid
> aide. The answer came back over an ordinary group chat, and it landed on the
> calendar and the TV."

## 1:55-2:08 - Closing a gap by buying the fix (Idea: purchasing)

The refill gap. One offer card, confirmed in the conversation, and the gap closes.

> **VO:** "When the fix is a purchase, it happens right here, and the gap closes when the
> order is placed."

## 2:08-2:35 - Who this is for (Impact)

**If the real-family pilot has run (preferred):** 12-15 seconds of their consented
footage: the group chat on a real phone, one line from a family member, then their real
numbers: `N asks sent - N answered - median answer time - N gaps closed`.

**Otherwise:** a map pulling to West Africa.

> **VO:** "Where I'm from, this isn't a convenience. Nigeria has the largest older
> population in Africa, heading to twenty-five million by 2050, and almost no formal care
> system. The family **is** the care system: one child in Lagos, one abroad, a parent in
> the village. Coordination isn't part of eldercare there. It's all of it."

**Tail, 5 seconds, over the TV surface:** "The spoken answer works without the screen,
and the screen works without the voice. A test fails the build if either breaks."

## 2:35-2:50 - It's a real MCP server (Tech, Alexa+)

Claude Desktop, connected to the live endpoint. Type: *"What's slipping for Margaret this
week?"* It calls `get_care_gaps` on the same server and gives the same answer.

> **VO:** "This isn't a mockup of Alexa. It's a live MCP server on the 2025-11-25 spec,
> with OAuth so Alexa+ can link it to a real person. Any MCP client works, and this is
> the same care record."

## 2:50-3:00 - End card

> **VO:** "Twenty-five tools. Four hundred and thirty tests. Every number in this video can
> be reproduced from the repo."

```
Live:  https://ypq2dfq2p7.us-east-1.awsapprunner.com/mcp
Try:   https://krqi2tpsif.us-east-1.awsapprunner.com
Repo:  npm ci && npm run story     (no AWS, no keys)
```

---

## Cutting room floor (do NOT restore)

- **An architecture diagram.** Three minutes lands one idea; it doesn't explain a system.
  The diagram lives in the repo where a judge can pause on it.
- **The Fire TV APK install.** The `/tv` surface makes the shared-display point faster.
- **The D-pad "who is taking this on?" beat.** Real multimodal work, but 12 seconds the
  Telegram loop needs more. Keep it for the Fire TV track writeup.
- **The eval number (~92-93%).** A tool-selection metric that invites "what about the
  other 7%?" mid-video. It's in the writeup with the miss analysis.
- **A tour of every connection (Gmail, Calendar sync, Bee).** One story beats a feature
  list. The calendar appears only as the 3-second payoff of the loop.
- **Voice-accuracy tooling (Transcribe, repair).** Infrastructure for the demo, not the
  argument.
