// The world's background music: an original, slow score made in the browser with WebAudio,
// so there is nothing to license. Warm pads under a soft chime arpeggio, in the calm, hopeful
// register of Alexa's own sounds. It follows the Sound switch and dips whenever someone speaks.

const CHORDS = [
  [57, 64, 69, 72], // A minor
  [53, 60, 65, 69], // F
  [48, 55, 64, 67], // C
  [55, 62, 67, 71], // G
];
const BAR_S = 4.8;
const LEVEL = 0.07;
const DUCKED = 0.02;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let bar = 0;
let next = 0;
let speaking = 0;

// Quiet while the microphone is open (see LISTENING_EVENT in lib/mic.ts).
if (typeof window !== 'undefined') {
  window.addEventListener('carecircle-listening', (e) => duck(!!(e as CustomEvent<boolean>).detail));
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

function tone(at: number, midi: number, dur: number, peak: number, type: OscillatorType) {
  if (!ctx || !master) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = hz(midi);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + Math.min(1.2, dur / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(master);
  o.start(at);
  o.stop(at + dur + 0.1);
}

function schedule() {
  if (!ctx) return;
  while (next < ctx.currentTime + 2 * BAR_S) {
    const chord = CHORDS[bar % CHORDS.length]!;
    tone(next, chord[0]! - 12, BAR_S + 1, 0.35, 'sine');
    for (const n of chord.slice(1)) tone(next, n, BAR_S + 1, 0.12, 'triangle');
    // A chime arpeggio every other bar, so the music breathes.
    if (bar % 2 === 0) chord.forEach((n, i) => tone(next + 0.6 + i * 0.6, n + 12, 2.4, 0.08, 'sine'));
    next += BAR_S;
    bar++;
  }
}

function level() {
  if (!ctx || !master) return;
  master.gain.setTargetAtTime(speaking > 0 ? DUCKED : LEVEL, ctx.currentTime, 0.4);
}

function open(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
  }
  void ctx.resume();
  return ctx;
}

/** A bright two-note chime for each step of the start-up, climbing as it goes. */
export function chime(step: number): void {
  const ctx = open();
  const g = ctx.createGain();
  g.gain.value = 0.25;
  g.connect(ctx.destination);
  const at = ctx.currentTime + 0.02;
  const base = 76 + Math.min(step, 4) * 2;
  for (const [i, n] of [base, base + 7].entries()) {
    const o = ctx.createOscillator();
    const e = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = hz(n);
    e.gain.setValueAtTime(0, at + i * 0.12);
    e.gain.linearRampToValueAtTime(0.5, at + i * 0.12 + 0.02);
    e.gain.exponentialRampToValueAtTime(0.0001, at + i * 0.12 + 1.2);
    o.connect(e).connect(g);
    o.start(at + i * 0.12);
    o.stop(at + i * 0.12 + 1.3);
  }
}

/** Start or stop the score. Must first be called from a click, as browsers require. */
export function music(on: boolean): void {
  if (!on) {
    if (timer) clearInterval(timer);
    timer = null;
    if (ctx && master) master.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    return;
  }
  const c = open();
  if (timer) return;
  next = c.currentTime + 0.1;
  schedule();
  timer = setInterval(schedule, 1000);
  level();
}

/** Someone started (true) or stopped (false) speaking: the music steps back for them. */
export function duck(on: boolean): void {
  speaking = Math.max(0, speaking + (on ? 1 : -1));
  if (timer) level();
}
