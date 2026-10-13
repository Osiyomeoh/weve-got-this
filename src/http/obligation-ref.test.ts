import { test, beforeEach, afterEach } from 'node:test';
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
 * The live console, 2026-09-23: "ask Funmi if she can take Daddy to his check-up",
 * then "yes". The planner passed the task's words as the obligationId, twice, and the
 * reply was "I'm having a technical issue identifying the exact obligation ID". These
 * replay that through the real SDK client.
 */

let store: CareStore;
let server: Server;
let base: string;

beforeEach(async () => {
  store = new CareStore();
  await seedDemoHousehold(store);
  await seedScenario(store, 'h_margaret');
  const app = createCareCircleApp({ store, tokens: new Map(Object.entries(DEMO_TOKENS)) });
  server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});
afterEach(() => server?.close());

async function call(token: string, name: string, args: Record<string, unknown>) {
  const c = new Client({ name: 'obligation-ref-test', version: '1' });
  await c.connect(
    new StreamableHTTPClientTransport(new URL(base), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  try {
    await c.listTools(); // so the SDK validates structured output, as a host does
    const out = await c.callTool({ name, arguments: args });
    return {
      isError: out.isError === true,
      text: (out.content as { text: string }[]).map((p) => p.text).join(' '),
      structured: (out.structuredContent ?? {}) as Record<string, unknown>,
    };
  } finally {
    await c.close();
  }
}

const ride = () =>
  store
    .getCareState('h_margaret')
    .obligations.find((o) => o.what === 'Take Daddy to his eye check-up')!;

test('asking Funmi works when the planner passes the spoken gap line instead of the id', async () => {
  const r = await call('david-token', 'request_owner', {
    obligationId: 'Take Daddy to his eye check-up tomorrow at 10 AM - nobody has taken this yet.',
    assigneeName: 'Funmi',
  });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.structured['obligationId'], ride().id);
  assert.equal(ride().status, 'REQUESTED');
  assert.equal(ride().request?.askedOfId, 'm_renee');
});

test('claiming "the refill" takes the refill', async () => {
  const r = await call('renee-token', 'claim_obligation', { obligationId: 'the refill' });
  assert.equal(r.isError, false, r.text);
  const refill = store
    .getCareState('h_margaret')
    .obligations.find((o) => o.what.includes('refill'))!;
  assert.equal(refill.ownerId, 'm_renee');
});

test('words that fit two things change nothing, and give the choices with their ids', async () => {
  const before = JSON.stringify(store.getCareState('h_margaret').obligations);
  const r = await call('david-token', 'request_owner', {
    obligationId: 'the eye one',
    assigneeName: 'Funmi',
  });
  assert.equal(r.isError, true);
  assert.match(
    r.text,
    /That could be 2 things: .*Take Daddy to his eye check-up" \(obligationId obl_/,
  );
  assert.match(r.text, /Ask the person which one they mean/);
  assert.equal(JSON.stringify(store.getCareState('h_margaret').obligations), before);
});

test('words that fit nothing list what is open, so the next call can use a real id', async () => {
  const r = await call('david-token', 'resolve_obligation', { obligationId: 'the laundry' });
  assert.equal(r.isError, true);
  assert.match(r.text, /Nothing open matches that\. What is open: /);
  assert.match(r.text, new RegExp(`obligationId ${ride().id}`));
});
