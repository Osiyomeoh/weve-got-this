import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can, canActOn, NotPermittedError, require as requireCap } from './auth.ts';
import { orphanedBy, proposeFromAppointment } from './inference.ts';
import type { Member, Obligation, Role } from './types.ts';
import { CareStore } from '../store/store.ts';
import { seedDemoHousehold } from '../demo/seed.ts';
import { seedScenario } from '../demo/scenario.ts';

const member = (role: Role, id = 'm1'): Member => ({ id, householdId: 'h1', name: 'Test', role });

test('only the primary caregiver can assign work to others', () => {
  assert.ok(can(member('primary_caregiver'), 'assign_obligation'));
  assert.ok(!can(member('caregiver'), 'assign_obligation'));
  assert.ok(!can(member('helper'), 'assign_obligation'));
});

test('a caregiver can still claim work themselves', () => {
  assert.ok(can(member('caregiver'), 'claim_obligation'));
});

test('the care recipient can log their own events', () => {
  assert.ok(can(member('care_recipient'), 'log_own_event'));
});

test('a helper cannot see the full care record', () => {
  assert.ok(!can(member('helper'), 'read_full_state'));
  assert.ok(can(member('helper'), 'read_shift'));
});

test('denial messages tell the person what they can do instead', () => {
  try {
    requireCap(member('caregiver'), 'assign_obligation');
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof NotPermittedError);
    // Written to be spoken, and to keep the conversation moving.
    assert.match(err.message, /take it on yourself/);
  }
});

test('a helper can only act on work they own', () => {
  const obligation = { id: 'o1', ownerId: 'someone_else' } as Obligation;
  assert.ok(!canActOn(member('helper'), obligation));
  assert.ok(canActOn(member('helper'), { ...obligation, ownerId: 'm1' }));
  assert.ok(canActOn(member('caregiver'), obligation));
});

test('an appointment proposes transport, and says it is guessing', () => {
  const seeds = proposeFromAppointment('cardiology', 'Daddy', '2026-10-16T14:00:00Z');
  const transport = seeds.find((s) => s.provenance.rule === 'medical-appointment-transport');
  assert.ok(transport);
  assert.equal(transport.provenance.kind, 'INFERRED');
  assert.match(transport.ask, /I'm guessing/);
  assert.equal(transport.dueAt, '2026-10-16T14:00:00Z');
});

test('a non-medical event proposes nothing', () => {
  assert.deepEqual(proposeFromAppointment('book club', 'Daddy', '2026-10-16T14:00:00Z'), []);
});

test('an unavailability orphans work that person was covering', () => {
  const thursday = '2026-10-15T14:00:00Z';
  const obligations = [
    {
      id: 'o1',
      ownerId: 'm_renee',
      status: 'ASSIGNED',
      dueAt: thursday,
      what: 'Take Daddy to his eye check-up',
    },
    {
      id: 'o2',
      ownerId: 'm_david',
      status: 'ASSIGNED',
      dueAt: thursday,
      what: 'Pick up prescription',
    },
    { id: 'o3', ownerId: 'm_renee', status: 'RESOLVED', dueAt: thursday, what: 'Already done' },
  ] as unknown as Obligation[];

  const orphaned = orphanedBy(
    { memberId: 'm_renee', from: '2026-10-15T00:00:00Z', to: '2026-10-15T23:59:00Z' },
    obligations,
    () => 'Funmi',
  );

  // Only Funmi's still-open work in that window. Nobody else's, nothing already done.
  assert.deepEqual(
    orphaned.map((o) => o.obligationId),
    ['o1'],
  );
  assert.match(orphaned[0]!.ask, /Does someone else need to pick it up/);
});

test('an unavailability outside the window orphans nothing', () => {
  const obligations = [
    {
      id: 'o1',
      ownerId: 'm_renee',
      status: 'ASSIGNED',
      dueAt: '2026-11-20T14:00:00Z',
      what: 'Drive Daddy',
    },
  ] as unknown as Obligation[];
  assert.deepEqual(
    orphanedBy(
      { memberId: 'm_renee', from: '2026-10-15T00:00:00Z', to: '2026-10-15T23:59:00Z' },
      obligations,
      () => 'Funmi',
    ),
    [],
  );
});

test('the scenario puts the check-up two days from whenever it is played, at 10:00 Lagos, and calls it by that day', async () => {
  // A fixed "Thursday" fell on the day itself when played on a Thursday, and was past by the
  // time anyone offered to drive. Every hour of a week, on a fixed clock: reading the UTC day
  // once put a Lagos date a day out when reset between midnight and 1 AM there.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Lagos',
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  });
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Lagos', weekday: 'long' });
  for (let h = 0; h < 24 * 7; h += 1) {
    const now = new Date(Date.UTC(2026, 8, 21, 0, 30) + h * 3_600_000);
    const store = new CareStore();
    await store.reset();
    await seedDemoHousehold(store);
    const { checkUpAt } = await seedScenario(store, 'h_margaret', { now });
    const parts = Object.fromEntries(fmt.formatToParts(checkUpAt).map((p) => [p.type, p.value]));
    const at = `reset at ${now.toISOString()}`;
    const day = weekday.format(new Date(now.getTime() + 2 * 86_400_000));
    assert.equal(parts['weekday'], day, at);
    assert.equal(Number(parts['hour']) % 24, 10, at);
    assert.equal(parts['minute'], '00', at);
    assert.ok(checkUpAt.getTime() > now.getTime(), `must be in the future: ${at}`);
    const said =
      store.getCareState('h_margaret').events.find((e) => e.kind === 'appointment_scheduled')
        ?.detail ?? '';
    assert.ok(
      said.includes(day) && !(day !== 'Thursday' && said.includes('Thursday')),
      `the record names ${day}: ${said}`,
    );
  }
});

test('the scenario opens with the ride unowned and the evening dose unrecorded', async () => {
  const store = new CareStore();
  await store.reset();
  await seedDemoHousehold(store);
  await seedScenario(store, 'h_margaret');
  const state = store.getCareState('h_margaret');

  const ride = state.obligations.find((o) => o.what.includes('Take Daddy'));
  assert.equal(ride?.status, 'OPEN');
  assert.equal(ride?.ownerId, null);

  // Morning doses logged; the evening one deliberately absent.
  const logged = state.events.filter((e) => e.kind === 'medication_taken');
  assert.equal(logged.length, 2);
});
