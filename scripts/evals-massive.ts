/**
 * Run CareCircle against outside data: Amazon's MASSIVE, US English.
 *
 *   npm run evals:massive
 *   EVALS_SYSTEM_PROMPT_FILE=evals/results/alexa-bridge-system-prompt.txt npm run evals:massive
 *   MASSIVE_SET=en-US.dev npm run evals:massive
 *
 * MASSIVE_SET picks the file in evals/massive (default en-US.test). The test partition's
 * failures were read before the 2026-09-24 description changes; the dev partition's were not,
 * so it is the held-out measure.
 *
 * A full run takes hours under Bedrock's per-minute quotas, so every answer is saved to
 * evals-massive-progress.jsonl as it lands, and a rerun picks up where the last one stopped.
 * Delete that file to start over.
 *
 * Requires the MCP server running and AWS credentials with Bedrock access. See
 * src/evals/massive.ts for what counts as right, and evals/massive/NOTICE.md for the data.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { runEvals, type CaseResult } from '../src/evals/run.ts';
import { loadMassive, summariseMassive } from '../src/evals/massive.ts';
import { providerFromEnv } from '../src/sim/providers.ts';

const endpoint = process.env.CARECIRCLE_URL ?? 'http://localhost:8787/mcp';
const provider = providerFromEnv();
const promptFile = process.env.EVALS_SYSTEM_PROMPT_FILE;
const set = process.env.MASSIVE_SET ?? 'en-US.test';
const cases = loadMassive(new URL(`../evals/massive/${set}.jsonl`, import.meta.url).pathname);
const limit = Number(process.env.EVALS_LIMIT ?? 0);
const chosenCases = limit > 0 ? cases.slice(0, limit) : cases;

const suffix = set === 'en-US.test' ? '' : `-${set}`;
const PROGRESS = `evals-massive${suffix}-progress.jsonl`;
type Saved = Omit<CaseResult, 'case'> & { id: string };
const saved = new Map<string, Saved>();
if (existsSync(PROGRESS)) {
  for (const line of readFileSync(PROGRESS, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(line) as Saved;
    if (!r.errored) saved.set(r.id, r); // an errored case never reached the model: run it again
  }
}
const byId = new Map(chosenCases.map((c) => [c.id, c]));
const earlier: CaseResult[] = [...saved.values()]
  .filter((r) => byId.has(r.id))
  .map(({ id, ...r }) => ({ ...r, case: byId.get(id)! }));
const todo = chosenCases.filter((c) => !saved.has(c.id));
if (earlier.length)
  console.log(`Resuming: ${earlier.length} already answered, ${todo.length} to go.`);

const fresh = await runEvals({
  endpoint,
  provider,
  cases: todo,
  onResult: ({ case: c, ...r }) =>
    appendFileSync(PROGRESS, JSON.stringify({ id: c.id, ...r }) + '\n'),
  concurrency: Number(process.env.EVALS_CONCURRENCY ?? 1),
  // Bedrock quotas are per minute (Nova Pro: 25 cross-region), so pace under them.
  paceMs: Number(process.env.EVALS_PACE_MS ?? 0),
  ...(promptFile ? { systemPrompt: readFileSync(promptFile, 'utf8') } : {}),
  onProgress: (done) =>
    process.stdout.write(
      `\rMASSIVE on ${provider.name}: ${earlier.length + done}/${chosenCases.length}   `,
    ),
});
const results = [...earlier, ...fresh];
process.stdout.write('\r' + ' '.repeat(60) + '\r');
const s = summariseMassive(results);
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a');

console.log(
  `\nCareCircle on Amazon MASSIVE (${set}) · ${provider.modelId} · prompt: ${promptFile ?? 'console'}`,
);
console.log(`  ${s.total} scored, ${s.errored} errored\n`);
console.log(`  Not CareCircle's business: ${s.notOurs.total}`);
console.log(
  `    left alone        ${s.notOurs.leftAlone}  (${pct(s.notOurs.leftAlone, s.notOurs.total)})`,
);
console.log(
  `    only read          ${s.notOurs.readInstead}  (${pct(s.notOurs.readInstead, s.notOurs.total)})`,
);
console.log(
  `    wrote or reached   ${s.notOurs.wrote}  (${pct(s.notOurs.wrote, s.notOurs.total)}), of which logged-an-event or messaged-someone: ${s.notOurs.worst}`,
);
console.log(
  `  Calendar and alarm requests (in scope either way): ${s.inScope.right}/${s.inScope.total} right`,
);
if (s.harms.length) {
  console.log('\n  Writes on requests that were not care:');
  for (const h of s.harms)
    console.log(`    ${h.tool.padEnd(20)} ${h.intent.padEnd(28)} "${h.utterance}"`);
}

writeFileSync(
  `evals-massive${suffix}-results.json`,
  JSON.stringify(
    {
      provider: provider.name,
      modelId: provider.modelId,
      at: new Date().toISOString(),
      systemPrompt: promptFile ?? 'console',
      dataset: `MASSIVE 1.1 ${set} (CC BY 4.0, Amazon)`,
      ...s,
      results: results.map((r) => ({
        id: r.case.id,
        utterance: r.case.utterance,
        intent: r.case.note,
        chosen: r.chosen,
        pass: r.pass,
        errored: r.errored ?? false,
      })),
    },
    null,
    2,
  ),
);
