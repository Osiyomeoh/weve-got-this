import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CareStore } from '../store/store.ts';
import { RecordOnlyNotifier } from '../notify/notifier.ts';
import { runAgentOnce } from './agent-runner.ts';
import { AGENT_ID, deliberate } from './agent.ts';
import { arrivalFrom, closeAlongside, deliveryFor, orderable, recordOrder } from './orders.ts';
import { applyRequestResponse } from './request-response.ts';
import { putRoutinesOnRecord } from './routines.ts';
import type { Obligation } from './types.ts';

/**
 * Ordering in, when nobody nearby is free. Lagos, Thursday 24 September, 10 AM. Sam and
 * Sandra are in Lagos; Kunle is in Houston.
 */

const H = 'h';
const TZ = 'Africa/Lagos';
const NOW = new Date('2026-09-24T09:00:00Z');
const LUNCH_AT = '2026-09-24T12:00:00.000Z';

const store = new CareStore();
const notifier = new RecordOnlyNotifier();
const run = (now = NOW) => runAgentOnce(H, { store, notifier, now: () => now });
const member = (id: string) => store.getCareState(H).members.find((m) => m.id === id)!;
const work = (what: string) => store.getCareState(H).obligations.find((o) => o.what === what)!;

beforeEach(async () => {
  await store.reset();
  store.useClock(() => NOW);
  await store.addHousehold({ id: H, name: 'Dad care circle', timezone: TZ });
  await store.addMember({
    id: 'm_dad',
    householdId: H,
    name: 'Pius',
    role: 'care_recipient',
    spokenAs: 'Dad',
  });
  await store.addMember({ id: 'm_sam', householdId: H, name: 'Sam', role: 'primary_caregiver' });
  await store.addMember({ id: 'm_sandra', householdId: H, name: 'Sandra', role: 'caregiver' });
  await store.addMember({
    id: 'm_kunle',
    householdId: H,
    name: 'Kunle',
    role: 'caregiver',
    livesAway: 'Houston',
  });
  await store.appendEvent({
    householdId: H,
    kind: 'routine_set',
    reportedBy: 'm_sam',
    occurredAt: '2026-09-23T09:00:00Z',
    data: {
      what: 'Bring Dad lunch',
      area: 'meal',
      times: ['13:00'],
      forMemberId: 'm_dad',
      orderFrom: "Mama Titi's kitchen",
    },
  });
  await putRoutinesOnRecord(store, H, NOW);
});

/** Everyone nearby has said they can't. */
async function nobodyNearby(o: Obligation) {
  await store.transition(o.id, H, o.status, 'm_sam', { declinedBy: ['m_sam', 'm_sandra'] });
}

test('nobody nearby is free for lunch: Kunle in Houston is asked to order it in, from where it usually comes', async () => {
  await nobodyNearby(work('Bring Dad lunch'));
  const r = await run();
  assert.equal(r.performed.length, 1);
  const { action } = r.performed[0]!;
  assert.equal(action.kind, 'ASK');
  assert.equal(action.memberId, 'm_kunle');
  assert.equal(action.order, true);
  assert.match(action.because, /Kunle, who lives in Houston, if they could order it in/);

  const lunch = work('Bring Dad lunch');
  assert.equal(lunch.status, 'REQUESTED');
  assert.equal(lunch.ownerId, null, 'asking someone to order is still only asking');
  const ask = store.getCareState(H).events.find((e) => e.kind === 'owner_requested')!;
  assert.equal(ask.data['order'], true);
  assert.equal(
    ask.data['message'],
    `Nobody nearby is free for "Bring Dad lunch" today at 1 PM. Could you order it in instead? It usually comes from Mama Titi's kitchen.\n\nReply "yes" or "can't".`,
  );
});

test('someone nearby is always asked before anyone is asked to order', async () => {
  const r = await run();
  assert.equal(r.performed[0]!.action.memberId !== 'm_kunle', true);
  assert.equal(r.performed[0]!.action.order, undefined);
});

test('a ride is never offered for ordering: somebody has to be there', async () => {
  const ride = await store.createObligation({
    householdId: H,
    what: 'Take Dad to his eye check-up',
    status: 'OPEN',
    consequence: 'medical',
    provenance: { kind: 'CONFIRMED', byMemberId: 'm_sam', at: NOW.toISOString() },
    ownerId: null,
    dueAt: '2026-09-25T09:00:00Z',
    declinedBy: ['m_sam', 'm_sandra'],
  });
  assert.equal(orderable(ride, store.getCareState(H)), false);
  const { actions, restraint } = deliberate(store.getCareState(H), { now: NOW, timezone: TZ });
  assert.ok(!actions.some((a) => a.obligationId === ride.id));
  assert.ok(
    restraint.some(
      (x) => x.because === 'There is nobody I can ask about "Take Dad to his eye check-up".',
    ),
  );
});

test('Kunle says yes: it is his, and he hears what comes next', async () => {
  await nobodyNearby(work('Bring Dad lunch'));
  await run();
  const r = await applyRequestResponse(
    store,
    { householdId: H, memberId: 'm_kunle', accepted: true, channel: 'telegram' },
    NOW,
  );
  assert.equal(
    r.spoken,
    `Thanks - "Bring Dad lunch" is yours now. Once it's ordered, tell me where from and when it's due, and I'll ask someone nearby to take it in.`,
  );
  assert.equal(work('Bring Dad lunch').ownerId, 'm_kunle');
});

test('an order nobody answered about goes to the coordinator, who hears it could be ordered in', async () => {
  const refill = await store.createObligation({
    householdId: H,
    what: "Pick up Dad's eye drops refill",
    status: 'REQUESTED',
    consequence: 'medical',
    provenance: { kind: 'CONFIRMED', byMemberId: 'm_sam', at: '2026-09-23T09:00:00Z' },
    ownerId: null,
    dueAt: '2026-09-24T19:00:00Z',
    declinedBy: ['m_sandra'],
    request: { askedOfId: 'm_kunle', askedById: AGENT_ID, askedAt: '2026-09-23T19:00:00Z' },
  });
  await store.appendEvent({
    householdId: H,
    kind: 'owner_requested',
    reportedBy: AGENT_ID,
    occurredAt: '2026-09-23T19:00:00Z',
    data: { obligationId: refill.id, askedOfId: 'm_kunle', order: true },
  });
  // Sam is nearby but coordinates; with Sandra's no and Kunle's silence, Sam hears.
  await store.transition(refill.id, H, 'REQUESTED', 'm_sam', {
    declinedBy: ['m_sandra', 'm_sam'],
  });
  const r = await run();
  const told = r.performed.find((p) => p.action.obligationId === refill.id)!;
  assert.equal(told.action.kind, 'ESCALATE');
  assert.equal(told.action.memberId, 'm_sam');
  const sent = store
    .getCareState(H)
    .events.filter((e) => e.kind === 'owner_requested' && e.data['obligationId'] === refill.id)
    .at(-1)!;
  assert.equal(
    sent.data['message'],
    `I couldn't find anyone for "Pick up Dad's eye drops refill". It may need you to step in, or it could be ordered in.`,
  );
});

test('ordered from Houston: lunch is on Kunle, and someone nearby is found to take it in', async () => {
  await nobodyNearby(work('Bring Dad lunch'));
  const done = await recordOrder(
    store,
    {
      householdId: H,
      by: member('m_kunle'),
      covered: work('Bring Dad lunch'),
      forMember: member('m_dad'),
      from: "Mama Titi's kitchen",
      arrivesAt: LUNCH_AT,
      source: 'voice',
    },
    NOW,
  );
  assert.equal(done.obligation.status, 'ASSIGNED');
  assert.equal(done.obligation.ownerId, 'm_kunle');
  assert.ok(done.takeIn);
  assert.equal(done.takeIn.what, "Take the delivery from Mama Titi's kitchen in to Dad");
  assert.equal(done.takeIn.status, 'OPEN');
  assert.equal(done.takeIn.dueAt, LUNCH_AT);
  assert.equal(done.takeIn.consequence, 'medical');

  const event = store.getCareState(H).events.find((e) => e.kind === 'order_placed')!;
  assert.equal(event.reportedBy, 'm_kunle');
  assert.equal(event.data['takeInId'], done.takeIn.id);

  // A "can't" about cooking lunch is not a "can't" about opening the door.
  const r = await run();
  const ask = r.performed.find((p) => p.action.obligationId === done.takeIn!.id)!;
  assert.equal(ask.action.kind, 'ASK');
  assert.notEqual(ask.action.memberId, 'm_kunle');
  assert.equal(ask.action.order, undefined);
});

test('ordered by someone at home: it is theirs, and nobody else is needed at the door', async () => {
  const done = await recordOrder(
    store,
    {
      householdId: H,
      by: member('m_sandra'),
      covered: work('Bring Dad lunch'),
      forMember: member('m_dad'),
      source: 'voice',
    },
    NOW,
  );
  assert.equal(done.obligation.ownerId, 'm_sandra');
  assert.equal(done.takeIn, undefined);
  assert.equal(orderable(done.obligation, store.getCareState(H)), false, 'not offered twice');
});

test('taking it in closes the order on that word; the doorbell only ever asks', async () => {
  const done = await recordOrder(
    store,
    {
      householdId: H,
      by: member('m_kunle'),
      covered: work('Bring Dad lunch'),
      forMember: member('m_dad'),
      from: "Mama Titi's kitchen",
      arrivesAt: LUNCH_AT,
      source: 'voice',
    },
    NOW,
  );
  const takeIn = done.takeIn!;

  const rang = deliveryFor(store.getCareState(H), new Date('2026-09-24T11:52:00Z'), 'Dad');
  assert.deepEqual(rang, {
    obligationId: takeIn.id,
    ask: `A delivery arrived at Dad's door. It may be "Bring Dad lunch", which Kunle ordered from Mama Titi's kitchen, due today at 1 PM. Has it reached Dad?`,
  });
  assert.equal(
    deliveryFor(store.getCareState(H), new Date('2026-09-24T17:00:00Z'), 'Dad'),
    undefined,
    'hours from when it was due, a delivery is not this order',
  );
  assert.equal(work('Bring Dad lunch').status, 'ASSIGNED', 'a delivery at the door closes nothing');

  await store.transition(takeIn.id, H, 'ASSIGNED', 'm_sandra', { ownerId: 'm_sandra' });
  await store.transition(takeIn.id, H, 'RESOLVED', 'm_sandra', { resolvedAt: LUNCH_AT });
  const followed = await closeAlongside(store, H, takeIn, 'm_sandra', NOW);
  assert.equal(followed?.id, done.obligation.id);
  const lunch = work('Bring Dad lunch');
  assert.equal(lunch.status, 'RESOLVED');
  assert.equal(lunch.resolutionNote, 'Sandra took the delivery in');
  const closed = store
    .getCareState(H)
    .events.find((e) => e.kind === 'obligation_resolved' && e.data['obligationId'] === lunch.id)!;
  assert.equal(closed.reportedBy, 'm_sandra');
});

test('Kunle hears from Dad it arrived: nobody needs to be found for the door', async () => {
  const done = await recordOrder(
    store,
    {
      householdId: H,
      by: member('m_kunle'),
      covered: work('Bring Dad lunch'),
      forMember: member('m_dad'),
      source: 'voice',
    },
    NOW,
  );
  await store.transition(done.obligation.id, H, 'RESOLVED', 'm_kunle', { resolvedAt: LUNCH_AT });
  const followed = await closeAlongside(store, H, done.obligation, 'm_kunle', NOW);
  assert.equal(followed?.status, 'DISMISSED');
  assert.equal(
    store.getTransitions(done.takeIn!.id).at(-1)?.note,
    'Kunle said it already reached Dad',
  );
});

test('when it arrives: on the day of the work, tomorrow if long past, and never a guess', () => {
  const lunch = work('Bring Dad lunch');
  assert.deepEqual(arrivalFrom('13:00', lunch, TZ, NOW), { at: LUNCH_AT });
  const night = new Date('2026-09-24T20:00:00Z'); // 9 PM Lagos
  assert.deepEqual(arrivalFrom('08:00', undefined, TZ, night), { at: '2026-09-25T07:00:00.000Z' });
  assert.deepEqual(arrivalFrom('20:30', undefined, TZ, night), { at: '2026-09-24T19:30:00.000Z' });
  assert.deepEqual(arrivalFrom('2026-09-26T09:00', undefined, TZ, NOW), {
    at: '2026-09-26T08:00:00.000Z',
  });
  assert.ok('problem' in arrivalFrom('1pm', lunch, TZ, NOW));
});
