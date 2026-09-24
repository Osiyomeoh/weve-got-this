/**
 * Write the MCP contract - what a model sees: tools/list, resources/list, prompts/list -
 * to a file, so two versions of the server can be compared byte for byte.
 *
 *   npx tsx scripts/contract-dump.ts <out.json>
 *
 * Tool descriptions and schemas are measured (the evals); a change here is a change to
 * what was measured, and the corpus, --dialects and evals:languages are re-run after it.
 */
import { writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CareStore } from '../src/store/store.ts';
import { createCareCircleServer } from '../src/mcp/server.ts';
import { seedDemoHousehold } from '../src/demo/seed.ts';

const out = process.argv[2];
if (!out) { console.error('usage: npx tsx scripts/contract-dump.ts <out.json>'); process.exit(1); }
const store = new CareStore();
await seedDemoHousehold(store);
const server = createCareCircleServer({ store, actorId: 'm_david' });
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const client = new Client({ name: 'contract-dump', version: '1' });
await client.connect(clientSide);
const contract = { tools: await client.listTools(), resources: await client.listResources(), prompts: await client.listPrompts() };
writeFileSync(out, `${JSON.stringify(contract, null, 2)}\n`);
console.log(`${contract.tools.tools.length} tools, ${JSON.stringify(contract).length} bytes -> ${out}`);
