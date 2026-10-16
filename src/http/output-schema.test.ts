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
 * Tools whose success results carried fields their output schema did not declare,
 * driven through the real SDK client. A real host rejected each of these; the server
 * now checks every result against its schema, and this makes sure the paths that no
 * other test reaches through the server are exercised at least once.
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

async function call(token: string, name: string, args: Record<string, unknown>) {
  const c = new Client({ name: 'output-schema-test', version: '1' });
  await c.connect(
    new StreamableHTTPClientTransport(new URL(base), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  try {
    await c.listTools();
    const out = await c.callTool({ name, arguments: args });
    const text = (out.content as { text: string }[]).map((p) => p.text).join(' ');
    assert.notEqual(out.isError, true, `${name}: ${text}`);
    return out.structuredContent as Record<string, unknown>;
  } finally {
    await c.close();
  }
}

test('add_note, with someone unavailable', async () => {
  const from = new Date();
  const to = new Date(from.getTime() + 86_400_000);
  const out = await call('david-token', 'add_note', {
    note: "Musa can't come in tomorrow.",
    unavailable: { memberName: 'Musa', from: from.toISOString(), to: to.toISOString() },
  });
  assert.ok(Array.isArray(out['orphaned']));
});

test('confirm_proposal', async () => {
  const startsAt = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 19);
  await call('david-token', 'record_appointment', { kind: 'eye clinic follow-up', startsAt });
  const proposed = store
    .getCareState('h_margaret')
    .obligations.find((o) => o.status === 'PROPOSED');
  assert.ok(proposed, 'the demo scenario has a proposal waiting');
  const out = await call('david-token', 'confirm_proposal', {
    obligationId: proposed.id,
    confirmed: true,
  });
  assert.equal(out['status'], 'OPEN');
});

test('request_owner, then respond_to_request declining it', async () => {
  const open = store
    .getCareState('h_margaret')
    .obligations.find((o) => o.status === 'OPEN' && !o.ownerId);
  assert.ok(open);
  await call('david-token', 'request_owner', { obligationId: open.id, assigneeName: 'Funmi' });
  const out = await call('renee-token', 'respond_to_request', {
    obligationId: open.id,
    accepted: false,
  });
  assert.equal(out['declined'], true);
});

test('add_member for someone abroad who wants the evening update', async () => {
  const out = await call('david-token', 'add_member', {
    name: 'Bisi',
    role: 'caregiver',
    livesAway: 'Toronto',
    dailyUpdate: true,
  });
  const added = store.getMember(out['memberId'] as string);
  assert.equal(added.livesAway, 'Toronto');
  assert.equal(added.dailyUpdate, true);
});

test('someone abroad can still be asked by name - a person chose them', async () => {
  const open = store
    .getCareState('h_margaret')
    .obligations.find((o) => o.status === 'OPEN' && !o.ownerId);
  assert.ok(open);
  const out = await call('david-token', 'request_owner', {
    obligationId: open.id,
    assigneeName: 'Kunle',
  });
  assert.equal(out['askedOfId'], 'm_kunle');
});

test('tools/list keeps the order the tool-selection evals measured', async () => {
  const c = new Client({ name: 'order-test', version: '1' });
  await c.connect(
    new StreamableHTTPClientTransport(new URL(base), {
      requestInit: { headers: { Authorization: 'Bearer david-token' } },
    }),
  );
  try {
    const { tools } = await c.listTools();
    // The planner sees tools in this order. Reordering them is a change to what the
    // evals measured: update this list only together with a fresh eval run.
    assert.deepEqual(
      tools.map((t) => t.name),
      [
        'log_care_event',
        'record_appointment',
        'add_note',
        'get_care_gaps',
        'claim_obligation',
        'assign_obligation',
        'request_owner',
        'respond_to_request',
        'get_my_requests',
        'get_provenance',
        'get_connections',
        'confirm_proposal',
        'resolve_obligation',
        'run_care_agent',
        'get_care_summary',
        'get_shift_brief',
        'notify_member',
        'ingest_signal',
        'reorder_prescription',
        'confirm_purchase',
        'get_started',
        'create_household',
        'add_member',
        'add_medication',
        'remove_member',
        'change_medication',
        'change_appointment',
        'raise_urgent',
        'get_promises',
      ],
    );
  } finally {
    await c.close();
  }
});
