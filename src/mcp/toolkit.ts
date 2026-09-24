import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { NotPermittedError } from '../domain/auth.js';
import { z } from 'zod';
import { LANGUAGE_CODES } from '../domain/language.js';
import type { CareState, LanguageCode, Member, Obligation } from '../domain/types.js';
import type { Notifier } from '../notify/notifier.js';
import { HouseholdScopeError, NotFoundError, RecordChangedError, type CareStore } from '../store/store.js';
import { matchObligation } from '../domain/obligation-ref.js';

/**
 * What every tool, resource and prompt is built from.
 *
 * Two rules govern all of them:
 *
 * 1. Tools exist because a person says a sentence that needs them. There is no tool
 *    that mirrors a database table for its own sake.
 * 2. Everything a tool returns is written to be *spoken*, and every error is written to
 *    tell the model what to do next. A failed call should move the conversation
 *    forward, not dead-end it.
 */

/** One session's view of the world: who is speaking, and the record they may act on. */
export interface ToolContext {
  server: McpServer;
  store: CareStore;
  /** The credential's subject. Identity comes from the session, never the conversation. */
  actorId: string;
  now: () => Date;
  notifier: Notifier;
  /** The member the credential speaks for, read fresh on every call. */
  actor: () => Member;
  household: () => string;
  state: () => CareState;
  /** How a member (or the agent) is spoken about; undefined when unknown. */
  nameOf: (id: string | null) => string | undefined;
}

/** Where the Care Board view lives. Referenced by the tool that renders it. */
export const CARE_BOARD_URI = 'ui://carecircle/care-board.html';

/** A tool result shaped for a voice client: one speakable line plus structure. */
export function reply(spoken: string, structured?: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: spoken }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

/**
 * An error the model should act on rather than report.
 *
 * The text is phrased as guidance ("ask which one", "you can claim it yourself")
 * because the model is the audience - it is deciding what to do next, and a stack
 * trace tells it nothing useful.
 */
export function guidance(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

/** Turn a thrown error into guidance the model can act on. */
/** A reference to a piece of work that needs the person to say which one. Its message is guidance. */
export class ObligationRefError extends Error {}

/**
 * The piece of work a tool call names: by id, or by the words for it when the planner
 * passed those instead (see domain/obligation-ref.ts). Never guesses between two.
 */
export function obligationFrom(store: CareStore, ref: string, householdId: string): Obligation {
  try {
    return store.getObligation(ref, householdId);
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err;
  }
  const match = matchObligation(ref, store.getCareState(householdId).obligations);
  if (match.kind === 'found') return match.obligation;
  const list = (os: Obligation[]) => os.map((o) => `"${o.what}" (obligationId ${o.id})`).join('; ');
  if (match.kind === 'ambiguous') {
    throw new ObligationRefError(
      `That could be ${match.options.length} things: ${list(match.options)}. `
      + 'Ask the person which one they mean, then use its obligationId.',
    );
  }
  throw new ObligationRefError(match.live.length === 0
    ? 'Nothing is open right now, so there is nothing to act on. Tell the person that.'
    : `Nothing open matches that. What is open: ${list(match.live)}. `
      + 'Use the obligationId of the one the person means, or ask them which.');
}

export function describeError(err: unknown): string {
  if (err instanceof NotPermittedError) return err.message;
  if (err instanceof ObligationRefError) return err.message;
  if (err instanceof HouseholdScopeError) return err.message;
  if (err instanceof NotFoundError) {
    return `I couldn't find that ${err.what}. Ask the person which one they mean, or list what's open first.`;
  }
  if (err instanceof RecordChangedError) {
    // Someone else changed the record in the same moment. Deciding again on the fresh record
    // is right; repeating the same call blindly may undo what they just did.
    return 'Someone else changed the care record at the same moment, so this was not saved. '
      + 'Read the record again (get_care_gaps), then do it again only if it still applies.';
  }
  return "Something went wrong saving that, so it hasn't been recorded. Tell the person it didn't save and offer to try again.";
}

/** A timezone the runtime can actually format in - the IANA name must be valid, or
 *  gap detection (which reads the household timezone) throws on every later call. */
export function isValidTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** Every entry must be a 24-hour "HH:MM"; a malformed time is silently un-checkable. */
export function validMedicationTimes(times: string[]): boolean {
  return times.length > 0 && times.every((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t));
}

/**
 * An input object the model is told is closed (`additionalProperties: false`), as every tool
 * input was declared under zod 3. At runtime an extra key is still dropped, not refused.
 */
export function closed<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).meta({ additionalProperties: false });
}

/** A medicine's name in another language, as the family says it: add_medication and change_medication. */
export const ALSO_CALLED = z.array(closed({
  language: z.enum(LANGUAGE_CODES as [LanguageCode, ...LanguageCode[]])
    .describe('The language of that name: es, fr, pt, de, it, hi, zh, pcm, yo, ig, ha, bin or en.'),
  name: z.string().describe('The name, exactly as the family says it in that language (e.g. "colírio").'),
})).optional()
  .describe('Only when the family says what they call it in another language ("Mum calls her eye drops colírio"). Never translate a name yourself.');

export function namesFrom(alsoCalled: z.infer<typeof ALSO_CALLED>): Partial<Record<LanguageCode, string>> | undefined {
  const named = (alsoCalled ?? []).filter((a) => a.name.trim());
  return named.length ? Object.fromEntries(named.map((a) => [a.language, a.name.trim()])) : undefined;
}
