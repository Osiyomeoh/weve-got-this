/**
 * "How do we know this?" - the provenance chain for a single obligation.
 *
 * This is the responsibility graph's conscience made audible. It walks what the
 * system actually recorded - the obligation's origin, the event it came from, and
 * every ownership move - and speaks it back WITHOUT ever stating more certainty than
 * the record carries. A guess is spoken as a guess; an absent record is spoken as an
 * absent record, never as "she didn't do it".
 *
 * It is a pure function of the recorded state, so its honesty is testable: see
 * provenance.test.ts, which asserts the two refusals hold over the whole chain.
 */
import type { CareEvent, Obligation, Provenance } from './types.ts';
import type { ObligationTransition } from '../store/store.ts';
import { evidenceLine } from './evidence.js';
import { clockTime, isLocalToday } from './local-time.js';

/** How sure the record is at a given link. Deliberately not a single scalar - a chain
 *  can mix a confirmed origin with an inferred source, and flattening that loses the point. */
export type LinkCertainty =
  | 'confirmed' // a named human asserted it
  | 'no_record' // expected and not logged - NOT evidence of absence
  | 'inferred' // the system guessed it, by a named rule
  | 'observed' // a sensor saw it (still not a verdict about meaning)
  | 'recorded'; // a plain logged action (an ownership move)

export interface ProvenanceStep {
  at?: string;
  certainty: LinkCertainty;
  /** One plain-language line, safe to read aloud. Never accusatory. */
  detail: string;
}

export interface ProvenanceExplanation {
  obligationId: string;
  what: string;
  /** The current, authoritative ownership fact, from the obligation itself. */
  owner: string | null;
  chain: ProvenanceStep[];
  /** The whole thing as one short spoken paragraph. */
  spoken: string;
}

/** Resolve a member/device id to a spoken name, falling back to something never blank. */
type NameOf = (id: string | null) => string | undefined;

/** When the question is asked, and where: so something from today can be said by the clock. */
interface Clock {
  now?: Date;
  timezone: string;
}

/**
 * "at 8:16 PM" for something earlier today, "on March 12" otherwise. Kept coarse on
 * purpose: a full timestamp does not read aloud, and "on October 7" three times over says
 * nothing when all of it happened this evening.
 */
function fmt(at: string | undefined, clock: Clock): { text: string; phrase: string } | undefined {
  if (!at) return undefined;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return undefined;
  if (clock.now && isLocalToday(at, clock.now, clock.timezone)) {
    const text = clockTime(at, clock.timezone);
    return { text, phrase: ` at ${text}` };
  }
  const text = d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: clock.timezone,
  });
  return { text, phrase: ` on ${text}` };
}

function origin(p: Provenance, nameOf: NameOf, clock: Clock): ProvenanceStep {
  switch (p.kind) {
    case 'CONFIRMED': {
      const who = nameOf(p.byMemberId) ?? 'someone in the circle';
      const when = fmt(p.at, clock);
      return {
        ...(p.at ? { at: p.at } : {}),
        certainty: 'confirmed',
        detail: `${who} confirmed this${when?.phrase ?? ''}.`,
      };
    }
    case 'INFERRED':
      return {
        certainty: 'inferred',
        // The load-bearing sentence: named as a guess, and explicitly not yet a fact.
        detail:
          `CareCircle proposed this, guessing from ${p.from}. Nobody has confirmed it yet, ` +
          `so it is still a suggestion, not a fact.`,
      };
    case 'NOT_LOGGED': {
      const when = fmt(p.expectedAt, clock)?.text;
      return {
        ...(p.expectedAt ? { at: p.expectedAt } : {}),
        certainty: 'no_record',
        // Never an accusation: absence of a record is stated as exactly that.
        detail:
          `There is no record for this${when ? `, which was expected around ${when}` : ''}. ` +
          `No record is not the same as it not happening - it only means nobody has logged it.`,
      };
    }
  }
}

const PERSON_CHANNELS = new Set(['voice', 'tv', 'telegram', 'whatsapp', 'system']);

/** The source event the obligation was raised from, if we still have it. */
function sourceStep(
  event: CareEvent | undefined,
  nameOf: NameOf,
  clock: Clock,
): ProvenanceStep | undefined {
  if (!event) return undefined;
  const what = event.detail ?? event.kind.replace(/_/g, ' ');
  const on = fmt(event.occurredAt, clock)?.phrase ?? '';
  // Prefer the event's own first-class source/confidence; fall back to the legacy
  // data.source and the actor for events written before those fields existed.
  const src =
    event.source ?? (typeof event.data?.source === 'string' ? event.data.source : undefined);
  // A person's word stays a person's word whichever channel carried it: spoken, pressed on
  // the TV remote, or typed in a family chat. Only a device reports what it sensed.
  const observed =
    event.confidence === 'observed' ||
    (event.confidence !== 'reported' && src !== undefined && !PERSON_CHANNELS.has(src));

  if (observed) {
    // A sensed signal: observed, never interpreted as meaning by itself.
    const label = src && src !== 'device' ? `${src} signal` : 'device signal';
    return {
      at: event.occurredAt,
      certainty: 'observed',
      detail: `It started from a ${label} - "${what}"${on}. A signal is evidence, not a conclusion.`,
    };
  }
  if (event.confidence === 'inferred' || src === 'system') {
    return {
      at: event.occurredAt,
      certainty: 'inferred',
      detail: `It started from something CareCircle worked out - "${what}"${on} - which is a suggestion, not a fact.`,
    };
  }
  const who = nameOf(event.reportedBy) ?? 'someone';
  return {
    at: event.occurredAt,
    certainty: 'recorded',
    detail: `It started from something ${who} logged - "${what}"${on}.`,
  };
}

/**
 * One ownership move, spoken neutrally. We key wording on the destination status, not on
 * who performed the write, because a decline and an assignment are different facts and the
 * transition record only tells us the status and who recorded it - never that anyone failed.
 */
function ownershipStep(
  t: ObligationTransition,
  ownerId: string | null,
  nameOf: NameOf,
  clock: Clock,
): ProvenanceStep | undefined {
  // The agent the move came through rides beside the person, never in place of them.
  const who = `${nameOf(t.byMemberId) ?? 'someone'}${t.via ? `, through ${t.via},` : ''}`;
  const on = fmt(t.at, clock)?.phrase ?? '';
  const note = t.note ? ` (${t.note})` : '';
  switch (t.to) {
    case 'OPEN':
      // Either a proposal was confirmed as real, or a request came back unanswered/declined.
      return {
        at: t.at,
        certainty: 'recorded',
        detail:
          t.from === 'REQUESTED'
            ? `A request for this came back without a yes${on}, so it is open for someone else again${note}.`
            : `It was confirmed as real work that someone needs to own${on}${note}.`,
      };
    case 'REQUESTED':
      return {
        at: t.at,
        certainty: 'recorded',
        detail: `${who} asked for someone to take this on${on}${note}.`,
      };
    case 'ASSIGNED':
      // Who owns it is authoritative from the obligation. When the person who wrote this
      // row is that owner, they took it on themselves and we can say so; otherwise we only
      // record that it became owned, never inferring the owner from who wrote the row.
      if (t.byMemberId && t.byMemberId === ownerId && nameOf(t.byMemberId)) {
        return { at: t.at, certainty: 'recorded', detail: `${who} took it on${on}${note}.` };
      }
      return { at: t.at, certainty: 'recorded', detail: `It became owned${on}${note}.` };
    case 'RESOLVED':
      return { at: t.at, certainty: 'recorded', detail: `${who} marked it done${on}${note}.` };
    case 'DISMISSED':
      return {
        at: t.at,
        certainty: 'recorded',
        detail: `${who} recorded that it was not needed${on}${note}.`,
      };
    default:
      return undefined;
  }
}

function currentOwnership(o: Obligation, nameOf: NameOf): ProvenanceStep {
  // Finished work keeps its owner on record, but nobody "owns" it any more.
  if (o.status === 'RESOLVED') {
    return { certainty: 'recorded', detail: `It is resolved.` };
  }
  if (o.status === 'DISMISSED') {
    return { certainty: 'recorded', detail: `It was set aside as not needed.` };
  }
  if (o.ownerId) {
    return {
      certainty: 'confirmed',
      detail: `Right now ${nameOf(o.ownerId) ?? 'someone'} owns it.`,
    };
  }
  if (o.status === 'REQUESTED') {
    return {
      certainty: 'recorded',
      detail: `Right now it has been asked of someone but not yet accepted, so nobody owns it.`,
    };
  }
  return { certainty: 'recorded', detail: `Right now nobody owns it.` };
}

/**
 * What the devices saw around the time the work was marked done - recorded with the
 * verdict, beside it, never as it. With no device evidence nothing is said: a person's
 * word is the record, and saying "only" would quietly doubt them.
 */
function closingEvidence(
  o: Obligation,
  events: CareEvent[],
  timezone: string,
): ProvenanceStep | undefined {
  if (o.status !== 'RESOLVED') return undefined;
  const closed = events
    .filter((e) => e.kind === 'obligation_resolved' && e.data['obligationId'] === o.id)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
  const seen = (closed?.derivedFrom ?? [])
    .map((id) => events.find((e) => e.id === id))
    .filter((e): e is CareEvent => !!e);
  if (!seen.length) return undefined;
  const lines = seen.map((e) => evidenceLine(e, timezone));
  return {
    at: seen[0]!.occurredAt,
    certainty: 'observed',
    detail:
      `Around then the doorbell saw ${lines.length > 1 ? `${lines.slice(0, -1).join(', ')} and ${lines.at(-1)}` : lines[0]}. ` +
      'A signal is evidence beside the record, not proof on its own.',
  };
}

/**
 * Build the full explanation. `events` need only contain the obligation's source event;
 * anything more is ignored. `transitions` should be this obligation's history in order.
 */
export function explainProvenance(
  obligation: Obligation,
  transitions: ObligationTransition[],
  events: CareEvent[],
  nameOf: NameOf,
  timezone = 'America/New_York',
  now?: Date,
): ProvenanceExplanation {
  const clock: Clock = { timezone, ...(now ? { now } : {}) };
  const chain: ProvenanceStep[] = [origin(obligation.provenance, nameOf, clock)];

  const source = obligation.sourceEventId
    ? events.find((e) => e.id === obligation.sourceEventId)
    : undefined;
  const step = sourceStep(source, nameOf, clock);
  if (step) chain.push(step);

  const ordered = [...transitions].sort((a, b) => a.at.localeCompare(b.at));
  for (const t of ordered) {
    const os = ownershipStep(t, obligation.ownerId, nameOf, clock);
    if (os) chain.push(os);
  }

  const evidence = closingEvidence(obligation, events, timezone);
  if (evidence) chain.push(evidence);

  chain.push(currentOwnership(obligation, nameOf));

  const spoken = chain.map((s) => s.detail).join(' ');
  return {
    obligationId: obligation.id,
    what: obligation.what,
    owner: obligation.ownerId,
    chain,
    spoken,
  };
}
