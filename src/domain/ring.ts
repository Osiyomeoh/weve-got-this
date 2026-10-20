import type { CareSignal } from './signals.js';
import type { RingHistoryEvent } from '../connectors/ring.js';

/**
 * Adapter: a real Ring event -> a vendor-neutral CareSignal.
 *
 * Built to Ring's published Partner API contract: webhooks are JSON:API, signed with
 * HMAC-SHA256 in X-Signature, carry `meta.request_id` for idempotency, and put the
 * device in `attributes.source` and the time in `attributes.timestamp` (epoch ms).
 * Event History lists the same happenings after the fact in its own shape, and maps to
 * the same signals. Ring emits *presence* events - motion, a button press - never
 * absence. "No one has been to the door all day" is therefore not a Ring event: it is
 * an inference the app draws over the absence of these events (see noActivityWarranted
 * in signals.ts). Keeping that distinction honest matters - the doorbell reports what
 * it saw, and the system is responsible for what it did not.
 *
 * The reader is defensive: it takes what the contract guarantees - a type, a device, a
 * timestamp, a motion sub_type - and ignores the rest. Ring says `sub_type` is an
 * open-ended vocabulary, so a value it does not know is kept, never dropped.
 */

/** The subset of a Ring webhook event this adapter relies on. */
export interface RingEvent {
  data?: {
    type?: string;
    id?: string;
    attributes?: {
      /** The device that saw it. */
      source?: string;
      /** When, in epoch milliseconds. */
      timestamp?: number;
      /** Earlier, undocumented spellings of the same two, still accepted. */
      created_at?: string;
      sub_type?: string;
      [k: string]: unknown;
    };
    relationships?: { device?: { data?: { id?: string } } };
  };
  meta?: { request_id?: string; account_id?: string };
}

/**
 * Map a Ring event to a CareSignal, or null when the event is not one the app
 * acts on (a device coming online, a subscription change).
 *
 * A package/delivery detection is a `motion_detected` with a package sub_type -
 * Ring does not have a distinct "delivery" event, so we read it from the sub_type
 * rather than inventing an event that does not exist.
 */
export function ringEventToSignal(event: RingEvent): CareSignal | null {
  const type = event.data?.type;
  const attributes = event.data?.attributes;
  const at = ringTime(attributes?.timestamp) ?? attributes?.created_at ?? new Date().toISOString();
  const subType = attributes?.sub_type?.toLowerCase();
  const deviceId = attributes?.source ?? event.data?.relationships?.device?.data?.id;
  const raw: Record<string, unknown> = {
    ...(event.data?.id ? { ringEventId: event.data.id } : {}),
    ...(deviceId ? { deviceId } : {}),
    ...(event.meta?.request_id ? { requestId: event.meta.request_id } : {}),
    ...(type ? { ringType: type } : {}),
    ...(subType ? { subType } : {}),
  };

  switch (type) {
    case 'motion_detected':
      // A package/delivery sub_type is evidence toward a pickup; other motion is
      // simply a sign of life at the door.
      if (subType && /package|delivery/.test(subType)) {
        return {
          source: 'ring',
          kind: 'delivery_arrived',
          at,
          detail: 'Package detected at the door',
          raw,
        };
      }
      return { source: 'ring', kind: 'motion', at, detail: motionDetail(subType), raw };
    case 'button_press':
      return {
        source: 'ring',
        kind: 'door_activity',
        at,
        detail: 'Someone pressed the doorbell',
        raw,
      };
    default:
      // device_online, subscription_activated, etc. - not care-relevant.
      return null;
  }
}

/**
 * The idempotency key for a Ring event, so a webhook redelivery is not recorded
 * twice. Ring guarantees `request_id` in event metadata for exactly this.
 */
export function ringIdempotencyKey(event: RingEvent): string | null {
  return event.meta?.request_id ?? event.data?.id ?? null;
}

/**
 * Map an Event History entry to a CareSignal, or null when it is not evidence of
 * anyone at the door.
 *
 * `ding` is the doorbell button and `motion` is motion, as in the webhooks. `on_demand`
 * is a live view: someone (in the family, or an app) chose to look through the camera.
 * That is a person looking, not a person arriving, so it is not presence at the door
 * and never counts toward care. Its picture can still be fetched and shown to a person.
 */
export function ringHistoryToSignal(event: RingHistoryEvent): CareSignal | null {
  const at = new Date(event.start).toISOString();
  const subType = event.subType;
  const raw: Record<string, unknown> = {
    ringEventId: event.id,
    ...(event.deviceId ? { deviceId: event.deviceId } : {}),
    ringType: event.type,
    ...(subType ? { subType } : {}),
    via: 'event_history',
  };
  switch (event.type) {
    case 'ding':
      return {
        source: 'ring',
        kind: 'door_activity',
        at,
        detail: 'Someone pressed the doorbell',
        raw,
      };
    case 'motion':
      if (subType && /package|delivery/.test(subType)) {
        return {
          source: 'ring',
          kind: 'delivery_arrived',
          at,
          detail: 'Package detected at the door',
          raw,
        };
      }
      return { source: 'ring', kind: 'motion', at, detail: motionDetail(subType), raw };
    default:
      return null;
  }
}

/** What Ring classified the motion as, in its own words: a person, never who. */
function motionDetail(subType: string | undefined): string {
  switch (subType) {
    case 'human':
      return 'A person was detected at the door';
    case 'vehicle':
      return 'A vehicle was detected at the door';
    case 'animal':
      return 'An animal was detected at the door';
    default:
      return `Motion detected${subType && subType !== 'motion' ? ` (${subType})` : ''}`;
  }
}

/** Ring's epoch-millisecond time as ISO, or undefined when it is not one. */
function ringTime(ms: unknown): string | undefined {
  const n = typeof ms === 'string' ? Number(ms) : ms;
  return typeof n === 'number' && Number.isFinite(n) && n > 0
    ? new Date(n).toISOString()
    : undefined;
}
