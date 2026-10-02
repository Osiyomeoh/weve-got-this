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
- [ ] **Burn in captions.** The video makes an accessibility argument.
- [ ] **Numbers on the day.** Say a number only if it matches then: tools (`tools/list`, 28
      on 2026-09-24), tests (`npm test`, 575 on 2026-09-24), the trust benchmark
      (`npm run trust-benchmark`).

---

## A. 0:00-0:28 Why I built this (Impact)

Your own voice, not a narrator. Read it slowly and plainly: it lands because it's true.
About 68 words, 28 seconds.

| Said or shown | Source |
|---|---|
| **VO (you):** "I'm from Lagos, Nigeria." | You (README, "Why I built this") |
| "My dad is going on seventy. He just had eye surgery, and he had to time his own medication." | You |
| "He wanted to know what was going on." | You |
| "There are five of us, and we still have to work." | You ("a family of five, and our dad"; "we still have to work to make a living") |
| "We all want to help. But nobody is in charge." | You |
| "So what fails isn't the thing someone forgot. It's the thing nobody knew was theirs." | Your words, README "Why I built this" |
| **On screen**, only with your dad's yes, no face needed: quiet close shots of his medicines on a table, his hands. Blur every name and number. Cut hard on "theirs". | The take |

If it runs long, drop a sentence rather than speed up. Never change a fact.

## B. 0:28-0:42 What it is: he just talks to it (Idea, Design)

About 18 words of VO, and one voice note.

| Said or shown | Source |
|---|---|
| **Title card, 2 s:** `CareCircle: an Alexa+ add-on, built as an MCP server` | README, first line; the live `/mcp` endpoint |
| **VO:** "So I built CareCircle. Dad doesn't want to be watched. He wants to know. So he talks to it." | README, "Why I built this": "a participant, not a patient on a dashboard" |
| **Daddy's phone:** he holds the mic and asks, *"What's on for me this week?"* | The take |
| The bot shows `I heard: "What's on for me this week?"`, answers in writing, then sends the answer back as a voice note. | `src/http/telegram-voice.test.ts:45` (heard, answered in text, answered aloud); `src/domain/language.ts:96` ("I heard"); `src/domain/language.ts:48` (English: Transcribe `en-US`, Polly Ruth) |
| **Caption:** `After eye surgery, reading a phone is hard. He asks out loud, and hears the answer.` | You (the surgery); README, "It keeps up with real life" |

## C. 0:42-1:02 The refusal (Idea: the most important beat)

The console, as the Alexa+ host. About 23 words of VO, over the freeze.

| Said or shown | Source |
|---|---|
| **Card, 1 s:** `Demo family, modelled on caring for my dad.` | README: the demo family "is fictional and modelled on mine" |
| **Tolu:** "Did Daddy use his evening eye drops?" | The take |
| **CareCircle** (gist): "There's no record of Daddy's eye drops from 8 PM. On the record today: eye drops at 8:10 AM, from Daddy." | `src/mcp/tools/ownership.ts:91` ("On the record today"); `src/http/whole-record.test.ts:42`; never "missed": `src/domain/gaps.test.ts:82` |
| **Freeze, two cards, 3 s:** `A plain assistant: "He missed it."` / `CareCircle: "There's no record."` | `scripts/trust-benchmark.ts`, which prints every raw answer |
| **VO:** "It won't turn missing information into an accusation." | `src/domain/gaps.test.ts:82`; `src/domain/daily-update.test.ts:33`; `src/mcp/app/care-board.test.ts:159` |
| "The same model, left to itself, does in about half of these cases. CareCircle: none." | README, "We measured how much this matters": raw Claude Sonnet 4.5, 6 of 12 (50%), CareCircle 0%; SUBMISSION: 50-58% across runs. Reproduce: `npm run trust-benchmark` |
| **On screen:** `npm run trust-benchmark: raw model about 50%, CareCircle 0%` | Same |

## D. 1:02-1:47 The delegation loop, on real phones (the centrepiece)

About 38 words of VO, over the phones.

| Said or shown | Source |
|---|---|
| **Tolu (console):** "Who can take Daddy to his check-up?" | The take |
| **CareCircle** (gist): "I've asked Funmi whether they can take Daddy to his eye check-up … I picked Funmi because they're the one who …" | `src/mcp/tools/delegation.ts:119-121`; picks and says why: `src/delegation.e2e.test.ts:179`; least-loaded first: `src/domain/delegation.test.ts:60` |
| **Funmi's phone:** "Tolu asked if you can take this on: … Reply "yes" or "can't"." | `src/mcp/tools/delegation.ts:103-104` |
| Funmi types **can't**. The board shows the ride open again, with Funmi's no on it. | `src/domain/request-response.test.ts:41` ("a decline puts it back with no owner and records who said no") |
| **Caption over the real clock:** `The agent's next pass, 15 minutes later. Nobody asked it to.` | Every 900,000 ms on prod: `infra/deploy-mcp.sh:145`; `src/domain/agent.test.ts:56` |
| **Musa's phone:** "CareCircle noticed nobody has "Take Daddy to his eye check-up" yet. Can you take it on? Reply "yes" or "can't"." | `src/domain/agent-runner.ts:73`; Funmi isn't asked again: `src/domain/agent.test.ts:171` |
| Musa types **yes**. "Thanks - … is yours now." The console board and the TV both show it as Musa's. | `src/domain/request-response.ts:54`; the whole loop: `src/delegation.e2e.test.ts:97` |
| **VO:** "Being asked isn't agreeing, so an unanswered ask still counts as a gap." | `src/domain/delegation.test.ts:146`, `:157` |
| "When someone can't, it asks the next person on its own." | `src/domain/agent.test.ts:148`; `src/delegation.e2e.test.ts:97` |
| "Never the brother abroad for a ride, and family before paid help." | `src/domain/daily-update.test.ts:85` ("the brother in London is never picked automatically for a ride"); `src/domain/delegation.test.ts:77` ("the paid aide is asked only after the family has run out") |
| *Optional, 3 s:* the ride on the family's Google Calendar, as Musa's. Only if it appears in the rehearsal. | `src/domain/calendar-writeback.test.ts:56`; the take |

## E. 1:47-2:12 Two languages, one record (Idea, Impact)

About 30 words of VO. Daddy has already said his word for the drops (see "Before you record").

| Said or shown | Source |
|---|---|
| **Daddy's phone:** `/language`, taps **Yorùbá**. The bot says what to expect. | `src/domain/language.test.ts:126` |
| He types: **"Mo ṣẹ̀ṣẹ̀ lo oogun ojú mi."** *(I've just used my eye drops.)* CareCircle answers in Yorùbá. | The sentence the language eval uses, which passed: `evals/results/2026-09-24-languages-sonnet-4-5-named-whole-record.json` (handoff, `yo`) |
| **Caption:** `Typed, not spoken: no speech service can hear Yorùbá yet.` | `src/domain/language.ts:59` (`hears: null`); `docs/pilot/FAMILY-GUIDE.md`, "Your language" |
| **Tolu (console, English):** "Has Daddy used his eye drops tonight?" | The take |
| **CareCircle** (gist): "Yes. There's a record at 9:12 PM, from Daddy." | His own words matched to the schedule, never a stray dose: `src/http/two-people.test.ts:111`; `src/http/medicine-names.test.ts:54` |
| **VO:** "Dad writes in Yoruba. His son asks in English. It's one record." | Same |
| "We measured it in eleven languages, from Spanish to Hausa: eleven out of eleven." | Handoff 11/11: `evals/results/2026-09-24-languages-handoff-strict-after-whole-record.json`; `…-named-whole-record.json`; and the re-run on zod 4 (`evals/results/README.md`) |

## F. 2:12-2:39 Who it's for (Impact)

About 65 words of VO, 27 seconds. If it runs long, drop the Echo sentence first.

| Said or shown | Source |
|---|---|
| **Kunle's phone, UK time:** his evening update arrives just after 21:00 Lagos time. Show it as sent; don't retype it. | Composed by `src/domain/daily-update.ts`; sent after 21:00 (`:25`), once a day (`src/domain/daily-update.test.ts:67`), only to people who asked for it (`:61`), never "missed" (`:33`) |
| **VO:** "Where I'm from, the family is the care system." | `docs/EVIDENCE.md`, Nigeria: formal long-term care "largely underdeveloped" (World Bank) |
| "Nigeria's older population is heading to twenty-five million by 2050, with little formal care." | `docs/EVIDENCE.md`: 25.3 million by 2050 (The Gerontologist, *Aging in Nigeria*); World Bank, same table |
| "In America, about half of family caregivers share the job." | `docs/EVIDENCE.md`: 53% (AARP & NAC, *Caregiving in the U.S.* 2020) |
| "And five and a half million people over sixty-five speak English less than very well." | `docs/LANGUAGES.md`: 5.6M (US Census ACS 2024, table B16004) |
| "The Echo sits with whoever coordinates. Everyone else answers from their phone, in their own language." | README, "Built in Lagos"; the language beat above. Don't show an Echo here. |
| **If the pilot has run, with the family's yes:** replace the phone shot with 10 s of their real group chat and their real numbers. | `npm run pilot:report` (asks sent and answered, median answer time, gaps closed); `docs/pilot/LOG.md` |

## G. 2:39-2:52 It's a real MCP server (Tech, Alexa+)

About 30 words of VO, over the typing.

| Said or shown | Source |
|---|---|
| **Claude Desktop**, on the live endpoint. Type: *"What's slipping for Daddy this week?"* It calls `get_care_gaps` on the same server and gives the same answer. | The take; `src/http/oauth.test.ts:123` ("an issued token opens a real MCP session as the right member") |
| **VO:** "This isn't a mock-up of Alexa. It's a live MCP server, with OAuth so Alexa+ can link it to a real person, and any MCP client gets the same care record." | `src/http/oauth.test.ts:97`, `:201-257` (PKCE, replay and redirect attacks refused); `/health` on the live URL |
| *Optional, 4 s, only if the Echo step is done:* a real Echo through the Alexa Skill bridge. **Caption:** `Alexa Skill bridge on a real Echo. Not Alexa+ itself.` | `docs/HANDOFF.md` (the bridge on AgentCore; `npm run skill:deploy`, `BRIDGE_SKILL_ID`) |

## H. 2:52-3:00 End card

| Said or shown | Source |
|---|---|
| **VO:** "Twenty-eight tools. Five hundred and seventy-five tests. Every number in this video has a source." | `tools/list` (28; both MCP revisions list the same tools: `src/http/stateless.test.ts`); `npm test` (575 on 2026-09-24); this document |
| `Live: https://ypq2dfq2p7.us-east-1.awsapprunner.com/mcp` | The live server |
| `Try it: https://krqi2tpsif.us-east-1.awsapprunner.com` | The live console |

No repo line: the repo is private, so the card names only what a judge can open.

---

## Cutting room floor (do NOT restore)

- **The Ring doorbell beat.** A simulated doorbell, and the Ring track isn't entered. Its
  15 seconds went to the two-language beat.
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
