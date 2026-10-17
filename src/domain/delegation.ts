import type { CareState, Member, Obligation } from './types.js';
import { can } from './auth.js';

/**
 * Choosing who to ask.
 *
 * The Care Gap engine finds work nobody owns. This decides who to *ask* about it -
 * the step between noticing a gap and closing it.
 *
 * Two rules govern everything here, and both are deliberate:
 *
 *  1. **Asking is not assigning.** Nothing in this file moves ownership. It returns
 *     candidates and the reason each was chosen; a human still has to say yes.
 *  2. **The choice must be explainable.** Every candidate carries `because` in plain
 *     language, because "the computer picked you" is not an acceptable answer when
 *     the subject is who looks after someone's mother.
 */

export interface Candidate {
  memberId: string;
  /** How to refer to them out loud. */
  name: string;
  /** Why this person, in words a model can speak unchanged. */
  because: string;
  /** How many pieces of work they already hold. Lower is why they ranked higher. */
  load: number;
  /** Other work they already hold around the time this is due, from the family calendar. */
  clashesWith?: string;
}

/**
 * Family is a *tier*, not a tie-break.
 *
 * A paid helper is scoped to the work in front of them - the same reason `canActOn`
 * limits them to what they own. Ranking purely by who is least busy would hand the
 * driver the eye-clinic run ahead of the family simply because he starts the
 * week empty, which is neither what the family means nor what they are paying for.
 * Helpers are asked only once the family members free at that time have run out.
 */
function tierOf(role: Member['role']): number {
  return role === 'helper' ? 1 : 0;
}

/** Within a tier, and only at equal load, prefer the person closest to the care. */
const ROLE_ORDER: Record<Member['role'], number> = {
  primary_caregiver: 0,
  caregiver: 1,
  helper: 2,
  care_recipient: 3,
};

/**
 * Whether a member has said they cannot cover the moment this work is due.
 *
 * Unavailability is recorded by `add_note` as an event carrying the window. We only
 * exclude somebody when we have a *stated* conflict overlapping the due time - not
 * knowing someone's plans is not evidence that they are free, but it is also not
 * evidence that they are busy, so silence leaves them eligible.
 */
export function statedUnavailable(
  member: Member,
  state: CareState,
  dueAt: string | undefined,
): boolean {
  if (!dueAt) return false;
  const due = new Date(dueAt).getTime();
  if (Number.isNaN(due)) return false;

  return state.events.some((e) => {
    const u = e.data['unavailable'] as
      { memberName?: string; from?: string; to?: string } | undefined;
    if (!u?.from || !u.to || !u.memberName) return false;
    const named = u.memberName.trim().toLowerCase();
    if (named !== member.name.toLowerCase() && named !== (member.spokenAs ?? '').toLowerCase()) {
      return false;
    }
    const from = new Date(u.from).getTime();
    const to = new Date(u.to).getTime();
    if (Number.isNaN(from) || Number.isNaN(to)) return false;
    return due >= from && due <= to;
  });
}

/**
 * How near two pieces of work have to be to clash, in hours. A ride at ten and a refill
 * at eleven cannot both be one person's morning; a ride at ten and a visit at four can.
 */
const CLASH_HOURS = 2;

/**
 * The family calendar, read from the record: the work this person has already said yes
 * to nearest the time this is due, if it is within `CLASH_HOURS`. The calendar is the
 * care record (see calendar-view.ts), so this sees the family's promises, not anyone's
 * private diary. Silence about the rest of someone's day is not evidence they are free,
 * which is why a clash only ranks a person lower and never rules them out.
 */
export function clashFor(
  memberId: string,
  obligation: Obligation,
  state: CareState,
): Obligation | undefined {
  const due = obligation.dueAt ? Date.parse(obligation.dueAt) : NaN;
  if (Number.isNaN(due)) return undefined;
  let nearest: { o: Obligation; apart: number } | undefined;
  for (const o of state.obligations) {
    if (o.id === obligation.id || o.ownerId !== memberId || o.status !== 'ASSIGNED') continue;
    const at = o.dueAt ? Date.parse(o.dueAt) : NaN;
    const apart = Math.abs(at - due);
    if (apart <= CLASH_HOURS * 3_600_000 && (!nearest || apart < nearest.apart)) {
      nearest = { o, apart };
    }
  }
  return nearest?.o;
}

/** How much work someone is already carrying. */
export function loadOf(memberId: string, state: CareState): number {
  return state.obligations.filter((o) => o.ownerId === memberId && o.status === 'ASSIGNED').length;
}

/**
 * Who could reasonably take this on, best first.
 *
 * Excluded, and each for a reason we can defend out loud:
 *  - anyone who cannot take work on at all (the care recipient is a participant in
 *    their own care, but we do not hand them their own transport problem);
 *  - whoever is doing the asking, because if they wanted it they would claim it;
 *  - anyone who has already declined this specific piece of work - the agent must
 *    not badger, and a decline is information we keep;
 *  - anyone who has *said* they cannot cover the time it is due;
 *  - anyone who lives far away. A son in London cannot drive his father to a clinic
 *    in Lagos, and asking him only adds a "can't" to the family's evening. The work
 *    here needs someone present, so they are never picked automatically. A person can
 *    still ask them by name, and they can still take anything on themselves.
 *
 * Ordering is free before busy, then family before paid help, then existing load, then
 * role, then name. Free means nothing else on the family calendar around the time this is
 * due (`clashFor`): the sister who already has the refill at eleven is asked about the ten
 * o'clock ride only once nobody free is left. Load ahead of role within a tier is what
 * stops the system quietly dumping everything on whoever answers fastest - the failure
 * mode families actually have.
 */
export function candidatesFor(
  obligation: Obligation,
  state: CareState,
  opts: { askerId?: string } = {},
): Candidate[] {
  const declined = new Set(obligation.declinedBy ?? []);

  const eligible = state.members
    .filter((m) => can(m, 'claim_obligation'))
    .filter((m) => m.id !== opts.askerId)
    .filter((m) => m.id !== obligation.ownerId)
    .filter((m) => !declined.has(m.id))
    .filter((m) => !statedUnavailable(m, state, obligation.dueAt))
    .filter((m) => !m.livesAway);

  const placed = eligible.map((m) => ({
    member: m,
    load: loadOf(m.id, state),
    clash: clashFor(m.id, obligation, state),
  }));
  const allBusy = placed.length > 0 && placed.every((p) => p.clash);
  return placed
    .sort(
      (a, b) =>
        Number(!!a.clash) - Number(!!b.clash) ||
        tierOf(a.member.role) - tierOf(b.member.role) ||
        a.load - b.load ||
        ROLE_ORDER[a.member.role] - ROLE_ORDER[b.member.role] ||
        a.member.name.localeCompare(b.member.name),
    )
    .map(({ member, load, clash }) => ({
      memberId: member.id,
      name: member.spokenAs ?? member.name,
      load,
      because: reasonFor(load, declined.size, !!obligation.dueAt, clash?.what, allBusy),
      ...(clash ? { clashesWith: clash.what } : {}),
    }));
}

function reasonFor(
  load: number,
  declinedCount: number,
  dated: boolean,
  clash: string | undefined,
  allBusy: boolean,
): string {
  if (clash && allBusy) {
    return `already has "${clash}" around then, as does everyone else who could take it on`;
  }
  const after = declinedCount > 0 ? ' and is next after the people already asked' : '';
  if (clash) return `already has "${clash}" around then${after}`;
  if (load === 0) return `has nothing else on the care board right now${after}`;
  const free = dated ? `, but nothing around then${after ? ',' : ''}` : '';
  if (load === 1) return `has one other thing on${free}${after}`;
  return `has ${load} other things on${free}${after}`;
}
