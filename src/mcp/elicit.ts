/**
 * A yes that comes from the person, not the model.
 *
 * Agents ask; people promise. When a model calls claim_obligation or answers an ask with
 * accepted: true, the words it heard were the person's, but the yes on the record would be
 * the model's reading of them. A client that can show a form lets the person give it
 * themselves: their client shows Yes / Not now, and only what they press is recorded. The
 * model cannot type that answer.
 *
 * Clients that cannot show a form keep the spoken path, unchanged: the model's call is the
 * answer, as it always was. A no is never put behind a form - saying no must stay easy.
 *
 * Two protocol eras, one rule:
 *
 * - 2025-11-25 and earlier: the form is an `elicitation/create` request sent while the tool
 *   call is open, on that call's own response stream (app.ts streams responses only for a
 *   session whose client said at initialize that it can show forms).
 * - 2026-07-28: there is no stream to send it on. The tool answers `input_required` with the
 *   form inside, and the client calls again carrying the person's answer. What comes back is
 *   the client's word, so the form is only believed alongside a signed `requestState` that
 *   says this server asked this person about this work (see `verifyFormState`).
 */

import { createHmac, randomBytes } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElicitResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { dueSpoken } from '../domain/local-time.js';
import type { Obligation } from '../domain/types.js';
import {
  CLIENT_CAPABILITIES_META_KEY,
  createRequestStateCodec,
  inputRequired,
  inputResponse,
  type ServerContext,
} from '@modelcontextprotocol/server';

/** What the person is saying yes to: taking it on, an ask, or a "still on?" check-in. */
export type YesKind = 'claim' | 'ask' | 'still_on';

export interface YesForm {
  kind: YesKind;
  /** Who the form is for. A form answer counts only from the person it was shown to. */
  actorId: string;
  obligationId: string;
  /** What the person reads on the form. */
  message: string;
  /** The two choices, in the person's words: "Yes, I'll do it" / "Not this time". */
  yes: string;
  no: string;
}

export type FormAnswer =
  | { kind: 'yes' }
  | { kind: 'not_now' }
  /** Closed, dismissed or timed out: nothing was answered, so nothing is recorded. */
  | { kind: 'unanswered' }
  /** 2026-07-28: the form is on its way. Return `result` from the tool as it is. */
  | { kind: 'shown'; result: CallToolResult };

/** How long a 2025-era call waits on the form: under App Runner's 120s request limit. */
const FORM_TIMEOUT_MS = 100_000;

/** The key the person's answer comes back under, on the 2026-07-28 retry. */
const ANSWER = 'answer';

/** Signed into the 2026-07-28 round trip: which form this answer is to. */
interface FormState {
  a: string;
  o: string;
  k: YesKind;
}

// One key for every instance that might take the retry, so it comes from the shared secret.
// Without one (tests, local runs) a key for this process, which only works while one process
// answers every round - true there.
const PROCESS_KEY = randomBytes(32);
function formKey(): Uint8Array {
  const secret = process.env['CARECIRCLE_OAUTH_SECRET'];
  return secret
    ? createHmac('sha256', secret).update('carecircle: form answers').digest()
    : PROCESS_KEY;
}

const codec = () => createRequestStateCodec<FormState>({ key: formKey(), ttlSeconds: 600 });

/**
 * The 2026-07-28 server's `requestState.verify`: a retry whose state was not minted here,
 * was altered, or is past ten minutes is refused before any tool sees it.
 */
export function verifyFormState(state: string, ctx: ServerContext): Promise<FormState> {
  return codec().verify(state, ctx);
}

/** Form mode is what this asks for: `elicitation: {}` means form under 2025-11-25. */
function showsForms(elicitation: unknown): boolean {
  if (!elicitation || typeof elicitation !== 'object') return false;
  const modes = elicitation as { form?: unknown; url?: unknown };
  return modes.form !== undefined || modes.url === undefined;
}

/** Whether an initialize request comes from a client that can show forms (see app.ts). */
export function declaresForms(initialize: unknown): boolean {
  const params = (initialize as { params?: { capabilities?: { elicitation?: unknown } } })?.params;
  return showsForms(params?.capabilities?.elicitation);
}

function schemaOf(form: YesForm) {
  return {
    type: 'object' as const,
    properties: {
      answer: {
        type: 'string' as const,
        title: 'Your answer',
        oneOf: [
          { const: 'yes', title: form.yes },
          { const: 'no', title: form.no },
        ],
      },
    },
    required: ['answer'],
  };
}

function read(action: string, content: Record<string, unknown> | undefined): FormAnswer {
  if (action !== 'accept') return { kind: 'unanswered' };
  if (content?.['answer'] === 'yes') return { kind: 'yes' };
  if (content?.['answer'] === 'no') return { kind: 'not_now' };
  return { kind: 'unanswered' };
}

interface ModernExtra {
  mcpReq: {
    envelope?: Record<string, unknown>;
    inputResponses?: Record<string, unknown>;
    requestState: <T>() => T | undefined;
  };
}

interface LegacyExtra {
  sendRequest: (
    request: { method: 'elicitation/create'; params: Record<string, unknown> },
    schema: typeof ElicitResultSchema,
    options: { timeout: number },
  ) => Promise<{ action: string; content?: Record<string, unknown> }>;
}

/**
 * Whether this call can put a form in front of the person. Checked before anything waits,
 * so a client without forms takes the spoken path exactly as before, with no pause between
 * reading the record and writing it. `extra` is the tool handler's second argument.
 */
export function canAskOnForm(server: McpServer, extra: unknown): boolean {
  if (isModern(extra)) {
    const caps = extra.mcpReq.envelope?.[CLIENT_CAPABILITIES_META_KEY] as
      { elicitation?: unknown } | undefined;
    return showsForms(caps?.elicitation);
  }
  return showsForms(server.server.getClientCapabilities()?.elicitation);
}

function isModern(extra: unknown): extra is ModernExtra {
  return !!extra && typeof extra === 'object' && 'mcpReq' in extra;
}

/**
 * Ask the person on their own client; only after canAskOnForm says it can. The record may
 * change while the form is open, so a caller reads it again before writing the answer.
 */
export async function askOnForm(extra: unknown, form: YesForm): Promise<FormAnswer> {
  const params = { message: form.message, requestedSchema: schemaOf(form) };

  if (isModern(extra)) {
    const req = extra.mcpReq;
    const state = req.requestState<FormState>();
    const answer = inputResponse(req.inputResponses, ANSWER);
    // Only an answer to the form this server showed this person, about this work.
    if (
      answer.kind === 'elicit' &&
      state?.a === form.actorId &&
      state.o === form.obligationId &&
      state.k === form.kind
    ) {
      return read(answer.action, answer.content);
    }
    const requestState = await codec().mint({
      a: form.actorId,
      o: form.obligationId,
      k: form.kind,
    });
    return {
      kind: 'shown',
      // The 2026-07-28 server takes this where a tool result goes; the tools are typed by v1.
      result: inputRequired({
        inputRequests: { [ANSWER]: inputRequired.elicit(params) },
        requestState,
      }) as unknown as CallToolResult,
    };
  }

  try {
    const result = await (extra as LegacyExtra).sendRequest(
      { method: 'elicitation/create', params },
      ElicitResultSchema,
      { timeout: FORM_TIMEOUT_MS },
    );
    return read(result.action, result.content);
  } catch {
    // Timed out, or the client could not show it after all. Either way nobody answered.
    return { kind: 'unanswered' };
  }
}

/**
 * Whether the work still stands as it did when the form went out: same status, same owner,
 * same ask. If not, the answer is to a question that no longer stands, and is not saved.
 */
export function unchangedSince(seen: Obligation, now: Obligation): boolean {
  return (
    seen.status === now.status &&
    seen.ownerId === now.ownerId &&
    seen.request?.askedOfId === now.request?.askedOfId &&
    seen.request?.askedAt === now.request?.askedAt
  );
}

/** ", Thursday at 10 AM" after the work on a form, or nothing when it has no time. */
export function dueLine(o: Obligation, timezone: string, now: Date): string {
  const due = dueSpoken(o.dueAt, timezone, now);
  return due ? `, ${due}` : '';
}

/** What the model is told when the form came back unanswered. Nothing was recorded. */
export function unansweredGuidance(what: string): string {
  return (
    `The form closed without an answer, so nothing was saved: "${what}" is still waiting ` +
    "for the speaker's own yes. Don't tell them it's theirs. They can say yes again " +
    'whenever they are ready.'
  );
}
