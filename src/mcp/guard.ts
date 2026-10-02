/**
 * The action guard: a second look at a write, when it is called.
 *
 * A gate on the person's words alone was measured and ruled out (evals/results/README.md):
 * it turned away a quarter of real care requests, because "That's sorted now" only means
 * something next to what is on the board. Under Alexa+ the server never sees the words
 * anyway. What it does see, at the moment a write is called, is the tool, its arguments,
 * and the care record they would change. That is the evidence here.
 *
 * Fixed before the first measured run (scripts/action-guard.ts), and not to be changed to
 * fit a result: the statement, the framing, and the threshold. Said plainly: the harmful
 * calls it is measured on come from MASSIVE's test partition, whose failures we have read,
 * so the measure is not held out.
 *
 * When it holds a write back, the write is not refused: the planner is told to ask the
 * person whether it belongs on the care record. CareCircle asks; it never decides for them.
 */

import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { CareState } from '../domain/types.js';
import { called } from '../domain/who.js';

/** Every tool that changes the record or reaches a person. */
export const GUARDED = new Set([
  'log_care_event', 'record_appointment', 'add_note', 'claim_obligation', 'assign_obligation',
  'request_owner', 'respond_to_request', 'confirm_proposal', 'resolve_obligation',
  'notify_member', 'reorder_prescription', 'confirm_purchase', 'add_medication',
  'change_medication', 'change_appointment', 'raise_urgent',
]);

export const GUARD_STATEMENT = 'This action belongs on this family\'s care record: it records, changes or arranges '
  + 'something about looking after a person in the care circle, or tells someone in the circle about it. It is '
  + 'not a general assistant task - an alarm, a timer, the speaker\'s own errands or lists, music, a smart-home '
  + 'device, an email, shopping, the weather or the news - sent to the care record by mistake.';

export const GUARD_THRESHOLD = 0.5;

/** What the guard is shown: who is in the circle, what is on the record, and the call itself. */
export function guardEvidence(state: CareState, tool: string, args: Record<string, unknown>): string {
  const roles: Record<string, string> = {
    care_recipient: 'being looked after', primary_caregiver: 'coordinating', caregiver: 'helping',
    helper: 'paid helper', observer: 'kept informed',
  };
  const circle = state.members.map((m) => `${called(m)} (${roles[m.role] ?? m.role})`).join(', ');
  const meds = state.medications.filter((m) => !m.stoppedAt).map((m) => m.name);
  const open = state.obligations.filter((o) => !['RESOLVED', 'CANCELLED', 'EXPIRED'].includes(o.status)).map((o) => o.what);
  return [
    `A family uses a shared care record to look after a relative. The care circle: ${circle}.`,
    meds.length ? `Medicines on the record: ${meds.join(', ')}.` : '',
    open.length ? `Open tasks: ${open.slice(0, 8).join('; ')}.` : '',
    `The voice assistant is about to call the care record's "${tool}" with: ${JSON.stringify(args)}`,
  ].filter(Boolean).join('\n');
}

export interface GuardVerdict { p: number; hold: boolean; ms: number }
export type Guard = (state: CareState, tool: string, args: Record<string, unknown>) => Promise<GuardVerdict>;

/** Nova Micro on Bedrock, asked for the probability as a number - the same way the word gate was. */
export function novaGuard(options: { region?: string; modelId?: string } = {}): Guard {
  const bedrock = new BedrockRuntimeClient({ region: options.region ?? process.env['AWS_REGION'] ?? 'us-east-1' });
  const modelId = options.modelId ?? process.env['CARECIRCLE_GUARD_MODEL_ID'] ?? 'us.amazon.nova-micro-v1:0';
  return async (state, tool, args) => {
    const started = Date.now();
    const out = await bedrock.send(new ConverseCommand({
      modelId,
      system: [{ text: 'You judge one statement about a piece of text. Reply with only the probability that the statement is true, as a number between 0 and 1.' }],
      messages: [{ role: 'user', content: [{ text: `Text: ${guardEvidence(state, tool, args)}\n\nStatement: ${GUARD_STATEMENT}` }] }],
      inferenceConfig: { temperature: 0, maxTokens: 8 },
    }));
    const text = out.output?.message?.content?.map((c) => c.text ?? '').join('') ?? '';
    const p = Number(/\d*\.?\d+/.exec(text)?.[0]);
    if (!Number.isFinite(p) || p < 0 || p > 1) throw new Error(`guard gave no probability: ${JSON.stringify(text)}`);
    return { p, hold: p < GUARD_THRESHOLD, ms: Date.now() - started };
  };
}

/** What the planner is told when a write is held back: ask, don't act. */
export const HELD_BACK = 'Not done yet: this does not look like something for the family\'s care record. '
  + 'Ask them whether it is about looking after someone in the family. If it is, make the same call again '
  + 'and it will go through; if not, help them another way and leave the care record alone.';

/**
 * Held calls, so the same call made again after the person says yes goes through. Keyed by
 * member, tool and arguments; a hold lasts ten minutes and is used once.
 */
export class HeldCalls {
  readonly #held = new Map<string, number>();
  constructor(private readonly ttlMs = 10 * 60_000) {}
  static key(memberId: string, tool: string, args: Record<string, unknown>): string {
    const sorted = (v: unknown): unknown => (v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sorted(x)]))
      : Array.isArray(v) ? v.map(sorted) : v);
    return `${memberId}\u0000${tool}\u0000${JSON.stringify(sorted(args))}`;
  }
  hold(key: string, now: number): void { this.#held.set(key, now + this.ttlMs); }
  /** True, once, when this call was held back and the person has since said yes. */
  release(key: string, now: number): boolean {
    for (const [k, until] of this.#held) if (until < now) this.#held.delete(k);
    return this.#held.delete(key);
  }
}
