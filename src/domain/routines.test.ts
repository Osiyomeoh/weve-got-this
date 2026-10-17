import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CareStore } from '../store/store.ts';
import { RecordOnlyNotifier } from '../notify/notifier.ts';
import { runAgentOnce } from './agent-runner.ts';
import { detectCareGaps } from './gaps.ts';
import {
  occurrenceId,
  putRoutinesOnRecord,
  routinesOf,
  takeRoutineOffRecord,
  upcomingOccurrences,
} from './routines.ts';

const HH = 'h1';
// 10:00 in Lagos on Wednesday 14 October.
const MORNING = new Date('2026-10-14T09:00:00Z');

const store = new CareStore();
const notifier = new RecordOnlyNotifier();

beforeEach(async () => {
  await store.reset();
  await store.addHousehold({ id: HH, name: 'circle', timezone: 'Africa/Lagos' });
  await store.addMember({ id: 'm_tolu', householdId: HH, name: 'Tolu', role: 'primary_caregiver' });
  await store.addMember({ id: 'm_funmi', householdId: HH, name: 'Funmi', role: 'caregiver' });
  await store.addMember({
    id: 'm_daddy',
    householdId: HH,
    name: 'Joseph',
    spokenAs: 'Daddy',
    role: 'care_recipient',
    attributes: { needsAccessibleTransport: true },
  });
});

async function setRoutine(data: Record<string, unknown>, by = 'm_tolu', at = MORNING) {
  return store.appendEvent({
    householdId: HH,
    kind: 'routine_set',
    reportedBy: by,
    occurredAt: new Date(at.getTime() - 3_600_000).toISOString(),
    source: 'voice',
    confidence: 'reported',
    detail: String(data['what']),
    data: { forMemberId: 'm_daddy', ...data },
  });
}

test('a routine is read from the record, and a stop ends it without rewriting it', async () => {
  const lunch = await setRoutine({ what: 'Bring Daddy lunch', area: 'meal', times: ['13:00'] });
  await setRoutine({ what: 'Nonsense', area: 'gardening', times: ['13:00'] });
  await store.appendEvent({
    householdId: HH,
    kind: 'routine_stopped',
    reportedBy: 'm_funmi',
    occurredAt: MORNING.toISOString(),
    data: { routineId: lunch.id },
  });
  const all = routinesOf(store.getCareState(HH));
  assert.equal(all.length, 1, 'an area we do not know is not a routine');
  assert.equal(all[0]!.what, 'Bring Daddy lunch');
  assert.equal(all[0]!.setBy, 'm_tolu');
  assert.equal(all[0]!.stoppedBy, 'm_funmi');
});

test('only the day ahead goes on the record, and only on the days it comes round', async () => {
  await setRoutine({ what: 'Bring Daddy lunch', area: 'meal', times: ['13:00'] });
  await setRoutine({ what: 'Help Daddy with his bath', area: 'personal', times: ['08:30'] });
  // Saturdays only: 17 October 2026 is a Saturday, outside the next 24 hours.
  await setRoutine({
    what: 'Buy diesel for the generator',
    area: 'household',
    times: ['10:00'],
    days: [6],
  });
  const ahead = upcomingOccurrences(store.getCareState(HH), MORNING);
  assert.deepEqual(
    ahead.map((o) => [o.routine.what, o.at]),
    [
      ['Bring Daddy lunch', '2026-10-14T12:00:00.000Z'],
      // Today's 8:30 has passed, so tomorrow's is the next one.
      ['Help Daddy with his bath', '2026-10-15T07:30:00.000Z'],
    ],
  );
  const saturday = upcomingOccurrences(store.getCareState(HH), new Date('2026-10-16T12:00:00Z'));
  assert.ok(saturday.some((o) => o.routine.what === 'Buy diesel for the generator'));
});

test('each day goes on the record once, as ordinary work nobody owns yet', async () => {
  const lunch = await setRoutine({ what: 'Bring Daddy lunch', area: 'meal', times: ['13:00'] });
  await putRoutinesOnRecord(store, HH, MORNING);
  await putRoutinesOnRecord(store, HH, new Date(MORNING.getTime() + 15 * 60_000));
  const days = store.getCareState(HH).obligations.filter((o) => o.routineId === lunch.id);
  assert.equal(days.length, 1);
  const day = days[0]!;
  assert.equal(day.id, occurrenceId(lunch.id, '2026-10-14', '13:00'));
  assert.equal(day.status, 'OPEN');
  assert.equal(day.ownerId, null);
  assert.equal(day.consequence, 'medical', 'a meal after an operation is a health matter');
  assert.deepEqual(day.provenance, {
    kind: 'CONFIRMED',
    byMemberId: 'm_tolu',
    at: lunch.occurredAt,
  });
  assert.equal(day.sourceEventId, lunch.id);
  assert.equal(day.aboutEntityId, undefined, 'a lunch must not be ranked as a ride');
});

test('"I\'ll do it every day" makes each day theirs from the start', async () => {
  await setRoutine(
    { what: 'Stay with Daddy at night', area: 'safety', times: ['21:00'], ownerId: 'm_funmi' },
    'm_funmi',
  );
  await putRoutinesOnRecord(store, HH, MORNING);
  const night = store.getCareState(HH).obligations[0]!;
  assert.equal(night.status, 'ASSIGNED');
  assert.equal(night.ownerId, 'm_funmi');
});

test('stopping a routine takes off the days ahead and leaves the days done', async () => {
  const lunch = await setRoutine({ what: 'Bring Daddy lunch', area: 'meal', times: ['13:00'] });
  await putRoutinesOnRecord(store, HH, MORNING);
  const today = store.getCareState(HH).obligations[0]!;
  await store.transition(today.id, HH, 'RESOLVED', 'm_funmi', {
    resolvedAt: '2026-10-14T12:10:00Z',
  });
  const afternoon = new Date('2026-10-14T13:00:00Z');
  await putRoutinesOnRecord(store, HH, afternoon);
  const tomorrow = store.getObligation(occurrenceId(lunch.id, '2026-10-15', '13:00'), HH);
  assert.equal(tomorrow.status, 'OPEN');

  assert.equal(await takeRoutineOffRecord(store, HH, lunch.id, 'm_tolu', afternoon), 1);
  assert.equal(store.getObligation(today.id, HH).status, 'RESOLVED');
  assert.equal(store.getObligation(tomorrow.id, HH).status, 'DISMISSED');
});

test("the agent finds someone for tomorrow's lunch like any other work, and only asks", async () => {
  await setRoutine({ what: 'Bring Daddy lunch', area: 'meal', times: ['13:00'] });
  const run = await runAgentOnce(HH, { store, notifier, now: () => MORNING });
  const asked = run.performed.find((p) => p.action.kind === 'ASK');
  assert.ok(asked, 'nobody was asked about lunch');
  const day = store.getObligation(asked.action.obligationId, HH);
  assert.equal(day.what, 'Bring Daddy lunch');
  assert.equal(day.status, 'REQUESTED');
  assert.equal(day.ownerId, null, 'asking is not assigning');
});

test('a lunch whose time has gone is not asked about, and an unanswered ask about it is taken back', async () => {
  const lunch = await setRoutine({ what: 'Bring Daddy lunch', area: 'meal', times: ['13:00'] });
  await runAgentOnce(HH, { store, notifier, now: () => MORNING });
  const today = store.getObligation(occurrenceId(lunch.id, '2026-10-14', '13:00'), HH);
  assert.equal(today.status, 'REQUESTED');

  const afternoon = new Date('2026-10-14T13:30:00Z');
  const run = await runAgentOnce(HH, { store, notifier, now: () => afternoon });
  const after = store.getObligation(today.id, HH);
  assert.equal(after.status, 'OPEN', 'nobody is left holding a question about a past lunch');
  assert.equal(after.request, undefined);
  assert.ok(
    !run.performed.some((p) => p.action.obligationId === today.id),
    'and nobody is asked about it now',
  );
  // Tomorrow's is a different day, and fair to ask about.
  assert.ok(run.performed.some((p) => p.action.obligationId !== today.id));
});

test("yesterday's days are history, not gaps: what the record says of them stays", async () => {
  const lunch = await setRoutine({ what: 'Bring Daddy lunch', area: 'meal', times: ['13:00'] });
  await putRoutinesOnRecord(store, HH, MORNING);
  const nextMorning = new Date('2026-10-15T08:00:00Z');
  const gaps = detectCareGaps(store.getCareState(HH), { now: nextMorning });
  const yesterday = occurrenceId(lunch.id, '2026-10-14', '13:00');
  assert.ok(!gaps.some((g) => g.obligationId === yesterday));
  assert.equal(store.getObligation(yesterday, HH).status, 'OPEN');
  assert.ok(
    detectCareGaps(store.getCareState(HH), { now: new Date('2026-10-14T13:30:00Z') }).some(
      (g) => g.obligationId === yesterday,
    ),
    'on its own day, a lunch nobody had still shows',
  );
});

test('a standing yes is not checked on every day; a yes given when asked is', async () => {
  // Funmi said the evenings are hers. This evening's passes with nothing marked.
  await setRoutine(
    { what: 'Sit with Daddy in the evening', area: 'safety', times: ['18:00'], ownerId: 'm_funmi' },
    'm_funmi',
  );
  const lunch = await setRoutine({ what: 'Bring Daddy lunch', area: 'meal', times: ['13:00'] });
  await putRoutinesOnRecord(store, HH, MORNING);
  // Tolu takes today's lunch when asked.
  const day = occurrenceId(lunch.id, '2026-10-14', '13:00');
  await store.transition(day, HH, 'ASSIGNED', 'm_tolu', { ownerId: 'm_tolu' });

  // 8 PM in Lagos: both are past, and it is not yet the quiet hours.
  const late = new Date('2026-10-14T19:00:00Z');
  const run = await runAgentOnce(HH, { store, notifier, now: () => late });
  const checked = run.performed.filter((p) => p.action.kind === 'CHECK_IN');
  assert.deepEqual(
    checked.map((p) => p.action.obligationId),
    [day],
    'only the lunch Tolu said yes to is checked on',
  );
  assert.ok(
    run.deliberation.restraint.some((r) =>
      /is Funmi's every time, so I leave it to them/.test(r.because),
    ),
  );
});
