import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseRefill,
  formatPrice,
  offerFor,
  offerSpoken,
  waitingOffers,
  OFFER_TTL_MS,
} from './commerce.ts';

test('prices are deterministic and formatted for speech', () => {
  const offer = offerFor('prescription_refill', { offerId: 'off_1', itemName: 'heart pill' });
  assert.equal(offer.amountCents, 1200);
  assert.equal(formatPrice(offer.amountCents), '$12.00');
  assert.match(offer.item, /heart pill/);
  assert.equal(offer.simulated, true);
});

test('an offer names its Care Gap when given one', () => {
  const offer = offerFor('prescription_refill', { offerId: 'off_2', obligationId: 'ob_9' });
  assert.equal(offer.obligationId, 'ob_9');
});

test('the spoken line always says nothing is charged until confirmed', () => {
  const offer = offerFor('prescription_refill', { offerId: 'off_3', itemName: 'blood thinner' });
  const spoken = offerSpoken(offer);
  assert.match(spoken, /\$12\.00/);
  assert.match(spoken, /confirm/i);
});

const MEDS = [{ name: 'eye drops' }, { name: 'supplement' }];
const PICKUP = { id: 'o_pickup', what: "Pick up Daddy's eye drops refill" };

test('an unnamed refill is the one already waiting to be picked up', () => {
  for (const said of [
    undefined,
    'prescription',
    'his prescription',
    "Daddy's meds",
    'my own prescription',
  ]) {
    assert.deepEqual(
      chooseRefill(said, MEDS, [PICKUP]),
      { ok: true, itemName: 'eye drops', obligationId: 'o_pickup' },
      String(said),
    );
  }
});

test('a loosely named medication is matched to the one on record', () => {
  assert.deepEqual(chooseRefill('his supplement', MEDS, [PICKUP]), {
    ok: true,
    itemName: 'supplement',
  });
  assert.deepEqual(chooseRefill('eye drops', MEDS, [PICKUP]), {
    ok: true,
    itemName: 'eye drops',
    obligationId: 'o_pickup',
  });
});

test('with several medications and nothing to go on, it asks rather than picking one', () => {
  assert.deepEqual(chooseRefill('his prescription', MEDS, []), {
    ok: false,
    choices: ['eye drops', 'supplement'],
  });
});

test('a name that matches two medications is asked about, never guessed', () => {
  const meds = [{ name: 'eye drops' }, { name: 'ear drops' }, { name: 'supplement' }];
  assert.deepEqual(chooseRefill('his drops', meds, [PICKUP]), {
    ok: false,
    choices: ['eye drops', 'ear drops'],
  });
});

test('one medication on record needs no question', () => {
  assert.deepEqual(chooseRefill(undefined, [{ name: 'eye drops' }], []), {
    ok: true,
    itemName: 'eye drops',
  });
});

test('something not on the schedule is still offered, in their words', () => {
  assert.deepEqual(chooseRefill('insulin', MEDS, [PICKUP]), { ok: true, itemName: 'insulin' });
});

test('nothing on record: a plain prescription refill', () => {
  assert.deepEqual(chooseRefill(undefined, [], []), { ok: true });
});

const at = new Date('2026-09-23T12:00:00Z');
const offered = (id: string, by: string, ago: number) => ({
  kind: 'purchase_offered',
  reportedBy: by,
  occurredAt: new Date(at.getTime() - ago).toISOString(),
  data: {
    offer: offerFor('prescription_refill', { offerId: id, itemName: id }) as unknown as Record<
      string,
      unknown
    >,
  },
});

test('waiting offers leave out answered and stale ones, newest first', () => {
  const events = [
    offered('old', 'm_david', OFFER_TTL_MS + 1),
    offered('answered', 'm_david', 60_000),
    {
      kind: 'purchase_completed',
      reportedBy: 'm_david',
      occurredAt: at.toISOString(),
      data: { offerId: 'answered' },
    },
    offered('first', 'm_david', 120_000),
    offered('second', 'm_renee', 30_000),
  ];
  assert.deepEqual(
    waitingOffers(events, at).map((w) => [w.offer.offerId, w.offeredBy]),
    [
      ['second', 'm_renee'],
      ['first', 'm_david'],
    ],
  );
});
