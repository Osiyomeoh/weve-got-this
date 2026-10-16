import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createCareCircleApp } from './app.ts';
import { CareStore } from '../store/store.ts';
import { composeDailyUpdate } from '../domain/daily-update.ts';
import { systemPrompt, SYSTEM_PROMPT_RULES } from '../sim/host.ts';

/**
 * A family caring for two people: Dad after surgery, and Grandma. Anything filed under
 * the wrong one would look right on the record, so when nobody says who, the app asks.
 */

let server: Server | undefined;
afterEach(() => server?.close());

async function family(): Promise<{ store: CareStore; base: string }> {
  const store = new CareStore();
  await store.addHousehold({ id: 'h2', name: 'Our circle', timezone: 'Africa/Lagos' });
  await store.addMember({
    id: 'm_dad',
    householdId: 'h2',
    name: 'Pius',
    role: 'care_recipient',
    spokenAs: 'Dad',
  });
  await store.addMember({
    id: 'm_gma',
    householdId: 'h2',
    name: 'Grace',
    role: 'care_recipient',
    spokenAs: 'Grandma',
  });
  await store.addMember({ id: 'm_sam', householdId: 'h2', name: 'Sam', role: 'primary_caregiver' });
  await store.addMedication({
    id: 'med_dad',
    householdId: 'h2',
    name: 'eye drops',
    times: ['08:00'],
    forMemberId: 'm_dad',
  });
  await store.addMedication({
    id: 'med_gma',
    householdId: 'h2',
    name: 'eye drops',
    times: ['09:00'],
    forMemberId: 'm_gma',
  });
  const app = createCareCircleApp({
    store,
    now: () => new Date('2026-09-24T12:00:00Z'),
    tokens: new Map([['sam', 'm_sam']]),
  });
  server = app.listen(0);
  await new Promise<void>((r) => server!.once('listening', r));
  return { store, base: `http://127.0.0.1:${(server!.address() as AddressInfo).port}/mcp` };
}

async function call(base: string, name: string, args: Record<string, unknown>) {
  const c = new Client({ name: 'two-people-test', version: '1' });
  await c.connect(
    new StreamableHTTPClientTransport(new URL(base), {
      requestInit: { headers: { Authorization: 'Bearer sam' } },
    }),
  );
  try {
    await c.listTools();
    const out = await c.callTool({ name, arguments: args });
    return {
      isError: out.isError === true,
      text: (out.content as { text: string }[]).map((p) => p.text).join(' '),
    };
  } finally {
    await c.close();
  }
}

test('an appointment nobody placed is asked about, never filed under whoever is first', async () => {
  const { store, base } = await family();
  const r = await call(base, 'record_appointment', {
    kind: 'eye check-up',
    startsAt: '2026-10-02T10:00:00',
  });
  assert.match(r.text, /Ask who this appointment is for: Dad or Grandma\./);
  assert.equal(store.getCareState('h2').events.length, 0, 'nothing recorded');

  const ok = await call(base, 'record_appointment', {
    kind: 'eye check-up',
    startsAt: '2026-10-02T10:00:00',
    forMemberId: 'Grandma',
  });
  assert.equal(ok.isError, false, ok.text);
  assert.equal(store.getCareState('h2').events.at(-1)!.data?.['forMemberId'], 'm_gma');
});

test("a name the circle doesn't know is questioned, with the names it does know", async () => {
  const { base } = await family();
  const r = await call(base, 'record_appointment', {
    kind: 'dentist',
    startsAt: '2026-10-02T10:00:00',
    forMemberId: 'Auntie',
  });
  assert.match(
    r.text,
    /I don't know who "Auntie" is in this circle\. Ask whether they meant Dad or Grandma\./,
  );
});

test('medicines and doses go to the person named, and the same medicine name is told apart', async () => {
  const { store, base } = await family();
  const unsure = await call(base, 'add_medication', { name: 'vitamin D', times: ['09:00'] });
  assert.match(unsure.text, /Ask who this medication is for: Dad or Grandma\./);
  await call(base, 'add_medication', { name: 'vitamin D', times: ['09:00'], forMemberId: 'Dad' });
  assert.equal(
    store.getMedications('h2').find((m) => m.name === 'vitamin D')!.forMemberId,
    'm_dad',
  );

  const dose = await call(base, 'log_care_event', {
    kind: 'medication_taken',
    medicationName: 'eye drops',
    aboutMemberId: 'Grandma',
  });
  assert.equal(dose.isError, false, dose.text);
  const e = store.getCareState('h2').events.at(-1)!;
  assert.equal(e.data?.['aboutMemberId'], 'm_gma');
  assert.equal(e.data?.['medicationId'], 'med_gma', "Grandma's drops, not Dad's");
});

test('the evening update covers everyone, and says whose each medicine is', async () => {
  const { store } = await family();
  const text = composeDailyUpdate(store.getCareState('h2'), new Date('2026-09-24T20:30:00Z'));
  assert.match(text, /^The evening update/);
  assert.match(text, /- eye drops \(Dad\), 8 AM: no record yet/);
  assert.match(text, /- eye drops \(Grandma\), 9 AM: no record yet/);
});

test('the chat knows the circle and writes like a person; voice is unchanged', () => {
  const speaker = {
    name: 'Sam',
    role: 'primary_caregiver',
    circle: [
      { name: 'Pius', spokenAs: 'Dad', role: 'care_recipient' },
      { name: 'Kunle', role: 'caregiver', livesAway: 'London' },
    ],
  };
  const chat = systemPrompt({ speaker, channel: 'chat', timezone: 'Africa/Lagos' });
  assert.match(chat, /- Pius \("Dad"\): being cared for/);
  assert.match(chat, /- Kunle: family, lives in London/);
  assert.match(chat, /Nigerian Pidgin/);
  const voice = systemPrompt({ speaker, timezone: 'Africa/Lagos' });
  assert.ok(
    voice.startsWith(SYSTEM_PROMPT_RULES),
    'the voice prompt the evals measure is untouched',
  );
  assert.doesNotMatch(voice, /messaging app|Pius/);
});

test('logging a dose that is already on the record says so, with when and who', async () => {
  const { store, base } = await family();
  await store.appendEvent({
    householdId: 'h2',
    kind: 'medication_taken',
    reportedBy: 'm_dad',
    occurredAt: '2026-09-24T07:05:00.000Z', // 8:05 AM Lagos
    source: 'voice',
    confidence: 'reported',
    data: { medicationId: 'med_dad', medicationName: 'eye drops', aboutMemberId: 'm_dad' },
  });
  const again = await call(base, 'log_care_event', {
    kind: 'medication_taken',
    medicationName: 'eye drops',
    aboutMemberId: 'Dad',
    occurredAt: '2026-09-24T08:30:00',
  });
  assert.equal(again.isError, false, again.text);
  assert.match(
    again.text,
    /Just so you know, there was already a record of the 8 AM dose, at 8:05 AM, from Dad\. If that was the same dose, say so and I'll note it\./,
  );

  const grandma = await call(base, 'log_care_event', {
    kind: 'medication_taken',
    medicationName: 'eye drops',
    aboutMemberId: 'Grandma',
    occurredAt: '2026-09-24T08:40:00',
  });
  assert.doesNotMatch(grandma.text, /already a record/, "Grandma's drops are a different dose");
});

test('a medicine said in another language or other words is matched to the schedule, never saved as a stray', async () => {
  const { store, base } = await family();
  const doses = () => store.getCareState('h2').events.filter((e) => e.kind === 'medication_taken');

  // "Colírio" is Portuguese for eye drops. Saved as a stray it would never clear Dad's dose,
  // and the family would be told there is no record of a dose he took.
  const r = await call(base, 'log_care_event', {
    kind: 'medication_taken',
    medicationName: 'colírio',
    aboutMemberId: 'Dad',
  });
  assert.match(r.text, /"colírio" is not a name on Dad's schedule, which has: "eye drops"\./);
  assert.equal(doses().length, 0, 'nothing saved until the name is settled');

  const ok = await call(base, 'log_care_event', {
    kind: 'medication_taken',
    medicationName: 'eye drops',
    aboutMemberId: 'Dad',
  });
  assert.equal(ok.isError, false, ok.text);
  assert.equal(doses().at(-1)!.data['medicationId'], 'med_dad');

  // A real one-off, once they have said so, is kept.
  const once = await call(base, 'log_care_event', {
    kind: 'medication_taken',
    medicationName: 'paracetamol',
    aboutMemberId: 'Dad',
    notOnSchedule: true,
  });
  assert.equal(once.isError, false, once.text);
  assert.equal(doses().at(-1)!.data['medicationName'], 'paracetamol');
  assert.equal(doses().at(-1)!.data['medicationId'], undefined);
});
