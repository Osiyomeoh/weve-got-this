import { AsyncLocalStorage } from 'node:async_hooks';
import { sandboxCreatedAt } from './sandbox.js';

/**
 * The story clock: what time it is inside one visitor's copy of the demo.
 *
 * The world simulation plays one evening in the family's life - the pharmacy run due at
 * 8, the doorbell at 7:58, the agent's "still on?" at 8:16. The agent's judgement depends
 * on the hour (quiet hours start at 9 PM in the household's zone), so a judge in New York
 * at 4 PM, which is 9 PM in Lagos, would watch the agent hold back from the scene they
 * came to see. Bending the server's clock for everyone is not an option, and neither is
 * faking the agent's answer.
 *
 * So the caller may say what time it is in the story, and the server believes it only
 * for a sandbox copy: a household whose id carries a sandbox suffix, reached with a
 * credential that only works inside that copy. The real demo household and every real
 * family run on the real clock, whatever a request claims. Nothing is stored: the time
 * travels with each request, so any instance can answer any request.
 */

export const STORY_TIME_HEADER = 'x-carecircle-story-time';

interface StoryTime { at: number; received: number }

const current = new AsyncLocalStorage<StoryTime>();

/** The claimed story time, if this request may have one: a sandbox household and a valid instant. */
export function storyTimeFor(householdId: string | undefined, header: string | undefined, received = Date.now()): StoryTime | null {
  if (!householdId || !header || sandboxCreatedAt(householdId) === null) return null;
  const at = Date.parse(header);
  return Number.isFinite(at) ? { at, received } : null;
}

/** Run `fn` with the story clock set, so every `now()` inside it reads story time. */
export function withStoryTime<T>(story: StoryTime | null, fn: () => T): T {
  return story ? current.run(story, fn) : fn();
}

/**
 * A clock that reads the story time when the current request has one, and `base`
 * otherwise. The story keeps moving while a request runs, as real time would.
 */
export function storyAware(base: () => Date): () => Date {
  return () => {
    const story = current.getStore();
    return story ? new Date(story.at + (Date.now() - story.received)) : base();
  };
}
