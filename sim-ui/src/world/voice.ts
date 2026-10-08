import { api } from '../lib/api';
import { duck } from './music';

// Speech in the world, in Amazon Polly. Each person has their own Polly voice. If Polly
// fails, the browser's own voice speaks for a minute and then Polly is tried again; one
// bad request never leaves the whole visit on a robot voice. A line is never silently
// skipped: if neither works, the caption carries it.

let pollyDownUntil = 0;
let current: HTMLAudioElement | null = null;
/** Lines asked for ahead of time, so a person speaks the moment they mean to. */
const ready = new Map<string, Promise<Blob | null>>();

const keyOf = (text: string, voice: string) => `${voice}|${text}`;

function fetchPolly(text: string, voice: string): Promise<Blob | null> {
  const key = keyOf(text, voice);
  let p = ready.get(key);
  if (!p) {
    p = api.speak(text, 'normal', voice).catch(() => null);
    ready.set(key, p);
    if (ready.size > 24) ready.delete(ready.keys().next().value!);
  }
  return p;
}

/** Start synthesising a line now (while the person reads, or thinks) so it is ready when said. */
export function prepare(text: string, voice: string, muted = false): void {
  if (muted || !text.trim() || Date.now() < pollyDownUntil) return;
  void fetchPolly(text, voice);
}

/** Speak a line and resolve when it has been said. */
export async function speak(text: string, voice: string, fallbackPitch = 1, muted = false): Promise<void> {
  if (muted || !text.trim()) return wait(Math.min(6000, 900 + text.length * 45));
  if (Date.now() >= pollyDownUntil) {
    const audio = await fetchPolly(text, voice);
    ready.delete(keyOf(text, voice));
    if (audio) return play(audio);
    pollyDownUntil = Date.now() + 60_000;
  }
  return browserVoice(text, fallbackPitch);
}

export function hush(): void {
  current?.pause();
  current = null;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

function play(blob: Blob): Promise<void> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const el = new Audio(url);
    current = el;
    duck(true);
    const done = () => { duck(false); URL.revokeObjectURL(url); if (current === el) current = null; resolve(); };
    el.onended = done;
    el.onerror = done;
    el.play().catch(done);
  });
}

function browserVoice(text: string, pitch: number): Promise<void> {
  if (!('speechSynthesis' in window)) return wait(1200 + text.length * 50);
  duck(true);
  return new Promise<void>((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.pitch = pitch;
    u.rate = 1;
    // Some browsers never fire onend; never let a voice hold the story hostage.
    const guard = setTimeout(resolve, 2500 + text.length * 90);
    u.onend = () => { clearTimeout(guard); resolve(); };
    u.onerror = () => { clearTimeout(guard); resolve(); };
    window.speechSynthesis.speak(u);
  }).finally(() => duck(false));
}

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
