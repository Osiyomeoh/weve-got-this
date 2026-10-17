import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createCareCircleApp } from './app.ts';
import { CareStore } from '../store/store.ts';
import { RecordOnlyNotifier } from '../notify/notifier.ts';
import { detectCareGaps } from '../domain/gaps.ts';

/**
 * Routines through the real SDK client: lunch every day, someone there at night, diesel on
 * Saturdays. Clock pinned to 10 AM in Lagos on a Thursday.
 */

let server: Server | undefined;
afterEach(() => server?.close());
const NOW = new Date('2026-09-24T09:00:00Z');
let clock = NOW;
afterEach(() => {
  clock = NOW;
});

async function family() {
  const store = new CareStore();
  await store.addHousehold({ id: 'h', name: 'Dad care circle', timezone: 'Africa/Lagos' });
  await store.addMember({
    id: 'm_dad',
    householdId: 'h',
    name: 'Pius',
    role: 'care_recipient',
    spokenAs: 'Dad',
  });
  await store.addMember({ id: 'm_sam', householdId: 'h', name: 'Sam', role: 'primary_caregiver' });
  await store.addMember({ id: 'm_sandra', householdId: 'h', name: 'Sandra', role: 'caregiver' });
  const app = createCareCircleApp({
    store,
    notifier: new RecordOnlyNotifier(),
    now: () => clock,
    tokens: new Map([
      ['sam', 'm_sam'],
      ['dad', 'm_dad'],
      ['sandra', 'm_sandra'],
    ]),
  });
  server = app.listen(0);
  await new Promise<void>((r) => server!.once('listening', r));
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}/mcp`;
  const use = async (token: string, name: string, args: Record<string, unknown> = {}) => {
    const c = new Client({ name: 't', version: '1' });
    await c.connect(
      new StreamableHTTPClientTransport(new URL(base), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    try {
      await c.listTools();
      const out = await c.callTool({ name, arguments: args });
      return {
        isError: out.isError === true,
        text: (out.content as { text: string }[]).map((p) => p.text).join(' '),
        structured: out.structuredContent as Record<string, unknown> | undefined,
      };
    } finally {
      await c.close();
    }
  };
  const call = (token: string, args: Record<string, unknown>) => use(token, 'set_routine', args);
  return { store, call, use };
}

const LUNCH = { what: 'Bring Dad lunch', area: 'meal', times: ['13:00'] };

test("lunch every day: today's goes on the board, unowned, and the family is told someone will be asked", async () => {
  const { store, call } = await family();
  const r = await call('sandra', LUNCH);
  assert.equal(r.isError, false, r.text);
  assert.equal(
    r.text,
    `Set up "Bring Dad lunch" every day at 1 PM. Each time goes on the board a day ahead, and I'll ask someone free to take it on.`,
  );
  const day = store.getCareState('h').obligations.find((o) => o.what === 'Bring Dad lunch');
  assert.ok(day);
  assert.equal(day.status, 'OPEN');
  assert.equal(day.dueAt, '2026-09-24T12:00:00.000Z');
  assert.equal(day.routineId, r.structured?.['routineId']);
  const gap = detectCareGaps(store.getCareState('h'), { now: NOW }).find(
    (g) => g.obligationId === day.id,
  );
  assert.ok(gap, 'an unowned lunch is a gap like any other');
  assert.match(gap.because, /comes round regularly/);
});

test('"I\'ll bring his lunch every day" makes each one theirs, and only theirs', async () => {
  const { store, call } = await family();
  const r = await call('sandra', { ...LUNCH, mine: true });
  assert.match(r.text, /Each time is yours/);
  const day = store.getCareState('h').obligations[0]!;
  assert.equal(day.status, 'ASSIGNED');
  assert.equal(day.ownerId, 'm_sandra');
});

test('Dad can ask for someone at night himself: he is a participant, not a subject', async () => {
  const { store, call } = await family();
  const r = await call('dad', {
    what: 'Someone with Dad at night',
    area: 'safety',
    times: ['21:00'],
  });
  assert.equal(r.isError, false, r.text);
  const set = store.getCareState('h').events.find((e) => e.kind === 'routine_set')!;
  assert.equal(set.reportedBy, 'm_dad');
});

test('diesel on Saturdays is said as Saturdays, and is not on the board on a Thursday', async () => {
  const { store, call } = await family();
  const r = await call('sam', {
    what: 'Buy diesel for the generator',
    area: 'household',
    times: ['10:00'],
    days: ['saturday'],
  });
  assert.match(r.text, /^Set up "Buy diesel for the generator" Saturdays at 10 AM\./);
  assert.equal(store.getCareState('h').obligations.length, 0);
});

test('times that are not "HH:MM", or a routine already set up, are asked about, not saved', async () => {
  const { store, call } = await family();
  const bad = await call('sam', { ...LUNCH, times: ['1pm'] });
  assert.match(bad.text, /I need the times as 24-hour "HH:MM"/);
  await call('sam', LUNCH);
  const twice = await call('sandra', { ...LUNCH, what: 'bring dad lunch' });
  assert.match(twice.text, /already set up/);
  assert.equal(store.getCareState('h').events.filter((e) => e.kind === 'routine_set').length, 1);
});

test('stopping: the days ahead come off, and only the one who set it up or the coordinator can', async () => {
  const { store, call } = await family();
  await call('sam', LUNCH);
  const refused = await call('sandra', { what: 'lunch', area: 'meal', stop: true });
  assert.match(refused.text, /Only the person who set up "Bring Dad lunch"/);
  const r = await call('sam', { what: 'lunch', area: 'meal', stop: true });
  assert.equal(
    r.text,
    'Stopped "Bring Dad lunch". The time ahead came off the board. What was already done stays on the record.',
  );
  assert.equal(store.getCareState('h').obligations[0]!.status, 'DISMISSED');
  const none = await call('sam', { what: 'lunch', area: 'meal', stop: true });
  assert.match(none.text, /no routines set up/);
});

test('"Did someone bring my lunch?" Dad hears what the record says, and who said so', async () => {
  const { store, call, use } = await family();
  await call('sam', LUNCH);
  await call('sandra', {
    what: 'Someone with Dad at night',
    area: 'safety',
    times: ['21:00'],
    mine: true,
  });
  const lunch = store.getCareState('h').obligations.find((o) => o.what === 'Bring Dad lunch')!;
  clock = new Date('2026-09-24T12:10:00Z');
  await use('sandra', 'resolve_obligation', { obligationId: lunch.id });

  clock = new Date('2026-09-24T12:30:00Z');
  const brief = await use('dad', 'get_shift_brief');
  assert.match(brief.text, /Bring Dad lunch at 1 PM: Sandra marked it done at 1:10 PM\./);
  assert.match(brief.text, /Someone with Dad at night at 9 PM: Sandra has it\./);
  const summary = await use('sam', 'get_care_summary');
  assert.match(summary.text, /Bring Dad lunch at 1 PM: Sandra marked it done at 1:10 PM\./);
  assert.equal((summary.structured?.['routinesToday'] as unknown[]).length, 2);
});

test('a night past its time with nothing marked is said as that, never as nobody came', async () => {
  const { call, use } = await family();
  await call('sandra', {
    what: 'Someone with Dad at night',
    area: 'safety',
    times: ['21:00'],
    mine: true,
  });
  clock = new Date('2026-09-24T21:30:00Z');
  const brief = await use('dad', 'get_shift_brief');
  assert.match(
    brief.text,
    /Someone with Dad at night at 9 PM: Sandra has it, and nothing's marked yet\./,
  );
  assert.doesNotMatch(brief.text, /didn't|did not|wasn't|missed/);
  // Sandra hears it as hers, once, not again as a routine line.
  const hers = await use('sandra', 'get_shift_brief');
  assert.doesNotMatch(hers.text, /Sandra has it|you have it/);
});
