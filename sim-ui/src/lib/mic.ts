/**
 * Recording an utterance as raw PCM.
 *
 * Amazon Transcribe wants 16-bit little-endian PCM at 16 kHz mono, and a browser
 * can produce exactly that if you ask the AudioContext for the right rate up
 * front. Doing it this way means no container and no transcoding anywhere on the
 * path: what the microphone hears is what Transcribe receives.
 *
 * This uses ScriptProcessorNode, which is deprecated but universally available.
 * An AudioWorklet would be the modern choice; it needs a separate module file
 * served at the right path, which buys nothing here when the node is only ever
 * copying samples into an array.
 */

import { FRESH, hear, type Ear, type Ending } from './endpoint.ts';

export const SAMPLE_RATE = 16_000;

/**
 * Fired on window as the microphone opens and closes, so the page's own sound (music, the
 * TV) steps back while someone speaks: the mic would hear it, and never hear them stop.
 */
export const LISTENING_EVENT = 'carecircle-listening';
const listeningNow = (on: boolean) => window.dispatchEvent(new CustomEvent(LISTENING_EVENT, { detail: on }));

export interface Recording {
  /** Resolves with the captured audio as 16-bit little-endian PCM. */
  stop(): Promise<Blob>;
  /** Give up without producing anything - used when the turn is abandoned. */
  cancel(): void;
}

export interface Listening {
  /** Peak amplitude of each frame, for the level meter. */
  onLevel?: (level: number) => void;
  /**
   * The speaker stopped. Called at most once, and never after `stop`/`cancel`.
   * The caller should do exactly what a tap on Stop does - the point is that the
   * tap is no longer required.
   */
  onEnd?: (reason: Ending) => void;
}

/**
 * To the rate Transcribe wants, with the browser's own resampler (a proper low-pass, the
 * same one it plays audio through). The averaging below is only for a browser without
 * OfflineAudioContext; it smears consonants, and consonants are what names are made of.
 */
async function toRate(samples: Float32Array, from: number, to: number): Promise<Float32Array> {
  if (from === to || samples.length === 0 || typeof OfflineAudioContext === 'undefined') return resample(samples, from, to);
  try {
    const length = Math.ceil(samples.length * to / from);
    const offline = new OfflineAudioContext(1, length, to);
    const buffer = offline.createBuffer(1, samples.length, from);
    buffer.copyToChannel(new Float32Array(samples), 0);
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start();
    return (await offline.startRendering()).getChannelData(0);
  } catch {
    return resample(samples, from, to);
  }
}

/** Fallback resampling: average each output sample's span so nothing aliases. */
function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j]!;
    out[i] = end > start ? sum / (end - start) : samples[Math.min(start, samples.length - 1)] ?? 0;
  }
  return out;
}

/** Float samples in [-1, 1] to signed 16-bit, clipped rather than wrapped. */
function toPcm16(samples: Float32Array): Int16Array<ArrayBuffer> {
  // Backed by an explicit ArrayBuffer so the result is a valid BlobPart: a bare
  // `new Int16Array(n)` is typed over ArrayBufferLike, which admits
  // SharedArrayBuffer and is not accepted by the Blob constructor.
  const out = new Int16Array(new ArrayBuffer(samples.length * 2));
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    // Asymmetric on purpose: 16-bit signed reaches -32768 but only +32767.
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return out;
}

/**
 * Start recording. Rejects if the microphone is unavailable, which the caller
 * should treat as "fall back to the browser's own recogniser" rather than as a
 * dead end.
 */
export async function record(listening: Listening | ((level: number) => void) = {}): Promise<Recording> {
  const { onLevel, onEnd } = typeof listening === 'function' ? { onLevel: listening, onEnd: undefined } : listening;

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

  // The device's own rate, converted to 16 kHz at the end: some browsers (Firefox, older
  // Safari) refuse to feed a microphone into a context at any other rate than the device's.
  const context = new AudioContext();
  const rate = context.sampleRate;
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  listeningNow(true);
  let open = true;
  const captured: Float32Array[] = [];

  // Endpointing runs off the audio callbacks rather than a timer, so it cannot
  // fire while the stream is stalled and has nothing to judge.
  const began = performance.now();
  let ear: Ear = FRESH;
  let closed = false;

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    captured.push(new Float32Array(input));

    // Peak, not RMS: a meter should jump when someone starts talking, and the
    // endpointer decides on the same number the meter draws.
    let peak = 0;
    for (const sample of input) peak = Math.max(peak, Math.abs(sample));
    onLevel?.(peak);

    if (closed || !onEnd) return;
    const step = hear(ear, performance.now() - began, peak);
    ear = step.ear;
    if (step.end) { closed = true; onEnd(step.end); }
  };

  source.connect(processor);
  // ScriptProcessor only runs while connected to a destination. Routing it to
  // the speakers would echo the room back at itself, so it terminates in a muted
  // gain node instead.
  const mute = context.createGain();
  mute.gain.value = 0;
  processor.connect(mute);
  mute.connect(context.destination);

  const teardown = () => {
    if (open) { open = false; listeningNow(false); }
    closed = true;
    processor.disconnect();
    source.disconnect();
    mute.disconnect();
    for (const track of stream.getTracks()) track.stop();
    void context.close();
  };

  return {
    async stop() {
      teardown();
      const total = captured.reduce((n, chunk) => n + chunk.length, 0);
      const merged = new Float32Array(total);
      let offset = 0;
      for (const chunk of captured) { merged.set(chunk, offset); offset += chunk.length; }
      // Pass the view, not `.buffer`: a typed array is a valid BlobPart and
      // avoids the SharedArrayBuffer branch of ArrayBufferLike.
      return new Blob([toPcm16(await toRate(merged, rate, SAMPLE_RATE))], { type: 'application/octet-stream' });
    },
    cancel: teardown,
  };
}
