/**
 * Run CareCircle against outside data: Amazon's MASSIVE, US English test partition.
 *
 *   npm run evals:massive
 *   EVALS_SYSTEM_PROMPT_FILE=evals/results/alexa-bridge-system-prompt.txt npm run evals:massive
 *
 * Requires the MCP server running and AWS credentials with Bedrock access. See
 * src/evals/massive.ts for what counts as right, and evals/massive/NOTICE.md for the data.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { runEvals } from '../src/evals/run.ts';
import { loadMassive, summariseMassive } from '../src/evals/massive.ts';
import { providerFromEnv } from '../src/sim/providers.ts';

const endpoint = process.env.CARECIRCLE_URL ?? 'http://localhost:8787/mcp';
const provider = providerFromEnv();
const promptFile = process.env.EVALS_SYSTEM_PROMPT_FILE;
const cases = loadMassive(new URL('../evals/massive/en-US.test.jsonl', import.meta.url).pathname);
const limit = Number(process.env.EVALS_LIMIT ?? 0);

const results = await runEvals({
  endpoint, provider,
  cases: limit > 0 ? cases.slice(0, limit) : cases,
  concurrency: Number(process.env.EVALS_CONCURRENCY ?? 1),
  // Bedrock quotas are per minute (Nova Pro: 25 cross-region), so pace under them.
  paceMs: Number(process.env.EVALS_PACE_MS ?? 0),
  ...(promptFile ? { systemPrompt: readFileSync(promptFile, 'utf8') } : {}),
  onProgress: (done, total) => process.stdout.write(`\rMASSIVE on ${provider.name}: ${done}/${total}   `),
});
process.stdout.write('\r' + ' '.repeat(60) + '\r');
const s = summariseMassive(results);
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a');

console.log(`\nCareCircle on Amazon MASSIVE (en-US test) · ${provider.modelId} · prompt: ${promptFile ?? 'console'}`);
console.log(`  ${s.total} scored, ${s.errored} errored\n`);
console.log(`  Not CareCircle's business: ${s.notOurs.total}`);
console.log(`    left alone        ${s.notOurs.leftAlone}  (${pct(s.notOurs.leftAlone, s.notOurs.total)})`);
console.log(`    only read          ${s.notOurs.readInstead}  (${pct(s.notOurs.readInstead, s.notOurs.total)})`);
console.log(`    wrote or reached   ${s.notOurs.wrote}  (${pct(s.notOurs.wrote, s.notOurs.total)}), of which logged-an-event or messaged-someone: ${s.notOurs.worst}`);
console.log(`  Calendar and alarm requests (in scope either way): ${s.inScope.right}/${s.inScope.total} right`);
if (s.harms.length) {
  console.log('\n  Writes on requests that were not care:');
  for (const h of s.harms) console.log(`    ${h.tool.padEnd(20)} ${h.intent.padEnd(28)} "${h.utterance}"`);
}

writeFileSync('evals-massive-results.json', JSON.stringify({
  provider: provider.name, modelId: provider.modelId, at: new Date().toISOString(),
  systemPrompt: promptFile ?? 'console', dataset: 'MASSIVE 1.1 en-US test (CC BY 4.0, Amazon)', ...s,
  results: results.map((r) => ({ id: r.case.id, utterance: r.case.utterance, intent: r.case.note, chosen: r.chosen, pass: r.pass, errored: r.errored ?? false })),
}, null, 2));
