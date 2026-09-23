import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { CareStore } from '../store/store.js';
import { seedDemoHousehold, DEMO_HOUSEHOLD_ID } from '../demo/seed.js';
import { seedScenario } from '../demo/scenario.js';
import { signToken } from './oauth.js';

/**
 * Per-visitor demo sandboxes.
 *
 * Judges try the live demo at the same time. With one shared demo household, one
 * judge's "yes, I'll take it" is already done when the next judge arrives, so nobody
 * sees the story from the start. Instead, each visitor of the console gets a private
 * copy of the demo household: same people, same scenario, ids of its own.
 *
 * - Only the console can create one. It sends a shared key (CARECIRCLE_SANDBOX_KEY),
 *   so the public cannot fill the table.
 * - A copy's ids end in `~<created, base36>-<random>`. The creation time lives in the
 *   id, so expiry needs no extra schema, and the suffix never collides with a real id.
 * - Copies expire (default 12h) and the total is capped (default 200); creating one
 *   sweeps the expired and, at the cap, the oldest. The real demo household and every
 *   real family are never touched: only ids with a sandbox suffix are candidates.
 * - Access is a signed token per member (the same HS256 tokens OAuth issues), valid
 *   only as long as the copy, so a sandbox token can only ever act inside its copy.
 */

/** The demo members a sandbox copy contains, by their logical (unsuffixed) ids. */
export const SANDBOX_MEMBERS = ['m_margaret', 'm_david', 'm_renee', 'm_aide'] as const;

const SUFFIX = /~([0-9a-z]+)-[0-9a-f]{8}$/;

export function sandboxSuffix(now: Date): string {
  return `~${now.getTime().toString(36)}-${randomBytes(4).toString('hex')}`;
}

/** When a sandbox household was created, or null if the id is not a sandbox's. */
export function sandboxCreatedAt(householdId: string): number | null {
  const m = SUFFIX.exec(householdId);
  if (!m || !householdId.startsWith(`${DEMO_HOUSEHOLD_ID}~`)) return null;
  const t = parseInt(m[1]!, 36);
  return Number.isFinite(t) ? t : null;
}

/**
 * Remove expired sandbox copies, and the oldest beyond `keepAtMost`. Real households
 * are never candidates. Returns how many copies were removed.
 */
export async function sweepSandboxes(
  store: CareStore, opts: { ttlMs: number; keepAtMost: number; now: Date },
): Promise<number> {
  const copies = store.householdIds()
    .map((id) => ({ id, at: sandboxCreatedAt(id) }))
    .filter((c): c is { id: string; at: number } => c.at !== null)
    .sort((a, b) => a.at - b.at);
  const expired = copies.filter((c) => opts.now.getTime() - c.at > opts.ttlMs);
  const live = copies.filter((c) => opts.now.getTime() - c.at <= opts.ttlMs);
  const overflow = live.slice(0, Math.max(0, live.length - opts.keepAtMost));
  for (const c of [...expired, ...overflow]) await store.removeHousehold(c.id);
  return expired.length + overflow.length;
}

function keyMatches(given: string | undefined, key: string): boolean {
  if (!given) return false;
  // Hash both sides so the comparison is constant-time regardless of length.
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(key).digest();
  return timingSafeEqual(a, b);
}

export interface SandboxOptions {
  store: CareStore;
  /** Shared with the console. Without it, the endpoint refuses everything. */
  key: string;
  /** OAuth signing secret and issuer, so sandbox tokens verify like any other. */
  secret: string;
  issuer: string;
  ttlMs?: number;
  max?: number;
  now?: () => Date;
}

export const SANDBOX_KEY_HEADER = 'x-sandbox-key';

export function createSandboxRoute(opts: SandboxOptions) {
  const ttlMs = opts.ttlMs ?? 12 * 3600_000;
  const max = opts.max ?? 200;
  const now = opts.now ?? (() => new Date());

  return async function handle(req: Request, res: Response): Promise<void> {
    if (!opts.key || !opts.secret) {
      res.status(503).json({ error: 'Sandboxes are not configured.' });
      return;
    }
    if (!keyMatches(req.header(SANDBOX_KEY_HEADER) ?? undefined, opts.key)) {
      res.status(401).json({ error: 'Bad sandbox key.' });
      return;
    }
    try {
      const at = now();
      // Leave room for the one we are about to create.
      await sweepSandboxes(opts.store, { ttlMs, keepAtMost: max - 1, now: at });

      const suffix = sandboxSuffix(at);
      await seedDemoHousehold(opts.store, { suffix });
      await seedScenario(opts.store, `${DEMO_HOUSEHOLD_ID}${suffix}`, { suffix, now: at });

      const iat = Math.floor(at.getTime() / 1000);
      const exp = Math.floor((at.getTime() + ttlMs) / 1000);
      const tokens = Object.fromEntries(SANDBOX_MEMBERS.map((m) => [m, signToken({
        sub: `${m}${suffix}`, iss: opts.issuer, aud: opts.issuer, iat, exp,
        typ: 'access', scope: 'carecircle.read carecircle.write',
      }, opts.secret)]));

      res.status(201).json({
        householdId: `${DEMO_HOUSEHOLD_ID}${suffix}`,
        suffix,
        tokens,
        expiresAt: new Date(exp * 1000).toISOString(),
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  };
}
