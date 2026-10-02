import {
  Model,
  ModelContentBlockDeltaEvent,
  ModelContentBlockStartEvent,
  ModelContentBlockStopEvent,
  ModelMessageStartEvent,
  ModelMessageStopEvent,
  ModelMetadataEvent,
  TextBlock,
  type BaseModelConfig,
  type JSONValue,
  type Message,
  type ModelStreamEvent,
  type StreamOptions,
} from '@strands-agents/sdk';

/**
 * A Strands model that plays a script instead of calling Bedrock, so the agent loop, the
 * MCP tools and the plugins run for real in tests with no credentials and no randomness.
 * A step is a tool call, a reply, or a function of the conversation so far that returns one.
 */
export type Step =
  | { tool: string; input?: Record<string, unknown> }
  | { say: string }
  | ((messages: Message[]) => Step);

/** The text of every block in a message, for steps that answer from what came back. */
export function textIn(message: Message | undefined): string {
  if (!message) return '';
  return message.content.flatMap((b) => {
    if (b instanceof TextBlock) return [b.text];
    if (b.type === 'toolResultBlock') return b.content.map((c) => (c instanceof TextBlock ? c.text : ''));
    return [];
  }).join(' ');
}

export class ScriptedModel extends Model<BaseModelConfig> {
  /** What the model was shown on each call, newest last. */
  readonly seen: Message[][] = [];
  /** The system prompt on each call. */
  readonly prompts: string[] = [];
  #next = 0;
  #ids = 0;

  constructor(private readonly steps: Step[]) { super(); }

  updateConfig(): void {}
  getConfig(): BaseModelConfig { return { modelId: 'scripted' }; }

  async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    this.seen.push(messages.map((m) => m));
    const system = options?.systemPrompt;
    this.prompts.push(typeof system === 'string' ? system : JSON.stringify(system ?? ''));
    let step: Step = this.steps[this.#next++] ?? { say: 'That is everything.' };
    while (typeof step === 'function') step = step(messages);

    yield new ModelMessageStartEvent({ type: 'modelMessageStartEvent', role: 'assistant' });
    if ('tool' in step) {
      yield new ModelContentBlockStartEvent({
        type: 'modelContentBlockStartEvent',
        start: { type: 'toolUseStart', name: step.tool, toolUseId: `scripted-${++this.#ids}` },
      });
      yield new ModelContentBlockDeltaEvent({
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'toolUseInputDelta', input: JSON.stringify((step.input ?? {}) as JSONValue) },
      });
      yield new ModelContentBlockStopEvent({ type: 'modelContentBlockStopEvent' });
      yield new ModelMessageStopEvent({ type: 'modelMessageStopEvent', stopReason: 'toolUse' });
    } else {
      yield new ModelContentBlockDeltaEvent({ type: 'modelContentBlockDeltaEvent', delta: { type: 'textDelta', text: step.say } });
      yield new ModelContentBlockStopEvent({ type: 'modelContentBlockStopEvent' });
      yield new ModelMessageStopEvent({ type: 'modelMessageStopEvent', stopReason: 'endTurn' });
    }
    yield new ModelMetadataEvent({ type: 'modelMetadataEvent', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, metrics: { latencyMs: 0 } });
  }
}
