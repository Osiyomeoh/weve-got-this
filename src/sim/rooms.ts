import { randomInt } from 'node:crypto';

/**
 * Playing one family's day together, from different phones.
 *
 * The host's browser runs the day on the host's own copy of the record; nothing about that
 * changes. A room is only a relay beside it: the host posts what the world is showing (the
 * feed), family members join by a short code and take a person nobody is playing, and when
 * it is that person's turn their words come back through the room to the host's world,
 * which says them to Alexa exactly as if the host had typed them. One copy, one record,
 * several people.
 *
 * Rooms live in this process's memory (the sim runs as one instance), are bounded, and
 * expire when the host stops posting. Nothing in a room is written anywhere.
 */

export type Seat = 'daddy' | 'tolu' | 'musa';
const SEATS: readonly Seat[] = ['daddy', 'tolu', 'musa'];

export function isSeat(v: unknown): v is Seat {
  return typeof v === 'string' && (SEATS as readonly string[]).includes(v);
}

/** What a guest sends: a line in their own words, or a press on the TV remote. */
export type GuestMessage = { who: Seat; text: string } | { who: Seat; key: RemoteKey };
export type RemoteKey = 'left' | 'up' | 'ok' | 'down' | 'right' | 'back';
const KEYS: readonly RemoteKey[] = ['left', 'up', 'ok', 'down', 'right', 'back'];

interface Room {
  code: string;
  host: string;
  feed: unknown;
  /** The person the host plays, which no guest can take. */
  hostAs: Seat | null;
  seats: Map<Seat, string>;
  inbox: GuestMessage[];
  touched: number;
}

const FEED_LIMIT = 16_000;
const TEXT_LIMIT = 500;
const INBOX_LIMIT = 20;
// No 0/O or 1/I: the code is read aloud across a room, or typed from a text message.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type RoomError =
  'no-room' | 'not-host' | 'seat-taken' | 'no-seat' | 'bad-message' | 'too-big';

export class Rooms {
  readonly #rooms = new Map<string, Room>();
  readonly #limit: number;
  readonly #ttl: number;
  readonly #now: () => number;

  constructor(opts: { limit?: number; ttlMs?: number; now?: () => number } = {}) {
    this.#limit = opts.limit ?? 200;
    this.#ttl = opts.ttlMs ?? 2 * 60 * 60 * 1000;
    this.#now = opts.now ?? Date.now;
  }

  #sweep(): void {
    const now = this.#now();
    for (const [code, r] of this.#rooms) if (now - r.touched > this.#ttl) this.#rooms.delete(code);
  }

  #live(code: string): Room | undefined {
    this.#sweep();
    return this.#rooms.get(code.toUpperCase());
  }

  /** A host's room: the same one again if they already have it. */
  open(host: string): string {
    this.#sweep();
    for (const r of this.#rooms.values())
      if (r.host === host) {
        r.touched = this.#now();
        return r.code;
      }
    while (this.#rooms.size >= this.#limit) {
      // The room idle longest goes first.
      let oldest: Room | undefined;
      for (const r of this.#rooms.values()) if (!oldest || r.touched < oldest.touched) oldest = r;
      if (!oldest) break;
      this.#rooms.delete(oldest.code);
    }
    let code = '';
    do code = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    while (this.#rooms.has(code));
    this.#rooms.set(code, {
      code,
      host,
      feed: null,
      hostAs: null,
      seats: new Map(),
      inbox: [],
      touched: this.#now(),
    });
    return code;
  }

  /**
   * The host posts what the world shows, and takes what guests sent since last time.
   * A guest in the host's own seat is let go: the host chose it.
   */
  post(
    code: string,
    host: string,
    feed: unknown,
    hostAs: Seat | null,
  ): { seats: Partial<Record<Seat, true>>; inbox: GuestMessage[] } | RoomError {
    const r = this.#live(code);
    if (!r) return 'no-room';
    if (r.host !== host) return 'not-host';
    if (JSON.stringify(feed ?? null).length > FEED_LIMIT) return 'too-big';
    r.feed = feed;
    r.hostAs = hostAs;
    if (hostAs) r.seats.delete(hostAs);
    r.touched = this.#now();
    const inbox = r.inbox.splice(0);
    return { seats: Object.fromEntries([...r.seats.keys()].map((s) => [s, true])), inbox };
  }

  /** What a guest sees: the host's feed, which seats are taken, and which one is theirs. */
  view(
    code: string,
    guest: string,
  ): { feed: unknown; taken: Seat[]; mine: Seat | null } | RoomError {
    const r = this.#live(code);
    if (!r) return 'no-room';
    const mine = [...r.seats].find(([, g]) => g === guest)?.[0] ?? null;
    const taken = [...new Set([...r.seats.keys(), ...(r.hostAs ? [r.hostAs] : [])])];
    return { feed: r.feed, taken, mine };
  }

  /** A guest takes a person nobody is playing. Taking another lets the first one go. */
  seat(code: string, guest: string, who: Seat): true | RoomError {
    const r = this.#live(code);
    if (!r) return 'no-room';
    const holder = r.seats.get(who);
    if (r.hostAs === who || (holder && holder !== guest)) return 'seat-taken';
    for (const [s, g] of r.seats) if (g === guest) r.seats.delete(s);
    r.seats.set(who, guest);
    return true;
  }

  /** A guest's line or press, for the person they hold. */
  send(code: string, guest: string, msg: unknown): true | RoomError {
    const r = this.#live(code);
    if (!r) return 'no-room';
    const m = (msg ?? {}) as { text?: unknown; key?: unknown };
    const who = [...r.seats].find(([, g]) => g === guest)?.[0];
    if (!who) return 'no-seat';
    let out: GuestMessage;
    if (typeof m.text === 'string' && m.text.trim() && m.text.length <= TEXT_LIMIT)
      out = { who, text: m.text.trim() };
    else if (typeof m.key === 'string' && (KEYS as readonly string[]).includes(m.key))
      out = { who, key: m.key as RemoteKey };
    else return 'bad-message';
    if (r.inbox.length >= INBOX_LIMIT) r.inbox.shift();
    r.inbox.push(out);
    return true;
  }
}
