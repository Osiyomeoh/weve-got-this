import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CareStore } from '../store/store.ts';
import { syncEmailAppointments } from './gmail.ts';
import type { EmailMessage } from '../domain/email.ts';

const HH = 'h1';
const NOW = new Date('2026-10-14T14:00:00Z');
const store = new CareStore();

async function seed(): Promise<void> {
  await store.reset();
  await store.addHousehold({ id: HH, name: 'circle', timezone: 'America/New_York' });
  await store.addMember({
    id: 'm_margaret',
    householdId: HH,
    name: 'Margaret',
    role: 'care_recipient',
  });
}
beforeEach(seed);

const invite = (over: { summary?: string; uid?: string } = {}): string =>
  [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    `UID:${over.uid ?? 'inv1@clinic'}`,
    `SUMMARY:${over.summary ?? 'Cardiology'}`,
    'DTSTART:20261016T180000Z',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

const email = (over: Partial<EmailMessage> = {}): EmailMessage => ({
  messageId: 'm1',
  from: 'clinic@mercy.com',
  subject: 'Your appointment',
  icsText: invite(),
  ...over,
});

test('an invite email becomes an observed appointment with confirmable work', async () => {
  const r = await syncEmailAppointments(store, HH, [email()], NOW);
  assert.equal(r.applied.length, 1);

  const state = store.getCareState(HH);
  const appt = state.events.find((e) => e.kind === 'appointment_scheduled');
  assert.ok(appt);
  assert.equal(appt!.source, 'email');
  assert.equal(appt!.confidence, 'observed');
  // The trust gate again: implied work is PROPOSED + INFERRED, never asserted.
  for (const o of state.obligations) {
    assert.equal(o.status, 'PROPOSED');
    assert.equal(o.provenance.kind, 'INFERRED');
  }
});

test('re-processing the same invite creates nothing (idempotent by UID)', async () => {
  await syncEmailAppointments(store, HH, [email()], NOW);
  const before = store.getCareState(HH).obligations.length;
  const r2 = await syncEmailAppointments(store, HH, [email({ messageId: 'm1-redelivered' })], NOW);
  assert.equal(r2.applied.length, 0);
  assert.equal(store.getCareState(HH).obligations.length, before);
});

test('an email with no invite is skipped, not guessed at', async () => {
  const r = await syncEmailAppointments(
    store,
    HH,
    [email({ icsText: undefined, subject: 'call me thursday' })],
    NOW,
  );
  assert.equal(r.applied.length, 0);
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0]!.reason, /no calendar invite/);
});
