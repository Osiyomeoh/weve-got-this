import {
  Agent,
  AfterModelCallEvent,
  TextBlock,
  Tool,
  ToolResultBlock,
  ToolUseBlock,
  type JSONSchema,
  type Model,
  type ToolContext,
  type ToolStreamGenerator,
} from '@strands-agents/sdk';
import type { Conversation, ModelProvider, ToolSpec, TurnOutput } from '../sim/providers.js';
import { bedrockModel } from './host.js';

/**
 * The Strands planner as a ModelProvider, so the tool-selection evals measure it with the
 * same harness, corpus, prompt and tool definitions as the console's planner: the first
 * reply to one utterance, and nothing run. Only the loop around the model differs.
 *
 * Full turns, with tools run and replies checked, are StrandsAlexa (host.ts). This provider
 * stops at the first reply, so it has nothing to report tool results to.
 */

/** A tool the model can see and choose, which the first-reply measure never runs. */
class Listed extends Tool {
  readonly name: string;
  readonly description: string;
  readonly toolSpec: { name: string; description: string; inputSchema: JSONSchema };

  constructor(spec: ToolSpec) {
    super();
    this.name = spec.name;
    this.description = spec.description;
    this.toolSpec = { name: spec.name, description: spec.description, inputSchema: spec.inputSchema as JSONSchema };
  }

  // eslint-disable-next-line require-yield
  async *stream(context: ToolContext): ToolStreamGenerator {
    return new ToolResultBlock({
      toolUseId: context.toolUse.toolUseId, status: 'error',
      content: [new TextBlock('Not run: the first reply is being measured.')],
    });
  }
}

export class StrandsProvider implements ModelProvider {
  readonly name = 'strands';
  readonly model: Model;

  constructor(model: Model = bedrockModel()) { this.model = model; }

  get modelId(): string { return String(this.model.getConfig().modelId ?? 'unknown'); }

  start(system: string, tools: ToolSpec[]): Conversation {
    const agent = new Agent({
      model: this.model,
      tools: tools.map((t) => new Listed(t)),
      systemPrompt: system,
      printer: false,
    });
    let first: TurnOutput | null = null;
    agent.addHook(AfterModelCallEvent, (event) => {
      if (first || !event.stopData) return;
      const content = event.stopData.message.content;
      first = {
        text: content.map((b) => (b instanceof TextBlock ? b.text : '')).join(' ').trim(),
        toolUses: content.filter((b): b is ToolUseBlock => b instanceof ToolUseBlock).map((b) => ({
          id: b.toolUseId, name: b.name, input: (b.input ?? {}) as Record<string, unknown>,
        })),
      };
      if (first.toolUses.length) agent.cancel();
    });
    return {
      async say(utterance) {
        first = null;
        await agent.invoke(utterance);
        if (!first) throw new Error('The Strands agent finished without a model reply.');
        return first;
      },
      async report() {
        throw new Error('StrandsProvider measures the first reply only; use StrandsAlexa for full turns.');
      },
    };
  }
}

