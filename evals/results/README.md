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
  that exposed the problem. A clean measure needs MASSIVE's dev or validation partition, which is not
  in the repo yet.
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
