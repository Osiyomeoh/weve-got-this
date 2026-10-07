import { useEffect, useState } from 'react';

// When a page runs inside the world (the Fire TV on Daddy's wall is the real /tv page in
// an iframe), the world tells it what time it is in the story. Only a page in the same
// origin can say so, and the server honours it only for this visitor's own copy.

const MESSAGE = 'carecircle-story-time';
let story: { at: number; setAt: number } | null = null;
const listeners = new Set<() => void>();

if (typeof window !== 'undefined' && window.parent !== window) {
  window.addEventListener('message', (e) => {
    if (e.origin !== window.location.origin || e.data?.type !== MESSAGE) return;
    const at = Date.parse(e.data.at);
    if (!Number.isFinite(at)) return;
    story = { at, setAt: Date.now() };
    listeners.forEach((l) => l());
  });
}

/** Story time if the world has set one, otherwise undefined (real time). */
export function storyNow(): Date | undefined {
  return story ? new Date(story.at + (Date.now() - story.setAt)) : undefined;
}

/** The world's side: tell an embedded page what time it is. */
export function tellStoryTime(frame: Window | null | undefined, at: Date): void {
  frame?.postMessage({ type: MESSAGE, at: at.toISOString() }, window.location.origin);
}

/** A clock that ticks every second, in story time when there is one. */
export function useNow(): { now: Date; inStory: boolean } {
  const [now, setNow] = useState(() => storyNow() ?? new Date());
  useEffect(() => {
    const tick = () => setNow(storyNow() ?? new Date());
    listeners.add(tick);
    const id = setInterval(tick, 1000);
    return () => { listeners.delete(tick); clearInterval(id); };
  }, []);
  return { now, inStory: story !== null };
}
