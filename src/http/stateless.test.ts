import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import {
  Client as ModernClient,
  StreamableHTTPClientTransport as ModernTransport,
} from '@modelcontextprotocol/client';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createCareCircleApp } from './app.ts';
import { CareStore } from '../store/store.ts';
import { DynamoPersistence } from '../store/dynamo.ts';
import { fakeTable, type FakeTable } from '../store/fake-table.ts';

/**
 * MCP 2026-07-28 alongside 2025-11-25.
 *
 * Two instances of the server, each with its own copy of the record in memory, over one
 * table - what a load balancer spreading requests would give. A 2026-07-28 client whose
 * requests alternate between them has to be answered by both, and see on one what it wrote
 * through the other. A 2025-11-25 client keeps its session exactly as before.
 */

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

const NOW = new Date('2026-09-24T12:00:00Z');
const TOKENS = new Map([
  ['tolu', 'm_tolu'],
  ['dad', 'm_dad'],
]);

async function instance(table: FakeTable): Promise<string> {
  const store = new CareStore(new DynamoPersistence({ tableName: 't', client: table.client }));
  await store.init();
  const server = createCareCircleApp({ store, now: () => NOW, tokens: TOKENS }).listen(0);
  servers.push(server);
  await new Promise<void>((r) => server.once('listening', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
}

async function seeded(): Promise<FakeTable> {
  const table = fakeTable();
  const store = new CareStore(new DynamoPersistence({ tableName: 't', client: table.client }));
  await store.init();
  await store.addHousehold({ id: 'h', name: 'circle', timezone: 'Africa/Lagos' });
  await store.addMember({
    id: 'm_dad',
    householdId: 'h',
    name: 'Joseph',
    role: 'care_recipient',
    spokenAs: 'Daddy',
  });
  await store.addMember({
    id: 'm_tolu',
    householdId: 'h',
    name: 'Tolu',
    role: 'primary_caregiver',
  });
  await store.addMedication({
    id: 'med',
    householdId: 'h',
    name: 'eye drops',
    times: ['08:00', '20:00'],
    forMemberId: 'm_dad',
    since: '2026-09-24T00:00:00Z',
  });
  return table;
}

/** A 2026-07-28 client whose every request goes to the next instance in turn. */
async function modernAcross(urls: string[], token: string) {
  let n = 0;
  const hits = urls.map(() => 0);
  const spread: typeof fetch = (input, init) => {
    const i = n++ % urls.length;
    hits[i]! += 1;
    return fetch(urls[i]!, init);
  };
  const client = new ModernClient(
    { name: 'stateless-test', version: '1' },
    { versionNegotiation: { mode: 'auto' } },
  );
  await client.connect(
    new ModernTransport(new URL(urls[0]!), {
      fetch: spread,
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return { client, hits };
}

const text = (r: unknown) => (r as { content: { text: string }[] }).content[0]!.text;

test('a 2026-07-28 client is served by whichever instance each request reaches', async () => {
  const table = await seeded();
  const urls = [await instance(table), await instance(table)];
  const { client, hits } = await modernAcross(urls, 'dad');
  try {
    assert.equal(client.getProtocolEra(), 'modern');
    assert.equal(client.getNegotiatedProtocolVersion(), '2026-07-28');

    const { tools } = await client.listTools();
    assert.equal(tools.length, 29);

    // Daddy logs his drops on one instance; the next request, on the other, reads it back.
    const logged = await client.callTool({
      name: 'log_care_event',
      arguments: { kind: 'medication_taken', medicationName: 'eye drops' },
    });
    assert.match(text(logged), /logged the eye drops/);
    const brief = await client.callTool({ name: 'get_shift_brief', arguments: {} });
    assert.match(text(brief), /Recorded so far today: eye drops at/);

    assert.ok(
      hits.every((h) => h >= 2),
      `both instances answered: ${hits.join(' / ')}`,
    );
  } finally {
    await client.close();
  }
});

test('the credential decides who is speaking on 2026-07-28 too, never the conversation', async () => {
  const table = await seeded();
  const urls = [await instance(table), await instance(table)];
  const { client } = await modernAcross(urls, 'dad');
  try {
    await client.callTool({
      name: 'log_care_event',
      arguments: { kind: 'medication_taken', medicationName: 'eye drops' },
    });
    const check = new CareStore(new DynamoPersistence({ tableName: 't', client: table.client }));
    await check.init();
    const dose = check.getCareState('h').events.find((e) => e.kind === 'medication_taken');
    assert.equal(dose?.reportedBy, 'm_dad');
  } finally {
    await client.close();
  }

  // No credential: refused before any server is built, as on every other path.
  const res = await fetch(urls[0]!, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } },
    }),
  });
  assert.equal(res.status, 401);
});

test('both revisions offer the same tools, word for word', async () => {
  const table = await seeded();
  const url = await instance(table);
  const { client: modern } = await modernAcross([url], 'tolu');
  const legacy = new Client({ name: 'stateless-test-legacy', version: '1' });
  await legacy.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: 'Bearer tolu' } },
    }),
  );
  try {
    const a = (await legacy.listTools()).tools.map((t) => [
      t.name,
      t.description,
      JSON.stringify(t.inputSchema),
    ]);
    const b = (await modern.listTools()).tools.map((t) => [
      t.name,
      t.description,
      JSON.stringify(t.inputSchema),
    ]);
    assert.deepEqual(
      b.map((t) => t[0]),
      a.map((t) => t[0]),
      'same tools, same order',
    );
    assert.deepEqual(
      b.map((t) => t[1]),
      a.map((t) => t[1]),
      'same descriptions',
    );
  } finally {
    await legacy.close();
    await modern.close();
  }
});

test('a 2025-11-25 client keeps its session on the instance that opened it, as before', async () => {
  const table = await seeded();
  const url = await instance(table);
  const legacy = new Client({ name: 'stateless-test-legacy', version: '1' });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: 'Bearer tolu' } },
  });
  await legacy.connect(transport);
  try {
    assert.ok(transport.sessionId, 'a 2025 client still gets a session');
    const gaps = await legacy.callTool({ name: 'get_care_gaps', arguments: {} });
    assert.ok(text(gaps).length > 0);
  } finally {
    await legacy.close();
  }
});
