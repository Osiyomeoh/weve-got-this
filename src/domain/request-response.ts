import type { CareStore } from '../store/store.js';
import type { CareState, EventSource, Obligation } from './types.js';
import { AGENT_ID } from './agent.js';

/**
 * Applying a member's answer to the request that was made of them.
 *
 * This is the same accept/decline transition the `respond_to_request` MCP tool makes,
 * factored out so a reply arriving over a different channel - a WhatsApp "yes" - travels
 * exactly the same path as one spoken to the console. If they diverged, an off-channel
 * reply would be a second, weaker way to become an owner, and the whole point is that
 * how you answered does not change what your answer means.
 *
 * The invariant it protects: only the person who was asked can answer, and only a
 * request that was actually made can be answered. A reply is matched to the sender's
 * OWN outstanding request; a "yes" from someone nobody asked assigns nothing.
 *
 * A reply can also answer the app's "still on?" about work the sender already holds, when
 * the caller knows the message was meant for the app (`checkIns`). A "can't" hands it back
 * like any decline. A "yes" keeps it theirs, but only to the question asked the day
 * before: after the time, "yes" could mean "still on" or "done", and that is not a guess
 * to make for them.
 */

export interface ResponseResult {
  ok: boolean;
  spoken: string;
  obligationId?: string;
  status?: 'ASSIGNED' | 'OPEN';
}

export async function applyRequestResponse(
  store: CareStore,
  input: {
    householdId: string;
    memberId: string;
    accepted: boolean;
    note?: string;
    channel?: EventSource;
    /** The message was meant for the app, so it may answer a check-in on work they hold. */
    checkIns?: boolean;
  },
  now: Date,
): Promise<ResponseResult> {
  const state = store.getCareState(input.householdId);

  // The one request outstanding *of this member*. Not any open request - only what they
  // themselves were asked, so a reply can never resolve someone else's obligation.
  const o = state.obligations.find(
    (ob) => ob.status === 'REQUESTED' && ob.request?.askedOfId === input.memberId,
  );
  const source: EventSource = input.channel ?? 'whatsapp';
  if (!o) {
    const held = input.checkIns ? openCheckIn(state, input.memberId) : undefined;
    if (held && (!input.accepted || held.ahead)) {
      return answerCheckIn(store, { ...input, source }, held.obligation, now);
    }
    return { ok: false, spoken: 'There is no open request for you to answer right now.' };
  }

  if (input.accepted) {
    await store.transition(
      o.id,
      input.householdId,
      'ASSIGNED',
      input.memberId,
      { ownerId: input.memberId, clearRequest: true },
      input.note,
    );
    await store.appendEvent({
      householdId: input.householdId,
      kind: 'request_answered',
      reportedBy: input.memberId,
      occurredAt: now.toISOString(),
      source,
      confidence: 'confirmed',
      ...(input.note ? { detail: input.note } : {}),
      data: { obligationId: o.id, accepted: true },
    });
    return {
      ok: true,
      spoken: `Thanks - "${o.what}" is yours now.`,
      obligationId: o.id,
      status: 'ASSIGNED',
    };
  }

  const declinedBy = [...(o.declinedBy ?? []), input.memberId];
  await store.transition(
    o.id,
    input.householdId,
    'OPEN',
    input.memberId,
    { ownerId: null, clearRequest: true, declinedBy },
    input.note,
  );
  await store.appendEvent({
    householdId: input.householdId,
    kind: 'request_answered',
    reportedBy: input.memberId,
    occurredAt: now.toISOString(),
    source,
    confidence: 'confirmed',
    ...(input.note ? { detail: input.note } : {}),
    data: { obligationId: o.id, accepted: false },
  });
  return {
    ok: true,
    spoken: `That's noted - "${o.what}" is back with no owner.`,
    obligationId: o.id,
    status: 'OPEN',
  };
}

/**
 * The app's latest "still on?" to this member that they have not answered, on work they
 * still hold. Only the app's own check-ins count: a reply is matched to a question that
 * was actually asked of them, never to work they merely own.
 */
function openCheckIn(
  state: CareState,
  memberId: string,
): { obligation: Obligation; ahead: boolean } | undefined {
  let latest: { obligation: Obligation; ahead: boolean; at: string } | undefined;
  for (const o of state.obligations) {
    if (o.status !== 'ASSIGNED' || o.ownerId !== memberId) continue;
    const about = state.events.filter((e) => e.data['obligationId'] === o.id);
    const asked = about
      .filter(
        (e) =>
          e.kind === 'owner_requested' &&
          e.reportedBy === AGENT_ID &&
          e.data['followUp'] === true &&
          e.data['escalation'] !== true &&
          e.data['askedOfId'] === memberId,
      )
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
      .at(-1);
    if (!asked) continue;
    const answered = about.some(
      (e) =>
        e.kind === 'request_answered' &&
        e.reportedBy === memberId &&
        e.occurredAt >= asked.occurredAt,
    );
    if (answered || (latest && latest.at >= asked.occurredAt)) continue;
    latest = { obligation: o, ahead: asked.data['ahead'] === true, at: asked.occurredAt };
  }
  return latest && { obligation: latest.obligation, ahead: latest.ahead };
}

/** The same two answers `respond_to_request` gives the owner of a check-in. */
async function answerCheckIn(
  store: CareStore,
  input: {
    householdId: string;
    memberId: string;
    accepted: boolean;
    note?: string;
    source: EventSource;
  },
  o: Obligation,
  now: Date,
): Promise<ResponseResult> {
  const answered = {
    householdId: input.householdId,
    kind: 'request_answered' as const,
    reportedBy: input.memberId,
    occurredAt: now.toISOString(),
    source: input.source,
    confidence: 'confirmed' as const,
    ...(input.note ? { detail: input.note } : {}),
  };
  if (input.accepted) {
    await store.appendEvent({
      ...answered,
      data: { obligationId: o.id, accepted: true, stillOn: true },
    });
    return {
      ok: true,
      spoken: `Thanks - "${o.what}" stays with you.`,
      obligationId: o.id,
      status: 'ASSIGNED',
    };
  }
  await store.transition(
    o.id,
    input.householdId,
    'OPEN',
    input.memberId,
    { ownerId: null, clearRequest: true, declinedBy: [...(o.declinedBy ?? []), input.memberId] },
    input.note,
  );
  await store.appendEvent({ ...answered, data: { obligationId: o.id, accepted: false } });
  return {
    ok: true,
    spoken: `That's noted - "${o.what}" is back with no owner.`,
    obligationId: o.id,
    status: 'OPEN',
  };
}
