import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pilotReport, renderPilotReport } from './pilot-report.ts';
import { AGENT_ID } from './agent.ts';
import type { CareEvent, CareState, Obligation } from './types.ts';

// Lagos is UTC+1 all year, so 08:00 there is 07:00Z.
const H = 'h_pilot';
const FROM = new Date('2026-09-20T23:00:00Z'); // Monday 21 September, 00:00 in Lagos
const TO = new Date('2026-09-23T20:30:00Z'); // Wednesday 23 September, 21:30 in Lagos

let n = 0;
function event(
  e: Partial<CareEvent> & Pick<CareEvent, 'kind' | 'reportedBy' | 'occurredAt'>,
): CareEvent {
  n += 1;
  return {
    id: `evt_${n}`,
    householdId: H,
    recordedAt: e.occurredAt,
    data: {},
    source: 'voice',
    ...e,
  };
}

function dose(by: string, occurredAt: string, recordedAt = occurredAt): CareEvent {
  return event({
    kind: 'medication_taken',
    reportedBy: by,
    occurredAt,
    recordedAt,
    data: { medicationId: 'med_drops', aboutMemberId: 'm_daddy' },
  });
}

function obligation(
  o: Partial<Obligation> & Pick<Obligation, 'id' | 'status' | 'createdAt'>,
): Obligation {
  return {
    householdId: H,
    what: o.id,
    consequence: 'logistical',
    ownerId: null,
    provenance: { kind: 'CONFIRMED', byMemberId: 'm_tolu', at: o.createdAt },
    ...o,
  };
}

function week(): CareState {
  return {
    household: { id: H, name: 'Pilot', timezone: 'Africa/Lagos' },
    members: [
      { id: 'm_daddy', householdId: H, name: 'Daddy', role: 'care_recipient' },
      { id: 'm_tolu', householdId: H, name: 'Tolu', role: 'primary_caregiver' },
      { id: 'm_funmi', householdId: H, name: 'Funmi', role: 'caregiver' },
      {
        id: 'm_kunle',
        householdId: H,
        name: 'Kunle',
        role: 'caregiver',
        livesAway: 'London',
        dailyUpdate: true,
      },
    ],
    medications: [
      {
        id: 'med_drops',
        householdId: H,
        name: 'eye drops',
        times: ['08:00', '20:00'],
        forMemberId: 'm_daddy',
      },
    ],
    entities: [],
    obligations: [
      obligation({
        id: 'ride',
        status: 'ASSIGNED',
        ownerId: 'm_funmi',
        createdAt: '2026-09-22T08:00:00Z',
      }),
      obligation({
        id: 'guessed',
        status: 'DISMISSED',
        createdAt: '2026-09-23T09:00:00Z',
        provenance: { kind: 'INFERRED', rule: 'ring', from: 'evt_x' },
      }),
      obligation({ id: 'refill', status: 'OPEN', createdAt: '2026-09-23T10:00:00Z' }),
      obligation({ id: 'last-week', status: 'RESOLVED', createdAt: '2026-09-14T10:00:00Z' }),
    ],
    events: [
      dose('m_daddy', '2026-09-19T07:00:00Z'), // before the window
      dose('m_daddy', '2026-09-21T07:00:00Z', '2026-09-21T07:02:00Z'), // Mon 08:00, on time
      dose('m_funmi', '2026-09-21T19:10:00Z', '2026-09-21T21:15:00Z'), // Mon 20:00, logged at 22:15
      dose('m_daddy', '2026-09-22T07:05:00Z'), // Tue 08:00
      // Tue 20:00: no record
      dose('m_daddy', '2026-09-23T07:00:00Z'), // Wed 08:00
      // Wed 20:00: no record
      event({
        kind: 'owner_requested',
        reportedBy: AGENT_ID,
        occurredAt: '2026-09-22T09:00:00Z',
        source: 'system',
        data: { obligationId: 'ride', askedOfId: 'm_tolu' },
      }),
      event({
        kind: 'request_answered',
        reportedBy: 'm_tolu',
        occurredAt: '2026-09-22T09:30:00Z',
        source: 'telegram',
        data: { obligationId: 'ride', accepted: false },
      }),
      event({
        kind: 'owner_requested',
        reportedBy: AGENT_ID,
        occurredAt: '2026-09-22T09:31:00Z',
        source: 'system',
        data: { obligationId: 'ride', askedOfId: 'm_funmi' },
      }),
      event({
        kind: 'request_answered',
        reportedBy: 'm_funmi',
        occurredAt: '2026-09-22T10:31:00Z',
        source: 'telegram',
        data: { obligationId: 'ride', accepted: true },
      }),
      event({
        kind: 'owner_requested',
        reportedBy: 'm_tolu',
        occurredAt: '2026-09-23T10:05:00Z',
        data: { obligationId: 'refill', askedOfId: 'm_funmi' },
      }),
      event({
        kind: 'external_signal',
        reportedBy: 'device:ring',
        occurredAt: '2026-09-23T08:00:00Z',
        source: 'ring',
        data: { source: 'ring', signalKind: 'delivery_arrived' },
      }),
      event({
        kind: 'member_notified',
        reportedBy: AGENT_ID,
        occurredAt: '2026-09-22T20:00:00Z',
        source: 'system',
        data: { recipientId: 'm_kunle', update: 'daily' },
      }),
    ],
  };
}

test('doses are counted from the record, and a late record is told apart', () => {
  const r = pilotReport(week(), { from: FROM, to: TO });
  assert.equal(r.firstDay, '2026-09-21');
  assert.equal(r.lastDay, '2026-09-23');
  assert.equal(r.days, 3);
  assert.deepEqual(r.doses, {
    expected: 6,
    recorded: 4,
    noRecord: 2,
    loggedLate: 1,
    recordedBy: [
      { name: 'Daddy', count: 3 },
      { name: 'Funmi', count: 1 },
    ],
  });
});

test('asks are paired with their own answers, including a no that moved on to the next person', () => {
  const { work } = pilotReport(week(), { from: FROM, to: TO });
  assert.equal(work.asked, 3);
  assert.equal(work.askedByCareCircle, 2);
  assert.equal(work.declined, 1);
  assert.equal(work.accepted, 1);
  assert.equal(work.unanswered, 1);
  assert.equal(work.medianAnswerMinutes, 45); // 30 and 60
});

test('only work created in the window counts as new; unowned work is what is open now', () => {
  const { work } = pilotReport(week(), { from: FROM, to: TO });
  assert.equal(work.created, 3);
  assert.equal(work.proposed, 1);
  assert.equal(work.proposedDismissed, 1);
  assert.equal(work.proposedConfirmed, 0);
  assert.equal(work.stillUnowned, 1);
});

test('people, devices and CareCircle are kept apart', () => {
  const r = pilotReport(week(), { from: FROM, to: TO });
  assert.deepEqual(
    r.people.map((p) => p.name),
    ['Daddy', 'Funmi', 'Tolu'],
  );
  assert.deepEqual(r.people.find((p) => p.name === 'Funmi')?.channels, ['telegram', 'voice']);
  assert.deepEqual(r.signals, { total: 1, bySource: [{ source: 'ring', count: 1 }] });
  assert.deepEqual(r.eveningUpdates, { sent: 1, recipients: ['Kunle'] });
});

test('a window that starts mid-day does not count doses that were due before it', () => {
  const r = pilotReport(week(), { from: new Date('2026-09-21T12:00:00Z'), to: TO });
  assert.equal(r.doses.expected, 5);
});

test('a dose whose "no record" point has not passed yet is not counted', () => {
  const r = pilotReport(week(), { from: FROM, to: new Date('2026-09-23T19:30:00Z') }); // 20:30 Lagos
  assert.equal(r.doses.expected, 5);
});

test('the text never turns a missing record into a missed dose', () => {
  const text = renderPilotReport(pilotReport(week(), { from: FROM, to: TO }), 'Pilot');
  assert.match(text, /4 of 6 doses have a record \(Daddy 3, Funmi 1\)/);
  assert.match(text, /2 doses with no record\. Counted as "no record", never as missed\./);
  assert.match(
    text,
    /1 dose logged after the board already showed "no record"\. Calling it missed would have been wrong\./,
  );
  assert.match(
    text,
    /3 asks \(2 by CareCircle\): 1 yes, 1 no, 1 no answer; median answer in 45 minutes/,
  );
  assert.match(text, /Evening updates: 1 sent to Kunle/);
  assert.doesNotMatch(text, /\b(was|were) missed\b|didn't take|did not take|forgot/i);
});

test('an empty record says so plainly', () => {
  const state = { ...week(), events: [], obligations: [], medications: [] };
  const text = renderPilotReport(pilotReport(state, { from: FROM, to: TO }), 'Pilot');
  assert.match(text, /Nobody yet\./);
  assert.match(text, /No doses were due in this window\./);
});
