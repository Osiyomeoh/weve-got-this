import {
  AfterModelCallEvent,
  AfterToolCallEvent,
  BeforeInvocationEvent,
  BeforeModelCallEvent,
  Message,
  TextBlock,
  type LocalAgent,
  type Plugin,
} from '@strands-agents/sdk';
import { blameIn } from '../domain/no-blame.js';
import { toolAnswer } from '../domain/speakable.js';

/**
 * No reply says a person missed something, whatever the model writes.
 *
 * The prompt already tells the planner that a missing record is not evidence, and the
 * server's own sentences never blame anyone (mcp/fuzz.props.test.ts). Neither stops a
 * model from turning "no record of the evening drops" into "Dad missed his evening drops"
 * on its way to the speaker. This plugin stands between the two, in the Strands loop:
 *
 *  1. A finished reply that blames anyone is not kept. The model is asked again, told what
 *     it said and why it can't be said (the note is taken out of the history afterwards).
 *  2. If the second reply blames too, the model is not asked a third time. What is spoken
 *     is what the tools answered this turn, which never blames (never a refusal: that is
 *     written for the model), or, with nothing to fall back on, a sentence that says only
 *     what the record can say.
 *
 * Either way the blaming reply never enters the conversation, so it is neither spoken nor
 * remembered for the next turn.
 */

export interface NoBlameReport {
  /** The blaming words in each reply that was stopped, in order. */
  caught: string[];
  /** The model was asked again and its next reply was clean. */
  corrected: boolean;
  /** The model blamed twice and its reply was replaced with what the tools said. */
  replaced: boolean;
}

/** Spoken when the model blamed twice and no tool said anything this turn. */
export const ONLY_THE_RECORD =
  "I can only tell you what's been recorded, and I won't say more than the record shows.";

function textOf(message: Message): string {
  return message.content
    .map((b) => (b instanceof TextBlock ? b.text : ''))
    .join(' ')
    .trim();
}

function correction(phrase: string): string {
  return (
    `[CareCircle check, not from the person] Your reply said "${phrase}". CareCircle only knows what someone ` +
    'recorded: a dose or task with no record may have been done and not logged, so nobody can be said to ' +
    'have missed, skipped or forgotten it, and nothing can be said to have been missed either. Answer again ' +
    'using only what the tool results say. Where there is no record, say there is no record.'
  );
}

export class NoBlame implements Plugin {
  readonly name = 'carecircle:no-blame';
  /** How many times a blaming reply is sent back before it is replaced. */
  readonly #retries: number;
  #report: NoBlameReport = { caught: [], corrected: false, replaced: false };
  #toolTexts: string[] = [];
  /** The history entry a correction was added to, and what it was before. */
  #noted: { index: number; original: Message } | null = null;
  #replaceWith: string | null = null;

  constructor(opts: { retries?: number } = {}) {
    this.#retries = opts.retries ?? 1;
  }

  /** What happened in the last turn. */
  get report(): NoBlameReport {
    return { ...this.#report, caught: [...this.#report.caught] };
  }

  initAgent(agent: LocalAgent): void {
    agent.addHook(BeforeInvocationEvent, () => {
      this.#report = { caught: [], corrected: false, replaced: false };
      this.#toolTexts = [];
      this.#noted = null;
      this.#replaceWith = null;
    });

    agent.addHook(AfterToolCallEvent, (event) => {
      // A refusal is written for the model (it names the tool to call instead), not for the person.
      if (event.result.status === 'error') return;
      for (const block of event.result.content) {
        if (block instanceof TextBlock && block.text.trim())
          this.#toolTexts.push(block.text.trim());
      }
    });

    agent.addHook(BeforeModelCallEvent, (event) => {
      // Cancelling with text makes that text the reply, as if the model had said it.
      if (this.#replaceWith !== null) {
        event.cancel = this.#replaceWith;
        this.#replaceWith = null;
      }
    });

    agent.addHook(AfterModelCallEvent, (event) => {
      if (this.#noted) {
        event.agent.messages[this.#noted.index] = this.#noted.original;
        this.#noted = null;
      }
      const stop = event.stopData;
      if (!stop || stop.stopReason !== 'endTurn') return;
      const phrase = blameIn(textOf(stop.message));
      if (!phrase) {
        if (this.#report.caught.length > 0 && !this.#report.replaced) this.#report.corrected = true;
        return;
      }
      this.#report.caught.push(phrase);
      event.retry = true;
      if (this.#report.caught.length <= this.#retries) {
        const messages = event.agent.messages;
        const index = messages.length - 1;
        const last = messages[index];
        if (last) {
          this.#noted = { index, original: last };
          messages[index] = new Message({
            role: last.role,
            content: [...last.content, new TextBlock(correction(phrase))],
          });
        }
        return;
      }
      this.#report.replaced = true;
      this.#replaceWith = toolAnswer(this.#toolTexts.filter((t) => !blameIn(t))) || ONLY_THE_RECORD;
    });
  }
}
