import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createCareCircleApp } from './app.ts';
import { CareStore } from '../store/store.ts';
import { asReadBy, medicineName, namesMedicine } from '../domain/language.ts';
import { dueReminders } from '../domain/reminders.ts';
import { chooseRefill } from '../domain/commerce.ts';

/**
 * A family in two languages: Mom reads Portuguese and calls her drops "colírio"; her son
 * reads English and calls them "eye drops". The family gives the medicine its name in each
 * language, once. From then on each of them hears it by their own word, and Mom's word is
 * matched the first time she says it - no translation of ours anywhere.
 */

let server: Server | undefined;
afterEach(() => server?.close());

const NOW = new Date('2026-09-24T19:00:00Z'); // 3 PM in New York: the 8 AM dose has passed

async function family(): Promise<{ store: CareStore; base: string }> {
  const store = new CareStore();
  await store.addHousehold({ id: 'h', name: 'Our circle', timezone: 'America/New_York' });
  await store.addMember({
    id: 'm_mom',
    householdId: 'h',
    name: 'Rosa',
    role: 'care_recipient',
    spokenAs: 'Mom',
    language: 'pt',
  });
  await store.addMember({
    id: 'm_son',
    householdId: 'h',
    name: 'Daniel',
    role: 'primary_caregiver',
  });
  await store.addMedication({
    id: 'med',
    householdId: 'h',
    name: 'eye drops',
    times: ['08:00', '20:00'],
    forMemberId: 'm_mom',
    since: '2026-09-24T04:00:00Z',
  });
  const app = createCareCircleApp({
    store,
    now: () => NOW,
    tokens: new Map([
      ['mom', 'm_mom'],
      ['son', 'm_son'],
    ]),
  });
  server = app.listen(0);
  await new Promise<void>((r) => server!.once('listening', r));
  return { store, base: `http://127.0.0.1:${(server!.address() as AddressInfo).port}/mcp` };
}

async function call(base: string, as: string, name: string, args: Record<string, unknown>) {
  const c = new Client({ name: 'medicine-names-test', version: '1' });
  await c.connect(
    new StreamableHTTPClientTransport(new URL(base), {
      requestInit: { headers: { Authorization: `Bearer ${as}` } },
    }),
  );
  try {
    await c.listTools();
    const out = await c.callTool({ name, arguments: args });
    return {
      isError: out.isError === true,
      text: (out.content as { text: string }[]).map((p) => p.text).join(' '),
      data: (out.structuredContent ?? {}) as Record<string, unknown>,
    };
  } finally {
    await c.close();
  }
}

test('the family names a medicine in another language; the record keeps its own name', async () => {
  const { store, base } = await family();
  const r = await call(base, 'son', 'change_medication', {
    medicationName: 'eye drops',
    alsoCalled: [{ language: 'pt', name: 'colírio' }],
  });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Mom's eye drops can also be called "colírio" in Portuguese \(Brazil\)\./);
  const med = store.getCareState('h').medications[0]!;
  assert.equal(med.name, 'eye drops');
  assert.deepEqual(med.names, { pt: 'colírio' });

  // A second language adds to the first; it never replaces it.
  await call(base, 'son', 'change_medication', {
    medicationName: 'colírio',
    alsoCalled: [{ language: 'es', name: 'gotas' }],
  });
  assert.deepEqual(store.getCareState('h').medications[0]!.names, { pt: 'colírio', es: 'gotas' });
  // Times and course are untouched by a name.
  assert.deepEqual(store.getCareState('h').medications[0]!.times, ['08:00', '20:00']);
});

test("Mom's own word is matched on the first call, however it is written", async () => {
  const { store, base } = await family();
  await store.updateMedication('med', 'h', { names: { pt: 'colírio' } });
  // No accent, a capital letter: what a voice transcript or a phone keyboard gives.
  const r = await call(base, 'mom', 'log_care_event', {
    kind: 'medication_taken',
    medicationName: 'Colirio',
  });
  assert.equal(r.isError, false, r.text);
  const dose = store.getCareState('h').events.find((e) => e.kind === 'medication_taken')!;
  assert.equal(
    dose.data['medicationId'],
    'med',
    'counted against her scheduled drops, not saved as a stray',
  );
});

test("each reader hears the medicine by their own family's word", async () => {
  const { store, base } = await family();
  await store.updateMedication('med', 'h', { names: { pt: 'colírio' } });

  // Before anything is logged, the son hears "eye drops" in the gap, Mom hears "colírio".
  const gaps = await call(base, 'son', 'get_care_gaps', {});
  assert.match(gaps.text, /eye drops/);
  assert.doesNotMatch(gaps.text, /colírio/);
  const brief = await call(base, 'mom', 'get_shift_brief', {});
  assert.match(brief.text, /Medications today: colírio at 8 AM and 8 PM\./);

  // Mom logs in her words; her son is told in his.
  await call(base, 'mom', 'log_care_event', {
    kind: 'medication_taken',
    medicationName: 'colírio',
  });
  const summary = await call(base, 'son', 'get_care_summary', {});
  assert.match(summary.text, /Logged today: eye drops at 3:00 PM\./);
  const after = await call(base, 'son', 'get_care_gaps', {});
  assert.deepEqual(
    (after.data['recordedToday'] as { what: string }[]).map((r) => r.what),
    ['eye drops'],
    'the medicine by its name, not by the words it was logged in',
  );
  const hers = await call(base, 'mom', 'get_shift_brief', {});
  assert.match(hers.text, /Recorded so far today: colírio at 3:00 PM\./);

  // Reading never wrote: the record still has its own name.
  assert.equal(store.getCareState('h').medications[0]!.name, 'eye drops');
});

test('add_medication takes the names at the start', async () => {
  const { store, base } = await family();
  const r = await call(base, 'son', 'add_medication', {
    name: 'vitamin D',
    times: ['09:00'],
    forMemberId: 'Mom',
    alsoCalled: [{ language: 'pt', name: 'vitamina D' }],
  });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Added vitamin D \(also called "vitamina D"\) at 09:00\./);
  assert.deepEqual(store.getCareState('h').medications.find((m) => m.name === 'vitamin D')!.names, {
    pt: 'vitamina D',
  });
});

test("a language without a name falls back to the record's name; a blank name is ignored", () => {
  const med = { name: 'eye drops', names: { pt: 'colírio', es: '  ' } };
  assert.equal(medicineName(med, 'pt'), 'colírio');
  assert.equal(medicineName(med, 'es'), 'eye drops');
  assert.equal(medicineName(med, 'fr'), 'eye drops');
  assert.equal(medicineName(med, undefined), 'eye drops');
  assert.equal(namesMedicine('my colírio', med), true);
  assert.equal(namesMedicine('EYE DROPS', med), true);
  assert.equal(namesMedicine('paracetamol', med), false);
  assert.equal(namesMedicine('   ', med), false);
});

test("the reader's view is a copy: the record underneath is never renamed", async () => {
  const { store } = await family();
  await store.updateMedication('med', 'h', { names: { pt: 'colírio' } });
  const state = store.getCareState('h');
  assert.equal(asReadBy(state, 'pt').medications[0]!.name, 'colírio');
  assert.equal(state.medications[0]!.name, 'eye drops');
  assert.equal(
    asReadBy(state, 'en'),
    state,
    'no name in that language: the same record, untouched',
  );
});

test('the dose reminder uses her word, with none of ours', async () => {
  const { store } = await family();
  await store.updateMedication('med', 'h', { names: { pt: 'colírio' } });
  const at8pm = new Date('2026-09-25T00:05:00Z'); // 8:05 PM in New York
  const [reminder] = dueReminders(store.getCareState('h'), at8pm);
  assert.ok(reminder);
  assert.match(reminder.text, /hora do remédio: colírio\./);
});

test("a refill asked for by the family's other word finds the medicine on the record", () => {
  const choice = chooseRefill(
    'her colírio',
    [{ name: 'eye drops', names: { pt: 'colírio' } }, { name: 'supplement' }],
    [],
  );
  assert.deepEqual(choice, { ok: true, itemName: 'eye drops' });
});

test('a dose with no medicine named is asked about, not saved as "the undefined" (found by fuzz.props)', async () => {
  const { store, base } = await family();
  const before = store.getCareState('h').events.length;
  const r = await call(base, 'son', 'log_care_event', {
    kind: 'medication_taken',
    aboutMemberId: 'Mom',
  });
  assert.match(
    r.text,
    /^Which medicine was it\? Mom's schedule has: "eye drops"\. Ask them, then call this again with that name\.$/,
  );
  assert.equal(
    store.getCareState('h').events.length,
    before,
    'nothing is saved until the name is settled',
  );

  // Nobody on the schedule: the dose is still noted, in words a voice can say.
  await store.addMember({ id: 'm_aunt', householdId: 'h', name: 'Ada', role: 'care_recipient' });
  const aunt = await call(base, 'son', 'log_care_event', {
    kind: 'medication_taken',
    aboutMemberId: 'Ada',
  });
  assert.equal(aunt.isError, false, aunt.text);
  assert.equal(aunt.text, "Got it, I've noted the medicine.");
});
