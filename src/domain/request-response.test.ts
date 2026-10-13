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
