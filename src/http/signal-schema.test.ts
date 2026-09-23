import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createCareCircleApp } from './app.ts';
import { CareStore } from '../store/store.ts';
import { seedDemoHousehold, DEMO_TOKENS } from '../demo/seed.ts';
import { seedScenario } from '../demo/scenario.ts';

/**
 * Regression: ingest_signal returned a `proposalId` its output schema did not declare,
 * and the MCP SDK client rejects undeclared structured fields. Unit tests called the
 * handler directly and passed; `npm run story` - a real client - crashed. So this goes
 * through the real SDK client, which validates output exactly as any MCP host does.
 */

const store = new CareStore();
let server: Server;
let base: string;

before(async () => {
  await seedDemoHousehold(store);
  await seedScenario(store, 'h_margaret');
  const app = createCareCircleApp({ store, tokens: new Map(Object.entries(DEMO_TOKENS)) });
  server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});
after(() => server?.close());

for (const kind of ['delivery_arrived', 'door_activity', 'motion', 'no_activity'] as const) {
  test(`a real MCP client accepts ingest_signal's result for ${kind}`, async () => {
    const c = new Client({ name: 'signal-schema-test', version: '1' });
    await c.connect(new StreamableHTTPClientTransport(new URL(base), {
      requestInit: { headers: { Authorization: 'Bearer david-token' } },
    }));
    try {
      // The SDK validates results against output schemas it learned from tools/list,
      // as every real host does before calling a tool.
      await c.listTools();
      const out = await c.callTool({ name: 'ingest_signal', arguments: { source: 'ring', kind } });
      assert.notEqual(out.isError, true);
      assert.ok(out.structuredContent, 'structured content must be present and schema-valid');
    } finally {
      await c.close(); // so a failure fails, rather than hanging on an open session
    }
  });
}
