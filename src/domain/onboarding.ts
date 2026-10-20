import type { CareState, Obligation } from './types.js';
import { detectCareGaps, pendingProposals } from './gaps.js';
import { RULES } from './inference.js';

/**
 * First run — walking a real family in, not making them guess a magic phrase.
 *
 * Every tool needed to set up a circle already exists (`create_household`,
 * `add_member`, `add_medication`). What was missing is the thing that turns a pile
 * of tools into a product: knowing, at any moment, *where this person is* in getting
 * started, and what the single next step is. A customer who authenticates and is met
 * with silence has not been onboarded; they have been handed a toolbox.
 *
 * So onboarding is a small state machine over the care record - pure, like the gap
 * engine - and both the voice planner and a setup screen read the same answer from
 * it. Determinism matters here for the same reason it matters everywhere else: the
 * step a person is shown is recomputed from the record, never remembered separately
 * and never able to drift from what is actually true.
 *
 * The order is deliberate: a circle, then the person it is *for*, then one real
 * detail that makes the value visible on day one. We stop asking for setup the moment
 * there is enough to show a first Care Gap, because the product earns its keep by
 * doing something, not by finishing a form.
 */

export type OnboardingStep =
  /** Authenticated, but not part of any circle yet. */
  | 'create_circle'
  /** Circle exists, but nobody is marked as the person being cared for. */
  | 'add_recipient'
  /** The circle knows who it is for, but has nothing to watch over yet. */
  | 'add_care_detail'
  /** Enough is set up that the product is doing its job. */
  | 'ready';

export interface FirstGap {
  what: string;
  because: string;
  /** The work behind the gap, so a screen can offer "I'll take it". */
  obligationId?: string;
}

/**
 * A guess the app made from what was just set up ("will Mum need a ride?"). It is not
 * work until someone says yes, so it is asked, never shown as a gap.
 */
export interface FirstQuestion {
  obligationId: string;
  what: string;
  /** The question, worded as the appointment flow first asked it. */
  ask: string;
}

export interface OnboardingProgress {
  step: OnboardingStep;
  /** Steps already behind them, in order - so a screen can show a filled checklist. */
  done: OnboardingStep[];
  /** One sentence, ready to speak, telling them the next thing. */
  spoken: string;
  /** On `ready`, the first thing nobody owns - the reason to keep the product. */
  firstGap?: FirstGap;
  /** On `ready` with no gap yet, the guess to put to them first. */
  question?: FirstQuestion;
  /** True once setup is complete; a caller can stop prompting for it. */
  complete: boolean;
}

const ORDER: OnboardingStep[] = ['create_circle', 'add_recipient', 'add_care_detail', 'ready'];

function priorSteps(step: OnboardingStep): OnboardingStep[] {
  return ORDER.slice(0, ORDER.indexOf(step));
}

/** Ask about a proposal in the words its rule used when it was made (inference.ts). */
function askAbout(state: CareState, o: Obligation, subject: string): string {
  if (o.provenance.kind !== 'INFERRED') return `${o.what}?`;
  const { rule: ruleId, from } = o.provenance;
  const rule = RULES.find((r) => r.id === ruleId);
  const kind = state.events.find((e) => e.id === o.sourceEventId)?.data['appointmentKind'];
  return rule && typeof kind === 'string'
    ? rule.ask(subject, kind)
    : `${o.what}? I'm guessing from ${from}, not from anything anyone told me.`;
}

/**
 * Where this caller is in getting set up.
 *
 * `state` is null when the caller has authenticated but belongs to no circle yet -
 * the one moment `create_household` is the only thing they can do. Otherwise it is
 * their household, and the step is read from what the record does and does not hold.
 */
export function onboardingProgress(
  state: CareState | null,
  opts: { now?: Date } = {},
): OnboardingProgress {
  if (!state) {
    return {
      step: 'create_circle',
      done: [],
      complete: false,
      spoken:
        "Let's set up your care circle. What would you like to call it, and who are " +
        'you looking after?',
    };
  }

  const hasRecipient = state.members.some((m) => m.role === 'care_recipient');
  if (!hasRecipient) {
    const who = state.members.find((m) => m.role === 'primary_caregiver');
    const lead = who ? `You've started ${state.household.name}. ` : '';
    return {
      step: 'add_recipient',
      done: priorSteps('add_recipient'),
      complete: false,
      spoken: `${lead}Who is the circle caring for? Tell me their name, and I'll add them.`,
    };
  }

  const recipient = state.members.find((m) => m.role === 'care_recipient')!;
  const name = recipient.spokenAs ?? recipient.name;
  const hasSomethingToWatch = state.medications.length > 0 || state.obligations.length > 0;

  if (!hasSomethingToWatch) {
    return {
      step: 'add_care_detail',
      done: priorSteps('add_care_detail'),
      complete: false,
      spoken:
        `Good - the circle is set up for ${name}. Now give me one thing to keep an ` +
        `eye on: a medication and the times it's due, or an appointment coming up. ` +
        `That's when ${name}'s care board starts working.`,
    };
  }

  // Ready: lead on the first thing nobody owns, because that is the product's point.
  const gaps = detectCareGaps(state, opts.now ? { now: opts.now } : {});
  const top = gaps[0];
  const firstGap: FirstGap | undefined = top
    ? {
        what: top.spoken,
        because: top.because,
        ...(top.obligationId ? { obligationId: top.obligationId } : {}),
      }
    : undefined;
  // With nothing to take yet, a guess the setup produced is the next thing to settle:
  // an appointment's ride is asked about, never put on the board unconfirmed.
  const pending = top ? undefined : pendingProposals(state)[0];
  const question: FirstQuestion | undefined = pending
    ? { obligationId: pending.id, what: pending.what, ask: askAbout(state, pending, name) }
    : undefined;

  const spoken = top
    ? `You're all set. Here's the first thing that needs someone: ${top.spoken} ` +
      `Say "I'll take it", or ask me to find who's free.`
    : question
      ? `You're all set up for ${name}. One question first: ${question.ask}`
      : `You're all set up for ${name}. Nothing needs anyone yet - I'll keep watch and ` +
        `let the circle know the moment something does.`;

  return {
    step: 'ready',
    done: priorSteps('ready'),
    complete: true,
    spoken,
    ...(firstGap ? { firstGap } : {}),
    ...(question ? { question } : {}),
  };
}
