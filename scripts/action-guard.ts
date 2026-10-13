/**
 * Would the action guard (src/mcp/guard.ts) stop the writes that should not happen, without
 * holding back the family's real ones? And how many of those writes actually land at all?
 *
 *   npx tsx scripts/action-guard.ts                     everything (MASSIVE harms + our care cases)
 *   npx tsx scripts/action-guard.ts --limit=10          a smoke test; the numbers mean nothing
 *
 * For each case the planner (Nova Pro, under the Alexa Skill bridge's prompt by default) is
 * given one request and the real tool definitions, and its first call is kept with its
 * arguments. A guarded call is then:
 *  1. run against a freshly seeded demo record, as the member speaking, to see whether it
 *     would actually have changed the record or reached a person ("landed") - the server
 *     already refuses some, like a message to someone who is not in the circle;
 *  2. shown to the guard, with the same seeded record as its context.
 *
 * The cases:
 *  - harm: every MASSIVE request (Amazon's public test set, CC BY 4.0) on which the 2026-09-24
 *    baseline wrote, though it was nobody's care. Re-planned here, because the baseline kept
 *    only the tool and not its arguments.
 *  - care: every case in our corpus and the dialect set whose right answer is a guarded write.
 *    Written by us about a fictional family; no real person's data goes anywhere.
 *
 * Requires the MCP server running (for the tool definitions) and AWS credentials with Bedrock.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { runEvals, type CaseResult } from '../src/evals/run.ts';
import { CORPUS, type EvalCase } from '../src/evals/corpus.ts';
import { DIALECT_CASES } from '../src/evals/dialects.ts';
import { WORST } from '../src/evals/massive.ts';
import { providerFromEnv } from '../src/sim/providers.ts';
import { createCareCircleApp } from '../src/http/app.ts';
import { CareStore } from '../src/store/store.ts';
import { seedDemoHousehold, DEMO_TOKENS, DEMO_HOUSEHOLD_ID } from '../src/demo/seed.ts';
import { GUARDED, GUARD_STATEMENT, GUARD_THRESHOLD, novaGuard } from '../src/mcp/guard.ts';
import type { Notifier } from '../src/notify/notifier.ts';

const argv = process.argv.slice(2);
const limit = Number(argv.find((a) => a.startsWith('--limit='))?.slice(8) ?? 0);
const endpoint = process.env.CARECIRCLE_URL ?? 'http://localhost:8787/mcp';
const promptFile =
  process.env.EVALS_SYSTEM_PROMPT_FILE ??
  new URL('../evals/results/alexa-bridge-system-prompt.txt', import.meta.url).pathname;
const provider = providerFromEnv();
const results = new URL('../evals/results/', import.meta.url).pathname;

const baseline = JSON.parse(
  readFileSync(`${results}2026-09-24-massive-nova-pro-alexa-bridge-prompt.json`, 'utf8'),
) as { harms: { id: string; utterance: string; intent: string; tool: string }[] };
const harmCases: EvalCase[] = baseline.harms.map((h) => ({
  id: h.id,
  member: 'm_margaret',
  utterance: h.utterance,
  expectNone: true,
  note: h.intent,
}));
const careCases = [...CORPUS, ...DIALECT_CASES].filter((c) =>
  c.expect?.some((t) => GUARDED.has(t)),
);
const cut = <T>(xs: T[]) => (limit > 0 ? xs.slice(0, limit) : xs);

const tokenOf = new Map(Object.entries(DEMO_TOKENS).map(([token, member]) => [member, token]));

/** Run one call against a freshly seeded record; did it change anything or reach anyone? */
async function landed(
  memberId: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<{ landed: boolean; reply: string }> {
  const store = new CareStore();
  await seedDemoHousehold(store);
  const before = JSON.stringify(store.getCareState(DEMO_HOUSEHOLD_ID));
  let reached = 0;
  const notifier: Notifier = {
    channel: 'telegram',
    deliver: async () => {
      reached += 1;
      return { delivered: true, channel: 'telegram' };
    },
  };
  const app = createCareCircleApp({
    store,
    notifier,
    tokens: new Map(Object.entries(DEMO_TOKENS)),
  });
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', r));
  const c = new Client({ name: 'guard', version: '1' });
  try {
    const url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
    await c.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: `Bearer ${tokenOf.get(memberId)}` } },
      }),
    );
    const out = await c.callTool({ name: tool, arguments: args });
    const reply = (out.content as { text?: string }[]).map((p) => p.text ?? '').join(' ');
    const changed = JSON.stringify(store.getCareState(DEMO_HOUSEHOLD_ID)) !== before;
    return { landed: out.isError !== true && (changed || reached > 0), reply };
  } finally {
    await c.close().catch(() => {});
    server.close();
  }
}

const guard = novaGuard();
const seeded = new CareStore();
await seedDemoHousehold(seeded);
const context = seeded.getCareState(DEMO_HOUSEHOLD_ID);

interface Row {
  id: string;
  utterance: string;
  member: string;
  tool: string | null;
  args: Record<string, unknown>;
  guarded: boolean;
  landed?: boolean;
  reply?: string;
  p?: number | null;
  held?: boolean;
  guardMs?: number;
  error?: string;
}

async function measure(kind: string, cases: EvalCase[]): Promise<Row[]> {
  const planned: CaseResult[] = await runEvals({
    endpoint,
    provider,
    cases,
    systemPrompt: readFileSync(promptFile, 'utf8'),
    concurrency: Number(process.env.EVALS_CONCURRENCY ?? 2),
    paceMs: Number(process.env.EVALS_PACE_MS ?? 0),
    onProgress: (d, t) => process.stdout.write(`\r${kind}: planned ${d}/${t}   `),
  });
  const rows: Row[] = [];
  let i = 0;
  for (const r of planned) {
    i += 1;
    process.stdout.write(`\r${kind}: run and guard ${i}/${planned.length}   `);
    const row: Row = {
      id: r.case.id,
      utterance: r.case.utterance,
      member: r.case.member,
      tool: r.chosen,
      args: r.args,
      guarded: !!r.chosen && GUARDED.has(r.chosen),
    };
    if (r.errored) {
      row.error = r.reason;
      rows.push(row);
      continue;
    }
    if (row.guarded) {
      try {
        Object.assign(row, await landed(r.case.member, r.chosen!, r.args));
      } catch (err) {
        row.error = `run: ${(err as Error).message}`;
      }
      for (let attempt = 0; ; attempt += 1) {
        try {
          const v = await guard(context, r.chosen!, r.args);
          Object.assign(row, { p: v.p, held: v.hold, guardMs: v.ms });
          break;
        } catch (err) {
          if (attempt >= 5 || !/Throttl|Too many|429|rate/i.test(String(err))) {
            row.p = null;
            row.error = `guard: ${(err as Error).message}`;
            break;
          }
          await new Promise((res) => setTimeout(res, 2_000 * 2 ** attempt));
        }
      }
    }
    rows.push(row);
  }
  process.stdout.write('\r' + ' '.repeat(50) + '\r');
  return rows;
}

const harms = await measure('harm', cut(harmCases));
const care = await measure('care', cut(careCases));

const n = (xs: Row[], f: (r: Row) => boolean) => xs.filter(f).length;
const pct = (a: number, b: number) => `${a}/${b} (${b ? ((100 * a) / b).toFixed(1) : '0'}%)`;
const wrote = harms.filter((r) => r.guarded);
const harmLanded = wrote.filter((r) => r.landed);
const careWrote = care.filter((r) => r.guarded);
const careLanded = careWrote.filter((r) => r.landed);
const sweep = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7].map((t) => ({
  threshold: t,
  harmsHeld: n(harmLanded, (r) => r.p != null && r.p < t),
  careHeld: n(careLanded, (r) => r.p != null && r.p < t),
}));
const ms = [...harms, ...care].flatMap((r) => (r.guardMs ? [r.guardMs] : [])).sort((a, b) => a - b);

console.log(
  `\nAction guard · planner ${provider.modelId} · prompt ${promptFile.split('/').pop()} · threshold ${GUARD_THRESHOLD}, fixed in advance`,
);
console.log(`  MASSIVE requests that were not care: ${harms.length} re-planned`);
console.log(`    planner called a write            ${pct(wrote.length, harms.length)}`);
console.log(
  `    ...and it landed on the record     ${pct(harmLanded.length, harms.length)}   (the server refused the rest)`,
);
console.log(`    of those, worst kind (log/notify)  ${n(harmLanded, (r) => WORST.has(r.tool!))}`);
console.log(
  `    guard held back                    ${pct(
    n(harmLanded, (r) => !!r.held),
    harmLanded.length,
  )}`,
);
console.log(`  Our care requests that should write: ${care.length}`);
console.log(`    planner called a write that landed ${pct(careLanded.length, care.length)}`);
console.log(
  `    guard held back (the cost)         ${pct(
    n(careLanded, (r) => !!r.held),
    careLanded.length,
  )}   <- each one is a question, not a refusal`,
);
console.log(
  `  guard latency p50 ${ms[Math.floor(ms.length / 2)] ?? 0} ms · p95 ${ms[Math.floor(ms.length * 0.95)] ?? 0} ms · errors ${n([...harms, ...care], (r) => !!r.error)}`,
);
console.log(
  '  sweep (reported, not used to choose): ' +
    sweep.map((s) => `${s.threshold}: holds ${s.harmsHeld} harms, ${s.careHeld} care`).join(' | '),
);
const heldCare = careLanded.filter((r) => r.held);
if (heldCare.length) {
  console.log('  care it would have asked about:');
  for (const r of heldCare)
    console.log(`    ${r.id} (p=${r.p?.toFixed(2)}) ${r.tool}: ${r.utterance}`);
}
const missed = harmLanded.filter((r) => !r.held);
if (missed.length) {
  console.log('  harms it let through:');
  for (const r of missed.slice(0, 20))
    console.log(`    (p=${r.p?.toFixed(2)}) ${r.tool}: ${r.utterance}`);
}

writeFileSync(
  'evals-results-action-guard.json',
  JSON.stringify(
    {
      at: new Date().toISOString(),
      planner: provider.modelId,
      prompt: promptFile.split('/').pop(),
      statement: GUARD_STATEMENT,
      threshold: GUARD_THRESHOLD,
      sweep,
      limit: limit || null,
      harms,
      care,
    },
    null,
    2,
  ),
);
console.log('\nWritten to evals-results-action-guard.json\n');
