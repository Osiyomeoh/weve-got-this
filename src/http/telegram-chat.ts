import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createCareCircleServer } from '../mcp/server.js';
import type { Notifier } from '../notify/notifier.js';
import type { CareStore } from '../store/store.js';
import { SimulatedAlexa } from '../sim/host.js';
import type { ModelProvider } from '../sim/providers.js';

/**
 * Talking to CareCircle in Telegram.
 *
 * Without an Echo in the house - the case in Lagos today - the person being cared for
 * still has to be able to say "I used my eye drops" himself, or the record is always
 * somebody else's account of him. His family already lives in Telegram, so that is where
 * he says it. A message goes to the same planner and the same tools the console uses,
 * acting as the member Telegram says sent it: identity comes from the verified sender,
 * never from anything in the text.
 *
 * Each member keeps one conversation for a while, so "and the supplement too" follows on
 * from what they said a minute ago; an idle one is dropped and starts fresh next time.
 * Turns for one member run one at a time, in the order they arrived.
 */

export type ChatReply = (memberId: string, text: string) => Promise<string>;

export interface TelegramChatOptions {
  store: CareStore;
  provider: ModelProvider;
  notifier?: Notifier;
  now?: () => Date;
  /** How long a quiet conversation is kept. */
  idleMs?: number;
}

interface Thread { host: Promise<SimulatedAlexa>; opened: number; lastUsed: number; queue: Promise<unknown> }

// The planner is told the date when a thread opens, so no thread outlives a few hours:
// a conversation that ran past midnight would resolve "tomorrow" against yesterday.
const MAX_AGE_MS = 4 * 60 * 60_000;

const SORRY = "Sorry, I couldn't do that just now. Please try again in a minute.";

export function createTelegramChat(opts: TelegramChatOptions): ChatReply {
  // Long enough that a morning conversation is still remembered at lunchtime.
  const idleMs = opts.idleMs ?? 3 * 60 * 60_000;
  const threads = new Map<string, Thread>();

  const open = async (memberId: string): Promise<SimulatedAlexa> => {
    const server = createCareCircleServer({
      store: opts.store, actorId: memberId,
      ...(opts.notifier ? { notifier: opts.notifier } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: 'carecircle-telegram', version: '0.1.0' });
    await client.connect(clientSide);
    return SimulatedAlexa.over(client, opts.provider, 'chat');
  };

  return async (memberId, text) => {
    const at = Date.now();
    for (const [id, t] of threads) if (at - t.lastUsed > idleMs || at - t.opened > MAX_AGE_MS) threads.delete(id);
    let thread = threads.get(memberId);
    if (!thread) {
      thread = { host: open(memberId), opened: at, lastUsed: at, queue: Promise.resolve() };
      threads.set(memberId, thread);
    }
    thread.lastUsed = at;
    const t = thread;
    const turn = t.queue.then(async () => {
      try {
        const reply = await (await t.host).say(text);
        return reply.spoken.trim() || SORRY;
      } catch {
        // A broken thread is not kept: the next message starts a clean one.
        threads.delete(memberId);
        return SORRY;
      }
    });
    t.queue = turn.catch(() => undefined);
    return turn;
  };
}
