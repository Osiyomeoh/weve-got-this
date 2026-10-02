/**
 * What of a model's reply may be said to the family.
 *
 * Some models (Amazon Nova among them) write their reasoning inline, in <thinking> tags,
 * before the answer: "<thinking>I need to tell Tolu nothing was logged</thinking> Here is
 * today's summary...". None of it is meant for the person, and on a speaker it would be
 * read aloud. A tag left open runs to the end of the reply, so that is cut too.
 */
export function speakable(reply: string): string {
  return reply
    .replace(/<(thinking|reasoning)>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(thinking|reasoning)>[\s\S]*$/i, ' ')
    .replace(/<\/?(thinking|reasoning|response|answer)>/gi, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * What the tools answered this turn, each distinct answer once, in order: said when a
 * reply has nothing left to say aloud. The server's sentences are written to be spoken and
 * never blame anyone, and a turn that wrote to the record must say so rather than go quiet.
 */
export function toolAnswer(texts: string[]): string {
  return [...new Set(texts.map((t) => t.trim()).filter(Boolean))].join(' ');
}

/** Said when a reply is empty and no tool answered anything this turn. */
export const NOTHING_SAID = "Sorry, I don't have an answer for that. Could you say it another way?";
