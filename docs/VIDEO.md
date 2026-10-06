# The demo video: script, with a source for every line

> The continuous 40-second "this is real" beat has its own second-by-second script and an
> executable reproducer (`npm run beat`) in [DEMO-BEAT.md](DEMO-BEAT.md).

**Hard limit 3:00, and judges may stop there or judge on the video alone.** The four
criteria (Tech, Design, Impact, Idea) are weighted equally, so every beat has to earn one
of them. It cannot be a product tour.

**The sentence every beat must prove:** *Families don't fail at remembering tasks; they
fail at noticing nobody owns them. CareCircle finds the unowned work, asks the right
person, and never accuses anyone of what it didn't see.*

**Never show a device doing more than it does.** No Echo is shown answering unless it
really is one, labelled as the Skill bridge it is. Yoruba is typed, because nothing can
hear it yet. The agent's next ask comes on its real 15-minute pass, and the cut shows the
real clock. A judge who checks the repo should find the video conservative, not generous.

**How the sources work.** Every line has one, in the right-hand column:
- **You**: your own account of your family, as written in the README's "Why I built this".
  Nothing is added to it.
- **A file and line**: the code that writes the words CareCircle says or shows.
- **A test**: what pins that behaviour, so it can't drift before the take.
- **A result file**: a measured number, in `evals/results/`.
- **The take**: something shown as it happens (a board changing, a reply arriving).

CareCircle's lines below give the gist; its real words come from the model and the tools
on the day. **Keep the words from the take. Never re-voice or retype them.** If a take says
something its source doesn't support, the take is wrong, not the source: shoot it again.

Timings assume about 2.4 spoken words a second, a calm pace.

---

## Before you record

- [ ] **Deploy first.** Prod runs `d6632f9`, which doesn't have the medicine names per
      language or the answer that says what *is* on the record. Beats C and E need both.
- [ ] **The family group belongs to the pilot now** (`docs/PILOT.md`, "One family group at a
      time"), so the demo happens in **private chats** with the bot. Don't switch the group
      back: that would break the pilot.
- [ ] **Reset the demo on prod, then link the phones.** First the reset, dry run first:
      `AWS_PROFILE=conductor CARECIRCLE_TABLE=carecircle AWS_REGION=us-east-1 npm run demo:reset:prod`,
      then `AWS_PROFILE=conductor bash infra/demo-reset-prod.sh`. Then
      `npm run telegram:invites -- --household h_margaret` for the demo links.
- [ ] **One Telegram account per person** (one account can be only one person). You need
      three: **Daddy**, **Funmi** and **Musa**. A fourth, **Kunle**, on a phone set to UK
      time, is for beat F. None of them can be your own account, which is in the pilot.
      After each taps its link, check that the greeting names the right person.
- [ ] **Daddy's Yoruba name for the drops, once, before beat E.** As Tolu: *"In Yoruba,
      Daddy's eye drops are oogun ojú."* (`change_medication` with `alsoCalled`,
      `src/http/medicine-names.test.ts:54`.) With it, his word matched on the first call in
      11 of 11 languages; without it, 3 of 11 (`evals/results/README.md`).
- [ ] **Film from 9 PM Lagos time.** The 8 PM dose shows "no record" only after its grace
      hour (`DOSE_GRACE_MINUTES`, `src/domain/gaps.ts:312`), and the evening update goes out
      after 21:00 (`src/domain/daily-update.ts:25`). The reset seeds Daddy's morning drops,
      logged by him at 8:10 AM (`src/demo/scenario.ts:77`, `src/domain/auth.test.ts:115`).
- [ ] **Rehearse the private-chat loop once**: Funmi's "can't" and Musa's "yes" in their own
      chats, and the agent's pass asking Musa. The script assumes it works as it does in
      the group; confirm it before the take.
- [ ] **The console in shared mode**, so it acts on the real demo household:
      `https://krqi2tpsif.us-east-1.awsapprunner.com/live?key=<SIM_LIVE_KEY from .env>`
      once in the recording browser (`src/sim/app.ts:60`). `/live/off` to go back.
      Voice pace **gentle**. Console on the left, `/tv` on the right, phones on a stand in
      frame. Never alt-tab on camera.
- [ ] **Claude Desktop** (or MCPJam) connected to the live `/mcp` over OAuth, tried once.
- [ ] **Consent.** Your dad agreed to the pilot on 2026-09-23. Filming anything of his is
      a separate yes. Your brother abroad hasn't agreed to be mentioned yet. Check your
      siblings are happy for the family to be described.
- [ ] **Set up beat E's errand** (needs the agent loop on, which prod has: every 15 min).
      Around 8:50 PM Lagos, as Tolu: *"Daddy's eye drops need picking up from the pharmacy
      by 9:30 tonight."* Off camera, Musa says "I'll do it" so it's his. Around 9:25, fire one
      doorbell event: `npm run ring:simulate -- --url https://ypq2dfq2p7.us-east-1.awsapprunner.com/ring/webhook --event motion`.
      Musa does **not** mark it done. The "still on?" arrives on the first agent pass after
      9:45, so film Musa's phone from 9:45 to 10:00. Rehearse once the night before: confirm
      the door line appears in the message, then reset.
- [ ] **Burn in captions.** The video makes an accessibility argument.
- [ ] **Numbers on the day.** Say a number only if it matches then: tools (`tools/list`, 28
      on 2026-09-24), tests (`npm test`, 575 on 2026-09-24), the trust benchmark
      (`npm run trust-benchmark`).

---

## The shape: a pitch, not a tour

The organisers' advice (2026-10-05): lead with the problem, show it working, and say
plainly what it solves, who it's for, how it uses the track's tool, and what the working
app does. **Say "Alexa+" out loud in the first 20 seconds**, and again when the tech is
shown. Every beat below answers one of those questions.

| Time | Beat | Answers |
|---|---|---|
| 0:00-0:24 | A. My dad | the problem, who it's for |
| 0:24-0:36 | B. He just talks to it | what it is, Alexa+ named |
| 0:36-0:56 | C. The refusal | what makes it different |
| 0:56-1:34 | D. Nobody owns it, so it asks | the app working |
| 1:34-2:04 | E. "Still on?" | the climax: a promise followed up |
| 2:04-2:20 | F. Two languages, one record | who it's for |
| 2:20-2:40 | G. Where I'm from | impact |
| 2:40-2:53 | H. A real Alexa+ MCP server | how it uses the track's tool |
| 2:53-3:00 | End card | |

## A. 0:00-0:24 My dad (Impact)

Your own voice, not a narrator. Read it slowly and plainly: it lands because it's true.
About 55 words.

| Said or shown | Source |
|---|---|
| **VO (you):** "I'm from Lagos, Nigeria. My dad is going on seventy. He just had eye surgery, and he had to time his own medication." | You (README, "Why I built this") |
| "There are five of us, and we all still have to work. We all want to help. But nobody is in charge." | You |
| "So what fails isn't the thing someone forgot. It's the thing nobody knew was theirs." | Your words, README "Why I built this" |
| **On screen**, only with your dad's yes, no face needed: quiet close shots of his medicines on a table, his hands. Blur every name and number. Cut hard on "theirs". | The take |

If it runs long, drop a sentence rather than speed up. Never change a fact.

## B. 0:24-0:36 He just talks to it (Idea, Alexa+)

| Said or shown | Source |
|---|---|
| **Title card, 2 s:** `CareCircle: an Alexa+ add-on, built as an MCP server` | README, first line; the live `/mcp` endpoint |
| **VO:** "So I built CareCircle, an add-on for Alexa+. Dad doesn't want to be watched. He wants to know. So he talks to it." | README: "a participant, not a patient on a dashboard" |
| **Daddy's phone:** he asks out loud, *"What's on for me this week?"* The bot shows `I heard: …`, answers in writing, then as a voice note. | `src/http/telegram-voice.test.ts:45`; `src/domain/language.ts:96` |
| **Caption:** `After eye surgery, reading a phone is hard. He asks out loud, and hears the answer.` | You (the surgery) |

## C. 0:36-0:56 The refusal (Idea)

The console, as the Alexa+ host.

| Said or shown | Source |
|---|---|
| **Card, 1 s:** `Demo family, modelled on caring for my dad.` | README |
| **Tolu:** "Did Daddy use his evening eye drops?" | The take |
| **CareCircle** (gist): "There's no record of Daddy's eye drops from 8 PM. On the record today: eye drops at 8:10 AM, from Daddy." | `src/mcp/tools/ownership.ts` ("On the record today"); `src/http/whole-record.test.ts:42`; never "missed": `src/domain/gaps.test.ts:82` |
| **Freeze, two cards, 3 s:** `A plain assistant: "He missed it."` / `CareCircle: "There's no record."` | `scripts/trust-benchmark.ts` |
| **VO:** "It won't turn missing information into an accusation. The same model, left to itself, does in about half of these cases. CareCircle: none." | Raw Sonnet 4.5 50-58% across runs, CareCircle 0%: `npm run trust-benchmark` |

## D. 0:56-1:34 Nobody owns it, so it asks (the app working)

| Said or shown | Source |
|---|---|
| **Tolu (console):** "Who can take Daddy to his check-up?" | The take |
| **CareCircle** (gist): "I've asked Funmi … I picked Funmi because …" | `src/mcp/tools/delegation.ts`; `src/delegation.e2e.test.ts:179`; `src/domain/delegation.test.ts:60` |
| **Funmi's phone:** the ask, "Reply "yes" or "can't"." Funmi types **can't**. The board shows the ride open again. | `src/domain/request-response.test.ts:41` |
| **Caption over the real clock:** `The agent's next pass, 15 minutes later. Nobody asked it to.` | Every 900,000 ms on prod: `infra/deploy-mcp.sh:145`; `src/domain/agent.test.ts:56` |
| **Musa's phone:** "CareCircle noticed nobody has … yet. Can you take it on?" Musa types **yes**. Board and TV show it as Musa's. | `src/domain/agent-runner.ts`; `src/delegation.e2e.test.ts:97` |
| **VO:** "It asks. It never assigns. When someone can't, it asks the next person on its own: family before paid help, and never the brother abroad for a ride." | `src/domain/agent.test.ts:148`; `src/domain/daily-update.test.ts:85`; `src/domain/delegation.test.ts:77` |

## E. 1:34-2:04 "Still on?" (the climax: a promise followed up)

Saying yes isn't doing it. This is the beat nobody else has: CareCircle notices a promise
slipping, checks in kindly, and closes the task with what the doorbell saw beside it.
Filmed as its own take, on the errand set up before recording (see the checklist below).

| Said or shown | Source |
|---|---|
| **Caption over the real clock:** `9:30 PM. Musa's pharmacy run was due. Nothing's marked.` | The take; slipping = 15 min past due: `FOLLOW_UP_GRACE_MINUTES`, `src/domain/agent.ts` |
| **Musa's phone**, on the agent's own pass: *""Pick up Daddy's eye drops" was due a little while ago and nothing's been marked yet. The doorbell saw activity at the door at 9:2x. Still on? Reply "done" if it's handled, or "can't" and I'll find someone."* | `messageFor`, `src/domain/agent-runner.ts`; `checkInEvidence`, `src/domain/evidence.ts:73`; `src/domain/agent.test.ts` (follow-up tests) |
| **Caption, 2 s:** `Doorbell event simulated, signed with the real Ring partner key.` | `src/demo/ring-simulate.ts`; `docs/PRODUCT-FEEDBACK.md`, Ring |
| Musa types **done**. *"Marked done - … The doorbell also saw activity at the door at 9:2x."* | `resolve_obligation`, `src/mcp/tools/ownership.ts`; `src/http/proof-of-care.test.ts` |
| **Tolu (console):** "How do we know?" **CareCircle** (gist): "Musa marked it done at … Around then the doorbell saw … A signal is evidence beside the record, not proof on its own." | `explainProvenance` / `closingEvidence`, `src/domain/provenance.ts` |
| **VO:** "Saying yes isn't the same as doing it. So it follows up, gently, once. If there's no answer, it tells Tolu: not 'he forgot', just 'you may want to call'. And it never claims a camera saw more than it did." | Escalate once after 30 min: `FOLLOW_UP_WAIT_MINUTES`, `src/domain/agent.ts`; Ring sees motion, never a car or face: `src/domain/evidence.ts:4-10` |
| *Say only if it matches on the day:* "We tested the replies on thirty held-out answers, Pidgin included: twenty-nine right." | `evals/results/2026-10-05-promises-sonnet-4-5.json` (29/30; 19/20 on untouched cases) |

## F. 2:04-2:20 Two languages, one record (Idea, Impact)

Daddy has already said his word for the drops (see "Before you record").

| Said or shown | Source |
|---|---|
| **Daddy's phone:** in Yorùbá, **"Mo ṣẹ̀ṣẹ̀ lo oogun ojú mi."** CareCircle answers in Yorùbá. | `evals/results/2026-09-24-languages-sonnet-4-5-named-whole-record.json` (`yo`) |
| **Caption:** `Typed, not spoken: no speech service can hear Yorùbá yet.` | `src/domain/language.ts:59` |
| **Tolu (console, English):** "Has Daddy used his eye drops tonight?" "Yes. There's a record at …, from Daddy." | `src/http/two-people.test.ts:111`; `src/http/medicine-names.test.ts:54` |
| **VO:** "Dad writes in Yoruba. His son asks in English. It's one record." | Same |

## G. 2:20-2:40 Where I'm from (Impact)

| Said or shown | Source |
|---|---|
| **Kunle's phone, UK time:** his evening update arrives. Show it as sent. | `src/domain/daily-update.ts`; `src/domain/daily-update.test.ts:61`, `:67`, `:33` |
| **VO:** "Where I'm from, the family is the care system. Nigeria's older population is heading to twenty-five million by 2050, with little formal care. And in America, about half of family caregivers share the job too." | `docs/EVIDENCE.md`: 25.3M by 2050 (*Aging in Nigeria*); 53% (AARP & NAC 2020) |
| **If the pilot has run, with the family's yes:** 8 s of their real group chat and real numbers. | `npm run pilot:report`; `docs/pilot/LOG.md` |

## H. 2:40-2:53 A real Alexa+ MCP server (Tech, Alexa+)

| Said or shown | Source |
|---|---|
| **Claude Desktop** on the live endpoint: *"What's slipping for Daddy this week?"* It calls `get_care_gaps` on the same server. | The take; `src/http/oauth.test.ts:123` |
| **VO:** "This is a live MCP server, built for Alexa+, with account linking so Alexa+ knows which family member is speaking. Any MCP client gets the same care record." | `src/http/oauth.test.ts:97`, `:201-257`; `/health` |
| *Optional, 3 s:* a real Echo through the Alexa Skill bridge. **Caption:** `Alexa Skill bridge on a real Echo. Not Alexa+ itself.` | `docs/HANDOFF.md` |

## End card 2:53-3:00

| Said or shown | Source |
|---|---|
| **VO:** "CareCircle, for Alexa+. Every number in this video has a source." | This document |
| `Live: https://ypq2dfq2p7.us-east-1.awsapprunner.com/mcp` · `Try it: https://krqi2tpsif.us-east-1.awsapprunner.com` | The live services |

Tool and test counts are dropped from the voice-over: they change, and the time is worth
more to beat E. They're in the write-up.

---

## Cutting room floor (do NOT restore)

- **The Ring doorbell as a beat of its own.** It's back only inside beat E, as evidence
  beside Musa's "done", captioned as simulated. A doorbell beat for its own sake stays cut.
- **The refill purchase.** The pharmacy is simulated and the exchange runs about 25
  seconds spoken. It's in the write-up.
- **An architecture diagram.** Three minutes land one idea; they don't explain a system.
  The diagram is in the repo, where a judge can pause on it.
- **The Fire TV APK install.** The `/tv` surface makes the shared-display point faster.
- **The D-pad "who is taking this on?" beat.** Real multimodal work, but 12 seconds the
  loop needs more.
- **The eval numbers (94.8%, MASSIVE).** Tool-selection metrics invite "what about the
  rest?" mid-video. They're in the write-up with the miss analysis.
- **A tour of every connection (Gmail, Calendar sync, Bee).** One story beats a feature
  list.
- **Voice-accuracy tooling (Transcribe vocabulary, repair).** Infrastructure for the demo,
  not the argument.
- **The group chat as the stage for the loop.** It belongs to the pilot family now. If their
  real loop is filmed, with their yes, it goes in beat F.
