import type { CareStore } from '../store/store.js';
import { careCaseFor, type CareCaseId, type FamilyNames } from './cases.js';

/**
 * The demo household: Daddy, going on 70 in Lagos, two of his grown children nearby, a
 * son in London, and the family's paid driver.
 *
 * A fictional family modelled on the builder's own: a father recovering from surgery,
 * with drops and supplements to take, check-ups to get to, and getting around no longer
 * easy, cared for by children who also have to work. No real names or medical detail.
 * Seeded rather than invented at runtime so the story is identical every time it is
 * shown, and anyone who clones the repo sees what the video shows.
 *
 * Ids and tokens (`m_margaret`, `david-token`, ...) are stable keys kept from the first
 * version of the demo. Nothing a person sees or hears uses them, and they cannot change
 * without breaking what depends on them: the live DynamoDB records, the Telegram
 * member mapping, and the tokens published in the README for judges to try.
 */

export const DEMO_TOKENS: Record<string, string> = {
  'margaret-token': 'm_margaret',
  'david-token': 'm_david',
  'renee-token': 'm_renee',
  'aide-token': 'm_aide',
  'kunle-token': 'm_kunle',
};

export const DEMO_HOUSEHOLD_ID = 'h_margaret';

export async function seedDemoHousehold(
  store: CareStore,
  options: { suffix?: string; careCase?: CareCaseId; names?: FamilyNames } = {},
): Promise<void> {
  const c = careCaseFor(options.careCase, options.names);
  // A suffix gives a per-visitor sandbox copy ids of its own; ids are global keys.
  const sid = (id: string): string => `${id}${options.suffix ?? ''}`;
  const HOUSEHOLD_ID = sid(DEMO_HOUSEHOLD_ID);
  let seeded;
  try {
    seeded = store.getCareState(HOUSEHOLD_ID).household;
  } catch {
    /* not seeded yet */
  }
  if (seeded) {
    // The demo families were "Daddy's care circle" and so on until 2026-10-20. A copy
    // seeded before then keeps its stored name, so that name, and only that one, is
    // brought in line; a name someone chose stays.
    if (seeded.name === c.household.replace(/ circle$/, ' care circle'))
      await store.renameHousehold(HOUSEHOLD_ID, c.household);
    return; // already seeded
  }

  await store.addHousehold({
    id: HOUSEHOLD_ID,
    name: c.household,
    timezone: c.timezone ?? 'Africa/Lagos',
  });

  await store.addMember({
    id: sid('m_margaret'),
    householdId: HOUSEHOLD_ID,
    name: c.recipient.name,
    role: 'care_recipient',
    spokenAs: c.recipient.spokenAs,
    // Standing needs (see cases.ts): logistics facts that rank a dropped task higher,
    // never a label the system may editorialise about.
    attributes: c.recipient.attributes,
  });
  const away = c.childrenLiveIn ? { livesAway: c.childrenLiveIn } : {};
  const f = c.family;
  const where = (p?: { livesAway?: string }) => (p?.livesAway ? { livesAway: p.livesAway } : away);
  await store.addMember({
    id: sid('m_david'),
    householdId: HOUSEHOLD_ID,
    name: f?.primary.name ?? 'Tolu',
    role: 'primary_caregiver',
    ...where(f?.primary),
  });
  await store.addMember({
    id: sid('m_renee'),
    householdId: HOUSEHOLD_ID,
    name: f?.caregiver.name ?? 'Funmi',
    role: 'caregiver',
    ...where(f?.caregiver),
  });
  await store.addMember({
    id: sid('m_aide'),
    householdId: HOUSEHOLD_ID,
    name: c.helper ?? 'Musa',
    role: 'helper',
  });
  // A brother in London: wants to know how the day went, and can't drive anyone to a
  // clinic in Lagos. He gets the evening update and is never picked for in-person work.
  await store.addMember({
    id: sid('m_kunle'),
    householdId: HOUSEHOLD_ID,
    name: f?.away.name ?? 'Kunle',
    role: 'caregiver',
    livesAway: f?.away.livesAway ?? 'London',
    dailyUpdate: true,
  });

  await store.addMedication({
    id: sid('med_heart'),
    householdId: HOUSEHOLD_ID,
    name: c.medication,
    times: ['08:00', '20:00'],
    forMemberId: sid('m_margaret'),
  });
  await store.addMedication({
    id: sid('med_thyroid'),
    householdId: HOUSEHOLD_ID,
    name: c.supplement,
    times: ['08:00'],
    forMemberId: sid('m_margaret'),
  });

  // The eye clinic as a first-class non-person node. The ride obligation points its
  // subject at Daddy (whose mobility need drives risk); this entity is here so the graph
  // names the destination the ride is *to*.
  await store.addEntity({
    id: sid('e_cardiology'),
    householdId: HOUSEHOLD_ID,
    type: 'service',
    name: c.appointment.place,
  });
}
