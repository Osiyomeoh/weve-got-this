import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { explainProvenance } from './provenance.ts';
import type { CareEvent, Obligation, ObligationStatus, Provenance } from './types.ts';
import type { ObligationTransition } from '../store/store.ts';

/**
 * Adversarial suite for the provenance walk. The whole point of get_provenance is that
 * it explains "how do we know?" without ever inventing certainty or guilt. These tests
 * try to make it lie - with inferred origins, absent records, declines, reassignments -
 * and assert the two refusals hold across every path and, by property test, over
 * thousands of generated chains.
 */

// The accusations this system must be structurally incapable of speaking. Kept in one
// place and reused; it mirrors the forbidden vocabulary the gap engine already enforces.
const ACCUSATORY =
  /did ?n[o']t (take|do)|missed|forgot|failed|neglect|ignored|refused to|her fault|to blame/i;
// Affirmative certainty claims an inference must never make. Deliberately does NOT
// include a bare "confirmed": the honest phrasing "Nobody has confirmed it yet" contains
// that word in a negation, and banning it would punish the correct sentence. The real
// guarantee that an inference is never asserted is structural (the origin step's
// `certainty` stays 'inferred'), checked separately.
const OVERCLAIM =
  /\b(definitely|for a fact|proven|certainly|we know (she|he|they)|it did happen)\b/i;

const names: Record<string, string> = {
  m_david: 'David',
  m_renee: 'Renee',
  m_margaret: 'Margaret',
  'device:ring': 'the Ring doorbell',
};
const nameOf = (id: string | null) => (id ? names[id] : undefined);

function obligation(over: Partial<Obligation> = {}): Obligation {
  return {
    id: 'o1',
    householdId: 'h1',
    what: 'Drive Margaret to cardiology',
    status: 'OPEN',
    consequence: 'medical',
    provenance: { kind: 'CONFIRMED', byMemberId: 'm_david', at: '2026-03-10T09:00:00Z' },
    ownerId: null,
    createdAt: '2026-03-10T09:00:00Z',
    ...over,
  };
}

test('a confirmed obligation names the human who confirmed it', () => {
  const e = explainProvenance(obligation(), [], [], nameOf);
  assert.match(e.spoken, /David confirmed this/);
  assert.doesNotMatch(e.spoken, ACCUSATORY);
});

test('an inferred obligation is spoken as a guess, never as a fact', () => {
  const o = obligation({
    provenance: {
      kind: 'INFERRED',
      rule: 'appointment_implies_ride',
      from: 'the cardiology appointment',
    },
    status: 'PROPOSED',
  });
  const e = explainProvenance(o, [], [], nameOf);
  // It must say it is guessing / a suggestion, and must not overclaim certainty.
  assert.match(e.spoken, /guess|suggestion|proposed/i);
  assert.match(e.spoken, /not (a fact|confirmed)/i);
  assert.doesNotMatch(e.spoken, OVERCLAIM);
  assert.doesNotMatch(e.spoken, ACCUSATORY);
  // Structural guarantee: the origin link is marked inferred, never confirmed.
  assert.equal(e.chain[0]?.certainty, 'inferred');
});

test('a confirmed guess does not still say nobody confirmed it', () => {
  const o = obligation({
    provenance: {
      kind: 'INFERRED',
      rule: 'appointment_implies_ride',
      from: 'the cardiology appointment',
    },
    status: 'ASSIGNED',
    ownerId: 'm_renee',
  });
  const ts: ObligationTransition[] = [
    {
      obligationId: 'o1',
      from: 'PROPOSED',
      to: 'OPEN',
      byMemberId: 'm_renee',
      at: '2026-03-10T10:00:00Z',
    },
    {
      obligationId: 'o1',
      from: 'OPEN',
      to: 'ASSIGNED',
      byMemberId: 'm_renee',
      at: '2026-03-10T11:00:00Z',
    },
  ];
  const e = explainProvenance(o, ts, [], nameOf);
  // Where it came from is still a guess, and said as one...
  assert.match(e.spoken, /guessing from the cardiology appointment/);
  assert.equal(e.chain[0]?.certainty, 'inferred');
  // ...but the chain no longer contradicts itself once someone has moved it on.
  assert.doesNotMatch(e.spoken, /nobody has confirmed|still a suggestion/i);
  assert.match(e.spoken, /confirmed as real work/);
  assert.match(e.spoken, /Renee took it on, on March 10\./);
  assert.doesNotMatch(e.spoken, /\bon on\b/);
  assert.doesNotMatch(e.spoken, OVERCLAIM);
  assert.doesNotMatch(e.spoken, ACCUSATORY);

  // Moved on with nothing on record to say how (the demo's seeded ride): no contradiction,
  // and no confirmation claimed that the record does not hold.
  const seeded = explainProvenance({ ...o, status: 'OPEN', ownerId: null }, [], [], nameOf);
  assert.doesNotMatch(seeded.spoken, /nobody has confirmed|still a suggestion|confirmed as/i);
  assert.match(seeded.spoken, /guessing from the cardiology appointment/);
});

test('an appointment is spoken by when it is for, never as logged on that day', () => {
  // An appointment's event carries the appointment's own time, two days after it was logged.
  const booked: CareEvent = {
    id: 'e5',
    householdId: 'h1',
    kind: 'appointment_scheduled',
    reportedBy: 'm_renee',
    occurredAt: '2026-03-12T15:00:00Z',
    recordedAt: '2026-03-10T09:00:00Z',
    detail: 'Cardiology, Thursday at 10',
    source: 'voice',
    confidence: 'reported',
    data: {},
  };
  const o = obligation({
    provenance: { kind: 'INFERRED', rule: 'r', from: 'the cardiology appointment' },
    sourceEventId: 'e5',
    status: 'PROPOSED',
  });
  const e = explainProvenance(o, [], [booked], nameOf);
  assert.match(e.spoken, /Renee logged - "Cardiology, Thursday at 10" for March 12\./);
  assert.doesNotMatch(e.spoken, /on March 12/);
});

test('a not-logged record is never turned into "she didn\'t do it"', () => {
  const o = obligation({
    provenance: { kind: 'NOT_LOGGED', expectedAt: '2026-03-10T20:00:00Z' },
    what: 'Evening dose',
    consequence: 'medical',
    status: 'OPEN',
  });
  const e = explainProvenance(o, [], [], nameOf);
  assert.match(e.spoken, /no record/i);
  assert.match(e.spoken, /not the same as it not happening/i);
  assert.doesNotMatch(e.spoken, ACCUSATORY);
  // And it must not swing the other way into asserting it DID happen either.
  assert.doesNotMatch(e.spoken, OVERCLAIM);
});

test('the source signal is evidence, not a conclusion', () => {
  const source: CareEvent = {
    id: 'e1',
    householdId: 'h1',
    kind: 'external_signal',
    reportedBy: 'device:ring',
    occurredAt: '2026-03-10T14:00:00Z',
    recordedAt: '2026-03-10T14:00:00Z',
    detail: 'a package was left at the door',
    data: { source: 'ring', signalKind: 'delivery_arrived' },
  };
  const o = obligation({
    provenance: { kind: 'INFERRED', rule: 'delivery_may_be_refill', from: 'a delivery' },
    sourceEventId: 'e1',
    what: 'Check the prescription refill',
    status: 'PROPOSED',
  });
  const e = explainProvenance(o, [], [source], nameOf);
  assert.match(e.spoken, /ring signal/i);
  assert.match(e.spoken, /evidence, not a conclusion/i);
  // The delivery must never have been narrated as "the prescription came".
  assert.doesNotMatch(e.spoken, /the prescription (came|arrived)/i);
});

test('a first-class event source/confidence drives the source step, not data digging', () => {
  const source: CareEvent = {
    id: 'e2',
    householdId: 'h1',
    kind: 'external_signal',
    reportedBy: 'device:ring',
    occurredAt: '2026-03-10T14:00:00Z',
    recordedAt: '2026-03-10T14:00:00Z',
    detail: 'a package was left at the door',
    source: 'ring',
    confidence: 'observed',
    data: {},
  };
  const o = obligation({
    provenance: { kind: 'INFERRED', rule: 'delivery_may_be_refill', from: 'a delivery' },
    sourceEventId: 'e2',
    status: 'PROPOSED',
  });
  const e = explainProvenance(o, [], [source], nameOf);
  assert.match(e.spoken, /ring signal/i);
  assert.match(e.spoken, /evidence, not a conclusion/i);
  assert.equal(
    e.chain.some((s) => s.certainty === 'observed'),
    true,
  );
});

test('a system-derived source event is spoken as a suggestion, never a fact', () => {
  const derived: CareEvent = {
    id: 'e3',
    householdId: 'h1',
    kind: 'check_in',
    reportedBy: 'agent',
    occurredAt: '2026-03-10T15:00:00Z',
    recordedAt: '2026-03-10T15:00:00Z',
    detail: 'check in on Margaret',
    source: 'system',
    confidence: 'inferred',
    derivedFrom: ['e2'],
    data: {},
  };
  const o = obligation({
    provenance: { kind: 'INFERRED', rule: 'no_activity', from: 'no activity' },
    sourceEventId: 'e3',
    status: 'PROPOSED',
    what: 'Check in on Margaret',
  });
  const e = explainProvenance(o, [], [derived], nameOf);
  assert.match(e.spoken, /worked out|suggestion, not a fact/i);
  assert.doesNotMatch(e.spoken, ACCUSATORY);
  assert.doesNotMatch(e.spoken, OVERCLAIM);
});

test("a press on the TV remote, or a message, is a person's word: never spoken as a sensor reading", () => {
  for (const source of ['tv', 'telegram', 'whatsapp'] as const) {
    const said: CareEvent = {
      id: 'e4',
      householdId: 'h1',
      kind: 'check_in',
      reportedBy: 'm_margaret',
      occurredAt: '2026-03-10T15:00:00Z',
      recordedAt: '2026-03-10T15:00:00Z',
      detail: 'needs a lift on Thursday',
      source,
      data: {},
    };
    const o = obligation({ sourceEventId: 'e4' });
    const e = explainProvenance(o, [], [said], nameOf);
    assert.equal(
      e.chain.some((s) => s.certainty === 'observed'),
      false,
      source,
    );
    assert.doesNotMatch(e.spoken, /signal/i, source);
  }
});

test('ownership is taken from the obligation, not inferred from who recorded a move', () => {
  // Renee ASSIGNED it (she wrote the row), but David is the owner. The walk must not say
  // Renee owns it just because she performed the write.
  const transitions: ObligationTransition[] = [
    {
      obligationId: 'o1',
      from: 'OPEN',
      to: 'ASSIGNED',
      byMemberId: 'm_renee',
      at: '2026-03-11T10:00:00Z',
    },
  ];
  const o = obligation({ status: 'ASSIGNED', ownerId: 'm_david' });
  const e = explainProvenance(o, transitions, [], nameOf);
  assert.match(e.spoken, /Right now David owns it/);
  assert.doesNotMatch(e.spoken, /Renee owns it/);
});

test('the owner taking it on is said by name; Renee assigning it is not', () => {
  const by = (who: string): ObligationTransition[] => [
    {
      obligationId: 'o1',
      from: 'OPEN',
      to: 'ASSIGNED',
      byMemberId: who,
      at: '2026-03-11T10:00:00Z',
    },
  ];
  const o = obligation({ status: 'ASSIGNED', ownerId: 'm_david' });
  assert.match(explainProvenance(o, by('m_david'), [], nameOf).spoken, /David took it on/);
  assert.match(explainProvenance(o, by('m_renee'), [], nameOf).spoken, /It became owned/);
  assert.doesNotMatch(explainProvenance(o, by('m_renee'), [], nameOf).spoken, /Renee took it on/);
});

test('what happened today is said by the clock, earlier days by the date', () => {
  const o = obligation({
    status: 'RESOLVED',
    ownerId: 'm_david',
    resolvedAt: '2026-03-12T19:16:00Z',
  });
  const transitions: ObligationTransition[] = [
    {
      obligationId: 'o1',
      from: 'OPEN',
      to: 'ASSIGNED',
      byMemberId: 'm_david',
      at: '2026-03-12T11:31:00Z',
    },
    {
      obligationId: 'o1',
      from: 'ASSIGNED',
      to: 'RESOLVED',
      byMemberId: 'm_david',
      at: '2026-03-12T19:16:00Z',
    },
  ];
  const e = explainProvenance(
    o,
    transitions,
    [],
    nameOf,
    'Africa/Lagos',
    new Date('2026-03-12T19:20:00Z'),
  );
  assert.equal(
    e.spoken,
    'David confirmed this on March 10. David took it on at 12:31 PM. David marked it done at 8:16 PM. It is resolved.',
  );
  const later = explainProvenance(
    o,
    transitions,
    [],
    nameOf,
    'Africa/Lagos',
    new Date('2026-03-14T09:00:00Z'),
  );
  assert.match(later.spoken, /David marked it done on March 12\./);
});

test('the evening before is "yesterday", the way the promises say it', () => {
  // A visitor's copy seeds the refill as noticed by Funmi at 6:30 the evening before.
  const o = obligation({
    provenance: { kind: 'CONFIRMED', byMemberId: 'm_renee', at: '2026-03-11T17:30:00Z' },
  });
  const at = (now: string) =>
    explainProvenance(o, [], [], nameOf, 'Africa/Lagos', new Date(now)).spoken;
  assert.match(at('2026-03-12T19:20:00Z'), /Renee confirmed this yesterday at 6:30 PM\./);
  // Half past midnight in Lagos is already the next day there, though not yet in UTC.
  assert.match(at('2026-03-12T23:30:00Z'), /Renee confirmed this on March 11\./);
});

test('a decline is recorded as information, never as a failure', () => {
  const transitions: ObligationTransition[] = [
    {
      obligationId: 'o1',
      from: 'OPEN',
      to: 'REQUESTED',
      byMemberId: 'm_david',
      at: '2026-03-11T09:00:00Z',
    },
    {
      obligationId: 'o1',
      from: 'REQUESTED',
      to: 'OPEN',
      byMemberId: 'm_renee',
      at: '2026-03-11T11:00:00Z',
      note: 'working that day',
    },
  ];
  const o = obligation({ status: 'OPEN', declinedBy: ['m_renee'] });
  const e = explainProvenance(o, transitions, [], nameOf);
  assert.match(e.spoken, /asked for someone to take this on/i);
  assert.match(e.spoken, /open for someone else again/i);
  assert.doesNotMatch(e.spoken, ACCUSATORY);
});

test('the walk is order-independent: shuffled transitions give the same chain', () => {
  const ts: ObligationTransition[] = [
    {
      obligationId: 'o1',
      from: 'PROPOSED',
      to: 'OPEN',
      byMemberId: 'm_david',
      at: '2026-03-10T09:00:00Z',
    },
    {
      obligationId: 'o1',
      from: 'OPEN',
      to: 'ASSIGNED',
      byMemberId: 'm_david',
      at: '2026-03-11T09:00:00Z',
    },
    {
      obligationId: 'o1',
      from: 'ASSIGNED',
      to: 'RESOLVED',
      byMemberId: 'm_david',
      at: '2026-03-12T09:00:00Z',
    },
  ];
  const o = obligation({ status: 'RESOLVED', ownerId: 'm_david' });
  const a = explainProvenance(o, ts, [], nameOf).spoken;
  const b = explainProvenance(o, [...ts].reverse(), [], nameOf).spoken;
  assert.equal(a, b);
});

// --- Property: over any generated obligation + history, the refusals always hold. ---

const arbProvenance: fc.Arbitrary<Provenance> = fc.oneof(
  fc.record({
    kind: fc.constant('CONFIRMED' as const),
    byMemberId: fc.constant('m_david'),
    at: fc.constant('2026-03-10T09:00:00Z'),
  }),
  fc.record({
    kind: fc.constant('NOT_LOGGED' as const),
    expectedAt: fc.constant('2026-03-10T20:00:00Z'),
  }),
  fc.record({
    kind: fc.constant('INFERRED' as const),
    rule: fc.constant('r'),
    from: fc.constant('a signal'),
  }),
);

const STATUSES: ObligationStatus[] = [
  'PROPOSED',
  'OPEN',
  'REQUESTED',
  'ASSIGNED',
  'RESOLVED',
  'DISMISSED',
];

const arbTransition: fc.Arbitrary<ObligationTransition> = fc.record({
  obligationId: fc.constant('o1'),
  from: fc.constantFrom(...STATUSES),
  to: fc.constantFrom(...STATUSES),
  byMemberId: fc.constantFrom('m_david', 'm_renee', 'm_margaret', 'device:ring'),
  at: fc
    .date({ min: new Date('2026-01-01'), max: new Date('2026-12-31'), noInvalidDate: true })
    .map((d) => d.toISOString()),
});

test('property: no provenance chain ever speaks an accusation', () => {
  fc.assert(
    fc.property(
      arbProvenance,
      fc.constantFrom<ObligationStatus>(...STATUSES),
      fc.option(fc.constantFrom('m_david', 'm_renee', null), { nil: undefined }),
      fc.array(arbTransition, { maxLength: 6 }),
      (provenance, status, ownerId, transitions) => {
        const o = obligation({ provenance, status, ...(ownerId !== undefined ? { ownerId } : {}) });
        const { spoken, chain } = explainProvenance(o, transitions, [], nameOf);
        assert.doesNotMatch(spoken, ACCUSATORY);
        // An inferred origin may never be spoken with fact-certainty vocabulary, and its
        // origin link must stay structurally marked as inferred.
        if (provenance.kind === 'INFERRED') {
          assert.doesNotMatch(spoken, OVERCLAIM);
          assert.equal(chain[0]?.certainty, 'inferred');
        }
      },
    ),
    { numRuns: 500 },
  );
});
