import { test } from 'node:test';
import assert from 'node:assert/strict';
import { obligationToCalendarEvent, planCalendarWriteback } from './calendar-writeback.ts';
import type { Member, Obligation } from './types.ts';

const members: Member[] = [
  { id: 'm_margaret', householdId: 'h1', name: 'Margaret', role: 'care_recipient' },
  { id: 'm_david', householdId: 'h1', name: 'David', role: 'primary_caregiver' },
  { id: 'm_renee', householdId: 'h1', name: 'Renee', role: 'caregiver' },
];

const base = (over: Partial<Obligation> = {}): Obligation => ({
  id: 'obl_ride',
  householdId: 'h1',
  what: 'Drive Margaret to cardiology',
  status: 'ASSIGNED',
  consequence: 'medical',
  provenance: { kind: 'CONFIRMED', byMemberId: 'm_david', at: '2026-10-12T12:00:00Z' },
  ownerId: 'm_david',
  dueAt: '2026-10-16T18:00:00Z',
  createdAt: '2026-10-12T12:00:00Z',
  ...over,
});

test('an owned, dated obligation writes an event naming the owner', () => {
  const ev = obligationToCalendarEvent(base(), members);
  assert.ok(ev);
  assert.equal(ev!.summary, 'Drive Margaret to cardiology — David');
  assert.equal(ev!.start?.dateTime, '2026-10-16T18:00:00Z');
  // Google's insert API rejects a dateTime with no zone; the UTC ISO stamp is declared UTC.
  assert.equal(ev!.start?.timeZone, 'UTC');
  assert.equal(ev!.end?.timeZone, 'UTC');
  assert.equal(ev!.extendedProperties?.private?.['carecircleObligationId'], 'obl_ride');
  // The loop-guard tag - inbound must skip anything carrying this.
  assert.equal(ev!.extendedProperties?.private?.['carecircleSource'], 'carecircle');
});

test('the calendar entry never claims more than the record: asked is not owned', () => {
  const requested = base({
    status: 'REQUESTED',
    ownerId: null,
    request: { askedOfId: 'm_renee', askedById: 'm_david', at: '2026-10-13T12:00:00Z' },
  });
  assert.match(obligationToCalendarEvent(requested, members)!.summary!, /asked Renee/);

  const open = base({ status: 'OPEN', ownerId: null });
  assert.match(obligationToCalendarEvent(open, members)!.summary!, /needs an owner/);
});

test('a PROPOSED guess and undated work are never written', () => {
  assert.equal(obligationToCalendarEvent(base({ status: 'PROPOSED' }), members), null);
  assert.equal(obligationToCalendarEvent(base({ dueAt: undefined }), members), null);
  assert.equal(obligationToCalendarEvent(base({ status: 'DISMISSED' }), members), null);
  assert.equal(obligationToCalendarEvent(base({ status: 'RESOLVED' }), members), null);
});

test('planning creates new events and patches only changed ones', () => {
  const owned = base(); // obl_ride, David, ASSIGNED
  const other = base({
    id: 'obl_pickup',
    what: 'Pick up prescription',
    status: 'OPEN',
    ownerId: null,
  });

  // obl_ride already on the calendar but with the OLD (asked) summary; obl_pickup new.
  const existing = new Map([
    [
      'obl_ride',
      {
        eventId: 'gc_1',
        summary: 'Drive Margaret to cardiology — asked Renee',
        start: '2026-10-16T18:00:00Z',
      },
    ],
  ]);

  const plan = planCalendarWriteback([owned, other], members, existing);
  assert.equal(plan.updates.length, 1, 'the owner changed, so the existing event is patched');
  assert.equal(plan.updates[0]!.eventId, 'gc_1');
  assert.equal(plan.creates.length, 1, 'the new obligation gets a fresh event');
  assert.equal(plan.creates[0]!.obligationId, 'obl_pickup');
});

test('an unchanged obligation is left untouched (idempotent)', () => {
  const owned = base();
  const existing = new Map([
    [
      'obl_ride',
      {
        eventId: 'gc_1',
        summary: 'Drive Margaret to cardiology — David',
        start: '2026-10-16T18:00:00Z',
      },
    ],
  ]);
  const plan = planCalendarWriteback([owned], members, existing);
  assert.equal(plan.creates.length, 0);
  assert.equal(plan.updates.length, 0);
});

test('the same time written differently by Google is not a change', () => {
  // The record keeps milliseconds; Google reads the time back without them, or in the
  // calendar's own offset. Prod patched the same two events every five minutes over this.
  const owned = base({ dueAt: '2026-10-16T18:00:00.000Z' });
  for (const start of ['2026-10-16T18:00:00Z', '2026-10-16T19:00:00+01:00']) {
    const existing = new Map([
      ['obl_ride', { eventId: 'gc_1', summary: 'Drive Margaret to cardiology — David', start }],
    ]);
    const plan = planCalendarWriteback([owned], members, existing);
    assert.equal(plan.updates.length, 0, `${start} is the same moment`);
  }

  const moved = new Map([
    [
      'obl_ride',
      {
        eventId: 'gc_1',
        summary: 'Drive Margaret to cardiology — David',
        start: '2026-10-16T17:00:00Z',
      },
    ],
  ]);
  assert.equal(planCalendarWriteback([owned], members, moved).updates.length, 1);
});
