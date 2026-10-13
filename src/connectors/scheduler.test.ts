import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CareStore } from '../store/store.ts';
import { runConnectorsOnce } from './scheduler.ts';

const HH = 'h1';
const store = new CareStore();
const silentLog = { info() {}, error(_m: string, _d?: Record<string, unknown>) {} };

// Snapshot and restore the env keys the config readers look at.
const KEYS = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN',
  'GOOGLE_CALENDAR_ID',
];
const saved: Record<string, string | undefined> = {};

beforeEach(async () => {
  await store.reset();
  await store.addHousehold({ id: HH, name: 'circle', timezone: 'America/New_York' });
  for (const k of KEYS) saved[k] = process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function configureGoogle(): void {
  process.env['GOOGLE_CLIENT_ID'] = 'cid';
  process.env['GOOGLE_CLIENT_SECRET'] = 'secret';
  process.env['GOOGLE_REFRESH_TOKEN'] = 'refresh';
}

test('a pass runs calendar inbound, write-back and gmail when Google is configured', async () => {
  configureGoogle();
  const calls: string[] = [];
  await runConnectorsOnce({
    store,
    log: silentLog,
    householdId: HH,
    now: () => new Date('2026-10-14T14:00:00Z'),
    calendarSync: async () => {
      calls.push('cal');
      return { fetched: 0, applied: [], skipped: [] };
    },
    calendarWriteback: async () => {
      calls.push('writeback');
      return { created: 0, updated: 0, unchanged: 0 };
    },
    gmailSync: async () => {
      calls.push('gmail');
      return { fetched: 0, applied: [], skipped: [] };
    },
  });
  assert.deepEqual(calls, ['cal', 'writeback', 'gmail']);
});

test('one connector failing does not stop the others (each is isolated)', async () => {
  configureGoogle();
  const calls: string[] = [];
  const errors: string[] = [];
  const log = {
    info() {},
    error(m: string) {
      errors.push(m);
    },
  };
  await runConnectorsOnce({
    store,
    log,
    householdId: HH,
    calendarSync: async () => {
      throw new Error('token expired');
    },
    calendarWriteback: async () => {
      calls.push('writeback');
      return { created: 0, updated: 0, unchanged: 0 };
    },
    gmailSync: async () => {
      calls.push('gmail');
      return { fetched: 0, applied: [], skipped: [] };
    },
  });
  // The calendar inbound threw, yet write-back and gmail still ran.
  assert.deepEqual(calls, ['writeback', 'gmail']);
  assert.ok(errors.some((e) => /calendar sync failed/.test(e)));
});

test('nothing runs when Google is not configured', async () => {
  for (const k of KEYS) delete process.env[k];
  let touched = false;
  await runConnectorsOnce({
    store,
    log: silentLog,
    householdId: HH,
    calendarSync: async () => {
      touched = true;
      return { fetched: 0, applied: [], skipped: [] };
    },
    calendarWriteback: async () => {
      touched = true;
      return { created: 0, updated: 0, unchanged: 0 };
    },
    gmailSync: async () => {
      touched = true;
      return { fetched: 0, applied: [], skipped: [] };
    },
  });
  assert.equal(touched, false);
});
