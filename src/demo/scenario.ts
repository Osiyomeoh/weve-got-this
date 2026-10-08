import { toInstant } from '../domain/time.js';
import type { CareStore } from '../store/store.js';
import { careCaseFor, type CareCaseId, type FamilyNames } from './cases.js';

/**
 * The demo scenario.
 *
 * Stages the exact state the video opens on, so what is on screen matches what is
 * being said. "The eye check-up is Thursday at ten" has to genuinely be a Thursday at 10:00
 * in the household's timezone - a card reading "Wednesday at 6:44 AM" while the
 * narrator says Thursday is the kind of detail a judge notices and nobody forgives.
 */

/**
 * A local wall-clock time on the day `date` falls on *in the timezone*. The day is the
 * zone's, not UTC's: between midnight and 1 AM in Lagos it is still yesterday in UTC, and
 * reading the UTC day put Thursday's check-up on Wednesday and the morning doses on the
 * day before.
 */
function localTimeToUtc(date: Date, hour: number, minute: number, timezone: string): Date {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(date);
  const clock = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const at = toInstant(`${day}T${clock}:00`, timezone);
  if (!at) throw new Error(`Cannot place ${day} ${clock} in ${timezone}`);
  return new Date(at);
}

/** Today at a local time in the household's zone. */
function todayAt(hour: number, minute: number, now: Date, timezone: string): Date {
  return localTimeToUtc(now, hour, minute, timezone);
}

export interface ScenarioOptions {
  /** Injectable for tests. */
  now?: Date;
  /**
   * Whether Funmi has already claimed the ride. The video claims it live on camera,
   * so the opening state leaves it unowned.
   */
  rideClaimedByFunmi?: boolean;
  /**
   * Skip seeding Daddy's morning eye drops. The live walkthrough logs them on
   * camera as beat one, so seeding them as well would double-count the same dose.
   * The supplement is still seeded, so the morning is not falsely reported as a
   * missed record. Defaults to false, which keeps `npm run demo:reset` unchanged.
   */
  skipMorningEyeDrops?: boolean;
  /**
   * Appended to every member and medication id, matching `seedDemoHousehold`'s
   * suffix, so a per-visitor sandbox copy of the demo gets ids of its own.
   */
  suffix?: string;
  /**
   * The refill is due at 8 tonight rather than the day before the check-up. A visitor's
   * copy opens this way, so asking someone to fetch it gives a promise with a time on
   * it, and the agent's "still on?" can follow it up that evening (the 8:16 PM scene).
   */
  refillDueTonight?: boolean;
  /** Who the family is caring for in this copy (see cases.ts). Defaults to Daddy's eyes. */
  careCase?: CareCaseId;
  /** The visitor's own family names over the case ("Make it yours"). */
  names?: FamilyNames;
}

/**
 * Reset the demo household to the state the video opens on:
 *
 * - Daddy logged his morning eye drops at 08:10, and his supplement.
 * - His evening eye drops have no record yet - the UNCONFIRMED gap, phrased as missing.
 * - The eye check-up is on the next Thursday at 10:00, recorded by Funmi.
 * - The ride it implies has been confirmed as needed and has no owner.
 * - The eye drops refill pickup is open and unowned.
 * - Funmi left a note: Daddy asked who is taking him on Thursday.
 */
export async function seedScenario(
  store: CareStore, householdId: string, options: ScenarioOptions = {},
): Promise<{ checkUpAt: Date; rideObligationId: string }> {
  const now = options.now ?? new Date();
  const c = careCaseFor(options.careCase, options.names);
  const TZ = c.timezone ?? 'Africa/Lagos';
  const sid = (id: string): string => `${id}${options.suffix ?? ''}`;
  // The check-up is two days from whenever the day is played, at ten, and is called by that
  // day's name. A fixed "Thursday" fell on the day itself when played on a Thursday, and was
  // already past by the time anyone offered to drive.
  const checkUpAt = localTimeToUtc(new Date(now.getTime() + 2 * 86_400_000), 10, 0, TZ);
  const rideDay = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long' }).format(checkUpAt);
  const onRideDay = (text: string): string => text.replace(/Thursday/g, rideDay);

  // Morning medications, logged by Daddy himself. The eye drops are optionally
  // left for the live walkthrough to log on camera (see skipMorningEyeDrops).
  if (!options.skipMorningEyeDrops) {
    await store.appendEvent({
      householdId, kind: 'medication_taken', reportedBy: sid('m_margaret'),
      occurredAt: todayAt(8, 10, now, TZ).toISOString(),
      source: 'voice', confidence: 'reported',
      data: { medicationId: sid('med_heart'), medicationName: c.medication, aboutMemberId: sid('m_margaret') },
    });
  }
  // In a live copy the day opens at 7:42 on the eye drops, so the supplement was taken
  // before that, with breakfast. A record later than the clock would be a record from the future.
  await store.appendEvent({
    householdId, kind: 'medication_taken', reportedBy: sid('m_margaret'),
    occurredAt: (options.skipMorningEyeDrops ? todayAt(7, 25, now, TZ) : todayAt(8, 12, now, TZ)).toISOString(),
    source: 'voice', confidence: 'reported',
    data: { medicationId: sid('med_thyroid'), medicationName: c.supplement, aboutMemberId: sid('m_margaret') },
  });
  // The evening dose is deliberately absent. Not "missed" - unrecorded.

  const appointment = await store.appendEvent({
    householdId, kind: 'appointment_scheduled', reportedBy: sid('m_renee'),
    occurredAt: checkUpAt.toISOString(),
    source: 'voice', confidence: 'reported',
    detail: onRideDay(c.appointment.detail),
    data: { appointmentKind: c.appointment.kind, forMemberId: sid('m_margaret') },
  });

  const ride = await store.createObligation({
    householdId,
    what: c.appointment.ride,
    status: 'OPEN',
    consequence: 'medical',
    // Inferred originally, then confirmed by a human - which is why it counts.
    provenance: { kind: 'INFERRED', rule: 'medical-appointment-transport', from: c.appointment.inferredFrom },
    ownerId: options.rideClaimedByFunmi ? sid('m_renee') : null,
    dueAt: checkUpAt.toISOString(),
    sourceEventId: appointment.id,
    // The ride is *for* Daddy; his accessibility need flows into how this gap ranks.
    aboutEntityId: sid('m_margaret'),
  });
  if (options.rideClaimedByFunmi) {
    await store.transition(ride.id, householdId, 'ASSIGNED', sid('m_renee'), { ownerId: sid('m_renee') });
  }

  await store.createObligation({
    householdId,
    what: c.refill,
    status: 'OPEN',
    consequence: 'medical',
    // In a visitor's copy the day is played from the morning, so Funmi noticed the
    // drops running low the evening before, not at whatever real time the copy was made.
    provenance: {
      kind: 'CONFIRMED', byMemberId: sid('m_renee'),
      at: (options.refillDueTonight ? todayAt(18, 30, new Date(now.getTime() - 86_400_000), TZ) : now).toISOString(),
    },
    ownerId: null,
    dueAt: options.refillDueTonight
      ? todayAt(20, 0, now, TZ).toISOString()
      : new Date(checkUpAt.getTime() - 86_400_000).toISOString(),
  });

  await store.appendEvent({
    householdId, kind: 'note_added', reportedBy: sid('m_renee'),
    occurredAt: todayAt(14, 20, now, TZ).toISOString(),
    source: 'voice', confidence: 'reported',
    detail: onRideDay(c.note),
    data: { aboutMemberId: sid('m_margaret') },
  });

  return { checkUpAt, rideObligationId: ride.id };
}
