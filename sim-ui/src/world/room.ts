import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { Key } from '../lib/dpad';
import { ALEXA_VOICE, CAST, PLAYABLE, type PersonKey } from './cast';
import type { Prompt, Status, WorldView } from './director';
import { family } from './families';
import { clockText, STORY } from './story';

// Playing one family's day together. The host's world runs the day, as always, on the host's
// copy of the record; this posts what it shows to a room (src/sim/rooms.ts) once a second, and
// brings back what family members sent from their own phones. A guest's words go to Alexa
// from the host's world, so there is one copy and one record however many people play.

export interface FeedCaption {
  who: string;
  to?: string;
  text: string;
  tone: string;
  color?: string;
  voice?: string;
}

/** What a family member's phone shows. Only what is on the host's screen already. */
export interface Feed {
  family: string;
  place: string;
  clock: string;
  beat: string;
  point: string;
  status: Status;
  caption: FeedCaption | null;
  /** Changes whenever the caption does, so a phone says each line once. */
  captionId: number;
  /** Only a guest's turn: the host's own turns stay on the host's screen. */
  prompt: Prompt | null;
  people: { key: PersonKey; name: string; role: string; playAs: string; color: string }[];
  hostAs: PersonKey | null;
  trace: { who: string; call: string; at: string; err: boolean }[];
  ending: string | null;
}

const POLL_MS = 1000;

function voiceOf(name: string): string | undefined {
  if (name === 'Alexa') return ALEXA_VOICE;
  return Object.values(CAST).find((p) => p?.name === name)?.voice;
}

export function feedOf(view: WorldView, captionId: number): Feed {
  const f = family();
  const beat = STORY[view.beat]!;
  const c = view.caption;
  return {
    family: f.label,
    place: f.places ? `${f.places.home} · ${f.places.tolu}` : 'Lagos',
    clock: clockText(view.clock),
    beat: view.status === 'cast' ? '' : beat.title,
    point: view.status === 'cast' ? '' : (view.point ?? beat.point),
    status: view.status,
    caption: c
      ? {
          who: c.who,
          ...(c.to ? { to: c.to } : {}),
          text: c.text,
          tone: c.tone,
          ...(c.color ? { color: c.color } : {}),
          ...(voiceOf(c.who) ? { voice: voiceOf(c.who) } : {}),
        }
      : null,
    captionId,
    prompt: view.status === 'yourTurn' && view.prompt?.guest ? view.prompt : null,
    people: PLAYABLE.map((k) => ({
      key: k,
      name: CAST[k]!.name,
      role: CAST[k]!.role,
      playAs: CAST[k]!.playAs,
      color: CAST[k]!.color,
    })),
    hostAs: view.playing,
    trace: view.trace.slice(-6).map((t) => ({
      who: t.who,
      call: t.call.name,
      at: clockText(new Date(t.at)),
      err: !!t.call.isError,
    })),
    ending: view.status === 'done' ? f.ending : null,
  };
}

/**
 * The host's side: once a room is open, post the feed and take guests' turns. Returns who
 * is held by whom, for the invite panel and the cast cards.
 */
export function useHostRoom(
  code: string | null,
  view: WorldView,
  director: {
    setGuests: (who: PersonKey[]) => void;
    fromGuest: (msg: { who: PersonKey; text?: string; key?: Key }) => void;
  },
): { held: PersonKey[]; error: string | null } {
  const [held, setHeld] = useState<PersonKey[]>([]);
  const [error, setError] = useState<string | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const caption = useRef<{ was: WorldView['caption']; id: number }>({ was: null, id: 0 });

  useEffect(() => {
    if (!code) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const v = viewRef.current;
      if (v.caption !== caption.current.was)
        caption.current = { was: v.caption, id: caption.current.id + 1 };
      try {
        const out = await api.room.host(code, feedOf(v, caption.current.id), v.playing);
        if (stop) return;
        const who = Object.keys(out.seats).filter((k): k is PersonKey =>
          (PLAYABLE as readonly string[]).includes(k),
        );
        setHeld((h) => (h.join() === who.join() ? h : who));
        director.setGuests(who);
        for (const m of out.inbox)
          director.fromGuest({
            who: m.who as PersonKey,
            text: m.text,
            key: m.key as Key | undefined,
          });
        setError(null);
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
      if (!stop) timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
      director.setGuests([]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  return { held, error };
}
