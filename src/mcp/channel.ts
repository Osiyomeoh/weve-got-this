import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Which device a person used to tell us something, when it was not their voice.
 *
 * The Fire TV can be worked with the remote: an older parent who has never used a
 * smartphone presses OK to say she took her tablet. That is still her word, reported by
 * her credential, and it is recorded as hers; the channel only says how it arrived, so
 * the trail can read "Mummy, with the TV remote" instead of claiming she said it aloud.
 *
 * The channel never changes who is speaking or what they may do. Identity comes from the
 * credential alone, so a client that names the wrong channel mislabels only its own report.
 */

export const CHANNEL_HEADER = 'x-carecircle-channel';

export type Channel = 'tv';

const current = new AsyncLocalStorage<Channel>();

/** The channel a request names, if it is one we know. Anything else is ignored. */
export function channelOf(header: string | undefined): Channel | null {
  return header === 'tv' ? 'tv' : null;
}

/** Run `fn` with the channel set, so a tool inside it can record how a report arrived. */
export function withChannel<T>(channel: Channel | null, fn: () => T): T {
  return channel ? current.run(channel, fn) : fn();
}

/** The channel of the request being served, if it named one. */
export function currentChannel(): Channel | undefined {
  return current.getStore();
}
