import { DEMO_HOUSEHOLD_ID } from '../demo/seed.js';

/**
 * What a household id says about being a copy of the demo family.
 *
 * A copy's ids end in `~<created, base36><sep><random>`: `-` for a console visitor's copy,
 * `_` for one an agent made over OAuth. The id carries everything, so the loops and the
 * sign-in can tell a copy from a real family, and one kind from the other, with no schema.
 * The making and sweeping of copies lives in `http/sandbox.ts`.
 */

/** A copy made for a console visitor, or for an agent that connected over OAuth. */
export type SandboxKind = 'console' | 'agent';

const SUFFIX = /~([0-9a-z]+)([-_])([0-9a-f]{8})$/;

/** How long an agent's copy lasts: as long as a refresh token, so a judge can come back. */
export const AGENT_COPY_TTL_MS = 30 * 86_400_000;

/**
 * Which kind of copy a household is, when it was made, and its family code (the random
 * part). Null for anything that is not a copy of the demo household.
 */
export function sandboxOf(
  householdId: string,
): { kind: SandboxKind; createdAt: number; code: string } | null {
  const m = SUFFIX.exec(householdId);
  if (!m || !householdId.startsWith(`${DEMO_HOUSEHOLD_ID}~`)) return null;
  const t = parseInt(m[1]!, 36);
  if (!Number.isFinite(t)) return null;
  return { kind: m[2] === '_' ? 'agent' : 'console', createdAt: t, code: m[3]! };
}

/**
 * Whether a household is an agent's copy that has not ended. Such a copy lives on the
 * server's clock, so the app's own pass runs in it as it does in a real family.
 */
export function isLiveAgentCopy(householdId: string, now: Date): boolean {
  const copy = sandboxOf(householdId);
  return copy?.kind === 'agent' && now.getTime() - copy.createdAt <= AGENT_COPY_TTL_MS;
}

/** The family code of the agent copy a household is, or null when it is not one. */
export function familyCodeOf(householdId: string): string | null {
  const copy = sandboxOf(householdId);
  return copy?.kind === 'agent' ? copy.code : null;
}
