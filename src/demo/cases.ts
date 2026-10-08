import type { EntityAttributes } from '../domain/types.js';

/**
 * Who the family is caring for, in a visitor's copy of the demo.
 *
 * The demo family is modelled on the builder's own: a father a week out of eye surgery.
 * That story is told as it happened and is the default everywhere. The other cases are
 * simulated families, labelled as such wherever they are shown, so a visitor can see the
 * same coordination around someone with early memory loss or someone who uses a
 * wheelchair. Each one uses only what the product really does: the record answers "did I
 * already?", a standing need ranks a dropped task higher and is spoken as a fact about the
 * task, never about the person.
 *
 * Ids stay the same across cases (m_margaret is always the person cared for), so tokens,
 * the console and the world work unchanged; only names, needs and wording differ.
 */

export type CareCaseId = 'eyes' | 'memory' | 'wheelchair' | 'hometown' | 'us' | 'abroad' | 'ke';

export const CARE_CASES: readonly CareCaseId[] = ['eyes', 'memory', 'wheelchair', 'hometown', 'us', 'abroad', 'ke'];

export interface CareCase {
  household: string;
  recipient: { name: string; spokenAs: string; attributes: EntityAttributes };
  /** Medication names: the twice-daily one (morning and 8 PM) and the morning-only one. */
  medication: string;
  supplement: string;
  /** `inferredFrom` is what the ride was first guessed from, before a person confirmed it. */
  appointment: { kind: string; detail: string; place: string; ride: string; inferredFrom: string };
  refill: string;
  note: string;
  /** Who helps in person (m_aide), when it is not the family's driver, Musa. */
  helper?: string;
  /**
   * Where Tolu and Funmi live, when it is not near the person they care for. They can take
   * anything on themselves, but CareCircle never picks them on its own for work that needs
   * someone there (see delegation.ts): the people nearby are who it asks.
   */
  childrenLiveIn?: string;
  /** The household's zone, when it is not Lagos. Every "today" and "8 PM" is in it. */
  timezone?: string;
  /**
   * The family's own names, when they are not Tolu, Funmi and Kunle, and where each lives.
   * The ids stay the same (m_david, m_renee, m_kunle), so nothing downstream changes.
   */
  family?: {
    primary: { name: string; livesAway?: string };
    caregiver: { name: string; livesAway?: string };
    away: { name: string; livesAway: string };
  };
}

export const CASES: Record<CareCaseId, CareCase> = {
  eyes: {
    household: "Daddy's care circle",
    // Getting around is no longer easy for him, so a ride to a check-up needs care and
    // an accessible vehicle. A logistics fact the graph carries so a dropped ride ranks
    // with the weight it deserves - never a label the system may editorialise about.
    recipient: { name: 'Joseph', spokenAs: 'Daddy', attributes: { needsAccessibleTransport: true } },
    medication: 'eye drops',
    supplement: 'supplement',
    appointment: {
      kind: 'eye check-up', detail: 'Eye check-up, Thursday at 10', place: 'Eye clinic',
      ride: 'Take Daddy to his eye check-up', inferredFrom: 'eye check-up appointment',
    },
    refill: "Pick up Daddy's eye drops refill",
    note: 'Daddy asked who is taking him on Thursday.',
  },
  memory: {
    household: "Mama's care circle",
    // Someone has to go in with her and hear what the doctor says, not just drop her off.
    recipient: { name: 'Grace', spokenAs: 'Mama', attributes: { requiresAssistance: true } },
    medication: 'blood pressure tablet',
    supplement: 'supplement',
    appointment: {
      kind: 'memory clinic appointment', detail: 'Memory clinic, Thursday at 10', place: 'Memory clinic',
      ride: 'Take Mama to her memory clinic appointment', inferredFrom: 'memory clinic appointment',
    },
    refill: "Pick up Mama's blood pressure tablets refill",
    note: 'Mama asked who is taking her on Thursday.',
  },
  wheelchair: {
    household: "Baba's care circle",
    recipient: { name: 'Adewale', spokenAs: 'Baba', attributes: { needsAccessibleTransport: true } },
    medication: 'blood pressure tablet',
    supplement: 'supplement',
    appointment: {
      kind: 'physiotherapy session', detail: 'Physiotherapy, Thursday at 10', place: 'Physiotherapy clinic',
      ride: 'Take Baba to physiotherapy', inferredFrom: 'physiotherapy appointment',
    },
    refill: "Pick up Baba's blood pressure tablets refill",
    note: 'Baba asked who is taking him on Thursday.',
  },
  // Mummy stays in her hometown; her children work in Lagos. The family's hands near
  // her are a neighbour's, and the house's own devices are the only witnesses.
  hometown: {
    household: "Mummy's care circle",
    recipient: { name: 'Adunni', spokenAs: 'Mummy', attributes: {} },
    medication: 'blood pressure tablet',
    supplement: 'supplement',
    appointment: {
      kind: 'hospital check-up', detail: 'Check-up at the general hospital, Thursday at 10', place: 'General hospital, Abeokuta',
      ride: 'Take Mummy to her hospital check-up', inferredFrom: 'hospital check-up appointment',
    },
    refill: "Pick up Mummy's blood pressure tablets refill",
    note: 'Mummy asked who is taking her on Thursday.',
    helper: 'Bisi',
    childrenLiveIn: 'Lagos',
  },
  // An American family: Mom lives alone in Dayton, Ohio. Her daughter coordinates from
  // Chicago between meetings; her son lives fifteen minutes away and is the one who ends up
  // doing everything; another daughter is in Seattle, a brother in Phoenix.
  us: {
    household: "Mom's care circle",
    recipient: { name: 'Linda', spokenAs: 'Mom', attributes: {} },
    medication: 'blood pressure pill',
    supplement: 'vitamin D',
    appointment: {
      kind: 'cardiology follow-up', detail: 'Cardiology follow-up, Thursday at 10', place: 'Heart center, Dayton',
      ride: 'Drive Mom to her cardiology follow-up', inferredFrom: 'cardiology follow-up appointment',
    },
    refill: "Pick up Mom's blood pressure pills from the pharmacy",
    note: 'Mom asked who is driving her on Thursday.',
    helper: 'Mike',
    timezone: 'America/New_York',
    family: {
      primary: { name: 'Sarah', livesAway: 'Chicago' },
      caregiver: { name: 'Jen', livesAway: 'Seattle' },
      away: { name: 'Tom', livesAway: 'Phoenix' },
    },
  },
  // Mummy in Ibadan; her children left: Tolu to London, Funmi to Toronto, Kunle to Houston.
  // Segun, her nephew in Ibadan, is the family's only hands nearby.
  abroad: {
    household: "Mummy's care circle",
    recipient: { name: 'Folake', spokenAs: 'Mummy', attributes: { requiresAssistance: true } },
    medication: 'blood pressure tablet',
    supplement: 'supplement',
    appointment: {
      kind: 'hospital check-up', detail: 'Check-up at University College Hospital, Thursday at 10', place: 'University College Hospital, Ibadan',
      ride: 'Take Mummy to her hospital check-up', inferredFrom: 'hospital check-up appointment',
    },
    refill: "Pick up Mummy's blood pressure tablets refill",
    note: 'Mummy asked who is taking her on Thursday.',
    helper: 'Segun',
    family: {
      primary: { name: 'Tolu', livesAway: 'London' },
      caregiver: { name: 'Funmi', livesAway: 'Toronto' },
      away: { name: 'Kunle', livesAway: 'Houston' },
    },
  },
  // A Kenyan family: Mum at home in Nyeri, her daughter coordinating from Nairobi, a son
  // working in Dubai. Njeri, the neighbour, is the one who is there.
  ke: {
    household: "Mum's care circle",
    recipient: { name: 'Wambui', spokenAs: 'Mum', attributes: {} },
    medication: 'diabetes tablet',
    supplement: 'supplement',
    appointment: {
      kind: 'diabetes clinic visit', detail: 'Diabetes clinic, Thursday at 10', place: 'Nyeri County Referral Hospital',
      ride: 'Take Mum to her diabetes clinic visit', inferredFrom: 'diabetes clinic appointment',
    },
    refill: "Pick up Mum's diabetes tablets refill",
    note: 'Mum asked who is taking her on Thursday.',
    helper: 'Njeri',
    timezone: 'Africa/Nairobi',
    family: {
      primary: { name: 'Wanjiru', livesAway: 'Nairobi' },
      caregiver: { name: 'Kamau', livesAway: 'Nairobi' },
      away: { name: 'Mwangi', livesAway: 'Dubai' },
    },
  },
};

export function isCareCase(v: unknown): v is CareCaseId {
  return typeof v === 'string' && (CARE_CASES as readonly string[]).includes(v);
}

/**
 * "Make it yours": the names a visitor's own family goes by, put over one of the cases.
 * The case still decides the need, the country and the wording; only names change. They
 * live in that visitor's throwaway copy and nowhere else: never logged, never kept.
 */
export interface FamilyNames {
  /** What the visitor calls the person cared for: "Mum", "Uncle Femi". */
  recipient: string;
  /** Who coordinates (m_david), usually the visitor. */
  primary: string;
  /** A second family caregiver (m_renee). */
  caregiver: string;
  /** Someone far away who wants the daily update (m_kunle). */
  away: string;
  /** Who helps in person nearby (m_aide). */
  helper: string;
}

const NAME = /^\p{L}[\p{L}' -]{0,22}\p{L}$|^\p{L}$/u;
const NAME_KEYS = ['recipient', 'primary', 'caregiver', 'away', 'helper'] as const;

/** Names read from an untrusted body: each a short name of letters, and all different. */
export function isFamilyNames(v: unknown): v is FamilyNames {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).some((k) => !(NAME_KEYS as readonly string[]).includes(k))) return false;
  const names = NAME_KEYS.map((k) => o[k]);
  if (!names.every((n) => typeof n === 'string' && NAME.test(n))) return false;
  return new Set((names as string[]).map((n) => n.toLowerCase())).size === names.length;
}

/** The names a case already uses, in the same order as FamilyNames. */
export function caseNames(c: CareCase): FamilyNames {
  return {
    recipient: c.recipient.spokenAs,
    primary: c.family?.primary.name ?? 'Tolu',
    caregiver: c.family?.caregiver.name ?? 'Funmi',
    away: c.family?.away.name ?? 'Kunle',
    helper: c.helper ?? 'Musa',
  };
}

/**
 * Put one set of names over another, whole words only and all at once, so a visitor
 * calling their helper "Tolu" never gets renamed twice.
 */
export function renameAll<T>(value: T, from: FamilyNames, to: FamilyNames): T {
  const map = new Map(NAME_KEYS.map((k) => [from[k], to[k]]));
  const words = [...map.keys()].sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(?<![\\p{L}])(${words.join('|')})(?![\\p{L}])`, 'gu');
  const walk = (x: unknown): unknown => typeof x === 'string' ? x.replace(re, (w) => map.get(w) ?? w)
    : Array.isArray(x) ? x.map(walk)
    : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, walk(v)]))
    : x;
  return walk(value) as T;
}

/** A case with the visitor's own names, or the case as it is when they gave none. */
export function careCaseFor(id: CareCaseId = 'eyes', names?: FamilyNames): CareCase {
  const base = CASES[id];
  if (!names) return base;
  const c = renameAll(base, caseNames(base), names);
  // The formal name is the case's own (Joseph, Linda); a visitor's family goes by what they typed.
  return {
    ...c,
    recipient: { ...c.recipient, name: names.recipient, spokenAs: names.recipient },
    helper: names.helper,
    family: {
      primary: { name: names.primary, ...(base.family?.primary.livesAway ? { livesAway: base.family.primary.livesAway } : {}) },
      caregiver: { name: names.caregiver, ...(base.family?.caregiver.livesAway ? { livesAway: base.family.caregiver.livesAway } : {}) },
      away: { name: names.away, livesAway: base.family?.away.livesAway ?? 'London' },
    },
  };
}
