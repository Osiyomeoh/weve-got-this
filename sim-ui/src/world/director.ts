import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type BoardState, type ToolCall } from '../lib/api';
import { ALEXA_VOICE, CAST, type PersonKey } from './cast';
import { DEVICE, HUB, SHOTS, SPOT, v3, type V3 } from './layout';
import { lagosToday, STORY, type ShotName, type Stage, type Step } from './story';
import { family } from './families';
import { hush, prepare, speak, wait } from './voice';
import type { Glow, PulseSpec } from './devices';
import type { Gesture } from './models';

// The director plays the story against the live server. It owns the story clock, the
// camera, who is speaking, and what each device shows. It never decides what Alexa or
// the agent says: those words come back from the server, and the world only stages them.

export interface Caption { who: string; text: string; tone: 'person' | 'aside' | 'alexa' | 'narration' | 'device' | 'agent'; color?: string; to?: string }

/** What a person is attending to. The scene turns it into a point in the world. */
export type LookAt = 'echo' | 'tv' | 'laptop' | 'door' | 'daddy' | 'musa' | 'tolu' | null;
/** How a person is, moment to moment: where their eyes are, whether they are talking, the phone in their hand. */
export interface Presence { look: LookAt; talking: boolean; phone: boolean; gesture: Gesture | null; at: 'home' | 'door' }
export interface PhoneMessage { from: string; text: string; key: string }
export interface TraceItem { id: number; who: string; call: ToolCall; at: string }
export interface Prompt { who: PersonKey; suggestion: string }
export interface Stuck { reason: string; expected: string[] }

export type Status = 'cast' | 'ready' | 'playing' | 'yourTurn' | 'stuck' | 'done' | 'error';

export interface WorldView {
  status: Status;
  beat: number;
  clock: Date;
  shot: ShotName;
  caption: Caption | null;
  glow: { daddy: Glow; tolu: Glow };
  phones: Partial<Record<PersonKey, PhoneMessage>>;
  phoneListening: PersonKey | null;
  trace: TraceItem[];
  pulses: PulseSpec[];
  musa: Stage;
  ringActive: boolean;
  hubBusy: boolean;
  prompt: Prompt | null;
  stuck: Stuck | null;
  error: string | null;
  playing: PersonKey | null;
  people: Record<PersonKey, Presence>;
}

const AT_REST: Record<PersonKey, Presence> = {
  daddy: { look: null, talking: false, phone: false, gesture: null, at: 'home' },
  // Tolu is at work: eyes on the laptop until something needs them.
  tolu: { look: 'laptop', talking: false, phone: false, gesture: null, at: 'home' },
  musa: { look: null, talking: false, phone: false, gesture: null, at: 'home' },
};

const START: WorldView = {
  status: 'cast', beat: 0, clock: lagosToday(7, 30), shot: 'overview', caption: null,
  glow: { daddy: 'idle', tolu: 'idle' }, phones: {}, phoneListening: null, trace: [], pulses: [],
  musa: 'midday', ringActive: false, hubBusy: false, prompt: null, stuck: null, error: null, playing: null,
  people: AT_REST,
};

/** Where a person's device is, so a message can be drawn reaching it. */
function deviceOf(who: PersonKey): V3 {
  if (who === 'daddy') return DEVICE.daddyEcho;
  if (who === 'tolu') return DEVICE.toluEcho;
  return [SPOT.musaCarMidday[0], 0.9, SPOT.musaCarMidday[2]];
}

/** Which person a notification is for, from the name the record gives them. */
function personNamed(name: string): PersonKey | null {
  const n = name.toLowerCase();
  if (n.includes('musa')) return 'musa';
  if (n.includes('tolu')) return 'tolu';
  // The person cared for, by what the family calls them or the name on the record.
  if (['daddy', 'joseph', 'mama', 'grace', 'baba', 'adewale'].some((k) => n.includes(k))) return 'daddy';
  return null;
}

const noteKey = (n: { from: string; to: string; message: string; at?: string }) => `${n.at ?? ''}|${n.to}|${n.message}`;

export function useDirector(opts: { muted: boolean; tvFrame: () => Window | null | undefined; onStoryTime: (at: Date) => void }) {
  const [view, setView] = useState<WorldView>(START);
  const set = useCallback((patch: Partial<WorldView> | ((v: WorldView) => Partial<WorldView>)) =>
    setView((v) => ({ ...v, ...(typeof patch === 'function' ? patch(v) : patch) })), []);

  // The story clock: a story instant, and the real moment it was set. It runs at real speed.
  const clock = useRef({ at: START.clock.getTime(), setAt: Date.now() });
  const storyNow = () => new Date(clock.current.at + (Date.now() - clock.current.setAt));
  const setClock = (at: Date) => { clock.current = { at: at.getTime(), setAt: Date.now() }; set({ clock: at }); opts.onStoryTime(at); };

  const run = useRef(0); // bumps on restart, so a stale run stops at its next await
  const answer = useRef<((text: string) => void) | null>(null);
  const retry = useRef<((again: boolean) => void) | null>(null);
  const seen = useRef(new Set<string>());
  const pulseId = useRef(0);
  const traceId = useRef(0);
  const viewRef = useRef(view);
  viewRef.current = view;
  const gestureId = useRef(0);
  /** People in the middle of their own turn: a passing notification doesn't take the phone away. */
  const busy = useRef(new Set<PersonKey>());
  const lastNotice = useRef<Partial<Record<PersonKey, { at: number; text: string }>>>({});

  const be = (who: PersonKey, patch: Partial<Presence>) =>
    set((v) => ({ people: { ...v.people, [who]: { ...v.people[who]!, ...patch } } }));
  const gesture = (who: PersonKey, kind: Gesture['kind']) => be(who, { gesture: { kind, key: ++gestureId.current } });
  /** Back to what they were doing before: Tolu to the laptop, the phone down. */
  const settle = (who: PersonKey) => be(who, { look: AT_REST[who]!.look, phone: false, talking: false });
  /** How long a person takes to read a message: people read, they don't absorb. */
  const readingTime = (text: string) => Math.min(3600, Math.max(1300, text.length * 38));

  // Tick the visible clock once a second, and keep the TV told.
  useEffect(() => {
    const id = setInterval(() => {
      const at = storyNow();
      set({ clock: at });
      opts.onStoryTime(at);
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pulse = (from: V3, to: V3, color: string) => {
    const spec: PulseSpec = { id: ++pulseId.current, from: v3(from), to: v3(to), color };
    set((v) => ({ pulses: [...v.pulses, spec] }));
  };
  const pulseDone = useCallback((id: number) => set((v) => ({ pulses: v.pulses.filter((p) => p.id !== id) })), [set]);

  const addTrace = (who: string, calls: ToolCall[]) => {
    if (!calls.length) return;
    const at = storyNow().toISOString();
    set((v) => ({ trace: [...v.trace, ...calls.map((call) => ({ id: ++traceId.current, who, call, at }))].slice(-14) }));
  };

  /** Read the record and deliver anything new to the right phone. */
  const deliver = async (): Promise<BoardState | null> => {
    const state = await api.state(storyNow()).catch(() => null);
    if (!state?.notifications) return state;
    for (const n of state.notifications) {
      const key = noteKey(n);
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      const to = personNamed(n.to);
      if (!to) continue;
      pulse(HUB, deviceOf(to), '#ffd27a');
      await wait(700);
      set((v) => ({ phones: { ...v.phones, [to]: { from: n.from, text: n.message, key } } }));
      // They notice, and pick it up. Daddy can't read a screen this week: his comes out of the Echo.
      lastNotice.current[to] = { at: Date.now(), text: n.message };
      if (to === 'daddy') be(to, { look: 'echo' });
      else be(to, { phone: true });
      const stamp = lastNotice.current[to];
      setTimeout(() => { if (!busy.current.has(to) && lastNotice.current[to] === stamp) settle(to); }, readingTime(n.message) + 2500);
    }
    return state;
  };

  /** Mark what is already on the record as seen, so phones only light up for what happens now. */
  const primeSeen = async () => {
    const state = await api.state(storyNow()).catch(() => null);
    for (const n of state?.notifications ?? []) seen.current.add(noteKey(n));
  };

  const lapse = async (to: [number, number], seconds: number, token: number) => {
    const from = storyNow().getTime();
    const target = lagosToday(to[0], to[1]).getTime();
    if (target <= from) return;
    const start = performance.now();
    while (true) {
      if (run.current !== token) return;
      const k = Math.min(1, (performance.now() - start) / (seconds * 1000));
      const eased = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      setClock(new Date(from + (target - from) * eased));
      if (k >= 1) return;
      await wait(60);
    }
  };

  /** One spoken turn, through the real planner, as that person. */
  const line = async (step: Extract<Step, { kind: 'line' }>, token: number): Promise<void> => {
    const person = CAST[step.who]!;
    const played = viewRef.current.playing === step.who;
    let text = step.text;

    if (played) {
      set({ status: 'yourTurn', prompt: { who: step.who, suggestion: step.text } });
      text = await new Promise<string>((resolve) => { answer.current = resolve; });
      answer.current = null;
      if (run.current !== token) return;
      set({ status: 'playing', prompt: null });
    }

    const echo = step.via === 'echo' ? (step.who === 'daddy' ? 'daddy' : 'tolu') : null;
    busy.current.add(step.who);
    // People don't answer on the instant. If something just came in, they read it first;
    // otherwise they turn to the device and gather the thought.
    if (!played) {
      prepare(text, person.voice, opts.muted);
      be(step.who, echo ? { look: 'echo' } : { phone: true });
      const notice = lastNotice.current[step.who];
      const fresh = notice && Date.now() - notice.at < 20_000;
      await wait(fresh ? Math.max(600, readingTime(notice.text) - (Date.now() - notice.at)) : 450 + Math.random() * 650);
      if (run.current !== token) return;
    } else {
      be(step.who, echo ? { look: 'echo' } : { phone: true });
    }
    set((v) => ({
      caption: { who: person.name, text, tone: 'person', color: person.color },
      ...(echo ? { glow: { ...v.glow, [echo]: 'listening' } } : { phoneListening: step.who }),
    }));
    be(step.who, { talking: true });
    if (!played) await speak(text, person.voice, person.fallbackPitch, opts.muted);
    // The visitor's words were typed or spoken already; their person says them while they travel.
    else setTimeout(() => be(step.who, { talking: false }), Math.min(4000, 700 + text.length * 45));
    if (!played) be(step.who, { talking: false });
    if (run.current !== token) return;

    set((v) => ({ hubBusy: true, ...(echo ? { glow: { ...v.glow, [echo]: 'thinking' } } : {}) }));
    pulse(deviceOf(step.who), HUB, person.color);

    let turn;
    try {
      turn = await api.say(person.memberId, text, storyNow());
    } catch (err) {
      busy.current.delete(step.who);
      set({ hubBusy: false, status: 'error', error: (err as Error).message, phoneListening: null, glow: { daddy: 'idle', tolu: 'idle' } });
      throw err;
    }
    if (run.current !== token) return;
    addTrace(person.name, turn.toolCalls);
    pulse(HUB, deviceOf(step.who), '#00e0c6');
    await wait(650);
    set((v) => ({
      hubBusy: false,
      phoneListening: null,
      caption: { who: 'Alexa', text: turn.spoken, tone: 'alexa' },
      ...(echo ? { glow: { ...v.glow, [echo]: 'speaking' } } : {}),
      // A phone reply lands on that person's phone.
      ...(!echo ? { phones: { ...v.phones, [step.who]: { from: 'Alexa', text: turn.spoken, key: `reply-${traceId.current}` } } } : {}),
    }));
    await Promise.all([speak(turn.spoken, ALEXA_VOICE, 1.15, opts.muted), deliver()]);
    if (run.current !== token) return;
    set((v) => (echo ? { glow: { ...v.glow, [echo]: 'idle' } } : {}));

    // The scene needs something to have happened. If the planner did something else,
    // say so plainly and let the visitor try again, rather than pretending.
    const called = turn.toolCalls.filter((c) => !c.isError).map((c) => c.name);
    const landed = !step.expect || step.expect.some((t) => called.includes(t));
    // A nod when it went the way they meant; a small shake of the head when it didn't.
    gesture(step.who, landed ? 'nod' : 'shake');
    busy.current.delete(step.who);
    const who = step.who;
    setTimeout(() => { if (!busy.current.has(who)) settle(who); }, 1300);
    if (!landed && step.expect) {
      set({ status: 'stuck', stuck: { reason: called.length ? `Alexa used ${called.join(', ')}.` : 'Alexa answered without changing the record.', expected: step.expect } });
      const again = await new Promise<boolean>((resolve) => { retry.current = resolve; });
      retry.current = null;
      set({ status: 'playing', stuck: null });
      if (again && run.current === token) return line(step, token);
    }
  };

  /**
   * People talking to each other, not to Alexa. Nothing is sent to the server and nothing
   * goes on the record: that is the point. The people know; the record only knows what it is told.
   */
  const aside = async (step: Extract<Step, { kind: 'aside' }>, token: number) => {
    const person = CAST[step.who]!;
    busy.current.add(step.who);
    if (viewRef.current.playing !== step.who) prepare(step.text, person.voice, opts.muted);
    be(step.who, { look: step.to as LookAt, phone: false });
    be(step.to, { look: step.who as LookAt });
    await wait(350);
    set({ caption: { who: person.name, to: CAST[step.to]!.name, text: step.text, tone: 'aside', color: person.color } });
    be(step.who, { talking: true });
    if (viewRef.current.playing === step.who) await wait(900 + step.text.length * 45);
    else await speak(step.text, person.voice, person.fallbackPitch, opts.muted);
    be(step.who, { talking: false });
    busy.current.delete(step.who);
    if (run.current !== token) return;
    if (step.listener) gesture(step.to, step.listener);
    await wait(500);
  };

  const signal = async (step: Extract<Step, { kind: 'signal' }>, token: number) => {
    set({ caption: { who: step.source === 'ring' ? 'Ring' : 'CareCircle', text: step.caption, tone: step.source === 'ring' ? 'device' : 'agent' } });
    if (step.source === 'ring') {
      if (!opts.muted) chime();
      set({ ringActive: true });
      pulse(DEVICE.doorbell, HUB, '#33b6ff');
    }
    set({ hubBusy: true });
    await wait(900);
    // The doorbell's report and the agent's own pass are tool calls like any other, made on
    // this visitor's copy; Tolu's credential stands in for the household's device link.
    const call = await api.act(CAST.tolu!.memberId, step.tool, step.args, storyNow());
    if (run.current !== token) return;
    addTrace(step.source === 'ring' ? 'Ring' : 'Agent', [call]);
    set({ hubBusy: false });
    await wait(2200);
    set({ ringActive: false });
    await deliver();
    await wait(1600);
  };

  const play = useCallback(async (from = viewRef.current.beat) => {
    const token = ++run.current;
    set({ status: 'playing', error: null });
    try {
      if (from === 0) await primeSeen();
      for (let b = from; b < STORY.length; b++) {
        const beat = STORY[b]!;
        set({ beat: b });
        // A beat that opens with a lapse runs the clock there itself; any other starts at its time,
        // even if the clock runs on later in the beat (Mama asks again at 9:05).
        if (storyNow().getTime() < lagosToday(beat.at[0], beat.at[1]).getTime() && beat.steps[0]?.kind !== 'lapse') {
          setClock(lagosToday(beat.at[0], beat.at[1]));
        }
        for (const step of beat.steps) {
          if (run.current !== token) return;
          if ('shot' in step && step.shot) set({ shot: step.shot });
          switch (step.kind) {
            case 'caption':
              set({ caption: { who: '', text: step.text, tone: 'narration' } });
              await wait(step.ms ?? 3000);
              break;
            case 'shot':
              await wait(step.ms ?? 1500);
              break;
            case 'lapse':
              await lapse(step.to, step.seconds, token);
              break;
            case 'musa':
              set({ musa: step.stage });
              await wait(step.ms ?? 2500);
              break;
            case 'line':
              await line(step, token);
              break;
            case 'signal':
              await signal(step, token);
              break;
            case 'aside':
              await aside(step, token);
              break;
            case 'move':
              be(step.who, { at: step.to, look: null });
              await wait(step.ms ?? 0);
              break;
          }
        }
      }
      if (run.current === token) set({ status: 'done', shot: 'both' });
    } catch (err) {
      if (run.current === token) set({ status: 'error', error: (err as Error).message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Start the day over, on a brand-new copy of the family's record. */
  const restart = useCallback(async () => {
    run.current++;
    hush();
    answer.current = null;
    retry.current?.(false);
    seen.current.clear();
    busy.current.clear();
    lastNotice.current = {};
    await api.resetSandbox({ liveMorning: true, careCase: family().id }).catch(() => undefined);
    clock.current = { at: START.clock.getTime(), setAt: Date.now() };
    setView((v) => ({ ...START, playing: v.playing, status: 'ready' }));
  }, []);

  const choose = useCallback((who: PersonKey | null) => set({ playing: who, status: 'ready' }), [set]);
  const say = useCallback((text: string) => answer.current?.(text), []);
  const decide = useCallback((again: boolean) => retry.current?.(again), []);
  const skipTo = useCallback((b: number) => {
    run.current++; hush(); answer.current = null; retry.current?.(false); busy.current.clear();
    set({ people: AT_REST });
    void play(b);
  }, [play, set]);

  /** Point the camera at a shot (the visitor's own choice, between beats). */
  const look = useCallback((shot: ShotName) => set({ shot }), [set]);

  /** Set how someone is, by hand (for checking a pose by eye). */
  const pose = useCallback((who: PersonKey, patch: Partial<Presence> & { nod?: boolean; shake?: boolean }) => {
    const { nod, shake, ...rest } = patch;
    be(who, rest);
    if (nod) gesture(who, 'nod');
    if (shake) gesture(who, 'shake');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { view, play, restart, choose, say, decide, skipTo, pulseDone, storyNow, look, pose };
}

/** A doorbell's two notes, so the house hears someone at the door. */
function chime() {
  try {
    const ctx = new AudioContext();
    [659.25, 523.25].forEach((hz, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = hz;
      const t = ctx.currentTime + i * 0.45;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 1.2);
    });
    setTimeout(() => void ctx.close(), 2000);
  } catch { /* no audio: the doorbell still lights */ }
}

export const shotOf = (name: ShotName) => SHOTS[name] ?? SHOTS.overview!;
