/**
 * Of the MASSIVE requests the planner wrongly sent to a write, how many would actually have
 * changed the care record or reached a person? The server already turns many back: a
 * message to "Naty", who is not in the circle, sends nothing.
 *
 *   npx tsx scripts/massive-landed.ts <result.json> <progress.jsonl>          totals, saved into the result
 *   npx tsx scripts/massive-landed.ts <result.json> <progress.jsonl> --show   and each one that landed
 *
 * Each harm's exact call, with the arguments the planner gave (kept in the progress file), is
 * run against a freshly seeded demo record as the member who spoke. `--show` prints the
 * requests; leave it off for a held-out partition, so its cases stay unread.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createCareCircleApp } from '../src/http/app.ts';
import { CareStore } from '../src/store/store.ts';
import { seedDemoHousehold, DEMO_TOKENS, DEMO_HOUSEHOLD_ID } from '../src/demo/seed.ts';
import type { Notifier } from '../src/notify/notifier.ts';

const [resultFile, progressFile] = process.argv.slice(2);
const show = process.argv.includes('--show');
if (!resultFile || !progressFile)
  throw new Error('usage: massive-landed.ts <result.json> <progress.jsonl> [--show]');

const result = JSON.parse(readFileSync(resultFile, 'utf8')) as {
  harms: { id: string; utterance: string; intent: string; tool: string }[];
  landed?: unknown;
};
const argsOf = new Map(
  readFileSync(progressFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { id: string; args?: Record<string, unknown> })
    .map((r) => [r.id, r.args ?? {}]),
);
const token = Object.entries(DEMO_TOKENS).find(([, m]) => m === 'm_margaret')![0];

async function landed(tool: string, args: Record<string, unknown>): Promise<boolean> {
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
  const server = createCareCircleApp({
    store,
    notifier,
    tokens: new Map(Object.entries(DEMO_TOKENS)),
  }).listen(0);
  await new Promise<void>((r) => server.once('listening', r));
  const c = new Client({ name: 'landed', version: '1' });
  try {
    const url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
    await c.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    const out = await c.callTool({ name: tool, arguments: args });
    return (
      out.isError !== true &&
      (reached > 0 || JSON.stringify(store.getCareState(DEMO_HOUSEHOLD_ID)) !== before)
    );
  } catch {
    return false;
  } finally {
    await c.close().catch(() => {});
    server.close();
  }
}

const byTool: Record<string, number> = {};
const rows: string[] = [];
for (const h of result.harms) {
  if (!argsOf.has(h.id)) throw new Error(`no saved arguments for ${h.id}: wrong progress file?`);
  if (!(await landed(h.tool, argsOf.get(h.id)!))) continue;
  byTool[h.tool] = (byTool[h.tool] ?? 0) + 1;
  rows.push(`  ${h.tool.padEnd(20)} ${h.intent.padEnd(28)} "${h.utterance}"`);
}
result.landed = { total: rows.length, byTool };
writeFileSync(resultFile, JSON.stringify(result, null, 2) + '\n');
console.log(
  `${rows.length} of ${result.harms.length} wrong writes landed: ${JSON.stringify(byTool)}`,
);
if (show) console.log(rows.join('\n'));
