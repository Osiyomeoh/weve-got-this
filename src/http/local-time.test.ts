import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createCareCircleApp } from './app.ts';
import { CareStore } from '../store/store.ts';
import { asTask, clockTime, isLocalToday } from '../domain/local-time.ts';
import { spokenClock } from '../domain/gaps.ts';

/**
 * Times as the family lives them. Found by driving the server through an Alexa Skill
 * bridge, 2026-09-23: a model read `dueAt: 09:00Z` and told Funmi the check-up was
 * "at nine in the morning" (it was at ten, Lagos time), and "today" was the UTC date,
 * so a New York evening lost the whole morning's record. These run through the real
 * SDK client, with the clock pinned.
 */

let server: Server | undefined;
afterEach(() => server?.close());

async function start(store: CareStore, now: Date): Promise<string> {
  const app = createCareCircleApp({
    store, now: () => now,
    tokens: new Map([['ann-token', 'm_ann'], ['ben-token', 'm_ben']]),
  });
  server = app.listen(0);
  await new Promise<void>((r) => server!.once('listening', r));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/mcp`;
}

async function call(base: string, token: string, name: string, args: Record<string, unknown> = {}) {
  const c = new Client({ name: 'local-time-test', version: '1' });
  await c.connect(new StreamableHTTPClientTransport(new URL(base), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
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

async function family(timezone: string): Promise<CareStore> {
  const store = new CareStore();
  await store.addHousehold({ id: 'h_t', name: 'Test circle', timezone });
  await store.addMember({ id: 'm_dad', householdId: 'h_t', name: 'Walter', role: 'care_recipient', spokenAs: 'Dad' });
  await store.addMember({ id: 'm_ann', householdId: 'h_t', name: 'Ann', role: 'primary_caregiver' });
  await store.addMember({ id: 'm_ben', householdId: 'h_t', name: 'Ben', role: 'caregiver' });
  await store.addMedication({ id: 'med_bp', householdId: 'h_t', name: 'blood pressure pill', times: ['08:00', '20:00'], forMemberId: 'm_dad' });
  return store;
}

const dose = (store: CareStore, at: string) => store.appendEvent({
  householdId: 'h_t', kind: 'medication_taken', reportedBy: 'm_dad', occurredAt: at,
  source: 'voice', confidence: 'reported', detail: 'blood pressure pill',
  data: { medicationId: 'med_bp', medicationName: 'blood pressure pill', forMemberId: 'm_dad' },
});

test('a New York evening still has the morning on the record', async () => {
  const store = await family('America/New_York');
  await dose(store, '2026-09-23T12:05:00.000Z'); // 8:05 AM in New York
  // 9:30 PM in New York is already the 24th in UTC.
  const base = await start(store, new Date('2026-09-24T01:30:00.000Z'));

  const gaps = await call(base, 'ann-token', 'get_care_gaps');
  const recorded = gaps.structured['recordedToday'] as { time: string }[];
  assert.equal(recorded.length, 1, 'the morning dose is part of today');
  assert.equal(recorded[0]!.time, '8:05 AM');

  const summary = await call(base, 'ann-token', 'get_care_summary');
  assert.equal(summary.structured['medicationsLogged'], 1);
  assert.match(summary.text, /Logged today: blood pressure pill at 8:05 AM\./);
  assert.match(summary.text, /There's no record of Dad's blood pressure pill from 8 PM\./);
  const logged = summary.structured['medications'] as { name: string; time: string }[];
  assert.deepEqual(logged.map((m) => [m.name, m.time]), [['blood pressure pill', '8:05 AM']]);
});

test('yesterday evening in UTC terms is not today in Lagos after midnight', async () => {
  const store = await family('Africa/Lagos');
  await dose(store, '2026-09-23T19:05:00.000Z'); // 8:05 PM on the 23rd in Lagos
  const base = await start(store, new Date('2026-09-23T23:30:00.000Z')); // 12:30 AM on the 24th

  const gaps = await call(base, 'ann-token', 'get_care_gaps');
  assert.deepEqual(gaps.structured['recordedToday'], []);
});

test('a request says when, in the family\'s time, and reads as a sentence', async () => {
  const store = await family('Africa/Lagos');
  await store.createObligation({
    householdId: 'h_t', what: 'Pick up Dad\'s refill', status: 'OPEN', consequence: 'medical',
    dueAt: '2026-09-24T09:00:00.000Z', // 10 AM in Lagos
    provenance: { kind: 'DIRECT', by: 'm_ann' },
  } as Parameters<CareStore['createObligation']>[0]);
  const base = await start(store, new Date('2026-09-23T15:00:00.000Z'));
  const refill = store.getCareState('h_t').obligations[0]!;

  const asked = await call(base, 'ann-token', 'request_owner', { obligationId: refill.id, assigneeName: 'Ben' });
  assert.equal(asked.isError, false, asked.text);
  assert.match(asked.text, /I've asked Ben whether they can pick up Dad's refill tomorrow at 10 AM\./);

  const mine = await call(base, 'ben-token', 'get_my_requests');
  assert.match(mine.text, /Ann asked if you can pick up Dad's refill tomorrow at 10 AM/);
  const req = (mine.structured['requests'] as { due: string }[])[0]!;
  assert.equal(req.due, 'tomorrow at 10 AM');
});

test('"at two" is two o\'clock where the family is, not in UTC', async () => {
  const store = await family('America/New_York');
  const base = await start(store, new Date('2026-09-23T22:00:00.000Z')); // 6 PM in New York

  const r = await call(base, 'ann-token', 'log_care_event', {
    kind: 'medication_taken', medicationName: 'blood pressure pill',
    occurredAt: '2026-09-23T14:00:00', aboutMemberId: 'm_dad',
  });
  assert.equal(r.isError, false, r.text);
  const logged = store.getCareState('h_t').events.at(-1)!;
  assert.equal(logged.occurredAt, '2026-09-23T18:00:00.000Z'); // 2 PM EDT

  const later = await call(base, 'ann-token', 'log_care_event', {
    kind: 'medication_taken', medicationName: 'blood pressure pill',
    occurredAt: '2026-09-23T21:00:00', aboutMemberId: 'm_dad', // 9 PM, three hours from now
  });
  assert.equal(later.isError, true);
  assert.match(later.text, /later than now/);
});

test('local-time helpers', () => {
  assert.equal(isLocalToday('2026-09-23T12:05:00.000Z', new Date('2026-09-24T01:30:00.000Z'), 'America/New_York'), true);
  assert.equal(isLocalToday('2026-09-23T12:05:00.000Z', new Date('2026-09-24T01:30:00.000Z'), 'UTC'), false);
  assert.equal(clockTime('2026-09-23T07:10:00.000Z', 'Africa/Lagos'), '8:10 AM');
  assert.equal(asTask('Take Daddy to his eye check-up'), 'take Daddy to his eye check-up');
  assert.equal(asTask('Pick up Daddy\'s eye drops refill'), 'pick up Daddy\'s eye drops refill');
  assert.equal(asTask('Groceries for the week'), 'take on Groceries for the week');
  assert.equal(spokenClock('20:00'), '8 PM');
  assert.equal(spokenClock('08:30'), '8:30 AM');
  assert.equal(spokenClock('00:00'), '12 AM');
  assert.equal(spokenClock('12:00'), '12 PM');
});
