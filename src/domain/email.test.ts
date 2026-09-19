import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIcs, parseIcsDate, emailToAppointment, type EmailMessage } from './email.ts';

const TZ = 'America/New_York';

const ics = (over: { dtstart?: string; summary?: string; uid?: string; location?: string } = {}): string => [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  `UID:${over.uid ?? 'abc@clinic'}`,
  `SUMMARY:${over.summary ?? 'Cardiology'}`,
  ...(over.location ? [`LOCATION:${over.location}`] : []),
  over.dtstart ?? 'DTSTART:20261016T180000Z',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('a UTC DTSTART parses to that instant', () => {
  assert.equal(parseIcsDate('20261016T180000Z', {}, TZ), '2026-10-16T18:00:00.000Z');
});

test('a floating local DTSTART is read in the household zone', () => {
  // 14:00 local in New York (EDT, -04:00) is 18:00 UTC.
  assert.equal(parseIcsDate('20261016T140000', {}, TZ), '2026-10-16T18:00:00.000Z');
});

test('a zoned DTSTART uses its TZID, not the household zone', () => {
  // 14:00 Los Angeles (PDT, -07:00) is 21:00 UTC, regardless of the NY household.
  assert.equal(parseIcsDate('20261016T140000', { TZID: 'America/Los_Angeles' }, TZ), '2026-10-16T21:00:00.000Z');
});

test('an all-day (date-only) DTSTART is not a timed appointment', () => {
  assert.equal(parseIcsDate('20261016', { VALUE: 'DATE' }, TZ), null);
  assert.equal(parseIcsDate('20261016', {}, TZ), null);
});

test('parseIcs pulls summary, uid and start from the first VEVENT', () => {
  const ev = parseIcs(ics({ location: 'Mercy Clinic' }), TZ);
  assert.ok(ev);
  assert.equal(ev!.summary, 'Cardiology');
  assert.equal(ev!.uid, 'abc@clinic');
  assert.equal(ev!.location, 'Mercy Clinic');
  assert.equal(ev!.startsAt, '2026-10-16T18:00:00.000Z');
});

test('line folding is unfolded before properties are read', () => {
  const folded = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Cardiology fol\r\n low-up\r\nDTSTART:20261016T180000Z\r\nEND:VEVENT\r\nEND:VCALENDAR';
  assert.equal(parseIcs(folded, TZ)!.summary, 'Cardiology follow-up');
});

test('an email with an invite becomes an observed, email-sourced appointment', () => {
  const email: EmailMessage = { messageId: 'm1', from: 'clinic@mercy.com', subject: 'Your visit', icsText: ics() };
  const m = emailToAppointment(email, TZ);
  assert.equal(m.apply, true);
  if (!m.apply) return;
  assert.equal(m.input.kind, 'Cardiology');
  assert.equal(m.input.startsAt, '2026-10-16T18:00:00.000Z');
  assert.equal(m.input.source, 'email');
  assert.equal(m.input.confidence, 'observed');
  assert.equal(m.input.externalId, 'email:abc@clinic');
});

test('an email with no invite is skipped, never date-guessed from prose', () => {
  const m = emailToAppointment({ messageId: 'm2', subject: 'see you thursday-ish' }, TZ);
  assert.equal(m.apply, false);
  if (m.apply) return;
  assert.match(m.reason, /no calendar invite/);
});

test('an all-day invite is skipped rather than turned into a timed appointment', () => {
  const m = emailToAppointment({ messageId: 'm3', icsText: ics({ dtstart: 'DTSTART;VALUE=DATE:20261016' }) }, TZ);
  assert.equal(m.apply, false);
});

test('the subject names the appointment when the invite has no summary', () => {
  // No UID in this invite, so idempotency must fall back to the Gmail message id.
  const noSummary = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART:20261016T180000Z', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const m = emailToAppointment({ messageId: 'm4', subject: 'Dentist cleaning', icsText: noSummary }, TZ);
  assert.equal(m.apply, true);
  if (!m.apply) return;
  assert.equal(m.input.kind, 'Dentist cleaning');
  assert.equal(m.input.externalId, 'email:m4');
});
