import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calendarEventToAppointment,
  calendarIdempotencyKey,
  type GoogleCalendarEvent,
} from './calendar.ts';

const timed = (over: Partial<GoogleCalendarEvent> = {}): GoogleCalendarEvent => ({
  id: 'gcal_1',
  status: 'confirmed',
  summary: 'Cardiology',
  updated: '2026-10-10T09:00:00Z',
  start: { dateTime: '2026-10-16T14:00:00-04:00' },
  end: { dateTime: '2026-10-16T15:00:00-04:00' },
  ...over,
});

test('a real timed event becomes an appointment, observed and calendar-sourced', () => {
  const m = calendarEventToAppointment(timed({ location: 'Mercy Clinic', description: 'bring list' }));
  assert.equal(m.apply, true);
  if (!m.apply) return;
  assert.equal(m.input.kind, 'Cardiology');
  assert.equal(m.input.startsAt, '2026-10-16T14:00:00-04:00');
  assert.equal(m.input.source, 'calendar');
  // The load-bearing honesty: a calendar sync observed a plan; it did not confirm it.
  assert.equal(m.input.confidence, 'observed');
  assert.equal(m.input.externalId, 'gcal_1');
  assert.equal(m.input.detail, 'Mercy Clinic - bring list');
});

test('a cancelled event is not an appointment', () => {
  const m = calendarEventToAppointment(timed({ status: 'cancelled' }));
  assert.equal(m.apply, false);
  if (m.apply) return;
  assert.match(m.reason, /cancel/);
});

test('an all-day banner (no timed start) is dropped, not guessed at', () => {
  const m = calendarEventToAppointment(timed({ start: { date: '2026-10-16' }, end: { date: '2026-10-17' } }));
  assert.equal(m.apply, false);
  if (m.apply) return;
  assert.match(m.reason, /timed start/);
});

test('an event the calendar owner declined creates no work', () => {
  const m = calendarEventToAppointment(timed({
    attendees: [{ self: true, responseStatus: 'declined' }],
  }));
  assert.equal(m.apply, false);
  if (m.apply) return;
  assert.match(m.reason, /declined/);
});

test('an event another attendee declined is still the owner\'s appointment', () => {
  const m = calendarEventToAppointment(timed({
    attendees: [{ self: true, responseStatus: 'accepted' }, { responseStatus: 'declined' }],
  }));
  assert.equal(m.apply, true);
});

test('an untitled event has nothing to name, so it is skipped', () => {
  const m = calendarEventToAppointment(timed({ summary: '   ' }));
  assert.equal(m.apply, false);
});

test('idempotency key is id + last-updated, so an edit re-applies and a re-poll does not', () => {
  assert.equal(calendarIdempotencyKey(timed()), 'gcal_1@2026-10-10T09:00:00Z');
  // Same event, edited later -> a new key -> will re-apply.
  assert.equal(
    calendarIdempotencyKey(timed({ updated: '2026-10-11T09:00:00Z' })),
    'gcal_1@2026-10-11T09:00:00Z',
  );
  // No id -> nothing to key on.
  assert.equal(calendarIdempotencyKey(timed({ id: undefined })), null);
});
