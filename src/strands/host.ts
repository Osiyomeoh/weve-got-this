import {
  Agent,
  AfterModelCallEvent,
  AfterToolCallEvent,
  BedrockModel,
  BeforeToolCallEvent,
  McpClient,
  SlidingWindowConversationManager,
  TextBlock,
  type McpTransport,
  type Model,
} from '@strands-agents/sdk';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { systemPrompt, type Channel, type Speaker, type ToolCallRecord, type TraceStep, type TurnResult } from '../sim/host.js';
import { NOTHING_SAID, speakable, toolAnswer } from '../domain/speakable.js';
import { NoBlame, type NoBlameReport } from './no-blame.js';

/**
 * The CareCircle planner on Strands Agents.
 *
 * The same planner as sim/host.ts - the same system prompt, the same MCP tools with their
 * descriptions untouched, the same step limits - with the loop run by a Strands Agent
 * instead of by hand. What Strands adds is a place to stand between the model and the
 * speaker: the NoBlame plugin (no-blame.ts) sees every finished reply before it is kept.
 *
 * The tools come from the CareCircle MCP server through Strands' own McpClient, over
 * whatever transport the caller has: in-process for the Telegram chat and the tests, or
 * Streamable HTTP to a deployed server.
 */

export interface StrandsTurnResult extends TurnResult {
  noBlame: NoBlameReport;
}

interface Turn { steps: TraceStep[]; calls: ToolCallRecord[]; started: Map<string, number>; modelStarted: number }

/** Bounded so a confused model cannot loop forever: model calls per turn, as the console's host. */
const STEPS: Record<Channel, number> = { voice: 7, chat: 11 };
/** Enough history for a conversation without paying for an afternoon of it on every turn. */
const HISTORY = 40;

export function bedrockModel(env: NodeJS.ProcessEnv = process.env): BedrockModel {
  return new BedrockModel({
    modelId: env['BEDROCK_MODEL_ID'] ?? 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
    region: env['AWS_REGION'] ?? 'us-east-1',
    maxTokens: 512,
    temperature: 0,
  });
}

/** Read a JSON resource the server offers, or nothing. */
async function resource<T>(client: Client, uri: string): Promise<T | null> {
  try {
    const res = await client.readResource({ uri });
    const text = (res.contents?.[0] as { text?: string } | undefined)?.text;
    return text ? JSON.parse(text) as T : null;
  } catch { return null; }
}

export class StrandsAlexa {
  readonly #agent: Agent;
  readonly #mcp: McpClient;
  readonly #noBlame: NoBlame;
  readonly #channel: Channel;
  readonly #modelId: string;
  /** The turn in progress, filled by the hooks. */
  #turn: Turn | null = null;

  private constructor(opts: { agent: Agent; mcp: McpClient; noBlame: NoBlame; channel: Channel; modelId: string }) {
    this.#agent = opts.agent;
    this.#mcp = opts.mcp;
    this.#noBlame = opts.noBlame;
    this.#channel = opts.channel;
    this.#modelId = opts.modelId;
  }

  get modelId(): string { return this.#modelId; }

  /**
   * A planner over a CareCircle server, speaking as the member the transport's credential
   * belongs to. `transport` is not yet started; Strands' McpClient starts it.
   */
  static async over(transport: McpTransport, opts: { model?: Model; channel?: Channel; now?: () => Date } = {}): Promise<StrandsAlexa> {
    const channel = opts.channel ?? 'voice';
    const mcp = new McpClient({ transport, applicationName: 'carecircle-strands', disableMcpInstrumentation: true });
    await mcp.connect();
    // Who is speaking and where the family lives come from the server, never the person.
    const me = await resource<Speaker>(mcp.client as unknown as Client, 'carecircle://session/me');
    const state = await resource<{ household?: { timezone?: string } }>(mcp.client as unknown as Client, 'carecircle://household/state');
    const speaker = me?.name && me.role ? me : null;
    const timezone = state?.household?.timezone ?? 'America/New_York';
    const model = opts.model ?? bedrockModel();
    const noBlame = new NoBlame();
    const agent = new Agent({
      model,
      tools: await mcp.listTools(),
      systemPrompt: systemPrompt({ now: opts.now?.() ?? new Date(), timezone, speaker, channel }),
      plugins: [noBlame],
      printer: false,
      conversationManager: new SlidingWindowConversationManager({ windowSize: HISTORY }),
      toolExecutor: 'sequential',
    });
    const host = new StrandsAlexa({ agent, mcp, noBlame, channel, modelId: String(model.getConfig().modelId ?? 'unknown') });
    host.#trace();
    return host;
  }

  /** Every model reply and tool call of a turn, in the console host's trace shape. */
  #trace(): void {
    this.#agent.addHook(AfterModelCallEvent, (event) => {
      const turn = this.#turn;
      if (!turn) return;
      turn.steps.push({ plannerMs: Date.now() - turn.modelStarted, calls: [] });
      turn.modelStarted = Date.now();
      if (turn.steps.length >= STEPS[this.#channel] && event.stopData?.stopReason === 'toolUse') this.#agent.cancel();
    });
    this.#agent.addHook(BeforeToolCallEvent, (event) => {
      this.#turn?.started.set(event.toolUse.toolUseId, Date.now());
    });
    this.#agent.addHook(AfterToolCallEvent, (event) => {
      const turn = this.#turn;
      if (!turn) return;
      const call: ToolCallRecord = {
        name: event.toolUse.name,
        arguments: (event.toolUse.input ?? {}) as Record<string, unknown>,
        result: event.result.content.map((b) => (b instanceof TextBlock ? b.text : '')).join(' ').trim(),
        isError: event.result.status === 'error',
        ms: Date.now() - (turn.started.get(event.toolUse.toolUseId) ?? Date.now()),
      };
      turn.calls.push(call);
      turn.steps.at(-1)?.calls.push(call);
      turn.modelStarted = Date.now();
    });
  }

  /** One turn: what the person said in, what is said back. */
  async say(utterance: string): Promise<StrandsTurnResult> {
    const started = Date.now();
    const turn: Turn = { steps: [], calls: [], started: new Map(), modelStarted: started };
    this.#turn = turn;
    try {
      const result = await this.#agent.invoke(utterance);
      const cut = result.stopReason === 'cancelled';
      const spoken = cut
        ? "Sorry, I got stuck working that out. Could you say it another way?"
        : speakable(result.lastMessage.content.map((b) => (b instanceof TextBlock ? b.text : '')).join(' '))
          || toolAnswer(turn.calls.filter((c) => !c.isError).map((c) => c.result))
          || NOTHING_SAID;
      const plannerMs = turn.steps.reduce((sum, s) => sum + s.plannerMs, 0);
      const toolMs = turn.calls.reduce((sum, c) => sum + c.ms, 0);
      return {
        spoken,
        toolCalls: turn.calls,
        noBlame: this.#noBlame.report,
        trace: {
          channel: this.#channel, model: this.#modelId, outcome: cut ? 'step_limit' : 'answered',
          steps: turn.steps, plannerMs, toolMs, totalMs: Date.now() - started,
        },
      };
    } finally {
      this.#turn = null;
    }
  }

  async close(): Promise<void> { await this.#mcp.disconnect(); }
}
