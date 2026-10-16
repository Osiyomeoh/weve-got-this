/**
 * "This week's promises" - every piece of work somebody said yes to, and what the record
 * shows since: the ask, the yes, any "still on?" and its answer, and the done, with what
 * the doorbell saw beside it.
 *
 * Agents ask; people promise. This is the page of the family's own word. It is built only
 * from what was recorded - the obligation's transitions and the events about it - and it
 * says no more than they do. A yes is said to be a yes only when the person who gave it
 * wrote it; work that is due with nothing marked reads "nothing's been marked yet", never
 * as a promise broken. A hand-back is an answer, not a failure.
 *
 * Pure, like the provenance walk it sits beside: promises.test.ts holds it to that.
 */
import type { CareEvent, CareState, Obligation } from './types.ts';
import type { ObligationTransition } from '../store/store.ts';
import { evidenceLine } from './evidence.js';
import { localParts } from './gaps.js';
import { afterOn, asTask, clockTime, dueSpoken, isLocalToday } from './local-time.js';

/** Where a promise stands now. */
export type PromiseStage =
  /** Said yes, and it is not due yet, or nobody has checked in. */
  | 'promised'
  /** Past its time with nothing marked; the app asked "still on?" and has no answer. */
  | 'checking'
  /** The person said it is still on. */
  | 'still_on'
  /** Marked done. */
  | 'done'
  /** Handed back, and nobody has it. */
  | 'open'
  /** Handed back, and someone else has been asked. */
  | 'asking'
  /** Someone said it was not needed after all. */
  | 'set_aside';

export type PromiseStepKind =
  | 'asked'
  | 'no'
  | 'yes'
  | 'took_on'
  /** It went on someone's name, and the record cannot show it was their own yes. */
  | 'owned'
  | 'still_on_asked'
  | 'told'
  | 'still_on'
  | 'handed_back'
  | 'done'
  | 'set_aside';

export interface PromiseStep {
  kind: PromiseStepKind;
  at: string;
  /** Who did it, as spoken: a person, or "the app". */
  who?: string;
  /** Who it was addressed to (an ask, a check-in, a heads-up), or who it went to ("owned"). */
  to?: string;
  /** The AI agent it came through, when one named itself. */
  via?: string;
  /** The person pressed it on their own client's form; no model gave this answer for them. */
  onForm?: true;
  /** One line, safe to read aloud. */
  detail: string;
}

export interface WeekPromise {
  obligationId: string;
  what: string;
  dueAt?: string;
  /** Whose yes this is: the latest person to say it. */
  promisedBy: string;
  /** Who holds it now, or null when it was handed back or is finished. */
  owner: string | null;
  stage: PromiseStage;
  steps: PromiseStep[];
  /** What the devices saw around the time it was marked done, beside the record. */
  evidence: string[];
  /** One or two sentences, ready to speak. */
  spoken: string;
}

type NameOf = (id: string | null) => string | undefined;

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** The order a family wants to hear them in: what needs an answer first. */
const STAGE_ORDER: Record<PromiseStage, number> = {
  checking: 0,
  open: 1,
  asking: 2,
  still_on: 3,
  promised: 4,
  done: 5,
  set_aside: 6,
};

const YES_KINDS = new Set<PromiseStepKind>(['yes', 'took_on', 'owned']);

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** " at 8:16 PM" today, " yesterday at 8:16 PM", " on Tuesday" this week, " on October 7" before. */
function when(at: string, timezone: string, now: Date): string {
  if (isLocalToday(at, now, timezone)) return ` at ${clockTime(at, timezone)}`;
  const then = new Date(at);
  const days =
    (new Date(localParts(now, timezone).date).getTime() -
      new Date(localParts(then, timezone).date).getTime()) /
    DAY_MS;
  if (days === 1) return ` yesterday at ${clockTime(at, timezone)}`;
  const day = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, ...o }).format(then);
  if (days > 1 && days < 7) return ` on ${day({ weekday: 'long' })}`;
  return ` on ${day({ month: 'long', day: 'numeric' })}`;
}

/** The asks, check-ins and "still on" answers about this obligation. */
function eventSteps(
  o: Obligation,
  events: CareEvent[],
  nameOf: NameOf,
  timezone: string,
  now: Date,
): PromiseStep[] {
  const steps: PromiseStep[] = [];
  for (const e of events) {
    if (e.data['obligationId'] !== o.id) continue;
    const who = nameOf(e.reportedBy) ?? 'someone';
    const by = `${capital(who)}${e.via ? `, through ${e.via},` : ''}`;
    const on = when(e.occurredAt, timezone, now);
    const via = e.via ? { via: e.via } : {};
    if (e.kind === 'owner_requested') {
      const askedOf = nameOf((e.data['askedOfId'] as string | undefined) ?? null) ?? 'someone';
      const base = { at: e.occurredAt, who, to: askedOf, ...via };
      if (e.data['escalation'] === true) {
        steps.push({ kind: 'told', ...base, detail: `${by} let ${askedOf} know${on}.` });
      } else if (e.data['followUp'] === true) {
        steps.push({
          kind: 'still_on_asked',
          ...base,
          detail: `${by} checked in with ${askedOf}${on} to ask if it's still on.`,
        });
      } else {
        steps.push({ kind: 'asked', ...base, detail: `${by} asked ${askedOf}${on}.` });
      }
    } else if (e.kind === 'request_answered' && e.data['stillOn'] === true) {
      const pressed = e.data['onForm'] === true;
      steps.push({
        kind: 'still_on',
        at: e.occurredAt,
        who,
        ...via,
        ...(pressed ? { onForm: true as const } : {}),
        detail: pressed
          ? `${by} pressed Yes to say it's still on${afterOn(on)}.`
          : `${by} said it's still on${afterOn(on)}.`,
      });
    }
  }
  return steps;
}

/**
 * The ownership moves. A move to ASSIGNED is spoken as the person's own yes only when the
 * record shows it was theirs: they answered yes to an ask, or it is the move that put the
 * work with them and they wrote it. Anything else is only "it became theirs".
 */
function transitionSteps(
  o: Obligation,
  transitions: ObligationTransition[],
  events: CareEvent[],
  nameOf: NameOf,
  timezone: string,
  now: Date,
): PromiseStep[] {
  const mine = events.filter((e) => e.data['obligationId'] === o.id);
  const answered = (memberId: string, accepted: boolean) =>
    mine.some(
      (e) =>
        e.kind === 'request_answered' &&
        e.reportedBy === memberId &&
        e.data['accepted'] === accepted &&
        e.data['stillOn'] !== true,
    );
  const ordered = [...transitions].sort((a, b) => a.at.localeCompare(b.at));
  const lastAssign = ordered.filter((t) => t.to === 'ASSIGNED').at(-1);
  const steps: PromiseStep[] = [];
  for (const t of ordered) {
    const named = nameOf(t.byMemberId);
    const who = named ?? 'someone';
    const by = `${capital(who)}${t.via ? `, through ${t.via},` : ''}`;
    const on = when(t.at, timezone, now);
    const base = {
      at: t.at,
      who,
      ...(t.via ? { via: t.via } : {}),
      ...(t.onForm ? { onForm: true as const } : {}),
    };
    if (t.to === 'ASSIGNED') {
      const own =
        !!named &&
        ((t === lastAssign && t.byMemberId === o.ownerId) || answered(t.byMemberId, true));
      if (own && t.from === 'REQUESTED')
        steps.push({
          kind: 'yes',
          ...base,
          detail: t.onForm ? `${by} pressed Yes${on}.` : `${by} said yes${on}.`,
        });
      else if (own)
        steps.push({
          kind: 'took_on',
          ...base,
          detail: t.onForm
            ? `${by} pressed Yes to take it on${afterOn(on)}.`
            : `${by} offered to take it on${afterOn(on)}.`,
        });
      else {
        const holder = t === lastAssign ? nameOf(o.ownerId) : undefined;
        steps.push({
          kind: 'owned',
          at: t.at,
          ...(holder ? { to: holder } : {}),
          detail: holder ? `It went to ${holder}${on}.` : `It became owned${on}.`,
        });
      }
    } else if (t.to === 'OPEN' && t.from === 'REQUESTED') {
      steps.push({
        kind: 'no',
        ...base,
        detail: answered(t.byMemberId, false)
          ? `${by} said no${on}.`
          : `The ask came back without a yes${on}.`,
      });
    } else if (t.to === 'OPEN' && t.from === 'ASSIGNED') {
      steps.push({ kind: 'handed_back', ...base, detail: `${by} handed it back${on}.` });
    } else if (t.to === 'RESOLVED') {
      steps.push({ kind: 'done', ...base, detail: `${by} marked it done${on}.` });
    } else if (t.to === 'DISMISSED') {
      steps.push({ kind: 'set_aside', ...base, detail: `${by} set it aside as not needed${on}.` });
    }
  }
  // Work that was put on someone's name when it was written down, with no move since.
  if (
    !steps.some((s) => YES_KINDS.has(s.kind)) &&
    o.ownerId &&
    !ordered.some((t) => t.to === 'ASSIGNED')
  ) {
    const holder = nameOf(o.ownerId);
    if (holder)
      steps.push({
        kind: 'owned',
        at: o.createdAt,
        to: holder,
        detail: `${capital(holder)} has had it since${when(o.createdAt, timezone, now)}.`,
      });
  }
  return steps;
}

/** What the doorbell saw around the time it was marked done: recorded with the verdict, never as it. */
function closingEvidence(o: Obligation, events: CareEvent[], timezone: string): string[] {
  if (o.status !== 'RESOLVED') return [];
  const closed = events
    .filter((e) => e.kind === 'obligation_resolved' && e.data['obligationId'] === o.id)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
  return (closed?.derivedFrom ?? [])
    .map((id) => events.find((e) => e.id === id))
    .filter((e): e is CareEvent => !!e)
    .map((e) => evidenceLine(e, timezone));
}

function stageOf(o: Obligation, steps: PromiseStep[]): PromiseStage {
  if (o.status === 'RESOLVED') return 'done';
  if (o.status === 'DISMISSED') return 'set_aside';
  if (o.status === 'REQUESTED') return 'asking';
  if (o.status !== 'ASSIGNED') return 'open';
  const yesAt = steps.filter((s) => YES_KINDS.has(s.kind)).at(-1)?.at ?? '';
  const since = steps.filter((s) => s.at >= yesAt);
  if (since.some((s) => s.kind === 'still_on')) return 'still_on';
  if (since.some((s) => s.kind === 'still_on_asked')) return 'checking';
  return 'promised';
}

/** Whose yes it is: the person who gave it, or for "owned", who it went to. */
function promiser(yes: PromiseStep): string {
  return (yes.kind === 'owned' ? yes.to : yes.who) ?? 'someone';
}

function last(steps: PromiseStep[], kind: PromiseStepKind): PromiseStep | undefined {
  return steps.filter((s) => s.kind === kind).at(-1);
}

function speak(
  o: Obligation,
  stage: PromiseStage,
  steps: PromiseStep[],
  evidence: string[],
  timezone: string,
  now: Date,
): string {
  const yes = steps.filter((s) => YES_KINDS.has(s.kind)).at(-1)!;
  const who = capital(promiser(yes));
  const task = asTask(o.what);
  const head =
    yes.kind === 'yes'
      ? `${who} said yes to ${task}`
      : yes.kind === 'took_on'
        ? `${who} offered to ${task}`
        : `${who} has "${o.what}"`;
  const due = dueSpoken(o.dueAt, timezone, now);
  const dueClause = due ? `, due ${due}` : '';
  const at = (s: PromiseStep | undefined) => (s ? when(s.at, timezone, now) : '');

  switch (stage) {
    case 'promised':
      return `${head}${dueClause}.`;
    case 'checking': {
      const asked = last(steps, 'still_on_asked');
      const told = last(steps, 'told');
      return (
        `${head}${dueClause}. ${capital(asked?.who ?? 'the app')} checked in${at(asked)} to ask if ` +
        `it's still on, and nothing's been marked yet.` +
        (told ? ` ${capital(told.who ?? 'the app')} also let ${told.to} know${at(told)}.` : '')
      );
    }
    case 'still_on': {
      const said = last(steps, 'still_on');
      const asked = last(steps, 'still_on_asked');
      return asked && asked.at <= said!.at
        ? `${head}${dueClause}. When ${asked.who ?? 'the app'} checked in${at(asked)}, ${who} said it's still on.`
        : `${head}${dueClause}, and said it's still on${at(said)}.`;
    }
    case 'done': {
      const done = last(steps, 'done');
      const by = done?.who && done.who !== promiser(yes) ? `${capital(done.who)} ` : '';
      const seen = evidence.length
        ? ` Around then the doorbell saw ${evidence.length > 1 ? `${evidence.slice(0, -1).join(', ')} and ${evidence.at(-1)}` : evidence[0]}.`
        : '';
      return `${head}, and ${by}marked it done${at(done)}.${seen}`;
    }
    case 'set_aside': {
      const set = last(steps, 'set_aside');
      return `${head}. ${capital(set?.who ?? 'someone')} later set it aside as not needed${at(set)}.`;
    }
    case 'open': {
      const back = last(steps, 'handed_back');
      return back
        ? `${head}, then handed it back${at(back)}, so nobody has it right now.`
        : `${head}, and nobody has it right now.`;
    }
    case 'asking': {
      const back = last(steps, 'handed_back');
      const ask = last(steps, 'asked');
      const handed = back ? `, then handed it back${at(back)}` : '';
      return ask
        ? `${head}${handed}. ${capital(ask.who ?? 'someone')} asked ${ask.to}${at(ask)}, and there's no answer yet.`
        : `${head}${handed}, and someone else has been asked.`;
    }
  }
}

/**
 * Every promise that belongs to this week: the yes, the due time, or the done falls in
 * the seven days either side of now. Ordered for listening: what is waiting on an answer
 * first, then what is coming, then what is done.
 */
export function promisesThisWeek(
  state: CareState,
  transitionsOf: (obligationId: string) => ObligationTransition[],
  nameOf: NameOf,
  now: Date,
): WeekPromise[] {
  const timezone = state.household.timezone;
  const from = now.getTime() - WEEK_MS;
  const to = now.getTime() + WEEK_MS;
  const promises: WeekPromise[] = [];
  for (const o of state.obligations) {
    if (o.status === 'PROPOSED') continue;
    const steps = [
      ...eventSteps(o, state.events, nameOf, timezone, now),
      ...transitionSteps(o, transitionsOf(o.id), state.events, nameOf, timezone, now),
    ].sort((a, b) => a.at.localeCompare(b.at));
    const yes = steps.filter((s) => YES_KINDS.has(s.kind)).at(-1);
    if (!yes) continue;
    const due = o.dueAt ? new Date(o.dueAt).getTime() : NaN;
    const thisWeek =
      (due >= from && due <= to) || steps.some((s) => new Date(s.at).getTime() >= from);
    if (!thisWeek) continue;
    const stage = stageOf(o, steps);
    const evidence = closingEvidence(o, state.events, timezone);
    promises.push({
      obligationId: o.id,
      what: o.what,
      ...(o.dueAt ? { dueAt: o.dueAt } : {}),
      promisedBy: promiser(yes),
      owner: o.status === 'ASSIGNED' ? (nameOf(o.ownerId) ?? null) : null,
      stage,
      steps,
      evidence,
      spoken: speak(o, stage, steps, evidence, timezone, now),
    });
  }
  const latest = (p: WeekPromise) => p.steps.at(-1)?.at ?? '';
  return promises.sort(
    (a, b) =>
      STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] ||
      (a.stage === 'done' || a.stage === 'set_aside'
        ? latest(b).localeCompare(latest(a))
        : (a.dueAt ?? '￿').localeCompare(b.dueAt ?? '￿')),
  );
}
