import type { CareStore } from '../store/store.js';

/**
 * The demo scenario.
 *
 * Stages the exact state the video opens on, so what is on screen matches what is
 * being said. "The eye check-up is Thursday at ten" has to genuinely be a Thursday at 10:00
 * in the household's timezone - a card reading "Wednesday at 6:44 AM" while the
 * narrator says Thursday is the kind of detail a judge notices and nobody forgives.
 */

const TZ = 'Africa/Lagos';

/** The UTC instant corresponding to a local wall-clock time in a timezone. */
function localTimeToUtc(date: Date, hour: number, minute: number, timezone: string): Date {
  // Start from the naive UTC guess, then correct by the zone's offset at that moment.
  const guess = new Date(Date.UTC(
    date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute, 0, 0,
  ));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: '2-digit', hour12: false, minute: '2-digit',
  }).formatToParts(guess);
  const asLocalHour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const asLocalMin = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const driftMinutes = (asLocalHour * 60 + asLocalMin) - (hour * 60 + minute);
  return new Date(guess.getTime() - driftMinutes * 60_000);
}

/** The next occurrence of a weekday (0=Sun) at a local time, strictly in the future. */
function nextWeekdayAt(
  weekday: number, hour: number, minute: number, from: Date, timezone: string,
): Date {
  for (let addDays = 0; addDays <= 14; addDays += 1) {
    const day = new Date(from.getTime() + addDays * 86_400_000);
    const localWeekday = new Date(
      new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(day) + 'T12:00:00Z',
    ).getUTCDay();
    if (localWeekday !== weekday) continue;
    const at = localTimeToUtc(day, hour, minute, timezone);
    if (at.getTime() > from.getTime()) return at;
  }
  throw new Error('No matching weekday found within two weeks');
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
  const sid = (id: string): string => `${id}${options.suffix ?? ''}`;
  const checkUpAt = nextWeekdayAt(4, 10, 0, now, TZ); // 4 = Thursday

  // Morning medications, logged by Daddy himself. The eye drops are optionally
  // left for the live walkthrough to log on camera (see skipMorningEyeDrops).
  if (!options.skipMorningEyeDrops) {
    await store.appendEvent({
      householdId, kind: 'medication_taken', reportedBy: sid('m_margaret'),
      occurredAt: todayAt(8, 10, now, TZ).toISOString(),
      source: 'voice', confidence: 'reported',
      data: { medicationId: sid('med_heart'), medicationName: 'eye drops', aboutMemberId: sid('m_margaret') },
    });
  }
  await store.appendEvent({
    householdId, kind: 'medication_taken', reportedBy: sid('m_margaret'),
    occurredAt: todayAt(8, 12, now, TZ).toISOString(),
    source: 'voice', confidence: 'reported',
    data: { medicationId: sid('med_thyroid'), medicationName: 'supplement', aboutMemberId: sid('m_margaret') },
  });
  // The evening dose is deliberately absent. Not "missed" - unrecorded.

  const appointment = await store.appendEvent({
    householdId, kind: 'appointment_scheduled', reportedBy: sid('m_renee'),
    occurredAt: checkUpAt.toISOString(),
    source: 'voice', confidence: 'reported',
    detail: 'Eye check-up, Thursday at 10',
    data: { appointmentKind: 'eye check-up', forMemberId: sid('m_margaret') },
  });

  const ride = await store.createObligation({
    householdId,
    what: 'Take Daddy to his eye check-up',
    status: 'OPEN',
    consequence: 'medical',
    // Inferred originally, then confirmed by a human - which is why it counts.
    provenance: { kind: 'INFERRED', rule: 'medical-appointment-transport', from: 'eye check-up appointment' },
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
    what: "Pick up Daddy's eye drops refill",
    status: 'OPEN',
    consequence: 'medical',
    provenance: { kind: 'CONFIRMED', byMemberId: sid('m_renee'), at: now.toISOString() },
    ownerId: null,
    dueAt: new Date(checkUpAt.getTime() - 86_400_000).toISOString(),
  });

  await store.appendEvent({
    householdId, kind: 'note_added', reportedBy: sid('m_renee'),
    occurredAt: todayAt(14, 20, now, TZ).toISOString(),
    source: 'voice', confidence: 'reported',
    detail: 'Daddy asked who is taking him on Thursday.',
    data: { aboutMemberId: sid('m_margaret') },
  });

  return { checkUpAt, rideObligationId: ride.id };
}
