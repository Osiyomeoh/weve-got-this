import type { CareStore } from '../store/store.js';
import type { EventSource } from './types.js';

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
 */

export interface ResponseResult {
  ok: boolean;
  spoken: string;
  obligationId?: string;
  status?: 'ASSIGNED' | 'OPEN';
}

export async function applyRequestResponse(
  store: CareStore,
  input: { householdId: string; memberId: string; accepted: boolean; note?: string; channel?: EventSource },
  now: Date,
): Promise<ResponseResult> {
  const state = store.getCareState(input.householdId);

  // The one request outstanding *of this member*. Not any open request - only what they
  // themselves were asked, so a reply can never resolve someone else's obligation.
  const o = state.obligations.find(
    (ob) => ob.status === 'REQUESTED' && ob.request?.askedOfId === input.memberId,
  );
  if (!o) {
    return { ok: false, spoken: 'There is no open request for you to answer right now.' };
  }

  const source: EventSource = input.channel ?? 'whatsapp';

  if (input.accepted) {
    await store.transition(
      o.id, input.householdId, 'ASSIGNED', input.memberId,
      { ownerId: input.memberId, clearRequest: true }, input.note,
    );
    await store.appendEvent({
      householdId: input.householdId, kind: 'request_answered', reportedBy: input.memberId,
      occurredAt: now.toISOString(), source, confidence: 'confirmed',
      ...(input.note ? { detail: input.note } : {}),
      data: { obligationId: o.id, accepted: true },
    });
    return { ok: true, spoken: `Thanks - "${o.what}" is yours now.`, obligationId: o.id, status: 'ASSIGNED' };
  }

  const declinedBy = [...(o.declinedBy ?? []), input.memberId];
  await store.transition(
    o.id, input.householdId, 'OPEN', input.memberId,
    { ownerId: null, clearRequest: true, declinedBy }, input.note,
  );
  await store.appendEvent({
    householdId: input.householdId, kind: 'request_answered', reportedBy: input.memberId,
    occurredAt: now.toISOString(), source, confidence: 'confirmed',
    ...(input.note ? { detail: input.note } : {}),
    data: { obligationId: o.id, accepted: false },
  });
  return {
    ok: true,
    spoken: `That's noted - "${o.what}" is back with no owner.`,
    obligationId: o.id, status: 'OPEN',
  };
}
