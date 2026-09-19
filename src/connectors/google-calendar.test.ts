import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CareStore } from '../store/store.ts';
import { syncCalendarEvents } from './google-calendar.ts';
import type { GoogleCalendarEvent } from '../domain/calendar.ts';

const HH = 'h1';
const NOW = new Date('2026-10-14T14:00:00Z'); // 10:00 New York
const store = new CareStore();

async function seed(): Promise<void> {
  await store.reset();
  await store.addHousehold({ id: HH, name: 'circle', timezone: 'America/New_York' });
  await store.addMember({ id: 'm_margaret', householdId: HH, name: 'Margaret', role: 'care_recipient' });
  await store.addMember({ id: 'm_david', householdId: HH, name: 'David', role: 'primary_caregiver' });
}
beforeEach(seed);

const cardiology = (over: Partial<GoogleCalendarEvent> = {}): GoogleCalendarEvent => ({
  id: 'gcal_card',
  status: 'confirmed',
  summary: 'Cardiology',
  updated: '2026-10-10T09:00:00Z',
  start: { dateTime: '2026-10-16T14:00:00-04:00' },
  ...over,
});

test('a real calendar event becomes an observed appointment with human-confirmable work', async () => {
  const r = await syncCalendarEvents(store, HH, [cardiology()], NOW);
  assert.equal(r.applied.length, 1);

  const state = store.getCareState(HH);
  const appt = state.events.find((e) => e.kind === 'appointment_scheduled');
  assert.ok(appt, 'an appointment event was recorded');
  assert.equal(appt!.source, 'calendar');
  assert.equal(appt!.confidence, 'observed', 'a calendar sync never records a confirmed fact');
  assert.equal(appt!.data['externalId'], 'gcal_card@2026-10-10T09:00:00Z');

  // The trust gate: every proposal the appointment implies is PROPOSED + INFERRED,
  // never OPEN and never CONFIRMED. A calendar cannot manufacture committed work.
  const obligations = state.obligations;
  assert.ok(obligations.length >= 1, 'a medical appointment proposes a ride');
  for (const o of obligations) {
    assert.equal(o.status, 'PROPOSED', `${o.what} should await confirmation`);
    assert.equal(o.provenance.kind, 'INFERRED', `${o.what} should be an inference`);
  }
});

test('re-polling the same unchanged event applies nothing (idempotent)', async () => {
  await syncCalendarEvents(store, HH, [cardiology()], NOW);
  const before = store.getCareState(HH).obligations.length;

  const r2 = await syncCalendarEvents(store, HH, [cardiology()], NOW);
  assert.equal(r2.applied.length, 0);
  assert.equal(r2.skipped[0]?.reason, 'already applied (unchanged)');
  assert.equal(store.getCareState(HH).obligations.length, before, 'no duplicate work created');
});

test('an edited event (new updated stamp) re-applies', async () => {
  await syncCalendarEvents(store, HH, [cardiology()], NOW);
  const r2 = await syncCalendarEvents(
    store, HH, [cardiology({ updated: '2026-10-12T09:00:00Z' })], NOW,
  );
  assert.equal(r2.applied.length, 1, 'a genuine change comes back through');
});

test('cancelled, all-day, and declined events are skipped with reasons', async () => {
  const r = await syncCalendarEvents(store, HH, [
    cardiology({ id: 'c1', status: 'cancelled' }),
    cardiology({ id: 'c2', start: { date: '2026-10-16' } }),
    cardiology({ id: 'c3', attendees: [{ self: true, responseStatus: 'declined' }] }),
  ], NOW);
  assert.equal(r.applied.length, 0);
  assert.equal(r.skipped.length, 3);
  assert.equal(store.getCareState(HH).obligations.length, 0);
});

test('a non-medical appointment is recorded but proposes no ride', async () => {
  const r = await syncCalendarEvents(store, HH, [cardiology({ summary: 'Book club' })], NOW);
  assert.equal(r.applied.length, 1);
  assert.equal(store.getCareState(HH).obligations.length, 0, 'book club needs no medical transport');
});
