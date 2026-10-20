import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ringEventToSignal,
  ringHistoryToSignal,
  ringIdempotencyKey,
  type RingEvent,
} from './ring.ts';
import type { RingHistoryEvent } from '../connectors/ring.ts';

const ev = (over: Partial<RingEvent['data']> = {}, meta: RingEvent['meta'] = {}): RingEvent => ({
  data: {
    type: 'motion_detected',
    id: 'evt_1',
    attributes: { created_at: '2026-10-15T18:00:00Z' },
    relationships: { device: { data: { id: 'dev_front' } } },
    ...over,
  },
  meta: { request_id: 'req_1', ...meta },
});

test('a package-motion event becomes a delivery signal', () => {
  const s = ringEventToSignal(
    ev({ attributes: { created_at: '2026-10-15T18:00:00Z', sub_type: 'package' } }),
  );
  assert.ok(s);
  assert.equal(s.kind, 'delivery_arrived');
  assert.equal(s.source, 'ring');
  assert.equal(s.raw?.['deviceId'], 'dev_front');
  assert.equal(s.raw?.['requestId'], 'req_1');
});

test('a human-motion event is a sign of life, not a delivery', () => {
  const s = ringEventToSignal(
    ev({ attributes: { created_at: '2026-10-15T18:00:00Z', sub_type: 'human' } }),
  );
  assert.equal(s?.kind, 'motion');
});

test('a doorbell press is door activity', () => {
  const s = ringEventToSignal(ev({ type: 'button_press' }));
  assert.equal(s?.kind, 'door_activity');
});

test('non-care Ring events are ignored, not mismapped', () => {
  // Ring emits presence, never absence - and plenty of events are irrelevant.
  for (const type of ['device_online', 'subscription_activated', 'app_integration_added']) {
    assert.equal(ringEventToSignal(ev({ type })), null, `${type} should map to nothing`);
  }
});

test('idempotency key prefers request_id, so a redelivered webhook is not double-counted', () => {
  assert.equal(ringIdempotencyKey(ev()), 'req_1');
  assert.equal(ringIdempotencyKey(ev({}, { request_id: undefined })), 'evt_1');
});

test('a malformed event does not throw', () => {
  assert.doesNotThrow(() => ringEventToSignal({} as RingEvent));
  assert.equal(ringEventToSignal({} as RingEvent), null);
});

// Ring's documented motion webhook (Partner API, payload version 1.1).
const DOCUMENTED_MOTION: RingEvent = {
  meta: {
    request_id: '2ad45ade-1818-4154-813b-afdd8bcd8085',
    account_id: 'ava1.ring.account.XXXYYY',
  },
  data: {
    id: 'dev_front_motion_1786715596787',
    type: 'motion_detected',
    attributes: {
      source: 'dev_front',
      source_type: 'devices',
      timestamp: 1786715596787,
      timestamp_readable: '2026-08-14 08:53:16',
      sub_type: 'human',
    },
  },
};

test("the documented webhook's own time and device are read, not the time it arrived", () => {
  const s = ringEventToSignal(DOCUMENTED_MOTION);
  assert.equal(s?.at, new Date(1786715596787).toISOString());
  assert.equal(s?.raw?.['deviceId'], 'dev_front');
  assert.equal(s?.detail, 'A person was detected at the door');
});

test("Ring's package_delivery classification is a delivery", () => {
  const s = ringEventToSignal({
    ...DOCUMENTED_MOTION,
    data: {
      ...DOCUMENTED_MOTION.data,
      attributes: { ...DOCUMENTED_MOTION.data!.attributes, sub_type: 'package_delivery' },
    },
  });
  assert.equal(s?.kind, 'delivery_arrived');
});

test('a sub_type Ring adds later is kept, not dropped', () => {
  const s = ringEventToSignal({
    ...DOCUMENTED_MOTION,
    data: {
      ...DOCUMENTED_MOTION.data,
      attributes: { ...DOCUMENTED_MOTION.data!.attributes, sub_type: 'drone' },
    },
  });
  assert.equal(s?.kind, 'motion');
  assert.equal(s?.detail, 'Motion detected (drone)');
});

const history = (over: Partial<RingHistoryEvent>): RingHistoryEvent => ({
  id: 'h1',
  type: 'motion',
  deviceId: 'dev_front',
  start: 1786715596787,
  ...over,
});

test('Event History maps onto the same signals as the webhooks', () => {
  const ding = ringHistoryToSignal(history({ type: 'ding' }));
  assert.equal(ding?.kind, 'door_activity');
  assert.equal(ding?.at, new Date(1786715596787).toISOString());
  assert.deepEqual(ding?.raw, {
    ringEventId: 'h1',
    deviceId: 'dev_front',
    ringType: 'ding',
    via: 'event_history',
  });
  const person = ringHistoryToSignal(history({ subType: 'human' }));
  assert.equal(person?.kind, 'motion');
  assert.equal(person?.detail, 'A person was detected at the door');
  assert.equal(ringHistoryToSignal(history({}))?.detail, 'Motion detected');
});

test('a live view is someone looking through the camera, not someone at the door', () => {
  assert.equal(ringHistoryToSignal(history({ type: 'on_demand' })), null);
});
