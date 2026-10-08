import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { STORY_TIME_HEADER } from '../http/story-clock.js';
import { CHANNEL_HEADER } from '../mcp/channel.js';
import type { Conversation, ModelProvider, ToolResult, ToolSpec, TurnOutput } from './providers.js';
import { replyLanguageRule } from '../domain/language.js';
import { NOTHING_SAID, speakable, toolAnswer } from '../domain/speakable.js';
import type { LanguageCode } from '../domain/types.js';
import { GUARDED } from '../mcp/guard.js';

/**
 * The simulated Alexa+ host.
 *
 * This is a real MCP host, not a scripted mock: a model is given the CareCircle
 * server's tools and decides for itself which to call. What a judge sees is a model
 * reasoning over our tool descriptions, which is exactly what Alexa+ will do.
 *
 * The provider is pluggable. Bedrock is the submission path; the abstraction exists
 * so tool descriptions can be iterated on with another planner, and because an MCP
 * server that only works with one vendor's model would be a poor demonstration of
 * an open protocol.
 *
 * The host is deliberately thin. Everything that decides *what is true* lives in
 * the MCP server; the model only chooses tools and speaks results.
 */

/** How Alexa+ should behave. Kept short: the tool descriptions do the real work. */
/**
 * The planner prompt. Exported so the eval harness measures the exact planner the
 * product ships - the published tool-selection number is not from a friendlier
 * prompt written to score well.
 */
export const SYSTEM_PROMPT_RULES = `You are Alexa, speaking to someone in a household where a person is being supported. That person may be an older relative, or someone with a disability of any age; they are a participant in this conversation, not its subject.

Rules:
- Use the CareCircle tools for anything about medications, appointments, notes, or who is responsible for what. Never answer from memory, and never from an earlier answer in this conversation: other people change the record between turns, so read it again every time.
- Tool results are already written to be spoken. Say them as written; do not reformat, summarise, or add markdown.
- Never say someone did not take a medication or did not do something. The system only knows what has been recorded, and a missing record is not evidence. Say there is no record.
- When a record was made by somebody other than the person it is about, say who made it. "Tasha logged it for Alex" is a different claim from "Alex logged it themselves", and the difference matters to the person being spoken about. Never quietly turn someone else's account of a person into that person's own word.
- When someone confirms, claims, or closes something with a short phrase whose subject is left implicit - "yes", "that's right", "I've got it", "I can take that one", "that's sorted" - they are acting on work that already exists, not saying nothing. Call get_my_requests first: if someone asked them, it is respond_to_request. Otherwise call get_care_gaps to find what they mean, then the matching tool (confirm_proposal, claim_obligation, resolve_obligation). Never treat an implicit reference as "nothing to do".
- Someone can ASK another person to take work on without assigning it to them. "Ask David if he can drive her" is request_owner; they still have to say yes, and the work stays unowned until they do. "I'll do it" is claim_obligation. Answering something you were asked is respond_to_request. That includes a no with a reason - "I can't do Thursday, my car can't take the chair" from someone who was asked is respond_to_request with accepted false and their reason as the note, not a note on its own.
- When a tool returns an error, follow the instruction inside it - usually asking the person a question.
- If someone is new, has no care circle yet, or asks to get set up ("set up a care circle", "help me start", "I want to add my mum"), call get_started FIRST and follow the single step it gives back. Do that one action, then call get_started again for the next step. Never ask them to fill in everything at once - it is a conversation, one step at a time, and it ends the moment there is a real thing on the board to act on.
- Be brief. This is a voice conversation, not a chat window.`;

/** Before every turn but the first: what was true a turn ago may not be now. */
export const STALE_NOTE = '[Others may have changed the care record since your last reply. Read it again before you answer.]';

/**
 * A reply that says it did something to the record. Late in a conversation the model can
 * echo its own earlier "I've asked Musa" as "I've already asked Funmi" without calling
 * anything - a promise nobody made, which is the exact failure this product exists to stop.
 */
const CLAIMS_A_WRITE = /\bI(?:'ve| have)(?: already| just)? (?:asked|logged|recorded|noted|added|marked|assigned|told|let \w+ know|sent|scheduled|put)\b|\bthat's (?:yours|theirs|now with)\b/i;
export const UNBACKED_NOTE = '[Your reply says something was done, but no tool changed the record this turn. Nothing has happened yet. Call the tool that does it now - or, if it was done in an earlier turn, read the record and say what it shows.]';

/** Whether a spoken reply claims a change that no successful write this turn backs. */
export function unbackedClaim(text: string, calls: { name: string; isError: boolean }[]): boolean {
  return CLAIMS_A_WRITE.test(text) && !calls.some((c) => !c.isError && GUARDED.has(c.name));
}

/**
 * The planner prompt, stamped with the current date.
 *
 * Without this the model has to invent a timestamp for "Thursday at ten" and will
 * reach for a date near its own training prior - we watched it record a 2026
 * appointment as 19 December 2024. A planner that does not know what day it is
 * cannot resolve a relative date, and every appointment in this product is spoken
 * as a relative date.
 */
export interface CircleMember { name: string; spokenAs?: string | null; role: string; livesAway?: string }
export interface Speaker { name: string; role: string; spokenAs?: string | null; circle?: CircleMember[]; language?: LanguageCode }

/**
 * How the conversation reaches the person. Voice is Alexa: short, spoken as written.
 * Chat is the family's own messaging app (Telegram): the same facts and the same honesty,
 * written the way a capable person who knows the family would write back.
 */
export type Channel = 'voice' | 'chat';

const CHAT_RULES = `
This conversation is in the family's messaging app, not out loud. Replace the voice rules about brevity and reading results word for word with these:
- Write like a warm, capable person who knows this family well. Use natural sentences, and the person's name now and then.
- When a message asks for several things, do all of them, then answer in one clear reply. When the tools gave you several results, bring them together, with a short line per item when there are a few.
- Keep every fact exactly as the tools give it. "No record" stays "no record": never "missed", never "probably taken". Who logged something stays who logged it.
- After you record something, offer the natural next step when there is one - after an appointment, whether to find someone to take them; after a request, that you'll say when they answer. Ask at most one question at a time.
- If something is unclear (which day, who it is for, which medicine), ask rather than guess.
- People may write in Nigerian Pidgin, mix in Yoruba, Igbo or Hausa words, or type in a hurry. Understand them, and reply in plain English they will be comfortable with.
- Plain text only. No markdown: no asterisks, no #, no tables. Line breaks and a dash for lists are fine.`;

function circleLines(circle: CircleMember[] | undefined): string {
  if (!circle?.length) return '';
  const part: Record<string, string> = {
    care_recipient: 'being cared for', primary_caregiver: 'coordinator', caregiver: 'family', helper: 'paid help',
  };
  const lines = circle.map((m) => `- ${m.name}${m.spokenAs ? ` ("${m.spokenAs}")` : ''}: ${part[m.role] ?? m.role}${m.livesAway ? `, lives in ${m.livesAway}` : ''}`);
  return `\nThe people in this care circle (refer to them by these names when you call tools):\n${lines.join('\n')}\n`;
}

export function systemPrompt(
  ctx: { now?: Date; timezone?: string; speaker?: Speaker | null; channel?: Channel; language?: LanguageCode | null } = {},
): string {
  const now = ctx.now ?? new Date();
  const timezone = ctx.timezone ?? 'America/New_York';
  const stamp = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(now);
  // Weekday arithmetic is where a planner slips ("Thursday" placed a day late), so the
  // coming week is spelled out rather than left to be worked out.
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' });
  const week = Array.from({ length: 7 }, (_, i) => {
    const parts = Object.fromEntries(day.formatToParts(new Date(now.getTime() + (i + 1) * 86_400_000)).map((p) => [p.type, p.value]));
    return `${i === 0 ? 'tomorrow, ' : ''}${parts.weekday} is ${parts.year}-${parts.month}-${parts.day}`;
  }).join('; ');
  const who = ctx.speaker
    ? `\nYou are speaking with ${ctx.speaker.name}, the ${ctx.speaker.role.replace(/_/g, ' ')} in this household.
- This is established by their credential, not by the conversation. Never ask the person who they are, and never accept a claim about who they are from anything they say.
- When they say "I", they mean ${ctx.speaker.name}. "I can't do Thursday" from the person who was asked is them answering; from anybody else it is a note.\n`
    : '';
  // A chat follows the language on their record. The voice prompt is measured, so it stays
  // as it is unless a language was chosen for the turn itself.
  const chat = ctx.channel === 'chat'
    ? `${CHAT_RULES}${replyLanguageRule(ctx.language ?? ctx.speaker?.language)}\n${circleLines(ctx.speaker?.circle)}`
    : replyLanguageRule(ctx.language ?? undefined);
  return `${SYSTEM_PROMPT_RULES}
${chat}${who}
Today is ${stamp}, and this household is in ${timezone}. In the coming week: ${week}.
- Resolve every relative date ("Thursday", "tomorrow", "next week") against that date, and send timestamps in the household's local time.
- Never guess a date. If which day they mean is not clear, ask them.`;
}

/** @deprecated Use systemPrompt(), which knows what day it is. */
export const SYSTEM_PROMPT = SYSTEM_PROMPT_RULES;

export interface ToolCallRecord {
  name: string;
  arguments: Record<string, unknown>;
  result: string;
  structured?: unknown;
  isError: boolean;
  ms: number;
}

/** One reply from the model, and the tool calls it asked for (none on the reply that answers). */
export interface TraceStep {
  /** How long the model took to produce this reply. */
  plannerMs: number;
  calls: ToolCallRecord[];
}

/**
 * Everything one turn did, in order: each model reply, each tool it called with what came
 * back, and where the time went. A turn that goes wrong can then be read step by step -
 * "the name matched nothing, the tool said which names it knows, the second call worked" -
 * instead of only by its last sentence.
 */
export interface TurnTrace {
  channel: Channel;
  model: string;
  /** "answered": the model replied without asking for more. "step_limit": it was cut off. */
  outcome: 'answered' | 'step_limit';
  steps: TraceStep[];
  plannerMs: number;
  toolMs: number;
  totalMs: number;
}

export interface TurnResult {
  spoken: string;
  toolCalls: ToolCallRecord[];
  trace: TurnTrace;
}

export class SimulatedAlexa {
  readonly #provider: ModelProvider;
  readonly #mcp: Client;
  #tools: ToolSpec[] = [];
  /** One conversation per device, so each member keeps their own thread. */
  #conversation: Conversation | null = null;
  /** The household's zone, read from the server so dates resolve where the family lives. */
  #timezone = 'America/New_York';
  /** Who the credential speaks for. Read from the server, never from the person. */
  #speaker: Speaker | null = null;
  #language: LanguageCode | null = null;
  #channel: Channel = 'voice';
  #story: { at: number; setAt: number } | null = null;
  /** Set while a press on the TV remote is being sent, so the record says it was pressed. */
  #pressed = false;
  #realNow: () => Date = () => new Date();
  /** The planner's clock: story time when one is set, otherwise the injected or real time. */
  #now: () => Date = () => (this.#story ? new Date(this.#story.at + (Date.now() - this.#story.setAt)) : this.#realNow());

  private constructor(provider: ModelProvider, mcp: Client) {
    this.#provider = provider;
    this.#mcp = mcp;
  }

  get provider(): string { return this.#provider.name; }
  get modelId(): string { return this.#provider.modelId; }

  /** Connect to the CareCircle server as one member of the care circle. */
  static async connect(opts: {
    endpoint: string; token: string; provider: ModelProvider;
  }): Promise<SimulatedAlexa> {
    const mcp = new Client({ name: 'alexa-plus-simulator', version: '0.1.0' });
    // The story clock rides on every request, so the server answers in story time too.
    // It only ever believes it for a sandbox copy (see src/http/story-clock.ts).
    let host: SimulatedAlexa | null = null;
    const transport = new StreamableHTTPClientTransport(new URL(opts.endpoint), {
      requestInit: { headers: { Authorization: `Bearer ${opts.token}` } },
      fetch: (url, init) => {
        const story = host ? host.#story : null;
        const pressed = host ? host.#pressed : false;
        if (!story && !pressed) return fetch(url, init);
        const headers = new Headers(init?.headers);
        if (story) headers.set(STORY_TIME_HEADER, new Date(story.at + (Date.now() - story.setAt)).toISOString());
        if (pressed) headers.set(CHANNEL_HEADER, 'tv');
        return fetch(url, { ...init, headers });
      },
    });
    await mcp.connect(transport as never);

    host = await SimulatedAlexa.over(mcp, opts.provider);
    return host;
  }

  /**
   * Set what time it is in the story, or null for the real time. The planner's sense of
   * "today" and "tonight" follows it, and so does the server's, for a sandbox copy.
   */
  setStoryTime(at: Date | null): void {
    this.#story = at ? { at: at.getTime(), setAt: Date.now() } : null;
  }

  /** The language chosen for this turn, over the one on the speaker's record; null keeps theirs. */
  setLanguage(language: LanguageCode | null): void {
    // The prompt is written once per conversation, so a new language starts a new one.
    if (language !== this.#language) this.#conversation = null;
    this.#language = language;
  }

  /**
   * The same planner over an MCP client that is already connected - for example one
   * joined in-process to a server bound to one member, as the Telegram chat does.
   */
  static async over(mcp: Client, provider: ModelProvider, channel: Channel = 'voice', now?: () => Date): Promise<SimulatedAlexa> {
    const host = new SimulatedAlexa(provider, mcp);
    host.#channel = channel;
    if (now) host.#realNow = now;
    await host.#loadTools();
    await host.#loadSpeaker();
    await host.#loadTimezone();
    return host;
  }

  /**
   * Ask the server where this household lives.
   *
   * Dates are resolved in the family's own time, not the server's. A failure here
   * is not worth losing a conversation over, so it falls back to the default.
   */
  async #loadTimezone(): Promise<void> {
    try {
      const res = await this.#mcp.readResource({ uri: 'carecircle://household/state' });
      const text = (res.contents?.[0] as { text?: string } | undefined)?.text;
      if (!text) return;
      const tz = (JSON.parse(text) as { household?: { timezone?: string } }).household?.timezone;
      if (tz) this.#timezone = tz;
    } catch { /* keep the default */ }
  }

  /**
   * Ask the server who this credential speaks for.
   *
   * The server has always known and was never asked, so the model had to guess and
   * ended up asking the person - the one channel identity must never come from.
   * Available to every member regardless of role, which matters: the case that
   * broke was the care recipient, who cannot read the full care state.
   */
  async #loadSpeaker(): Promise<void> {
    try {
      const res = await this.#mcp.readResource({ uri: 'carecircle://session/me' });
      const text = (res.contents?.[0] as { text?: string } | undefined)?.text;
      if (!text) return;
      const me = JSON.parse(text) as Speaker & { name?: string; role?: string };
      if (me.name && me.role) this.#speaker = me;
    } catch { /* an unnamed speaker is worse than none, but not fatal */ }
  }

  /** What the planner needs to resolve "Thursday", and who is asking. */
  #context(): { now: Date; timezone: string; speaker: Speaker | null; channel: Channel; language: LanguageCode | null } {
    return { now: this.#now(), timezone: this.#timezone, speaker: this.#speaker, channel: this.#channel, language: this.#language };
  }

  /**
   * Take the MCP tool definitions as they are.
   *
   * The descriptions pass through untouched: how well the model chooses is a direct
   * test of how well the server's tool descriptions are written.
   */
  async #loadTools(): Promise<void> {
    const { tools } = await this.#mcp.listTools();
    this.#tools = tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: (t.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
    }));
  }

  get toolCount(): number { return this.#tools.length; }

  /** One conversational turn: what the person said in, what Alexa says out. */
  async say(utterance: string): Promise<TurnResult> {
    // A later turn is where the model is tempted to answer from its own earlier reply. Other
    // people write to the record in between (a dose said on the Echo, a yes from Musa), so
    // every turn after the first carries that reminder with it.
    const later = this.#conversation !== undefined;
    const conversation = this.#conversation ??= this.#provider.start(systemPrompt(this.#context()), this.#tools);
    const turnStarted = Date.now();
    const toolCalls: ToolCallRecord[] = [];
    const steps: TraceStep[] = [];
    const plan = async (ask: () => Promise<TurnOutput>): Promise<TurnOutput> => {
      const started = Date.now();
      const out = await ask();
      steps.push({ plannerMs: Date.now() - started, calls: [] });
      return out;
    };
    const finish = (spoken: string, outcome: TurnTrace['outcome']): TurnResult => {
      const plannerMs = steps.reduce((sum, s) => sum + s.plannerMs, 0);
      const toolMs = toolCalls.reduce((sum, c) => sum + c.ms, 0);
      return {
        spoken, toolCalls,
        trace: { channel: this.#channel, model: this.#provider.modelId, outcome, steps, plannerMs, toolMs, totalMs: Date.now() - turnStarted },
      };
    };
    const said = later ? `${STALE_NOTE}\n${utterance}` : utterance;
    let output = await plan(() => conversation.say(said));

    // Bounded so a confused model cannot loop forever on a live demo.
    // A chat message can carry several requests at once ("add her drops and the clinic on
    // Friday"), so it gets a little more room than a spoken turn.
    let nudged = false;
    for (let step = 0; step < (this.#channel === 'chat' ? 10 : 6); step += 1) {
      if (output.toolUses.length === 0 && !nudged && unbackedClaim(output.text, toolCalls)) {
        nudged = true;
        output = await plan(() => conversation.say(UNBACKED_NOTE));
        continue;
      }
      if (output.toolUses.length === 0) {
        return finish(
          speakable(output.text)
            || toolAnswer(toolCalls.filter((c) => !c.isError).map((c) => c.result))
            || NOTHING_SAID,
          'answered',
        );
      }

      const current = steps.at(-1)!;
      const results: ToolResult[] = [];
      for (const use of output.toolUses) {
        const started = Date.now();
        let text = '';
        let structured: unknown;
        let isError = false;
        try {
          const out = await this.#mcp.callTool({
            name: use.name, arguments: use.input,
          }) as { content?: { text?: string }[]; structuredContent?: unknown; isError?: boolean };
          text = out.content?.[0]?.text ?? '';
          structured = out.structuredContent;
          isError = out.isError === true;
        } catch (err) {
          text = `The tool failed: ${(err as Error).message}`;
          isError = true;
        }
        const call: ToolCallRecord = {
          name: use.name, arguments: use.input, result: text,
          ...(structured !== undefined ? { structured } : {}),
          isError, ms: Date.now() - started,
        };
        toolCalls.push(call);
        current.calls.push(call);
        results.push({ id: use.id, name: use.name, text, isError });
      }
      output = await plan(() => conversation.report(results));
    }

    return finish("Sorry, I got stuck working that out. Could you say it another way?", 'step_limit');
  }

  /**
   * Invoke a tool directly, bypassing the model - what a card button does.
   *
   * The turn is still recorded in the conversation history so the model knows what
   * happened; otherwise the next spoken turn would contradict the screen.
   */
  async callToolDirect(name: string, args: Record<string, unknown>, opts: { via?: 'tv' } = {}): Promise<ToolCallRecord> {
    const started = Date.now();
    this.#pressed = opts.via === 'tv';
    let out: { content?: { text?: string }[]; structuredContent?: unknown; isError?: boolean };
    try {
      out = await this.#mcp.callTool({ name, arguments: args }) as typeof out;
    } finally {
      this.#pressed = false;
    }
    const text = out.content?.[0]?.text ?? '';
    // The model is not consulted, but the next spoken turn must not contradict the
    // screen, so the conversation is told what happened.
    this.#conversation ??= this.#provider.start(systemPrompt(this.#context()), this.#tools);
    return {
      name, arguments: args, result: text,
      ...(out.structuredContent !== undefined ? { structured: out.structuredContent } : {}),
      isError: out.isError === true, ms: Date.now() - started,
    };
  }

  async close(): Promise<void> { await this.#mcp.close(); }
}
