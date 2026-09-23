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

| `2026-09-24-claude-sonnet-4-5-language-fixes.json` | Claude Sonnet 4.5, 155 cases, after the 2026-09-24 description changes (Pidgin "don", not alarms/email/lists/smart home) | the console's |
| `2026-09-24-nova-pro-alexa-bridge-prompt.json` | Amazon Nova Pro, 155 cases, after the 2026-09-24 description changes: 145/155 (93.5%) | an Alexa Skill bridge's |
| `2026-09-24-dialects-sonnet-4-5.json` | the 34 dialect and language cases, after those changes | the console's |
| `2026-09-24-languages-handoff-sonnet-4-5-before-fix.json` | 12 languages (part 1) and a two-language family (part 2), before the medicine-name fix | the chat channel's |
| `2026-09-24-languages-handoff-sonnet-4-5.json` | the same, after it | the chat channel's |

The dialect and language runs are explained in `docs/LANGUAGES.md`.

**MASSIVE**, in outside words, measures what CareCircle does with everyday Alexa requests that
are not about care, on Alexa's likeliest planner under a host prompt we did not write:
- 2,538 requests are not care. **1,944 (76.6%) were left alone**, 297 (11.7%) only read something,
  and 297 (11.7%) wrote. **94 (3.7%) logged an event or messaged someone**, for example "switch off the
  lights" logged as a care event, or "set an alarm for nine am" recorded as an appointment.
- 436 calendar and alarm requests are in scope either way: **321 were handled right**.
- Those 94 writes are the next thing for the tool descriptions to fix. Any change there needs a fresh
  corpus run.

`alexa-bridge-system-prompt.txt` is the system prompt of
[KayLerch/alexa-skill-mcp-bridge](https://github.com/KayLerch/alexa-skill-mcp-bridge)
(Apache-2.0), rendered by that project's own `buildSystemPrompt` for this server on 2026-09-23.
Real Alexa+ will not use our prompt, so this measures what the tool descriptions do under a
host prompt we did not write. Reproduce it with:

```bash
EVALS_SYSTEM_PROMPT_FILE=evals/results/alexa-bridge-system-prompt.txt \
  BEDROCK_MODEL_ID=us.amazon.nova-pro-v1:0 npm run evals
```
