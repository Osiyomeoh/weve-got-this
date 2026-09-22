import type { ConsequenceClass } from './types.js';

/**
 * Adapter: a real Bee item (a fact or a todo an ambient wearable captured) -> the
 * vendor-neutral shape CareCircle acts on.
 *
 * Bee (bee.computer) is a wearable that overhears ordinary conversation and distils
 * it into `facts` ("Mom's cardiology appointment is on the 24th") and `todos`
 * ("pick up the prescription Friday"). That is a genuinely different kind of evidence
 * from a doorbell: nobody typed it, and nobody has confirmed it either. So the one
 * rule that governs every door governs this one hardest:
 *
 *   A thing Bee heard is HEARD, not KNOWN. It enters as something a human confirms -
 *   a todo becomes a PROPOSED obligation, a fact becomes a recorded observation - and
 *   never as a fact CareCircle asserts on its own. The wearable overhearing "she said
 *   she'd skip her pill" is not evidence that she skipped it.
 *
 * Two consequences of that rule, enforced below and in the tests:
 *  - Bee cannot read medical stakes from free text, so a proposal it raises is
 *    `logistical`, never `medical`. Severity that high has to come from the record,
 *    not from a sentence a microphone caught.
 *  - A completed todo and an already-actioned fact raise nothing: the door surfaces
 *    what is still open, so it never re-proposes work the family has already closed.
 *
 * Endpoints and field names are the real ones (Bee developer API, GET /v1/facts and
 * GET /v1/todos, Bearer token). `alarm_at` comes back as epoch milliseconds in
 * responses though it is ISO 8601 on input - handled in normalisation.
 */

/** A Bee todo, normalised away from the raw API shape. */
export interface BeeTodo {
  id: string;
  text: string;
  completed: boolean;
  /** When the todo is due, if Bee captured a time. ISO 8601. */
  alarmAt?: string;
}

/** A Bee fact, normalised away from the raw API shape. */
export interface BeeFact {
  id: string;
  text: string;
  /** Whether Bee itself marks the fact confirmed. Independent of CareCircle's gate. */
  confirmed: boolean;
}

/** Everything a single Bee sync pulls. */
export interface BeeItems {
  facts: BeeFact[];
  todos: BeeTodo[];
}

/**
 * A proposal Bee raises: a piece of work the family might take on, always entering as
 * PROPOSED. The `ask` is what CareCircle puts to a human before any of it becomes real.
 */
export interface BeeProposal {
  what: string;
  ask: string;
  spoken: string;
  /** Always `logistical`: Bee never gets to assert a medical stake from overheard text. */
  consequence: ConsequenceClass;
}

/** An observation Bee recorded: a fact, kept as "heard, unconfirmed", acting on nothing. */
export interface BeeObservation {
  spoken: string;
}

const asString = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

const asBool = (v: unknown): boolean =>
  v === true || v === 'true' || v === 1;

/** Bee returns `alarm_at` as epoch milliseconds; keep it only when it is a real time. */
function normaliseAlarm(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return new Date(v).toISOString();
  const s = asString(v);
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

/**
 * Normalise the /v1/todos response into a plain list. Defensive, like the Ring device
 * reader: takes id and text where present, tolerates an unknown shape, and never
 * throws on a row it does not recognise.
 */
export function parseTodos(json: unknown): BeeTodo[] {
  const rows = pickRows(json, 'todos');
  const out: BeeTodo[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const d = raw as Record<string, unknown>;
    const id = asString(d['id']) ?? asString(d['uuid']);
    const text = asString(d['text']) ?? asString(d['title']);
    if (!id || !text) continue;
    const alarmAt = normaliseAlarm(d['alarm_at'] ?? d['alarmAt']);
    out.push({ id, text, completed: asBool(d['completed']), ...(alarmAt ? { alarmAt } : {}) });
  }
  return out;
}

/** Normalise the /v1/facts response into a plain list. */
export function parseFacts(json: unknown): BeeFact[] {
  const rows = pickRows(json, 'facts');
  const out: BeeFact[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const d = raw as Record<string, unknown>;
    const id = asString(d['id']) ?? asString(d['uuid']);
    const text = asString(d['text']) ?? asString(d['content']);
    if (!id || !text) continue;
    out.push({ id, text, confirmed: asBool(d['confirmed']) });
  }
  return out;
}

/** Bee wraps lists as `{ <name>: [...] }` or `{ data: [...] }`, or returns a bare array. */
function pickRows(json: unknown, name: string): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    if (Array.isArray(o[name])) return o[name] as unknown[];
    if (Array.isArray(o['data'])) return o['data'] as unknown[];
  }
  return [];
}

/**
 * Map a Bee todo to a proposal, or null when it raises nothing.
 *
 * An open todo Bee heard is a suggestion the family might adopt; a completed one is
 * already handled and must not be re-raised. The proposal is always logistical - the
 * one thing a microphone is not allowed to decide is that something is a medical
 * emergency.
 */
export function beeTodoToProposal(todo: BeeTodo, recipientName: string): BeeProposal | null {
  if (todo.completed) return null;
  const what = todo.text;
  return {
    what,
    consequence: 'logistical',
    spoken: `Bee heard something for ${recipientName}: "${what}".`,
    ask: `Bee overheard a to-do for ${recipientName}: "${what}". `
      + `I haven't confirmed it with anyone - should I add it to the circle?`,
  };
}

/**
 * Map a Bee fact to a recorded observation, or null when it is nothing to keep.
 *
 * A fact is kept verbatim as something the wearable heard, attributed to the device
 * and never promoted past `observed`. It acts on nothing on its own; it is there so a
 * human can see what was said and decide.
 */
export function beeFactToObservation(fact: BeeFact, recipientName: string): BeeObservation | null {
  if (!fact.text) return null;
  return { spoken: `Bee noted about ${recipientName}: "${fact.text}" (heard, unconfirmed).` };
}
