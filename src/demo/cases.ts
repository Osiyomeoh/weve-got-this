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

export type CareCaseId = 'eyes' | 'memory' | 'wheelchair';

export const CARE_CASES: readonly CareCaseId[] = ['eyes', 'memory', 'wheelchair'];

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
};

export function isCareCase(v: unknown): v is CareCaseId {
  return typeof v === 'string' && (CARE_CASES as readonly string[]).includes(v);
}
