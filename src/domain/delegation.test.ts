import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidatesFor, clashFor, loadOf, statedUnavailable } from './delegation.ts';
import { detectCareGaps } from './gaps.ts';
import type { CareEvent, CareState, Obligation } from './types.ts';

const NOW = new Date('2026-10-15T18:00:00Z');
/** Other work, on a day that does not touch the cardiology drive's. */
const ANOTHER_DAY = '2026-10-18T14:00:00Z';

function baseState(over: Partial<CareState> = {}): CareState {
  return {
    household: { id: 'h1', name: "Margaret's circle", timezone: 'America/New_York' },
    members: [
      {
        id: 'm_margaret',
        householdId: 'h1',
        name: 'Margaret',
        role: 'care_recipient',
        spokenAs: 'Mom',
      },
      { id: 'm_david', householdId: 'h1', name: 'David', role: 'primary_caregiver' },
      { id: 'm_renee', householdId: 'h1', name: 'Renee', role: 'caregiver' },
      { id: 'm_tasha', householdId: 'h1', name: 'Tasha', role: 'helper' },
    ],
    events: [],
    obligations: [],
    medications: [],
    ...over,
  };
}

function obligation(over: Partial<Obligation> = {}): Obligation {
  return {
    id: 'o1',
    householdId: 'h1',
    what: 'Drive Margaret to cardiology',
    status: 'OPEN',
    consequence: 'medical',
    provenance: { kind: 'CONFIRMED', byMemberId: 'm_renee', at: '2026-10-13T12:00:00Z' },
    ownerId: null,
    createdAt: '2026-10-13T12:00:00Z',
    dueAt: '2026-10-16T14:00:00Z',
    ...over,
  };
}

function unavailabilityEvent(memberName: string, from: string, to: string): CareEvent {
  return {
    id: 'e_unavail',
    householdId: 'h1',
    kind: 'note_added',
    reportedBy: 'm_david',
    occurredAt: '2026-10-14T12:00:00Z',
    recordedAt: '2026-10-14T12:00:00Z',
    data: { unavailable: { memberName, from, to } },
  };
}

test('the person being cared for is never a candidate to drive herself', () => {
  const names = candidatesFor(obligation(), baseState()).map((c) => c.name);
  assert.ok(!names.includes('Mom'));
});

test('whoever is asking is not offered as the answer', () => {
  const names = candidatesFor(obligation(), baseState(), { askerId: 'm_david' }).map((c) => c.name);
  assert.ok(!names.includes('David'));
  assert.ok(names.includes('Renee'));
});

test('the person carrying least ranks first', () => {
  // The failure mode families actually have is everything landing on whoever
  // answers fastest. Load comes before role for exactly that reason.
  const state = baseState({
    obligations: [
      obligation(),
      obligation({ id: 'o2', status: 'ASSIGNED', ownerId: 'm_david', dueAt: ANOTHER_DAY }),
      obligation({ id: 'o3', status: 'ASSIGNED', ownerId: 'm_david', dueAt: ANOTHER_DAY }),
      obligation({ id: 'o4', status: 'ASSIGNED', ownerId: 'm_renee', dueAt: ANOTHER_DAY }),
    ],
  });
  const ranked = candidatesFor(obligation(), state);
  assert.equal(ranked[0]!.name, 'Renee');
  assert.equal(ranked[0]!.load, 1);
  assert.equal(loadOf('m_david', state), 2);
});

test('the paid aide is asked only after the family has run out', () => {
  // Tasha starts every week empty, so ranking on load alone would hand her the
  // cardiology drive ahead of both of Margaret's children.
  const busyFamily = baseState({
    obligations: [
      obligation({ id: 'o2', status: 'ASSIGNED', ownerId: 'm_david', dueAt: ANOTHER_DAY }),
      obligation({ id: 'o3', status: 'ASSIGNED', ownerId: 'm_renee', dueAt: ANOTHER_DAY }),
    ],
  });
  const ranked = candidatesFor(obligation(), busyFamily);
  assert.equal(ranked.at(-1)!.name, 'Tasha');
  assert.equal(loadOf('m_tasha', busyFamily), 0);

  // But she is still there when nobody else is left.
  const onlyTasha = candidatesFor(obligation({ declinedBy: ['m_david', 'm_renee'] }), busyFamily);
  assert.equal(onlyTasha[0]!.name, 'Tasha');
});

test('somebody who already said no is not asked again', () => {
  const ranked = candidatesFor(obligation({ declinedBy: ['m_david', 'm_renee'] }), baseState());
  const names = ranked.map((c) => c.name);
  assert.ok(!names.includes('David'));
  assert.ok(!names.includes('Renee'));
  assert.ok(names.includes('Tasha'));
});

test('a stated conflict at the due time takes someone out of the running', () => {
  const state = baseState({
    events: [unavailabilityEvent('David', '2026-10-16T12:00:00Z', '2026-10-16T20:00:00Z')],
  });
  assert.equal(statedUnavailable(state.members[1]!, state, '2026-10-16T14:00:00Z'), true);
  assert.ok(
    !candidatesFor(obligation(), state)
      .map((c) => c.name)
      .includes('David'),
  );
});

test('a conflict at a different time leaves them eligible', () => {
  // Not knowing someone's plans is not evidence they are busy.
  const state = baseState({
    events: [unavailabilityEvent('David', '2026-10-20T12:00:00Z', '2026-10-20T20:00:00Z')],
  });
  assert.ok(
    candidatesFor(obligation(), state)
      .map((c) => c.name)
      .includes('David'),
  );
});

test('an alias is matched, so "Mom said David is away" still counts', () => {
  const state = baseState({
    events: [unavailabilityEvent('david', '2026-10-16T12:00:00Z', '2026-10-16T20:00:00Z')],
  });
  assert.ok(
    !candidatesFor(obligation(), state)
      .map((c) => c.name)
      .includes('David'),
  );
});

test('running out of people is said plainly rather than crashing', () => {
  const ranked = candidatesFor(
    obligation({ declinedBy: ['m_david', 'm_renee', 'm_tasha'] }),
    baseState(),
  );
  assert.deepEqual(ranked, []);
});

test('every candidate carries a reason that can be spoken aloud', () => {
  for (const c of candidatesFor(obligation(), baseState())) {
    assert.match(c.because, /^has /);
    assert.ok(!/undefined|null|NaN/.test(c.because));
  }
});

// --- the loop's central promise ------------------------------------------

test('being asked is not being assigned: it is still a care gap', () => {
  const gaps = detectCareGaps(
    baseState({
      obligations: [
        obligation({
          status: 'REQUESTED',
          ownerId: null,
          request: { askedOfId: 'm_david', askedById: 'm_renee', askedAt: '2026-10-15T17:00:00Z' },
        }),
      ],
    }),
    { now: NOW },
  );
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0]!.kind, 'UNCLAIMED');
});

test('an unanswered request is spoken as asked, never as agreed', () => {
  const gaps = detectCareGaps(
    baseState({
      obligations: [
        obligation({
          status: 'REQUESTED',
          ownerId: null,
          request: { askedOfId: 'm_david', askedById: 'm_renee', askedAt: '2026-10-15T17:00:00Z' },
        }),
      ],
    }),
    { now: NOW },
  );
  assert.match(gaps[0]!.spoken, /David was asked and hasn't answered yet/);
  // The words that would turn a question into a commitment.
  assert.ok(!/is taking|will take|has it|agreed|confirmed/i.test(gaps[0]!.spoken));
});

test('a fresh ask lowers the risk; a stale one gives the relief back', () => {
  const make = (askedAt: string) =>
    detectCareGaps(
      baseState({
        obligations: [
          obligation({
            status: 'REQUESTED',
            ownerId: null,
            request: { askedOfId: 'm_david', askedById: 'm_renee', askedAt },
          }),
        ],
      }),
      { now: NOW },
    )[0]!;

  const fresh = make('2026-10-15T17:30:00Z'); // half an hour ago
  const stale = make('2026-10-13T17:30:00Z'); // two days ago
  const unowned = detectCareGaps(baseState({ obligations: [obligation()] }), { now: NOW })[0]!;

  assert.ok(fresh.score < stale.score, 'a fresh ask should rank below a stale one');
  assert.ok(stale.score <= unowned.score, 'relief must never exceed simply being unowned');
  assert.ok(fresh.score < unowned.score, 'asking someone should count for something');
});

// The family calendar: who already holds other work around the time this is due.
// The drive is at 14:00Z; the refill an hour later is "around then", one at 17:00Z is not.
const refill = (over: Partial<Obligation> = {}): Obligation =>
  obligation({
    id: 'o_refill',
    what: 'Pick up the refill',
    status: 'ASSIGNED',
    ownerId: 'm_renee',
    dueAt: '2026-10-16T15:00:00Z',
    ...over,
  });

test('somebody free at the time is asked before somebody who already has work then', () => {
  // Renee is least loaded on paper next to David's two things on other days, but she has
  // the refill an hour after the drive. David has nothing around then.
  const state = baseState({
    obligations: [
      obligation(),
      refill(),
      obligation({ id: 'o2', status: 'ASSIGNED', ownerId: 'm_david', dueAt: ANOTHER_DAY }),
      obligation({ id: 'o3', status: 'ASSIGNED', ownerId: 'm_david', dueAt: ANOTHER_DAY }),
    ],
  });
  const ranked = candidatesFor(obligation(), state);
  assert.equal(ranked[0]!.name, 'David');
  assert.equal(ranked[0]!.because, 'has 2 other things on, but nothing around then');
  const renee = ranked.find((c) => c.name === 'Renee')!;
  assert.equal(renee.clashesWith, 'Pick up the refill');
  assert.match(renee.because, /already has "Pick up the refill" around then/);
});

test('free before busy reaches across to the paid aide, but busy never rules anyone out', () => {
  // Both of Margaret's children hold work at the drive's hour; Tasha is free then.
  const state = baseState({
    obligations: [
      obligation(),
      refill(),
      refill({
        id: 'o_pharm',
        what: 'Call the pharmacy',
        ownerId: 'm_david',
        dueAt: '2026-10-16T13:30:00Z',
      }),
    ],
  });
  const ranked = candidatesFor(obligation(), state);
  assert.deepEqual(
    ranked.map((c) => c.name),
    ['Tasha', 'David', 'Renee'],
  );
  assert.equal(ranked[0]!.clashesWith, undefined);
});

test('when everyone who could has something then, the reason says so', () => {
  const state = baseState({
    members: baseState().members.filter((m) => m.id !== 'm_tasha'),
    obligations: [
      obligation(),
      refill(),
      refill({
        id: 'o_pharm',
        what: 'Call the pharmacy',
        ownerId: 'm_david',
        dueAt: '2026-10-16T13:30:00Z',
      }),
    ],
  });
  const top = candidatesFor(obligation(), state)[0]!;
  assert.equal(
    top.because,
    'already has "Call the pharmacy" around then - everyone who could take it on has something then',
  );
});

test('work three hours away, unowned work, or finished work is not a clash', () => {
  const state = (o: Obligation) => baseState({ obligations: [obligation(), o] });
  assert.equal(
    clashFor('m_renee', obligation(), state(refill({ dueAt: '2026-10-16T17:00:00Z' }))),
    undefined,
  );
  assert.equal(
    clashFor('m_renee', obligation(), state(refill({ status: 'REQUESTED', ownerId: null }))),
    undefined,
  );
  assert.equal(clashFor('m_renee', obligation(), state(refill({ status: 'RESOLVED' }))), undefined);
  assert.equal(clashFor('m_renee', obligation(), state(refill({ dueAt: undefined }))), undefined);
  // Undated work has no time to clash with.
  assert.equal(clashFor('m_renee', obligation({ dueAt: undefined }), state(refill())), undefined);
  assert.equal(clashFor('m_renee', obligation(), state(refill()))?.what, 'Pick up the refill');
});

test('undated work keeps the plain reason: there is no "around then" to speak of', () => {
  const state = baseState({
    obligations: [obligation({ dueAt: undefined }), refill({ ownerId: 'm_david' })],
  });
  const david = candidatesFor(obligation({ dueAt: undefined }), state).find(
    (c) => c.name === 'David',
  )!;
  assert.equal(david.because, 'has one other thing on');
});

test('after a no, the next free person reads as next, with the comma where it belongs', () => {
  const state = baseState({
    obligations: [obligation(), refill({ ownerId: 'm_david', dueAt: ANOTHER_DAY })],
  });
  const next = candidatesFor(obligation({ declinedBy: ['m_renee'] }), state)[0]!;
  assert.equal(next.name, 'David');
  assert.equal(
    next.because,
    'has one other thing on, but nothing around then, and is next after the people already asked',
  );
});
