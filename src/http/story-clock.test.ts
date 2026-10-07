import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createCareCircleApp } from './app.ts';
import { CareStore } from '../store/store.ts';
import { seedDemoHousehold, DEMO_TOKENS } from '../demo/seed.ts';
import { seedScenario } from '../demo/scenario.ts';
import { STORY_TIME_HEADER } from './story-clock.ts';

/**
 * The story clock. The world simulation plays an evening in the family's life, and a
 * sandbox copy may run on that evening's time - but only a sandbox copy. A request
 * claiming a time against the real demo household, or any real family, is answered on
 * the real clock.
 */

const KEY = 'test-sandbox-key';
const store = new CareStore();
let server: Server;
let base: string;

before(async () => {
  process.env['CARECIRCLE_OAUTH_SECRET'] = 'test-oauth-secret';
  process.env['CARECIRCLE_PUBLIC_URL'] = 'http://localhost';
  process.env['CARECIRCLE_SANDBOX_KEY'] = KEY;
  await store.reset();
  await seedDemoHousehold(store);
  await seedScenario(store, 'h_margaret');
  const app = createCareCircleApp({ store, tokens: new Map(Object.entries(DEMO_TOKENS)) });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const a = server.address();
      base = `http://localhost:${typeof a === 'object' && a ? a.port : 0}`;
      resolve();
    });
  });
});

after(() => {
  server?.close();
  delete process.env['CARECIRCLE_OAUTH_SECRET'];
  delete process.env['CARECIRCLE_PUBLIC_URL'];
  delete process.env['CARECIRCLE_SANDBOX_KEY'];
});

async function sandbox(): Promise<{ householdId: string; tokens: Record<string, string> }> {
  const res = await fetch(`${base}/sandbox`, { method: 'POST', headers: { 'x-sandbox-key': KEY } });
  assert.equal(res.status, 201);
  return res.json() as Promise<{ householdId: string; tokens: Record<string, string> }>;
}

/** One tool call in its own session, optionally claiming a story time on every request. */
async function callTool(token: string, name: string, args: Record<string, unknown>, storyTime?: string): Promise<void> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${token}`,
    ...(storyTime ? { [STORY_TIME_HEADER]: storyTime } : {}),
  };
  const init = await fetch(`${base}/mcp`, {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } } }),
  });
  assert.equal(init.status, 200);
  headers['mcp-session-id'] = init.headers.get('mcp-session-id')!;
  await init.text();
  await fetch(`${base}/mcp`, { method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  const res = await fetch(`${base}/mcp`, { method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }) });
  assert.equal(res.status, 200);
  await res.text();
}

const lastNoteAt = (householdId: string): number => {
  const notes = store.getCareState(householdId).events.filter((e) => e.kind === 'note_added');
  return Date.parse(notes.at(-1)!.occurredAt);
};

test('a sandbox copy runs on the story time its caller sends', async () => {
  const copy = await sandbox();
  const story = '2026-10-07T19:16:00.000Z';
  await callTool(copy.tokens['m_david']!, 'add_note', { note: 'Musa is on his way to the pharmacy.' }, story);
  const at = lastNoteAt(copy.householdId);
  // Story time plus however long the request took - never the real clock.
  assert.ok(at >= Date.parse(story) && at < Date.parse(story) + 5_000, `recorded at ${new Date(at).toISOString()}`);
});

test('who took the work on, and when, is kept in story time too', async () => {
  const copy = await sandbox();
  const story = '2026-10-07T11:34:00.000Z';
  await callTool(copy.tokens['m_david']!, 'claim_obligation', { obligationId: 'eye check-up' }, story);
  const ride = store.getCareState(copy.householdId).obligations.find((o) => /eye check-up/.test(o.what))!;
  const moved = store.getTransitions(ride.id).at(-1)!;
  assert.equal(moved.to, 'ASSIGNED');
  const at = Date.parse(moved.at);
  assert.ok(at >= Date.parse(story) && at < Date.parse(story) + 5_000, `moved at ${moved.at}`);
});

test('the real demo household ignores a claimed story time', async () => {
  const before = Date.now();
  await callTool('david-token', 'add_note', { note: 'A note on the real clock.' }, '2001-01-01T12:00:00.000Z');
  assert.ok(lastNoteAt('h_margaret') >= before - 1_000, 'a real household must stay on the real clock');
});

test('a copy that sends no story time stays on the real clock', async () => {
  const copy = await sandbox();
  const before = Date.now();
  await callTool(copy.tokens['m_david']!, 'add_note', { note: 'No story time sent.' });
  assert.ok(lastNoteAt(copy.householdId) >= before - 1_000);
});

test('a malformed story time is ignored, not trusted', async () => {
  const copy = await sandbox();
  const before = Date.now();
  await callTool(copy.tokens['m_david']!, 'add_note', { note: 'Garbage time.' }, 'half past never');
  assert.ok(lastNoteAt(copy.householdId) >= before - 1_000);
});
