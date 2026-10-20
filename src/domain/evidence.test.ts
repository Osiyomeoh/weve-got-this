import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkInEvidence, evidenceFor } from './evidence.ts';
import { explainProvenance } from './provenance.ts';
import type { CareEvent, Obligation } from './types.ts';

const TZ = 'Africa/Lagos';
/** The ride was due at 09:00 Lagos (08:00Z). */
const ride: Obligation = {
  id: 'o1',
  householdId: 'h1',
  what: 'Drive Daddy to the eye check-up',
  status: 'ASSIGNED',
  consequence: 'medical',
  ownerId: 'm_musa',
  provenance: { kind: 'CONFIRMED', byMemberId: 'm_ada', at: '2026-10-12T12:00:00Z' },
  createdAt: '2026-10-12T12:00:00Z',
  dueAt: '2026-10-14T08:00:00Z',
};

function door(at: string, signalKind = 'motion', id = `e_${at}`): CareEvent {
  return {
    id,
    householdId: 'h1',
    kind: 'external_signal',
    reportedBy: 'device:ring',
    occurredAt: at,
    recordedAt: at,
    source: 'ring',
    confidence: 'observed',
    data: { source: 'ring', signalKind },
  };
}

test('door activity near the due time is evidence; activity far from it is not', () => {
  const events = [
    door('2026-10-14T07:30:00Z'),
    door('2026-10-14T08:04:00Z'),
    door('2026-10-14T03:00:00Z'),
  ];
  const seen = evidenceFor(ride, events, new Date('2026-10-14T08:30:00Z'));
  assert.deepEqual(
    seen.map((e) => e.occurredAt),
    ['2026-10-14T08:04:00Z', '2026-10-14T07:30:00Z'],
  );
});

test('Ring classifying motion as a person is said as a person, never as who', () => {
  const person: CareEvent = {
    ...door('2026-10-14T08:04:00Z'),
    data: { source: 'ring', signalKind: 'motion', raw: { subType: 'human' } },
  };
  const line = checkInEvidence(ride, [person], new Date('2026-10-14T08:30:00Z'), TZ);
  assert.match(line, /The doorbell saw a person at the door at 9:04/);
  assert.doesNotMatch(line, /Musa/);
});

test('only presence counts: a note or a dose is not something the doorbell saw', () => {
  const note: CareEvent = { ...door('2026-10-14T08:01:00Z'), kind: 'note_added' };
  assert.deepEqual(evidenceFor(ride, [note], new Date('2026-10-14T08:30:00Z')), []);
});

test("the check-in mentions what the door saw, in the family's own time", () => {
  const line = checkInEvidence(
    ride,
    [door('2026-10-14T08:04:00Z')],
    new Date('2026-10-14T08:30:00Z'),
    TZ,
  );
  assert.match(line, /The doorbell saw activity at the door at 9:04/);
});

test('silence at the door is said as silence, never as a failure', () => {
  const earlier = door('2026-10-13T08:00:00Z'); // the house has a doorbell; it saw nothing today
  const line = checkInEvidence(ride, [earlier], new Date('2026-10-14T08:30:00Z'), TZ);
  assert.match(line, /No activity at the door has been recorded since 8:00/);
  assert.doesNotMatch(line, /miss|fail|didn't|did not/i);
});

test('a house with no doorbell gets no claim about the door at all', () => {
  assert.equal(checkInEvidence(ride, [], new Date('2026-10-14T08:30:00Z'), TZ), '');
});

test('"how do we know it was done?" speaks the evidence beside the verdict, not as it', () => {
  const seen = door('2026-10-14T08:04:00Z', 'motion', 'e_ring');
  const closed: CareEvent = {
    id: 'e_done',
    householdId: 'h1',
    kind: 'obligation_resolved',
    reportedBy: 'm_musa',
    occurredAt: '2026-10-14T09:00:00Z',
    recordedAt: '2026-10-14T09:00:00Z',
    source: 'telegram',
    confidence: 'confirmed',
    derivedFrom: ['e_ring'],
    data: { obligationId: 'o1' },
  };
  const done = { ...ride, status: 'RESOLVED' as const };
  const names = (id: string | null) =>
    (({ m_musa: 'Musa', m_ada: 'Ada' }) as Record<string, string>)[id ?? ''];
  const said = explainProvenance(done, [], [seen, closed], names, TZ).spoken;
  assert.match(said, /Around then the doorbell saw activity at the door at 9:04/);
  assert.match(said, /not proof on its own/);

  const unseen = explainProvenance(done, [], [{ ...closed, derivedFrom: [] }], names, TZ).spoken;
  assert.doesNotMatch(
    unseen,
    /doorbell|only/i,
    "a person's word is not doubted for lack of a sensor",
  );
});
