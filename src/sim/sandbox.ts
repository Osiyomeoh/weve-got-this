import { randomBytes } from 'node:crypto';
import { isCareCase, isFamilyNames, type CareCaseId, type FamilyNames } from '../demo/cases.js';

/**
 * The console's side of per-visitor demo sandboxes (the server side is
 * src/http/sandbox.ts).
 *
 * Each browser that opens the console gets a private copy of the demo household.
 * The copy's ids carry a suffix (`m_david~k3x9...`) because ids are global keys on the
 * server, but the UI, the planner prompts and every screen speak in the demo's
 * logical ids (`m_david`). So the console translates at its boundary: logical ids in
 * requests gain the visitor's suffix, and the suffix is stripped from everything
 * that comes back. Nothing past this boundary needs to know sandboxes exist.
 *
 * Callers without the visitor cookie - the Fire TV app, scripts, curl - keep reading
 * the shared demo household, exactly as before.
 */

/** Logical ids the UI uses, which a sandbox copy has under its own suffix. */
export const LOGICAL_IDS = ['h_margaret', 'm_margaret', 'm_david', 'm_renee', 'm_aide', 'm_kunle'] as const;
const LOGICAL = new Set<string>(LOGICAL_IDS);

export const VISITOR_COOKIE = 'cc_visitor';
export const LIVE_COOKIE = 'cc_live';

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of (header ?? '').split(';')) {
    const part = raw.trim();
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* skip malformed */ }
  }
  return out;
}

export function newVisitorId(): string {
  return randomBytes(16).toString('hex');
}

/** A visitor id is ours only if it has the exact shape we mint. */
export function isVisitorId(v: string | undefined): v is string {
  return typeof v === 'string' && /^[0-9a-f]{32}$/.test(v);
}

/** Request side: give logical ids the visitor's suffix, anywhere in the arguments. */
export function toSandbox<T>(value: T, suffix: string): T {
  if (!suffix) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return LOGICAL.has(v) ? `${v}${suffix}` : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(value) as T;
}

/**
 * Response side: strip the visitor's suffix from everything. The suffix is a random
 * string that appears only in this copy's ids, so removing it everywhere is exact.
 */
export function fromSandbox<T>(value: T, suffix: string): T {
  if (!suffix || value === undefined) return value;
  return JSON.parse(JSON.stringify(value).split(suffix).join('')) as T;
}

/**
 * Options for a new copy. `liveMorning`: the visitor logs the morning dose themselves.
 * `careCase`: who the family is caring for (see demo/cases.ts); absent means Daddy's eyes.
 */
export interface SandboxKind {
  liveMorning?: boolean;
  careCase?: CareCaseId;
  /** "Make it yours": the visitor's own family names, kept in this copy only. */
  names?: FamilyNames;
}

/** A kind read from an untrusted request body: unknown fields and values are dropped. */
export function sandboxKindFrom(body: unknown): SandboxKind {
  const b = (body ?? {}) as { liveMorning?: unknown; careCase?: unknown; names?: unknown };
  return {
    ...(b.liveMorning === true ? { liveMorning: true } : {}),
    ...(isCareCase(b.careCase) ? { careCase: b.careCase } : {}),
    ...(isFamilyNames(b.names) ? { names: { ...b.names } } : {}),
  };
}

export interface SandboxGrant {
  suffix: string;
  tokens: Record<string, string>;
  expiresAt: number;
}

/**
 * Sandbox grants per visitor, created on first use by asking the MCP server for a
 * copy. Bounded, so a flood of new visitors cannot grow memory without limit; a
 * visitor evicted or expired simply gets a fresh copy next time.
 */
export class VisitorSandboxes {
  readonly #grants = new Map<string, SandboxGrant>();
  readonly #pending = new Map<string, Promise<SandboxGrant>>();
  /** How the next copy for a visitor should be made, set by "start over". */
  readonly #next = new Map<string, SandboxKind>();
  readonly #limit: number;
  readonly #create: (kind: SandboxKind) => Promise<SandboxGrant>;
  readonly #now: () => number;

  constructor(opts: { create: (kind: SandboxKind) => Promise<SandboxGrant>; limit?: number; now?: () => number }) {
    this.#create = opts.create;
    this.#limit = opts.limit ?? 500;
    this.#now = opts.now ?? Date.now;
  }

  async get(visitor: string): Promise<SandboxGrant> {
    const g = this.#grants.get(visitor);
    // Refresh a minute early so a turn never starts on a copy about to expire.
    if (g && g.expiresAt - 60_000 > this.#now()) {
      this.#grants.delete(visitor);
      this.#grants.set(visitor, g); // most recently used goes last
      return g;
    }
    // One creation per visitor even when the page fires several requests at once.
    const inflight = this.#pending.get(visitor);
    if (inflight) return inflight;
    const p = this.#create(this.#next.get(visitor) ?? {})
      .then((grant) => {
        this.#next.delete(visitor);
        this.#grants.delete(visitor);
        this.#grants.set(visitor, grant);
        while (this.#grants.size > this.#limit) {
          const oldest = this.#grants.keys().next().value;
          if (oldest === undefined) break;
          this.#grants.delete(oldest);
        }
        return grant;
      })
      .finally(() => this.#pending.delete(visitor));
    this.#pending.set(visitor, p);
    return p;
  }

  /** "Start over": forget this visitor's copy so the next request makes a new one, of `kind`. */
  forget(visitor: string, kind: SandboxKind = {}): SandboxGrant | undefined {
    const g = this.#grants.get(visitor);
    this.#grants.delete(visitor);
    this.#next.delete(visitor);
    if (kind.liveMorning || kind.careCase || kind.names) this.#next.set(visitor, kind);
    // The #next map is bounded by the same visitors the grants are.
    while (this.#next.size > this.#limit) {
      const oldest = this.#next.keys().next().value;
      if (oldest === undefined) break;
      this.#next.delete(oldest);
    }
    return g;
  }
}
