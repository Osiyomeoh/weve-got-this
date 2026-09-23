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
 * The purchase moment, the way a voice host actually hits it: loosely ("refill his
 * prescription"), and often in a fresh conversation that never saw the offer id
 * ("yes, place the order"). Through the real SDK client, so every result is also
 * checked against the declared output schema.
 */

let store: CareStore;
let server: Server;
let base: string;

before(async () => {
  store = new CareStore();
  await seedDemoHousehold(store);
  await seedScenario(store, 'h_margaret');
  const app = createCareCircleApp({ store, tokens: new Map(Object.entries(DEMO_TOKENS)) });
  server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});
after(() => server?.close());

type Result = { isError?: boolean; text: string; structured: Record<string, unknown> };

/** One call in its own session, like a new conversation with Alexa. */
async function call(token: string, name: string, args: Record<string, unknown> = {}): Promise<Result> {
  const c = new Client({ name: 'purchase-test', version: '1' });
  await c.connect(new StreamableHTTPClientTransport(new URL(base), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  try {
    await c.listTools(); // so the SDK validates structured output, as a host does
    const out = await c.callTool({ name, arguments: args });
    const content = out.content as { text: string }[];
    return {
      ...(out.isError ? { isError: true } : {}),
      text: content.map((p) => p.text).join(' '),
      structured: (out.structuredContent ?? {}) as Record<string, unknown>,
    };
  } finally {
    await c.close();
  }
}

const pickupOpen = () => store.getCareState('h_margaret').obligations
  .some((o) => o.what === "Pick up Daddy's eye drops refill" && o.status !== 'RESOLVED');

test('"yes, place the order" with nothing waiting says so, and buys nothing', async () => {
  const r = await call('david-token', 'confirm_purchase', { confirmed: true });
  assert.equal(r.isError, true);
  assert.match(r.text, /no order waiting/);
});

test('"refill his prescription" prices the refill already waiting, without asking which', async () => {
  const r = await call('david-token', 'reorder_prescription', { medicationName: 'his prescription' });
  assert.notEqual(r.isError, true, r.text);
  assert.match(r.text, /eye drops refill/);
  assert.match(r.text, /Nothing is charged/);
});

test('someone else\'s "go ahead" gets the price read back, not placed', async () => {
  const r = await call('renee-token', 'confirm_purchase', { confirmed: true });
  assert.equal(r.isError, true);
  assert.match(r.text, /Tolu was quoted eye drops refill .* for \$12\.00/);
  assert.equal(pickupOpen(), true, 'nothing was placed');
});

test('the person who heard the price can say yes in a new conversation, and it closes the pickup', async () => {
  const r = await call('david-token', 'confirm_purchase', { confirmed: true });
  assert.notEqual(r.isError, true, r.text);
  assert.equal(r.structured['placed'], true);
  assert.equal(r.structured['closedObligation'], "Pick up Daddy's eye drops refill");
  assert.equal(pickupOpen(), false);
});

test('two orders waiting: it asks which, and names both', async () => {
  await call('david-token', 'reorder_prescription', { medicationName: 'his supplement' });
  await call('david-token', 'reorder_prescription', { medicationName: 'eye drops' });
  const r = await call('david-token', 'confirm_purchase', { confirmed: true });
  assert.equal(r.isError, true);
  assert.match(r.text, /2 orders are waiting: eye drops refill .* and supplement refill/);
});

test('with the refill gone, an unnamed prescription is asked about, not guessed', async () => {
  const r = await call('david-token', 'reorder_prescription', {});
  assert.equal(r.isError, true);
  assert.match(r.text, /eye drops and supplement/);
});
