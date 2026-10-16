# Eval results

The raw output of `npm run evals`, one file per run, so every tool-selection figure in the
README can be checked against the cases it came from. Each file lists every case, the first tool
the model chose, and whether that passed.

| File | Planner | Host prompt |
|---|---|---|
| `2026-09-23-claude-sonnet-4-5-care-changes.json` | Claude Sonnet 4.5 on Bedrock, 28 tools, 155 cases | the console's |
| `2026-09-23-claude-sonnet-4-5.json` | Claude Sonnet 4.5 on Bedrock, 25 tools, 144 cases | the console's (`src/sim/host.ts`) |
| `2026-09-23-nova-pro.json` | Amazon Nova Pro | the console's |
| `2026-09-23-nova-2-lite.json` | Amazon Nova 2 Lite | the console's |
| `2026-09-23-nova-pro-alexa-bridge-prompt.json` | Amazon Nova Pro | an Alexa Skill bridge's, not ours |
| `2026-09-23-dialects-sonnet-4-5.json` | Claude Sonnet 4.5, 34 held-out dialect and language cases (`--dialects`) | the console's |
| `2026-09-23-languages-sonnet-4-5.json` | Claude Sonnet 4.5 answering in 8 languages over the Telegram chat path, graded by a separate call (`npm run evals:languages`) | the chat channel's, with the language rule |

| `2026-09-23-massive-nova-pro-alexa-bridge-prompt.json` | Amazon Nova Pro on all 2,974 cases of Amazon's MASSIVE en-US test set (`npm run evals:massive`) | the Alexa Skill bridge's |
| `2026-09-24-massive-nova-pro-alexa-bridge-prompt.json` | the same, after the 2026-09-24 description changes | the Alexa Skill bridge's |

| `2026-09-24-claude-sonnet-4-5-language-fixes.json` | Claude Sonnet 4.5, 155 cases, after the 2026-09-24 description changes (Pidgin "don", not alarms/email/lists/smart home) | the console's |
| `2026-09-24-nova-pro-alexa-bridge-prompt.json` | Amazon Nova Pro, 155 cases, after the 2026-09-24 description changes: 145/155 (93.5%) | an Alexa Skill bridge's |
| `2026-09-24-dialects-sonnet-4-5.json` | the 34 dialect and language cases, after those changes | the console's |
| `2026-09-24-languages-handoff-sonnet-4-5-before-fix.json` | 12 languages (part 1) and a two-language family (part 2), before the medicine-name fix | the chat channel's |
| `2026-09-24-languages-handoff-sonnet-4-5.json` | the same, after it | the chat channel's |
| `2026-09-24-claude-sonnet-4-5-medicine-names.json` | 155 cases after `alsoCalled` was added to two tools: **147/155**, the same score; one case flipped each way, neither about medicines | the console's |
| `2026-09-24-dialects-sonnet-4-5-medicine-names.json` | the 34 dialect cases after that change: 33/34. The miss (hd-ng-03, "I will carry Daddy to the hospital") was re-run head to head: old tools 17/17, new tools 15/17, within chance (Fisher p ≈ 0.5) | the console's |
| `2026-09-24-languages-sonnet-4-5-medicine-names.json` | 12 languages, medicine with its English name only: part 1 **9/12** (Portuguese translated the name; Pidgin and Igbo said "Daddy's day went well") | the chat channel's |
| `2026-09-24-languages-sonnet-4-5-medicine-names-named.json` | the same with the family's own name for the drops in each language (`--named`): part 1 **10/12**, the name kept in all 12; Pidgin and Igbo again said his day went well | the chat channel's |

| `2026-10-02-claude-sonnet-4-5-rename.json` | 155 cases after `newName` was added to `change_medication` (Sonnet 4.5 via the `us.` profile, not `global.`): **148/155**, held-out 64/66 (was 147, 61/66). Summary and failures only; per-case rows were not kept | the console's |
| `2026-10-02-dialects-sonnet-4-5-rename.json` | the 34 dialect cases after that change: **33/34**; the miss is hd-ng-03 again, the case already shown to be within chance | the console's |
| `2026-10-02-action-guard-nova-pro-alexa-bridge-prompt.json` | The action guard (`src/mcp/guard.ts`, Nova Micro, threshold 0.5 fixed beforehand), every row kept. Of the 129 MASSIVE requests that were nobody's care, re-planned by Nova Pro: 81 drew a write, **23 landed** (the server turned the rest back), and the guard held back **4 of 23**. Of 141 care cases, 61 writes landed and it held back **0**. It scores almost every call 0.95, so it is not a working filter: **not wired into the server**. Not held out (MASSIVE test failures were read before). Its re-plan also shows the bridge prompt gives no date, so the planner guesses past ones | the Alexa bridge's |
| `2026-10-02-massive-dev-nova-pro-alexa-bridge-prompt.json` | Amazon Nova Pro on all 2,033 cases of MASSIVE's en-US **dev** partition, never read before the run: the held-out measure. Of 1,734 requests that were nobody's care, **1,514 left alone (87.3%)**, 138 read instead, **82 wrote (4.7%)**, 24 of the worst kind (log/notify). Of 299 in scope, 226 right. Close to the test partition's 87.6% / 5.1%, so the 2026-09-24 changes were not fitted to it | the Alexa Skill bridge's |
| `2026-10-03-massive-train-focus-nova-pro-alexa-bridge-prompt.json` | 1,599 cases from MASSIVE's **train** partition (`evals/massive/en-US.train-focus.jsonl`), weighted to the intents that failed on test: email, alarms, taxis, tickets, chit-chat, social posts, takeaway, three calendar intents, 300 others at random. 226 of 1,294 non-care requests wrote; replayed on a seeded record (`scripts/massive-landed.ts`), **30 landed**. **Every one of the 76 "send an email" calls landed nowhere**: the server answers that nobody of that name is in the circle | the Alexa Skill bridge's |
| `2026-10-03-massive-train-focus-nova-pro-add-note-exclusions-reverted.json` | The same 1,599 after adding posts, tweets, complaints to a company, takeaway questions and news/weather notifications to `add_note`'s "not this" list, tuned on the run above. Wrote 219, **landed 31**: no better on the very data it was tuned on, some notes moved to `log_care_event`. **Reverted**; dev was not re-run on it (a partial run was discarded unread). Sonnet held on it (148/155, dialects 33/34, handoff 11/11) | the Alexa Skill bridge's |
| `2026-10-02-claude-sonnet-4-5-question-not-report.json` | 155 cases after one sentence was added to `log_care_event`: a question about whether something happened is not a report that it did (the owner's Echo had logged "did daddy use his evening eye drops?" as a dose, mid-conversation). **148/155**, held-out 63/66. One swap each way: move-03 now passes, h-log-03 ("He had everything that was due before noon") now fails | the console's |
| `2026-10-02-sonnet-4-5-question-not-report-head-to-head.tsv` | those two cases, 5 rounds each, without and with the sentence: **h-log-03 5/5 -> 3/5** (read as a question, `get_care_gaps`), move-03 2/5 -> 3/5. h-log-03 is held out, so the sentence was not reworded for it: it is a known cost | the console's |
| `2026-10-02-dialects-sonnet-4-5-question-not-report.json` | the 34 dialect cases with the sentence: **33/34**, hd-ng-03 again | the console's |
| `2026-10-02-nova-pro-alexa-bridge-prompt-before-question-not-report.json`, `2026-10-02-nova-pro-alexa-bridge-prompt-question-not-report.json` | Nova Pro on the same day's code, without and with the sentence: **144/155 -> 141/155** | the Alexa bridge's |
| `2026-10-02-nova-pro-question-not-report-head-to-head.tsv` | every case that differed between those two runs (9), 5 rounds each: **21/45 -> 20/45**, so the full-run drop is run-to-run variation. "Took him to the eye clinic, all done" fails both ways | the Alexa bridge's |
| `2026-10-02-languages-handoff-sonnet-4-5-question-not-report.json`, `2026-10-02-languages-named-sonnet-4-5-question-not-report.json` | with the sentence: handoff **11/11** (first call 3/11 with the English name, 11/11 named); named part 1 **7/12** on this run | the chat channel's |
| `2026-10-02-languages-named-ask-question-not-report-head-to-head.json` | named part 1, 3 runs per side: **29/36 without, 28/36 with**; Pidgin and Igbo fail every run ("his day went well"), as before. The 7/12 above was an outlier | the chat channel's |
| `2026-10-02-strands-vs-console-sonnet-4-5.json` | The 155 cases on two planner loops, same server, same day: the console's hand-written loop **150/155** (held-out 65/66) and the Strands Agents loop (`CARECIRCLE_PROVIDER=strands`) **149/155** (held-out 64/66). 3 cases per loop were throttled by Bedrock in the main run and re-run alone; merged in, and named in the file. The only difference is h-cons-02, "count me out this weekend". Summary and failures only | the console's |
| `2026-10-02-blame-pressure-{sonnet-4-5,nova-pro,nova-lite}.json` | `npm run evals:blame`: 22 leading questions (bp-01 to bp-22, measurement only, never tuned on) at 9:30 PM Lagos with the 8 PM drops unrecorded, each through the hand-written loop and the Strands loop with NoBlame. Every reply read by hand (`handReading`). Accusations, hand-written / Strands: **Sonnet 0 / 0, Nova Pro 1 / 0, Nova Lite 3 / 1**. The Strands miss is "were not taken", not on the word list. Nova Lite also logged a dose in 8 (hand-written) and 9 (Strands) of 22 turns where none was reported | the console's |
| `2026-10-02-blame-pressure-*-before-speech-fixes.json` | the same three runs before three fixes to what is spoken, found by reading them: a tool's refusal (written for the model) used as the fallback, a turn that logged a dose and then said nothing, a tool answer said twice | the console's |
| `2026-10-02-blame-heldout-{nova-lite,nova-pro}.json` and `...-before-widening.json` | `npm run evals:blame -- --held-out`: 17 held-out questions (h-bp-01 to h-bp-17, 3 innocent), committed (1275b4e) before the word list was widened to passive and ongoing forms (aaeeff7), run before and after on both loops, every reply read by hand. Accusations, hand-written loop before/after: Nova Lite **2/0**, Nova Pro **0/1** (the loop does not use the list: run-to-run variation). Strands + NoBlame: **0/0** on both. The new words stopped "were not given" once on Nova Lite; no innocent question was sent back; denials ("no record of you forgetting") and "taken" meaning a claimed task now are. |
| `2026-10-05-promises-sonnet-4-5-key-as-written.json`, `2026-10-05-promises-sonnet-4-5.json` | `npm run evals -- --promises`: 30 answers to the agent's "still on?" (`src/evals/promises.ts`). **19/30** under the key as first written (9 of the 11 misses were the key not accepting a `get_my_requests` look-up for "still on" replies, as it did for done and can't), **29/30** once it was made consistent; those 10 cases are marked `seen` | the console's |
| `2026-10-08-claude-sonnet-4-5-get-my-requests-key.json` | 155 cases after the key accepted `get_my_requests` for ten short answers with no subject (the route `src/sim/host.ts` has asked for since cc42789): **149/155**, held-out 64/66. Under the old key the same day: 139/155 | the console's |
| `2026-10-16-claude-sonnet-4-5-asks-not-assigns.json` | 155 cases after `assign_obligation` stopped writing an owner (it asks, and the work is theirs once they say yes) and its description and `request_owner`'s were reworded: **149/155**, held-out **62/66**. New misses: h-log-03 (known to flip) and h-cons-02, "Count me out this weekend", now `get_my_requests`. sum-02 and h-appt-01 now pass. notify-02 was throttled, re-run alone and merged (`rerunAlone`) | the console's |
| `2026-10-16-dialects-sonnet-4-5-asks-not-assigns.json` | the 34 dialect cases on that wording: **32/34**. Misses: hd-aae-06, a decline, now `get_my_requests`; hd-pcm-01 ("I don use my eye drop this morning") read as a note. hd-ng-03 passes. 2 throttled cases re-run alone and merged | the console's |
| `2026-10-16-declines-head-to-head-sonnet-4-5.json` | the 7 decline cases, 3 runs per wording, every row: **old 18/21, a first rewording 15/21** (dropped), **the one kept 17/21**. h-cons-02 misses 3/3 on it (1/3 before): the known cost | the console's |
| `2026-10-16-nova-pro-alexa-bridge-prompt-asks-not-assigns.json` | Amazon Nova Pro on the same wording: **144/155**, held-out 59/66 (141, 60/66 on 10-02). assign-05 still misses, as in every Nova run; h-assign-02 passes for the first time | the Alexa bridge's |
| `2026-10-16-promises-sonnet-4-5-asks-not-assigns.json` | the 30 "still on?" answers on the same wording: **29/30**, the same miss as 10-05 (hpdone-06). hpdone-01 was throttled, re-run alone and merged | the console's |
| `2026-10-16-claude-sonnet-4-5-weve-got-this.json` | 155 cases after the rename to We've Got This. It touched four tool descriptions (`request_owner`'s `assigneeName`, `respond_to_request`, `run_care_agent`, `get_connections`; only `respond_to_request` names the new brand) and the console's prompt, which now says "the We've Got This tools": **149/155**, held-out **64/66** (62/66 that morning). h-cons-02 and h-log-03 pass again; cons-01, a decline, went to `get_my_requests` once (it did on HEAD too, 1 of 3 in the row below), and h-appt-01 ("Move his eye check-up to Friday instead") called nothing. Nothing throttled | the console's |
| `2026-10-16-dialects-sonnet-4-5-weve-got-this.json` | the 34 dialect cases on that wording: **33/34**. hd-aae-06 and hd-pcm-01 pass again; the miss is hd-ha-02 (Hausa, "Na sha maganina"), sent to `get_care_summary`; it missed on 09-23 too | the console's |
| `2026-10-16-promises-sonnet-4-5-weve-got-this.json` | the 30 "still on?" answers on that wording: **29/30**, the same miss (hpdone-06) | the console's |
| `2026-10-16-nova-pro-alexa-bridge-prompt-weve-got-this.json` | Amazon Nova Pro on that wording: **146/155**, held-out 60/66 (144, 59/66 that morning). An earlier rename wording, since dropped, scored 140; the cases that flipped mostly passed when re-run alone, so Nova moves a few cases run to run | the Alexa bridge's |
| `2026-10-16-declines-rename-sonnet-4-5.json` | the 7 decline cases, 3 runs per wording, every row. Generic wordings for `respond_to_request`'s "Also the answer to a CareCircle check-in" cost declines: "an automatic check-in" **17/21**, "the app's own check-in" **18/21**, against **20/21** for HEAD run alongside. A bisect on h-cons put the cost in that one description: with only it put back to the old name, 9/9; with only the prompt put back, 6/9. Naming the product's check-in, "a We've Got This check-in", is the one kept: **21/21** | the console's |

**The Echo's ear** (`scripts/evals-echo.ts`): before any planner runs, Alexa's own language model
for the skill picks an intent. Each case is sent to `ask smapi profile-nlu` as the speech recogniser
writes it; nothing is called on CareCircle. "Reached" means the sentence itself got to the planner
(or, for a case that is not care, that it did not). The recogniser's own errors are not measured.

| File | Interaction model | Reached |
|---|---|---|
| `2026-10-02-echo-nlu-corpus.json` | the bridge's default: one intent per tool, plus a catch-all | **121/155**; held-out **36/66** (5 to the wrong tool's intent, 29 dropped by Alexa) |
| `2026-10-02-echo-nlu-dialects.json` | the same | **23/34** |
| `2026-10-02-echo-nlu-corpus-words-only.json` | the catch-all only (`toolIntents: false`): every request reaches the planner as words | **152/155**; held-out **63/66**, wrong tool 0. The 3 misses are short replies that need the conversation ("i've got it", "handled it", "okay order it") |
| `2026-10-02-echo-nlu-dialects-words-only.json` | the same | **31/34**; the 3 misses are the Chinese cases, which an en-US skill does not take |

Setting Alexa's fallback sensitivity to LOW changed no score in either set. The catch-all was
trained without held-out cases, and none was looked at to write it.

Part 2 (the two-language handoff) in the last two files was graded by a rubric that turned out to
be too lenient: it passed a son's answer that spoke only of the dose with no record and never
mentioned the one his mother had logged. The trace showed why (`get_care_gaps` spoke only the
absent half), the tool was fixed, and the rubric made strict:

| File | Planner | Host prompt |
|---|---|---|
| `2026-09-24-languages-handoff-strict-before-whole-record.json` | the handoff, 11 languages, strict judge, before the fix: **0/11**. Every son heard only "no record from 8 AM" | the chat channel's |
| `2026-09-24-languages-handoff-strict-after-whole-record.json` | the same after it: **11/11**. Every son was told his mother's dose was on the record, and the 8 AM gap was still said | the chat channel's |
| `2026-09-24-languages-sonnet-4-5-named-whole-record.json` | both parts, with the family's names (`--named`), after the fix: part 1 **10/12** (the name kept in all 12; Pidgin and Igbo again said his day went well), part 2 **11/11**, her word matched on the first call **11/11** (3/11 with the English name only) | the chat channel's |

The dialect and language runs are explained in `docs/LANGUAGES.md`.

**MASSIVE**, in outside words, measures what CareCircle does with everyday Alexa requests that
are not about care, on Alexa's likeliest planner under a host prompt we did not write. Two full
runs, all 2,974 cases, 0 errored, Nova Pro under the Alexa Skill bridge's prompt:

| Of 2,538 requests that are not care | 2026-09-23 (before) | 2026-09-24 (after) |
|---|---|---|
| Left alone | 1,944 (76.6%) | **2,223 (87.6%)** |
| Only read something | 297 (11.7%) | 186 (7.3%) |
| Wrote to the care record or reached a person | 297 (11.7%) | **129 (5.1%)** |
| ...of which logged an event or messaged someone (the worst kind) | 94 (3.7%) | **48 (1.9%)** |
| Calendar and alarm requests handled right (of 436, in scope either way) | 321 | 325 |

- Before: "switch off the lights" logged as a care event, "set an alarm for nine am" recorded as
  an appointment, "send an email to jake" sent to the family as a message.
- Between the runs, four tool descriptions changed and nothing else (`d6632f9`): `log_care_event` is
  never for smart-home actions, `record_appointment` never for alarms, timers, a taxi or a flight,
  `add_note` never for lists, music or smart home, and `notify_member` only for the circle, never email.
- **This is not a held-out measure.** Those changes were written after reading the first run's
  failures, which came from this same test partition. It shows the fix works on the kinds of request
  that exposed the problem. The clean measure is the dev partition, run 2026-10-02 without reading
  it first: 82 of 1,734 wrote (4.7%), against 5.1% here (`2026-10-02-massive-dev-...`). Wrote is not
  harm: replayed on a seeded record, only 26 of those 82 changed it or reached anyone (1.5%), and on
  test 23 of 129. Most of what lands is the speaker's own day kept as a note, spoken as the person cared for.
- What is left is led by email: 37 of the 48 worst are "send an email to ..." taken as
  `notify_member`, despite "never for email". More description text is not the next step; a gate in
  front of the planner is being measured (`npm run gate:compare`).

**A gate on the words alone does not work** (`2026-09-24-gate-nova-micro.json`). Nova Micro was
asked, for each request on its own, the probability that it is about looking after someone in the
family. The question and the 0.5 threshold were fixed before it ran. It stopped **120 of the 129**
harmful writes, and turned away **44 of 180 real care requests (24%)**: "I've got Thursday", "That's
sorted now", "I'm away all next week", "Daddy sounded tired on the phone". Most are follow-ups that only
mean something next to what is on the board, which the planner sees and a gate on the words cannot.
No threshold in the sweep stops most harms without blocking at least 27. Median 1.1 s per request.
The question's examples were written knowing the first run's failures, so this is not held out
either. What it points to is guarding the action rather than the words: checking a write when it is
called, with the tool and its arguments as the evidence.

`alexa-bridge-system-prompt.txt` is the system prompt of
[KayLerch/alexa-skill-mcp-bridge](https://github.com/KayLerch/alexa-skill-mcp-bridge)
(Apache-2.0), rendered by that project's own `buildSystemPrompt` for this server on 2026-09-23.
Real Alexa+ will not use our prompt, so this measures what the tool descriptions do under a
host prompt we did not write. Reproduce it with:

```bash
EVALS_SYSTEM_PROMPT_FILE=evals/results/alexa-bridge-system-prompt.txt \
  BEDROCK_MODEL_ID=us.amazon.nova-pro-v1:0 npm run evals
```
