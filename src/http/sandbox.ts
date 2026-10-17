import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { CareStore } from '../store/store.js';
import { seedDemoHousehold, DEMO_HOUSEHOLD_ID } from '../demo/seed.js';
import { seedScenario } from '../demo/scenario.js';
import { isCareCase, isFamilyNames } from '../demo/cases.js';
import { signToken, type ConnectionCopies } from './oauth.js';
import { sandboxOf, AGENT_COPY_TTL_MS, type SandboxKind } from '../domain/sandbox-id.js';

export {
  sandboxOf,
  familyCodeOf,
  AGENT_COPY_TTL_MS,
  type SandboxKind,
} from '../domain/sandbox-id.js';

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
 *
 * An agent that connects over OAuth (Claude, ChatGPT, Cursor, the MCP Inspector) gets a
 * copy of its own too, made when the person picks who they are on the consent screen (see
 * `agentCopies`). Its ids separate time and random with `_` instead of `-`, so each kind is
 * swept on its own terms: a console visit lasts hours, a connected agent may come back
 * next week.
 */

/** The demo members a sandbox copy contains, by their logical (unsuffixed) ids. */
const SANDBOX_MEMBERS = ['m_margaret', 'm_david', 'm_renee', 'm_aide', 'm_kunle'] as const;

export function sandboxSuffix(now: Date, kind: SandboxKind = 'console'): string {
  const sep = kind === 'agent' ? '_' : '-';
  return `~${now.getTime().toString(36)}${sep}${randomBytes(4).toString('hex')}`;
}

/** When a sandbox household was created, or null if the id is not a sandbox's. */
export function sandboxCreatedAt(householdId: string): number | null {
  return sandboxOf(householdId)?.createdAt ?? null;
}

/**
 * Remove expired sandbox copies of one kind, and the oldest beyond `keepAtMost`. Real
 * households and the other kind's copies are never candidates. Returns how many copies
 * were removed.
 */
export async function sweepSandboxes(
  store: CareStore,
  opts: { ttlMs: number; keepAtMost: number; now: Date; kind?: SandboxKind },
): Promise<number> {
  const kind = opts.kind ?? 'console';
  const copies = store
    .householdIds()
    .map((id) => ({ id, copy: sandboxOf(id) }))
    .filter((c) => c.copy?.kind === kind)
    .map((c) => ({ id: c.id, at: c.copy!.createdAt }))
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

const SANDBOX_KEY_HEADER = 'x-sandbox-key';

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
      // The 3D world's day opens at 7:42 with Daddy logging his eye drops by voice, so
      // its copy must not already hold the 8:10 dose (Alexa would call it a duplicate).
      const body = (req.body ?? {}) as {
        liveMorning?: unknown;
        careCase?: unknown;
        names?: unknown;
      };
      const liveMorning = body.liveMorning === true;
      const careCase = {
        ...(isCareCase(body.careCase) ? { careCase: body.careCase } : {}),
        ...(isFamilyNames(body.names) ? { names: body.names } : {}),
      };
      await seedDemoHousehold(opts.store, { suffix, ...careCase });
      await seedScenario(opts.store, `${DEMO_HOUSEHOLD_ID}${suffix}`, {
        suffix,
        now: at,
        refillDueTonight: true,
        skipMorningEyeDrops: liveMorning,
        routines: 'today',
        ...careCase,
      });

      const iat = Math.floor(at.getTime() / 1000);
      const exp = Math.floor((at.getTime() + ttlMs) / 1000);
      const tokens = Object.fromEntries(
        SANDBOX_MEMBERS.map((m) => [
          m,
          signToken(
            {
              sub: `${m}${suffix}`,
              iss: opts.issuer,
              aud: opts.issuer,
              iat,
              exp,
              typ: 'access',
              scope: 'carecircle.read carecircle.write',
            },
            opts.secret,
          ),
        ]),
      );

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

/**
 * A private copy of the demo family for every agent that connects over OAuth.
 *
 * Judges are asked to try it with their own agent. With one shared family, the first
 * judge's "yes, I'll drive him" is already on the record when the next one arrives, and
 * each reads the other's work. So picking who you are on the consent screen makes a copy,
 * and the tokens that come back act inside it alone, for as long as it lasts.
 *
 * Its family code, the random part of its ids, lets a second agent join the same copy: ask
 * from Claude as Tolu, answer from ChatGPT as Funmi.
 */
export function agentCopies(opts: {
  store: CareStore;
  ttlMs?: number;
  max?: number;
  now?: () => Date;
}): ConnectionCopies {
  const ttlMs = opts.ttlMs ?? AGENT_COPY_TTL_MS;
  const max = opts.max ?? 300;
  const now = opts.now ?? (() => new Date());
  const live = (householdId: string): boolean => {
    const copy = sandboxOf(householdId);
    return (
      copy?.kind === 'agent' &&
      now().getTime() - copy.createdAt <= ttlMs &&
      opts.store.householdIds().includes(householdId)
    );
  };
  const memberIn = (householdId: string, memberId: string): string | null => {
    const id = `${memberId}${householdId.slice(DEMO_HOUSEHOLD_ID.length)}`;
    try {
      return opts.store.getMember(id).householdId === householdId ? id : null;
    } catch {
      return null;
    }
  };

  return {
    async create(memberId) {
      const at = now();
      // Leave room for the one we are about to create.
      await sweepSandboxes(opts.store, { ttlMs, keepAtMost: max - 1, now: at, kind: 'agent' });
      const suffix = sandboxSuffix(at, 'agent');
      const householdId = `${DEMO_HOUSEHOLD_ID}${suffix}`;
      await seedDemoHousehold(opts.store, { suffix });
      await seedScenario(opts.store, householdId, {
        suffix,
        now: at,
        refillDueTonight: true,
        routines: 'ahead',
      });
      const id = memberIn(householdId, memberId);
      if (!id) throw new Error('That person is not in the demo family.');
      return { memberId: id, expiresAt: at.getTime() + ttlMs };
    },

    join(code, memberId) {
      const wanted = code.toLowerCase().replace(/[^0-9a-f]/g, '');
      if (wanted.length !== 8) return null;
      const householdId = opts.store
        .householdIds()
        .find((id) => sandboxOf(id)?.code === wanted && live(id));
      const id = householdId ? memberIn(householdId, memberId) : null;
      return householdId && id
        ? { memberId: id, expiresAt: sandboxOf(householdId)!.createdAt + ttlMs }
        : null;
    },

    expiresAt(memberId) {
      // The member id carries the copy's suffix, so this holds even once the copy is gone.
      const m = /~[0-9a-z]+_[0-9a-f]{8}$/.exec(memberId);
      const copy = m ? sandboxOf(`${DEMO_HOUSEHOLD_ID}${m[0]}`) : null;
      if (!copy) return null;
      return live(`${DEMO_HOUSEHOLD_ID}${m![0]}`) ? copy.createdAt + ttlMs : 0;
    },
  };
}
