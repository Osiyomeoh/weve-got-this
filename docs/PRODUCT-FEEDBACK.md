# Product Feedback

Answers to the required Product Feedback field, one block per tool. This is the honest
version — the detailed evidence behind every "needs work" note lives in
[FRICTION-LOG.md](FRICTION-LOG.md), written as we hit each issue, not reconstructed after.

Primary track: **Alexa+** (self-hosted MCP server, spec 2025-11-25 over Streamable HTTP).
Mini-challenge: **AWS Builder** (Bedrock + Nova + Strands Agents + AgentCore Runtime + App Runner + DynamoDB + SNS + Transcribe + Polly).

---

## MCP TypeScript SDK (`@modelcontextprotocol/sdk`)

**Used for:** the whole server — 23 tools, resources, prompts, and the Streamable HTTP
transport that Alexa+ requires at spec 2025-11-25.

**What worked well:** the tool/resource/prompt registration API is clean, and once the
session model clicked, stateful Streamable HTTP behaved exactly as documented. The spec
itself is coherent and the SDK tracks it closely.

**What needs work:**
- No published spec-version support matrix — we confirmed 2025-11-25 support only by
  grepping `LATEST_PROTOCOL_VERSION` out of the compiled `dist`.
- Under `exactOptionalPropertyTypes: true` (a *recommended* strictness flag), the SDK's own
  transports are not assignable to the SDK's own `Transport` interface — every strict
  consumer must cast. The fix is on `main` but unreleased; 1.30.0 still ships the break.
- `400 "Server not initialized"` on the second request describes a state, not the cause
  (sessions must be reused and keyed by `Mcp-Session-Id`). A one-line "sessions span
  requests" note near the top of the Streamable HTTP docs would prevent the whole mistake.
- The protocol has no way to (a) tell the client the current date/timezone, (b) pass a
  non-authoritative speaker hint from a shared device, or (c) mark tool-result text as
  user-supplied rather than trusted. Each is a real gap for a multi-user, date-sensitive,
  free-text product — see the friction log; the date gap produced a wrong medical date.

**Onboarding (zero → hello world):** fast for a single stdio tool; slower for stateful
Streamable HTTP, because the session-reuse requirement is discovered through an opaque error
rather than the docs.

**Would you build with it again?** **Yes.** It is the right abstraction and the spec is
sound; the friction is documentation and one unreleased type fix, not the design.

---

## Amazon Bedrock (Claude Sonnet 4.5, `Converse`)

**Used for:** the Alexa+ planner — turning a spoken sentence into a tool call. Measured at
~92–93% first-tool accuracy (124–126/135 across runs) and used to generate the raw-LLM
baseline in the trust benchmark.

**What worked well:** `Converse` is a genuinely simple, uniform API, and Sonnet 4.5's
tool-selection quality is strong straight out of the box — most of our accuracy came from
fixing *our* tool descriptions, not fighting the model.

**What needs work:** this was our single hardest onboarding, and it was almost entirely
operational, not modelling:
- **A zeroed quota reports as `ThrottlingException: Too many tokens per day`** — identical to
  genuine exhaustion. We lost most of a day hunting a workload that had drained a budget that
  was never non-zero. "Quota is 0" and "quota consumed" are different situations and only one
  is worth waiting out.
- **Service Quotas won't restore a zeroed quota:** it validates the requested value against
  the *default*, so you cannot ask to be raised *to* the default from 0.
- **Model access ≠ IAM `InvokeModel`** — two independent gates that fail with the same-looking
  AccessDenied. And the newer models must be called by **inference-profile id** (`us.`-prefixed),
  with IAM scoped to `inference-profile/*`, not `foundation-model/*`.
- **No invoke-scoped way to discover** which models you can call or how much daily budget
  remains; reading quotas needs a separate `servicequotas:*` grant your inference role won't
  have.

**Onboarding:** the modelling path is excellent; the *readiness* path (quota, access, correct
id, correct IAM resource) is where days go, and every failure mode looks like every other.

**Would you build with it again?** **Yes** — for the model. The API and quality earn it. But
we would provision quota and a dedicated `InvokeModel` principal on day one and never trust a
`ThrottlingException` at face value again.

---

## AWS App Runner + CodeBuild + ECR

**Used for:** building the container in the cloud (no local Docker) and serving the MCP server
on a public HTTPS URL with a health check. Live now.

**What worked well:** genuinely low-ceremony managed hosting — one script goes from `git
archive` to a running HTTPS endpoint, and the health-check + auto-scaling defaults were fine.

**What needs work:** `update-service` **replaces** the whole runtime-environment map rather
than merging, so a deploy from a shell that didn't source `.env` silently *deletes* the OAuth
and HMAC secrets from a running service — the deploy reports success and the image is fine,
but account linking just stops. We now read the existing env and treat it as a floor. Also,
with `AutoDeploymentsEnabled=false`, pushing a new `:latest` and re-running `update-service`
with an unchanged config is a no-op — you need an explicit `start-deployment` to force a pull.

**Onboarding:** good. The footguns above are the kind you only learn by being bitten once.

**Would you build with it again?** **Yes**, for a demo-to-small-production HTTPS service. For
real medical data we'd move secrets to Secrets Manager (the code already supports it; the
blocker was an IAM grant).

---

## Amazon DynamoDB

**Used for:** the durable, append-only care record — single-table, diff-based writes.

**What worked well:** single-table modelling fit the event log perfectly, writes are simple,
and it needed no capacity tuning at demo scale.

**What needs work:** nothing that bit us at this scale. Reading raw items to debug the wrong
date (see Bedrock/MCP time bug) was ordinary and fine.

**Onboarding:** straightforward from the SDK.

**Would you build with it again?** **Yes.**

---

## Amazon SNS

**Used for:** real notification delivery when the agent asks a family member to take on a gap.

**What worked well:** `Publish` is trivial and reliable; the instance role needed one action.

**What needs work:** email subscriptions require a manual confirmation click, which is easy to
forget in a demo setup — worth a louder reminder in the console flow.

**Onboarding:** easy.

**Would you build with it again?** **Yes.**

---

## Amazon Transcribe

**Used for:** speech → text for the voice surface, with a custom vocabulary built from each
household's own names and medications.

**What worked well:** the **custom-vocabulary API is genuinely good** and did most of the
accuracy rescue — feeding real household names in as hints measurably fixed mis-hearings.

**What needs work:** **no `en-NG` locale**, in the largest English-speaking country in Africa.
Yoruba, Igbo and Nigerian Pidgin don't appear at all (Hausa does). For a care system, the
failure lands hardest exactly where it hurts — *names* — and mis-hearing a name attributes a
medication to the wrong person. We worked around it with the custom vocabulary plus a phonetic
repair pass, shown to the user rather than applied silently.

**Onboarding:** fine; the gap is coverage, not capability.

**Would you build with it again?** **Yes**, with the custom vocabulary as a hard requirement,
not an optimization — and we'd push for `en-NG`.

---

## Amazon Polly (generative engine)

**Used for:** spoken responses, with slower paces as an accessibility option for listeners
with hearing loss or post-stroke language processing.

**What worked well:** the generative voices are natural, and structural SSML (sentence breaks)
is honoured reliably at any length.

**What needs work:** `<prosody rate>` is **silently quantized** — `90%` returned audio
byte-identical to `100%`, HTTP 200, no warning. An accessibility control that silently does
nothing is worse than an absent one, because nobody goes looking for it. We redesigned "gentle"
as longer inter-sentence pauses (which the engine honours) and now verify by comparing audio
*bytes*, not the SSML string.

**Onboarding:** good, but per-engine SSML support is undocumented — the SSML reference is
engine-agnostic while `generative` is the engine Amazon steers you toward.

**Would you build with it again?** **Yes**, using structural breaks for pacing and byte-level
verification for anything accessibility-critical.

---

## Ring Partner API

**Used for:** an evidence seam — a package/motion event becomes a provenance-tagged Event in
the graph (`source: ring`), which may *propose* an obligation a human must confirm. Never an
autonomous action.

**What worked well:** the event-type taxonomy, JSON:API envelope, and HMAC-SHA256 `X-Signature`
verification are clearly specified, and idempotency via `request_id` is well thought out.

**What needs work:**
- **The webhook payload schema is not published** — only the event *types* and the envelope.
  Exact field names and nesting aren't given, so you cannot parse events reliably from the docs
  alone. One concrete filled-in `motion_detected` example would remove the guesswork.
- **Staging tests against real hardware only** — there's no "send test event" control, so
  end-to-end verification is gated behind buying a doorbell, even though the hackathon rules
  explicitly permit a simulator. We built one (`src/demo/ring-simulate.ts`) that signs events
  with the **real partner HMAC key**, so signature verification, idempotency and inference all
  run exactly as they would for real Ring traffic. What's simulated is the device; what's
  exercised is the integration — and we say so.

**Onboarding:** blocked without hardware or a simulator; a Stripe-style test-event button per
type (signed with the partner key) would be the single biggest improvement.

**Would you build with it again?** **Yes**, for non-security care/accessibility use cases — but
only after a published payload schema and a synthetic-event generator land.

---

## Strands Agents SDK (TypeScript, 1.19.0)

**Used for:** the planner that runs the family's Telegram chat by default, and the one deployed to
AgentCore Runtime (`src/strands/`). It talks to our server through Strands' `McpClient`, the same MCP
contract Alexa+ uses.

**What worked well:** the hook points in the agent loop. `NoBlame` (`src/strands/no-blame.ts`) sits on
the model loop and sends a finished reply that blames someone back once with a reason, then falls back
to what the tools said, without our own loop. Swapping our hand-written loop for Strands cost almost
nothing in accuracy: 149/155 against 150/155 on the same corpus (`evals/results/README.md`).

**What needs work:** one point fewer than our own loop on the corpus (149 vs 150 of 155); we have not
yet read which case it lost.

**Onboarding:** quick to a working agent over MCP.

**Would you build with it again?** Yes. The hooks are what made the no-blame guarantee one small file.

---

## Amazon Bedrock AgentCore Runtime

**Used for:** hosting the Strands planner (`carecircle_planner`, `src/agentcore.ts`,
`Dockerfile.agentcore`, `infra/deploy-agentcore.sh`), and the open-source Alexa Skill bridge we tested
through on a real Echo.

**What worked well:** a container in, a managed endpoint out. A cold invoke as the sibling in Lagos
("How is Daddy doing today?") answered from `get_care_summary` in about 13 s.

**What needs work:** a newly created execution role fails with "Access denied while validating ECR
URI" until its permissions propagate; it reads as a wrong policy. Our deploy script now retries that
error (friction log, 2026-10-02). Cold starts of ~13 s are long for a voice turn.

**Onboarding:** moderate; the first deploy is mostly IAM.

**Would you build with it again?** Yes, for hosting agents; we'd want the propagation case handled.

---

## Amazon Nova (Pro, 2 Lite, Micro)

**Used for:** planner evals and the Alexa bridge's planner (Nova Pro and Nova 2 Lite), and a trial
action guard (Nova Micro).

**What worked well:** Nova Pro chooses tools close to the frontier models we measured: 94.4% on the
earlier 144-case corpus, and it held up on Amazon's MASSIVE dev set, never read before the run: 87.3%
of non-care requests left alone, 4.7% wrote.

**What needs work:** Nova 2 Lite, the bridge's default, was our weakest planner: 81.3%, and 73.5% on held-out phrasings. As a yes/no
guard, Nova Micro scored almost every call 0.95, so it could not separate harmful writes from fine ones;
we did not wire it in (`evals/results/README.md`).

**Onboarding:** easy through Bedrock `Converse`, the same code path as the other models.

**Would you build with it again?** Yes, Nova Pro for planning; not Micro as a classifier without
calibrated scores.

---

## A note on Kiro / development-time AWS tools

Our development workflow used Claude Code as the primary agent for building and reviewing this
project during the hackathon window. The runtime AWS integration that anchors the AWS Builder
mini-challenge is the Bedrock + App Runner + DynamoDB + SNS + Transcribe + Polly pipeline
documented above and demonstrated in the video.
