import type { CareStore } from '../store/store.js';
import type { Notifier } from '../notify/notifier.js';
import { checkInEvidence } from './evidence.js';
import { deliberate, AGENT_ID, type AgentAction, type Deliberation } from './agent.js';

/**
 * Carrying out what the policy decided.
 *
 * `agent.ts` decides and touches nothing; this performs the effects and touches
 * everything. Keeping them apart is what lets the hard thinking be tested against a
 * scripted week while this stays a thin, boring translation of a decision into store
 * writes and notifications.
 *
 * Every act the agent takes becomes an event in the same append-only log as every
 * human act, attributed to `system:carecircle`. That attribution is not cosmetic:
 * `attribution.ts` will render an agent-made request as "CareCircle asked Funmi",
 * never as a person having asked, so "why did I get this?" is always answerable and
 * the machine is held to the same standard of saying who-said-so as everyone else.
 */

export interface AgentRun {
  householdId: string;
  at: string;
  deliberation: Deliberation;
  /** What actually happened, after effects - delivery can fail where a decision cannot. */
  performed: Array<{ action: AgentAction; delivered: boolean }>;
}

export interface RunnerDeps {
  store: CareStore;
  notifier: Notifier;
  now?: () => Date;
}

/**
 * Run the agent once over one household.
 *
 * Idempotent in the way that matters: the policy will not re-ask a person it has
 * already asked within the fatigue window, so running this every fifteen minutes
 * does not produce a request every fifteen minutes. Safe to call on a timer, on a
 * webhook, or by hand in a demo.
 */
export async function runAgentOnce(
  householdId: string, deps: RunnerDeps,
): Promise<AgentRun> {
  const now = deps.now?.() ?? new Date();
  const state = deps.store.getCareState(householdId);
  const deliberation = deliberate(state, { now, timezone: state.household.timezone });

  const performed: AgentRun['performed'] = [];
  for (const action of deliberation.actions) {
    if (action.kind === 'STAND_DOWN' || !action.memberId) continue;

    const member = state.members.find((m) => m.id === action.memberId);
    const obligation = state.obligations.find((o) => o.id === action.obligationId);
    if (!member || !obligation) continue;
    const name = member.spokenAs ?? member.name;

    // ASK moves the obligation to REQUESTED. ESCALATE flags the primary caregiver
    // but leaves status alone - escalation is a heads-up, not another ask in the
    // queue, and turning it into REQUESTED would make the board claim the boss is
    // being asked to do the driving.
    if (action.kind === 'ASK') {
      await deps.store.transition(
        action.obligationId, householdId, 'REQUESTED', AGENT_ID,
        { ownerId: null, request: { askedOfId: member.id, askedById: AGENT_ID, askedAt: now.toISOString() } },
        `CareCircle asked ${name}`,
      );
    }

    const message = messageFor(action, obligation.what, state.members.find((m) => m.id === obligation.ownerId),
      action.followUp ? checkInEvidence(obligation, state.events, now, state.household.timezone) : '');
    const delivery = await deps.notifier.deliver({ to: member.id, toName: name, from: 'CareCircle', message });

    await deps.store.appendEvent({
      householdId,
      kind: 'owner_requested',
      reportedBy: AGENT_ID,
      occurredAt: now.toISOString(),
      // The agent is CareCircle itself deciding to act on what it inferred - so the
      // channel is `system` and the certainty is `inferred`, and the act is linked
      // back to the event the obligation came from when there is one.
      source: 'system',
      confidence: 'inferred',
      ...(obligation.sourceEventId ? { derivedFrom: [obligation.sourceEventId] } : {}),
      detail: obligation.what,
      data: {
        obligationId: action.obligationId,
        askedOfId: member.id,
        escalation: action.kind === 'ESCALATE',
        ...(action.followUp ? { followUp: true } : {}),
        delivered: delivery.delivered,
        // What the person was actually sent, so the board can show it as they saw it.
        message,
        // The arithmetic travels with the act, so an agent decision is auditable
        // from the log alone, exactly like a gap score.
        because: action.because,
        value: action.value,
      },
    });

    performed.push({ action, delivered: delivery.delivered });
  }

  return { householdId, at: now.toISOString(), deliberation, performed };
}

/**
 * What the person reads. A follow-up is a question, never a verdict: nothing being
 * recorded does not mean it did not happen, so the wording cannot say it did not.
 */
function messageFor(
  action: AgentAction, what: string, owner?: { name: string; spokenAs?: string }, seen = '',
): string {
  if (action.kind === 'CHECK_IN') {
    return `"${what}" was due a little while ago and nothing's been marked yet.${seen} Still on?\n\nReply "done" if it's handled, or "can't" and I'll find someone.`;
  }
  if (action.kind === 'ASK') {
    return `CareCircle noticed nobody has "${what}" yet. Can you take it on?\n\nReply "yes" or "can't".`;
  }
  if (action.followUp) {
    const name = owner?.spokenAs ?? owner?.name ?? 'Whoever took it on';
    return `"${what}" is past its time and nothing's recorded. ${name} hasn't answered my check-in.${seen} It may be fine, but you may want to call.`;
  }
  return `CareCircle couldn't find anyone for "${what}". It may need you to step in.`;
}

/** Run the agent over every household the store knows. */
export async function runAgentAll(deps: RunnerDeps): Promise<AgentRun[]> {
  // A visitor's sandbox copy (`<household>~<suffix>`) lives on its own story clock: the
  // story runs CareCircle's pass when its day reaches it. Run on the server's clock, the
  // pass would ask the helper about tonight's refill before the story's own asking does.
  const householdIds = [...new Set(deps.store.allMembers().map((m) => m.householdId))].filter((id) => !id.includes('~'));
  const runs: AgentRun[] = [];
  for (const id of householdIds) runs.push(await runAgentOnce(id, deps));
  return runs;
}
