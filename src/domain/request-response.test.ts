import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CareStore } from '../store/store.ts';
import { applyRequestResponse } from './request-response.ts';

const HH = 'h1';
const NOW = new Date('2026-10-14T14:00:00Z');
const store = new CareStore();

async function seed(): Promise<string> {
  await store.reset();
  await store.addHousehold({ id: HH, name: 'circle', timezone: 'America/New_York' });
  await store.addMember({ id: 'm_mum', householdId: HH, name: 'Grace', role: 'care_recipient' });
  await store.addMember({
    id: 'm_renee',
    householdId: HH,
    name: 'Renee',
    role: 'family_caregiver',
  });
  const o = await store.createObligation({
    householdId: HH,
    what: 'Drive Grace to cardiology',
    status: 'OPEN',
    consequence: 'medical',
    provenance: { kind: 'CONFIRMED', byMemberId: 'm_mum', at: NOW.toISOString() },
    ownerId: null,
  });
  // Ask Renee, as the request flow does.
  await store.transition(
    o.id,
    HH,
    'REQUESTED',
    'system:carecircle',
    {
      ownerId: null,
      request: { askedOfId: 'm_renee', askedById: 'system:carecircle', askedAt: NOW.toISOString() },
    },
    'asked',
  );
  return o.id;
}
beforeEach(async () => {
  await seed();
});

test('an accept from the asked member makes them the owner, over the whatsapp channel', async () => {
  const r = await applyRequestResponse(
    store,
    { householdId: HH, memberId: 'm_renee', accepted: true, note: 'Yes I can' },
    NOW,
  );
  assert.equal(r.ok, true);
  assert.equal(r.status, 'ASSIGNED');
  const o = store.getCareState(HH).obligations[0]!;
  assert.equal(o.status, 'ASSIGNED');
  assert.equal(o.ownerId, 'm_renee');
  const ev = store.getCareState(HH).events.find((e) => e.kind === 'request_answered');
  assert.equal(ev!.source, 'whatsapp');
  assert.equal(ev!.confidence, 'confirmed');
  assert.equal(ev!.data['accepted'], true);
});

test('a decline puts it back with no owner and records who said no', async () => {
  const r = await applyRequestResponse(
    store,
    { householdId: HH, memberId: 'm_renee', accepted: false, note: "Can't this week" },
    NOW,
  );
  assert.equal(r.status, 'OPEN');
  const o = store.getCareState(HH).obligations[0]!;
  assert.equal(o.status, 'OPEN');
  assert.equal(o.ownerId, null);
  assert.ok((o.declinedBy ?? []).includes('m_renee'));
});

test('a reply from someone who was not asked assigns nothing', async () => {
  // Nobody asked Mum; her "yes" answers no request of hers.
  const r = await applyRequestResponse(
    store,
    { householdId: HH, memberId: 'm_mum', accepted: true },
    NOW,
  );
  assert.equal(r.ok, false);
  assert.match(r.spoken, /no open request/i);
  const o = store.getCareState(HH).obligations[0]!;
  assert.equal(o.status, 'REQUESTED'); // untouched
});

// --- Answering the app's "still on?" about work the sender already holds ----------

/** Renee holds the drive, and the app has asked her about it. */
async function checkedIn(ahead: boolean): Promise<string> {
  const id = store.getCareState(HH).obligations[0]!.id;
  await store.transition(id, HH, 'ASSIGNED', 'm_renee', { ownerId: 'm_renee', clearRequest: true });
  await store.appendEvent({
    householdId: HH,
    kind: 'owner_requested',
    reportedBy: 'system:carecircle',
    occurredAt: NOW.toISOString(),
    source: 'system',
    confidence: 'inferred',
    data: { obligationId: id, askedOfId: 'm_renee', followUp: true, ...(ahead ? { ahead } : {}) },
  });
  return id;
}

test('"yes" to the day-before question keeps it theirs, and is recorded as still on', async () => {
  const id = await checkedIn(true);
  const r = await applyRequestResponse(
    store,
    { householdId: HH, memberId: 'm_renee', accepted: true, note: 'yes', checkIns: true },
    NOW,
  );
  assert.equal(r.ok, true);
  assert.equal(r.status, 'ASSIGNED');
  assert.equal(store.getObligation(id, HH).ownerId, 'm_renee');
  const said = store.getCareState(HH).events.find((e) => e.kind === 'request_answered')!;
  assert.equal(said.data['stillOn'], true);
  assert.equal(said.reportedBy, 'm_renee');

  // Answered: a second "yes" answers nothing.
  const again = await applyRequestResponse(
    store,
    { householdId: HH, memberId: 'm_renee', accepted: true, checkIns: true },
    NOW,
  );
  assert.equal(again.ok, false);
});

test('"can\'t" to a check-in hands it back like any decline', async () => {
  const id = await checkedIn(false);
  const r = await applyRequestResponse(
    store,
    { householdId: HH, memberId: 'm_renee', accepted: false, note: "can't", checkIns: true },
    NOW,
  );
  assert.equal(r.status, 'OPEN');
  const o = store.getObligation(id, HH);
  assert.equal(o.ownerId, null);
  assert.deepEqual(o.declinedBy, ['m_renee']);
});

test('after the time, "yes" is not guessed into "still on" or "done"', async () => {
  await checkedIn(false);
  const r = await applyRequestResponse(
    store,
    { householdId: HH, memberId: 'm_renee', accepted: true, checkIns: true },
    NOW,
  );
  assert.equal(r.ok, false);
  assert.ok(!store.getCareState(HH).events.some((e) => e.kind === 'request_answered'));
});

test('a message not meant for the app never answers a check-in', async () => {
  // "Sorry, can't make dinner" in the family group is not handing back the drive.
  const id = await checkedIn(true);
  const r = await applyRequestResponse(
    store,
    { householdId: HH, memberId: 'm_renee', accepted: false, note: "sorry, can't make dinner" },
    NOW,
  );
  assert.equal(r.ok, false);
  assert.equal(store.getObligation(id, HH).ownerId, 'm_renee');
});
