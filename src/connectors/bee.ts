import type { CareStore } from '../store/store.js';
import {
  parseFacts,
  parseTodos,
  beeTodoToProposal,
  beeFactToObservation,
  type BeeItems,
} from '../domain/bee.js';
import { doseRecord } from '../domain/gaps.js';

/**
 * The Bee connector: an ambient wearable's facts and todos as a care signal source.
 *
 * A real inbound integration against the Bee developer API (GET /v1/facts,
 * GET /v1/todos, Bearer token). It pulls what the wearable overheard and folds each
 * item into the care record through the same gate as every other door:
 *
 *  - a todo becomes a PROPOSED obligation (INFERRED provenance) a human confirms;
 *  - a fact becomes a recorded observation, attributed to the device, `observed` and
 *    no higher - it is "heard, unconfirmed", never a fact the app asserts.
 *
 * Network at the edges, pure core, matching the Gmail door:
 *  - `fetchBeeItems` is the only function that talks to Bee;
 *  - `syncBeeItems` is pure of the network and is what tests hit;
 *  - `runBeeSync` wires them together.
 *
 * Bee's API base is deployment-specific (its docs parameterise it as `$BEE_API_BASE`,
 * and direct access can sit behind a private-CA proxy), so the base URL is required
 * from the environment rather than guessed.
 */

export interface BeeConfig {
  token: string;
  /** Bee API base, e.g. https://api.bee.computer. No trailing slash needed. */
  apiBase: string;
  /** Max rows to pull per list. Defaults to 25. */
  maxResults?: number;
}

export interface BeeSyncResult {
  fetched: number;
  /** PROPOSED obligations raised from todos, and observations recorded from facts. */
  proposed: Array<{ obligationId: string; eventId: string; spoken: string }>;
  observed: Array<{ eventId: string; spoken: string }>;
  /** Doses recorded because they ticked the app's own reminder done in Bee. */
  taken: Array<{ eventId: string; medicationId: string }>;
  skipped: Array<{ id: string; reason: string }>;
}

export function beeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): BeeConfig | null {
  const token = env['BEE_TOKEN']?.trim();
  const apiBase = env['BEE_API_BASE']?.trim().replace(/\/+$/, '');
  if (!token || !apiBase) return null;
  const max = Number(env['BEE_MAX_RESULTS']);
  return {
    token,
    apiBase,
    ...(Number.isFinite(max) && max > 0 ? { maxResults: max } : {}),
  };
}

async function getJson(url: string, token: string): Promise<unknown> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Bee ${url} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * Put a reminder in the person's own Bee: a todo with an alarm (POST /v1/todos, which Bee's
 * developer API documents with `text` and an ISO 8601 `alarm_at`). It rings in their Bee app,
 * and when they tick it done, the next sync records the dose as their word. Returns Bee's id.
 */
export async function createBeeTodo(
  config: BeeConfig,
  todo: { text: string; alarmAt: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchImpl(`${config.apiBase}/v1/todos`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text: todo.text, alarm_at: todo.alarmAt }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Bee POST /v1/todos failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const [row] = parseTodos({ todos: [await res.json()] });
  if (!row) throw new Error('Bee created a todo but returned no id.');
  return row.id;
}

/** Pull the account's facts and todos. The only function that touches the network. */
async function fetchBeeItems(config: BeeConfig): Promise<BeeItems> {
  const limit = config.maxResults ?? 25;
  const q = new URLSearchParams({ limit: String(limit) }).toString();
  const [factsJson, todosJson] = await Promise.all([
    getJson(`${config.apiBase}/v1/facts?${q}`, config.token),
    getJson(`${config.apiBase}/v1/todos?${q}`, config.token),
  ]);
  return { facts: parseFacts(factsJson), todos: parseTodos(todosJson) };
}

/**
 * Apply a batch of already-fetched Bee items. Pure of the network. De-duplicates
 * against items already recorded from Bee (by the Bee row id kept on the event), so
 * re-running is safe and only a genuinely new fact or todo creates anything.
 */
export async function syncBeeItems(
  store: CareStore,
  householdId: string,
  items: BeeItems,
  now: Date,
): Promise<BeeSyncResult> {
  const state = store.getCareState(householdId);
  const recipient = state.members.find((m) => m.role === 'care_recipient');
  if (!recipient) throw new Error('This household has no care recipient.');
  const recipientName = recipient.spokenAs ?? recipient.name;

  const seen = new Set<string>();
  for (const e of state.events) {
    if (e.source === 'bee') {
      const beeId = e.data['beeId'];
      if (typeof beeId === 'string') seen.add(beeId);
    }
  }

  const result: BeeSyncResult = {
    fetched: items.facts.length + items.todos.length,
    proposed: [],
    observed: [],
    taken: [],
    skipped: [],
  };

  const baseEvent = (beeId: string, text: string) => ({
    householdId,
    reportedBy: 'device:bee' as const,
    occurredAt: now.toISOString(),
    source: 'bee' as const,
    confidence: 'observed' as const,
    detail: text,
  });

  // Reminders the app itself put in their Bee, by Bee's id: the dose each one is about.
  const ours = new Map<string, { medicationId: string; slot: string; to: string }>();
  for (const e of state.events) {
    if (e.kind !== 'reminder_sent' || typeof e.data['beeTodoId'] !== 'string') continue;
    ours.set(e.data['beeTodoId'], {
      medicationId: String(e.data['medicationId']),
      slot: String(e.data['slot']),
      to: String(e.data['to']),
    });
  }

  // Todos first: each open one is a proposal the family confirms.
  for (const todo of items.todos) {
    if (seen.has(todo.id)) {
      result.skipped.push({ id: todo.id, reason: 'already applied' });
      continue;
    }
    const mine = ours.get(todo.id);
    if (mine) {
      // Our own reminder is not something Bee overheard, so it never becomes a proposal.
      // Ticked done, it is their word, tapped by them: the same as "Taken" on Telegram.
      // That differs from a sentence Bee heard, which stays heard and unconfirmed.
      if (!todo.completed) {
        result.skipped.push({ id: todo.id, reason: 'our reminder, still open' });
        continue;
      }
      const med = state.medications.find((m) => m.id === mine.medicationId);
      if (med && !doseRecord(state, med.id, mine.slot, now)) {
        const event = await store.appendEvent({
          householdId,
          kind: 'medication_taken',
          reportedBy: mine.to,
          occurredAt: now.toISOString(),
          source: 'bee',
          confidence: 'reported',
          detail: `Ticked the ${med.name} reminder done in Bee`,
          data: {
            medicationId: med.id,
            medicationName: med.name,
            aboutMemberId: med.forMemberId,
            beeId: todo.id,
          },
        });
        result.taken.push({ eventId: event.id, medicationId: med.id });
      } else result.skipped.push({ id: todo.id, reason: 'dose already on the record' });
      seen.add(todo.id);
      continue;
    }
    const proposal = beeTodoToProposal(todo, recipientName);
    if (!proposal) {
      result.skipped.push({ id: todo.id, reason: 'completed or empty' });
      continue;
    }

    const event = await store.appendEvent({
      ...baseEvent(todo.id, todo.text),
      kind: 'external_signal',
      data: { source: 'bee', beeId: todo.id, beeKind: 'todo', text: todo.text },
    });
    const obligation = await store.createObligation({
      householdId,
      what: proposal.what,
      status: 'PROPOSED',
      consequence: proposal.consequence,
      provenance: { kind: 'INFERRED', rule: 'bee:todo', from: `bee todo ${todo.id}` },
      ownerId: null,
      sourceEventId: event.id,
    });
    seen.add(todo.id);
    result.proposed.push({
      obligationId: obligation.id,
      eventId: event.id,
      spoken: proposal.spoken,
    });
  }

  // Facts: recorded as observations. They act on nothing on their own.
  for (const fact of items.facts) {
    if (seen.has(fact.id)) {
      result.skipped.push({ id: fact.id, reason: 'already applied' });
      continue;
    }
    const observation = beeFactToObservation(fact, recipientName);
    if (!observation) {
      result.skipped.push({ id: fact.id, reason: 'empty' });
      continue;
    }

    const event = await store.appendEvent({
      ...baseEvent(fact.id, fact.text),
      kind: 'external_signal',
      data: { source: 'bee', beeId: fact.id, beeKind: 'fact', text: fact.text },
    });
    seen.add(fact.id);
    result.observed.push({ eventId: event.id, spoken: observation.spoken });
  }

  return result;
}

/** End-to-end real sync: pull from Bee, apply as INFERRED. */
export async function runBeeSync(
  store: CareStore,
  householdId: string,
  config: BeeConfig,
  now: Date,
): Promise<BeeSyncResult> {
  const items = await fetchBeeItems(config);
  return syncBeeItems(store, householdId, items, now);
}
