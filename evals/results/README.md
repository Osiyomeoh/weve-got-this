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

`alexa-bridge-system-prompt.txt` is the system prompt of
[KayLerch/alexa-skill-mcp-bridge](https://github.com/KayLerch/alexa-skill-mcp-bridge)
(Apache-2.0), rendered by that project's own `buildSystemPrompt` for this server on 2026-09-23.
Real Alexa+ will not use our prompt, so this measures what the tool descriptions do under a
host prompt we did not write. Reproduce it with:

```bash
EVALS_SYSTEM_PROMPT_FILE=evals/results/alexa-bridge-system-prompt.txt \
  BEDROCK_MODEL_ID=us.amazon.nova-pro-v1:0 npm run evals
```
