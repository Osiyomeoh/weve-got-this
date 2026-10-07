import type { ToolCall } from './api';
import type { Key } from './dpad';

// The TV on the wall in the world is the real /tv page in an iframe. When someone in the
// story picks up the remote, the world presses its buttons here, and the page does exactly
// what it does for a real remote. What the press did on the server comes back, so the
// world can show it on the record like any other call. Same origin only, both ways.

const PRESS = 'carecircle-remote';
const DID = 'carecircle-tv-did';

/** The world's side: press a button on the remote of an embedded TV. */
export function pressRemote(frame: Window | null | undefined, key: Key): void {
  frame?.postMessage({ type: PRESS, key }, window.location.origin);
}

/** The TV's side: hear presses from the world. Returns an unsubscribe. */
export function onRemote(handler: (key: Key) => void): () => void {
  if (typeof window === 'undefined' || window.parent === window) return () => undefined;
  const listen = (e: MessageEvent) => {
    if (e.origin !== window.location.origin || e.data?.type !== PRESS) return;
    handler(e.data.key as Key);
  };
  window.addEventListener('message', listen);
  return () => window.removeEventListener('message', listen);
}

/** The TV's side: tell the world what a press did, as the tool call it made. */
export function reportToWorld(who: string, call: ToolCall): void {
  if (typeof window === 'undefined' || window.parent === window) return;
  window.parent.postMessage({ type: DID, who, call }, window.location.origin);
}

/** The world's side: hear what the TV did. Returns an unsubscribe. */
export function onTvDid(handler: (who: string, call: ToolCall) => void): () => void {
  const listen = (e: MessageEvent) => {
    if (e.origin !== window.location.origin || e.data?.type !== DID) return;
    handler(String(e.data.who), e.data.call as ToolCall);
  };
  window.addEventListener('message', listen);
  return () => window.removeEventListener('message', listen);
}

// The doorbell. On Fire TV a Ring press opens its live view over whatever is playing, so when
// the doorbell in the world reports someone, the world tells the set in the house.
const RING = 'carecircle-ring';

/** The world's side: someone is at the door this TV belongs to. */
export function ringTv(frame: Window | null | undefined): void {
  frame?.postMessage({ type: RING }, window.location.origin);
}

/** The TV's side: hear the doorbell. Returns an unsubscribe. */
export function onRing(handler: () => void): () => void {
  if (typeof window === 'undefined' || window.parent === window) return () => undefined;
  const listen = (e: MessageEvent) => {
    if (e.origin !== window.location.origin || e.data?.type !== RING) return;
    handler();
  };
  window.addEventListener('message', listen);
  return () => window.removeEventListener('message', listen);
}
