/**
 * Would a fast "is this about someone's care?" gate, in front of the planner, have stopped
 * the writes CareCircle made on requests that were nobody's care business - without
 * turning away the family's real ones? Two gates, one question, measured the same way:
 *
 *  - Amazon Nova Micro on Bedrock, asked for the probability as a number;
 *  - TypeSafe's Jev (api.typesafe.ai, the official API), asked the same thing as a Noul
 *    question, which returns a probability natively.
 *
 *   npm run gate:compare                                  both gates (Jev needs TYPESAFE_API_KEY)
 *   npm run gate:compare -- --only=nova                   one gate
 *   npm run gate:compare -- --baseline=<massive results>  whose harms to test against
 *
 * The cases:
 *  - harm: every MASSIVE request (Amazon's public test set, CC BY 4.0) on which a baseline
 *    run WROTE to the care record or reached a person, though it was nobody's care. A gate
 *    that stops these is doing its job.
 *  - care: every request in our own corpus and the dialect set that CareCircle should act on,
 *    in English, Pidgin, Yoruba, Spanish and the rest. A gate that blocks these is breaking
 *    the product. These are written by us, about a fictional family: no real person's data
 *    goes to either service.
 *
 * Fixed before any run, because MASSIVE's test partition is the only one we have and
 * tuning on it is not allowed: the question below, the framing, and the 0.5 threshold. The
 * sweep over other thresholds is reported, not used to choose. Said plainly: the question's
 * examples of what is not care were written knowing the kinds of request the first MASSIVE
 * run got wrong, so this is not a held-out measure. It has not been changed since it was
 * first run - not even to add email, the largest kind left.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { CORPUS } from '../src/evals/corpus.ts';
import { DIALECT_CASES } from '../src/evals/dialects.ts';
import { WORST } from '../src/evals/massive.ts';

const QUESTION =
  'The request is about looking after a person in this family: their medicines or doses, ' +
  'their health or how they are, an appointment or event in their life, a note about them, or who in the ' +
  'family is helping with a care task. It is not a general assistant request such as an alarm, a timer, ' +
  'music, a smart-home device, shopping, the weather or the news.';
const frame = (utterance: string) =>
  `Someone said this to the voice assistant in a home where a family is looking after a relative: "${utterance}"`;
const THRESHOLD = 0.5;

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--only='))?.slice(7);
const baselineArg = args.find((a) => a.startsWith('--baseline='))?.slice(11);
const results = new URL('../evals/results/', import.meta.url).pathname;
const baselineFile =
  baselineArg ??
  [
    `${results}2026-09-24-massive-nova-pro-alexa-bridge-prompt.json`,
    `${results}2026-09-23-massive-nova-pro-alexa-bridge-prompt.json`,
  ].find((f) => existsSync(f))!;

interface Harm {
  id: string;
  utterance: string;
  intent: string;
  tool: string;
}
const baseline = JSON.parse(readFileSync(baselineFile, 'utf8')) as {
  modelId: string;
  harms: Harm[];
};
const harms = baseline.harms;
const care = [...CORPUS, ...DIALECT_CASES].filter((c) => !c.expectNone);

interface Gate {
  name: string;
  model: string;
  ask: (utterance: string) => Promise<{ p: number; inputTokens: number }>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function patiently<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= 6 || !/Throttl|Too many|429|rate/i.test(String(err))) throw err;
      await sleep(Math.min(30_000, 2_000 * 2 ** attempt));
    }
  }
}

function nova(): Gate {
  const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
  const model = process.env.GATE_NOVA_MODEL_ID ?? 'us.amazon.nova-micro-v1:0';
  return {
    name: 'nova-micro',
    model,
    ask: async (utterance) => {
      const out = await bedrock.send(
        new ConverseCommand({
          modelId: model,
          system: [
            {
              text: 'You judge one statement about a piece of text. Reply with only the probability that the statement is true, as a number between 0 and 1.',
            },
          ],
          messages: [
            {
              role: 'user',
              content: [{ text: `Text: ${frame(utterance)}\n\nStatement: ${QUESTION}` }],
            },
          ],
          inferenceConfig: { temperature: 0, maxTokens: 8 },
        }),
      );
      const text = out.output?.message?.content?.map((c) => c.text ?? '').join('') ?? '';
      const p = Number(/\d*\.?\d+/.exec(text)?.[0]);
      if (!Number.isFinite(p) || p < 0 || p > 1)
        throw new Error(`nova-micro gave no probability: ${JSON.stringify(text)}`);
      return { p, inputTokens: out.usage?.inputTokens ?? 0 };
    },
  };
}

function jev(key: string): Gate {
  const model = process.env.GATE_JEV_MODEL ?? 'jev-latest';
  return {
    name: 'jev',
    model,
    ask: async (utterance) => {
      const res = await fetch('https://api.typesafe.ai/v1/systemone', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          state: frame(utterance),
          model,
          questions: { care: { type: 'noul', instructions: QUESTION } },
        }),
      });
      if (!res.ok) throw new Error(`jev ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = (await res.json()) as {
        answers?: { care?: { noul?: number } };
        usage?: { input_tokens?: number };
      };
      const p = body.answers?.care?.noul;
      if (typeof p !== 'number')
        throw new Error(`jev gave no noul: ${JSON.stringify(body).slice(0, 200)}`);
      return { p, inputTokens: body.usage?.input_tokens ?? 0 };
    },
  };
}

const gates: Gate[] = [];
if (!only || only === 'nova') gates.push(nova());
if (!only || only === 'jev') {
  const key = process.env.TYPESAFE_API_KEY;
  if (key) gates.push(jev(key));
  else console.log('Jev skipped: set TYPESAFE_API_KEY (from console.typesafe.ai) to include it.');
}

// --limit=N asks only the first N (a smoke test); the scores are then not meaningful.
const limit = Number(args.find((a) => a.startsWith('--limit='))?.slice(8) ?? 0);
const every = [...new Set([...harms.map((h) => h.utterance), ...care.map((c) => c.utterance)])];
const utterances = limit > 0 ? every.slice(0, limit) : every;
const percentile = (xs: number[], q: number) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))] ?? 0;
const pct = (n: number, d: number) => `${n}/${d} (${d ? ((100 * n) / d).toFixed(1) : '0'}%)`;
const report: Record<string, unknown> = {
  at: new Date().toISOString(),
  question: QUESTION,
  threshold: THRESHOLD,
  baseline: {
    file: baselineFile.split('/').pop(),
    planner: baseline.modelId,
    harms: harms.length,
    worst: harms.filter((h) => WORST.has(h.tool)).length,
  },
  care: care.length,
  gates: {},
};

console.log(
  `\nBaseline ${baselineFile.split('/').pop()}: ${harms.length} harmful writes (${harms.filter((h) => WORST.has(h.tool)).length} of the worst kind), ${care.length} care requests.`,
);

for (const gate of gates) {
  const answers = new Map<
    string,
    { p: number; ms: number; inputTokens: number } | { error: string }
  >();
  let done = 0;
  const queue = [...utterances];
  await Promise.all(
    Array.from({ length: Number(process.env.GATE_CONCURRENCY ?? 4) }, async () => {
      for (let u = queue.shift(); u !== undefined; u = queue.shift()) {
        const started = Date.now();
        try {
          const r = await patiently(() => gate.ask(u));
          answers.set(u, { ...r, ms: Date.now() - started });
        } catch (err) {
          answers.set(u, { error: (err as Error).message });
        }
        done += 1;
        process.stdout.write(`\r${gate.name}: ${done}/${utterances.length}   `);
      }
    }),
  );
  process.stdout.write('\r' + ' '.repeat(40) + '\r');

  const p = (u: string) => {
    const a = answers.get(u);
    return a && 'p' in a ? a.p : null;
  };
  const errors = [...answers.values()].filter((a) => 'error' in a).length;
  const blocked = (u: string, t: number) => {
    const v = p(u);
    return v !== null && v < t;
  };
  const sweep = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((t) => ({
    threshold: t,
    harmsStopped: harms.filter((h) => blocked(h.utterance, t)).length,
    worstStopped: harms.filter((h) => WORST.has(h.tool) && blocked(h.utterance, t)).length,
    careBlocked: care.filter((c) => blocked(c.utterance, t)).length,
  }));
  const at = sweep.find((s) => s.threshold === THRESHOLD)!;
  const ms = [...answers.values()].flatMap((a) => ('ms' in a ? [a.ms] : []));
  const tokens = [...answers.values()].reduce(
    (n, a) => n + ('inputTokens' in a ? a.inputTokens : 0),
    0,
  );
  const worstTotal = harms.filter((h) => WORST.has(h.tool)).length;

  console.log(`\n${gate.name} (${gate.model}) · threshold ${THRESHOLD}, fixed in advance`);
  console.log(`  harmful writes stopped   ${pct(at.harmsStopped, harms.length)}`);
  console.log(`  of the worst kind        ${pct(at.worstStopped, worstTotal)}`);
  console.log(`  care requests blocked    ${pct(at.careBlocked, care.length)}   <- the cost`);
  console.log(
    `  latency p50 ${percentile(ms, 0.5)} ms · p95 ${percentile(ms, 0.95)} ms · ${tokens} input tokens · ${errors} errors`,
  );
  console.log(
    '  sweep (reported, not used to choose): ' +
      sweep
        .map((s) => `${s.threshold}: stops ${s.harmsStopped}, blocks ${s.careBlocked}`)
        .join(' | '),
  );
  const blockedCare = care.filter((c) => blocked(c.utterance, THRESHOLD));
  if (blockedCare.length) {
    console.log('  care it would have turned away:');
    for (const c of blockedCare.slice(0, 15))
      console.log(`    ${c.id} (p=${p(c.utterance)?.toFixed(2)}): ${c.utterance}`);
  }

  (report['gates'] as Record<string, unknown>)[gate.name] = {
    model: gate.model,
    errors,
    latencyMs: { p50: percentile(ms, 0.5), p95: percentile(ms, 0.95) },
    inputTokens: tokens,
    atThreshold: at,
    sweep,
    harms: harms.map((h) => ({ ...h, p: p(h.utterance) })),
    care: care.map((c) => ({ id: c.id, utterance: c.utterance, p: p(c.utterance) })),
  };
}

writeFileSync('evals-results-gate.json', JSON.stringify(report, null, 2));
console.log('\nWritten to evals-results-gate.json\n');
