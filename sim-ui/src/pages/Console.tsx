import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, MEMBERS, type Member, type SpeechRate } from '../lib/api';
import { record, type Recording } from '../lib/mic';
import { useBoard } from '../lib/useBoard';
import { ProvChip, provFromGap } from '../components/ProvChip';
import { TraceCard, type TraceEntry } from '../components/TraceCard';
import type { Provenance } from '../lib/api';

type Msg = { who: 'me' | 'alexa' | 'err'; text: string; tag?: string; heard?: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SpeechRec: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

/** What the Web Speech API's error codes actually mean to someone demoing this. */
const VOICE_ERRORS: Record<string, string> = {
  'not-allowed': 'The browser blocked the microphone. Allow mic access for this site, then tap Speak again.',
  'service-not-allowed': 'The browser blocked its speech service. Allow mic access, or type instead.',
  'no-speech': "I didn't hear anything. Tap Speak and talk a little closer to the mic.",
  network: 'Speech recognition needs the network and could not reach it. Typing still works.',
  'audio-capture': 'No microphone was found. Plug one in, or type instead.',
  aborted: 'Voice input stopped.',
};

export default function Console() {
  const [member, setMember] = useState<Member>(MEMBERS[1]); // Tolu
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [speakOn, setSpeakOn] = useState(true);
  const [handsfree, setHandsfree] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Why the mic is not listening, when it isn't. Null when nothing is wrong. */
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  /** Amazon Transcribe, which knows the household's names, vs the browser's own
   *  recogniser, which does not. Falls back automatically when anything fails. */
  const [accurate, setAccurate] = useState(true);
  const [level, setLevel] = useState(0);
  /** What the browser's recogniser thinks it is hearing, right now. Shown under
   *  the orb so the words appear as they are spoken instead of only at the end. */
  const [interim, setInterim] = useState('');
  const recordingRef = useRef<Recording | null>(null);
  /** Speech pace. Slower is an access control for older listeners, not a demo toggle. */
  const [rate, setRate] = useState<SpeechRate>('normal');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** The last few turns, newest first, each with how it was worked out. */
  const [traces, setTraces] = useState<TraceEntry[]>([]);
  const { state, online } = useBoard(3000);
  // Whether this browser has its own copy of the demo (see src/sim/sandbox.ts).
  const [demo, setDemo] = useState<'shared' | 'private' | undefined>();
  useEffect(() => { api.config().then((c) => setDemo(c.demo)).catch(() => undefined); }, []);
  const recRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [messages]);

  /** What to do once a line has finished being spoken, whichever voice said it. */
  const afterSpeaking = useCallback(() => {
    setSpeaking(false);
    if (handsfree && recRef.current && !listening) {
      try { recRef.current.start(); } catch { /* */ }
    }
  }, [handsfree, listening]);

  /** The browser's own voice: the fallback, and whatever the OS happens to provide. */
  const speakLocally = useCallback((text: string) => {
    if (!window.speechSynthesis) { afterSpeaking(); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate === 'slow' ? 0.75 : rate === 'gentle' ? 0.9 : 1.02;
    const voices = window.speechSynthesis.getVoices();
    const pref = voices.find((v) => /samantha|google us english|zira|aria/i.test(v.name))
      ?? voices.find((v) => v.lang?.startsWith('en'));
    if (pref) u.voice = pref;
    u.onstart = () => setSpeaking(true);
    u.onend = afterSpeaking;
    u.onerror = afterSpeaking;
    window.speechSynthesis.speak(u);
  }, [afterSpeaking, rate]);

  /**
   * Say a line.
   *
   * Polly first, because the browser's voice is whatever the listener's operating
   * system decided and varies from warm to robotic. If Polly is unreachable the
   * local voice still speaks - losing the nicer voice is a downgrade, not a
   * silence, which matters when speech is somebody's only channel.
   */
  const speak = useCallback((text: string) => {
    if (!speakOn) return;
    window.speechSynthesis?.cancel();
    audioRef.current?.pause();
    setSpeaking(true);
    void api.speak(text, rate).then((blob) => {
      if (!blob) { speakLocally(text); return; }
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { URL.revokeObjectURL(url); afterSpeaking(); };
      audio.onerror = () => { URL.revokeObjectURL(url); speakLocally(text); };
      void audio.play().catch(() => { URL.revokeObjectURL(url); speakLocally(text); });
    });
  }, [speakOn, rate, speakLocally, afterSpeaking]);

  const say = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setInput('');
    setMessages((m) => [...m, { who: 'me', text }]);
    setBusy(true);
    try {
      const turn = await api.say(member.id, text);
      // The server repairs names the recogniser mangles. Show the repair on the
      // message it changed rather than quietly replacing what somebody said.
      if (turn.corrections?.length) {
        const shown = turn.corrections.map((c) => `${c.from} → ${c.to}`).join(', ');
        setMessages((m) => m.map((msg, i) => (i === m.length - 1 ? { ...msg, heard: shown } : msg)));
      }
      setMessages((m) => [...m, { who: 'alexa', text: turn.spoken, tag: 'Alexa' }]);
      setTraces((t) => [{ said: turn.heard ?? text, trace: turn.trace }, ...t].slice(0, 5));
      speak(turn.spoken);
    } catch (e) {
      setMessages((m) => [...m, { who: 'err', text: (e as Error).message }]);
    } finally { setBusy(false); }
  }, [member, speak]);

  // Held in a ref so the recogniser and the recorder can reach the current `say`
  // without being rebuilt every time it changes.
  const sayRef = useRef(say);
  useEffect(() => { sayRef.current = say; }, [say]);

  /**
   * Held in a ref so the recorder's endpoint callback can reach the current
   * `finishAccurately` without `listenAccurately` depending on it - the same
   * closure cycle that once silently killed the browser recogniser.
   */
  const finishRef = useRef<() => Promise<void>>(async () => {});

  /**
   * Listen using Amazon Transcribe.
   *
   * Records raw PCM, sends it once the speaker stops, and hands the text to the
   * same `say` the typed path uses. Any failure here drops back to the browser's
   * recogniser rather than losing the turn.
   */
  const listenAccurately = useCallback(async () => {
    setVoiceNote(null);
    try {
      // The recorder calls the end of the turn itself. Tapping Stop still works;
      // it is just no longer the only way to be heard, which matters when speech
      // is somebody's only channel and a second deliberate tap is not available.
      recordingRef.current = await record({
        onLevel: setLevel,
        onEnd: (reason) => {
          if (reason === 'nothing') {
            recordingRef.current?.cancel();
            recordingRef.current = null;
            setListening(false);
            setLevel(0);
            setVoiceNote("I didn't hear anything. Tap Speak and talk a little closer to the mic.");
            return;
          }
          void finishRef.current();
        },
      });
      setListening(true);
    } catch {
      setVoiceNote('The browser blocked the microphone. Allow mic access for this site, then tap Speak again.');
    }
  }, []);

  const finishAccurately = useCallback(async () => {
    const recording = recordingRef.current;
    recordingRef.current = null;
    setListening(false);
    setLevel(0);
    if (!recording) return;
    setBusy(true);
    try {
      const { text } = await api.transcribe(await recording.stop());
      if (text.trim()) await sayRef.current(text);
      else setVoiceNote("I didn't catch that. Tap Speak and try again.");
    } catch (e) {
      setVoiceNote(`Transcription failed: ${(e as Error).message} Falling back to the browser's recogniser.`);
      setAccurate(false);
    } finally { setBusy(false); }
  }, []);
  useEffect(() => { finishRef.current = finishAccurately; }, [finishAccurately]);

  const act = useCallback(async (tool: string, args: Record<string, unknown>) => {
    try {
      const res = await api.act(member.id, tool, args);
      setMessages((m) => [...m, { who: 'alexa', text: res.result, tag: 'Alexa · tapped' }]);
      // A tap has no model in it: one step, the tool the card is bound to.
      const tap: TraceEntry = {
        said: `Tapped: ${tool}`, tapped: true,
        trace: { channel: 'voice', model: 'none', outcome: 'answered', steps: [{ plannerMs: 0, calls: [res] }], plannerMs: 0, toolMs: res.ms, totalMs: res.ms },
      };
      setTraces((t) => [tap, ...t].slice(0, 5));
      speak(res.result);
    } catch (e) {
      setMessages((m) => [...m, { who: 'err', text: (e as Error).message }]);
    }
  }, [member, speak]);

  /**
   * Speech recognition.
   *
   * The recogniser is built exactly once and reaches the latest `say` through a
   * ref. It used to depend on `say` directly, which was a silent killer: `speak`
   * closes over `listening`, `say` closes over `speak`, so the first `onstart`
   * set `listening` -> rebuilt `speak` -> rebuilt `say` -> re-ran this effect,
   * whose cleanup aborted the recognition that had just started. The mic
   * appeared dead with nothing in the console to explain why.
   */
  const handsfreeRef = useRef(handsfree);
  useEffect(() => { handsfreeRef.current = handsfree; }, [handsfree]);

  useEffect(() => {
    if (!SpeechRec) return;
    const rec = new SpeechRec();
    rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = false;
    rec.onstart = () => { setListening(true); setVoiceNote(null); setInterim(''); };
    rec.onend = () => { setListening(false); setInterim(''); };
    rec.onresult = (e: any) => {
      let t = ''; for (const r of e.results) t += r[0].transcript;
      setInput(t);
      setInterim(t);
      if (e.results[e.results.length - 1].isFinal && t.trim()) { setInterim(''); sayRef.current(t); }
    };
    // Every one of these used to fail silently. A demo where the mic quietly
    // does nothing is worse than one that says why it cannot hear you.
    rec.onerror = (e: any) => {
      setListening(false);
      setInterim('');
      handsfreeRef.current = false;
      setHandsfree(false);
      setVoiceNote(VOICE_ERRORS[e?.error] ?? `Voice stopped: ${e?.error ?? 'unknown error'}. Typing still works.`);
    };
    recRef.current = rec;
    return () => { try { rec.abort(); } catch { /* */ } };
  }, []);

  // One entry point for the microphone, so tapping the orb and tapping the
  // button cannot drift apart.
  const micDisabled = !accurate && !SpeechRec;
  const toggleMic = useCallback(() => {
    if (accurate) {
      void (listening ? finishAccurately() : listenAccurately());
      return;
    }
    const r = recRef.current; if (!r) return;
    setVoiceNote(null);
    if (listening) { r.stop(); return; }
    // start() throws if the recogniser is already running - surface it rather
    // than swallowing it, which is how this went unnoticed.
    try { r.start(); } catch { setVoiceNote('The microphone is already starting. Give it a second and try again.'); }
  }, [accurate, listening, listenAccurately, finishAccurately]);

  const gaps = state?.gaps ?? [];
  const obById = Object.fromEntries((state?.obligations ?? []).map((o) => [o.id, o]));
  const proposals = (state?.obligations ?? []).filter((o) => o.status === 'PROPOSED');
  const owned = (state?.obligations ?? []).filter((o) => o.status === 'ASSIGNED');
  const offers = state?.offers ?? [];

  const mode: GlowMode = listening ? 'listening' : busy ? 'thinking' : speaking ? 'speaking' : 'idle';
  const lastAlexa = [...messages].reverse().find((m) => m.who !== 'me');
  const lastMe = [...messages].reverse().find((m) => m.who === 'me');
  const earlier = messages.slice(0, Math.max(0, messages.length - (busy ? 1 : 2)));
  const openCount = proposals.length + offers.length + gaps.length;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#04060b]">
      {/* Ambient light, like an Echo Show at rest: colour that drifts, never a pattern. */}
      <div aria-hidden className="pointer-events-none absolute -left-40 -top-40 h-[42rem] w-[42rem] rounded-full bg-[#1b4dff]/20 blur-[140px] animate-drift-slow" />
      <div aria-hidden className="pointer-events-none absolute -bottom-52 right-[-10rem] h-[40rem] w-[40rem] rounded-full bg-[#00e0c6]/10 blur-[140px] animate-drift-slower" />

      <div className="relative mx-auto grid max-w-[1500px] grid-cols-1 gap-7 p-5 md:p-8 lg:grid-cols-[1.25fr_1fr]">
        {/* LEFT: the device */}
        <section className="flex min-w-0 flex-col gap-5">
          <header className="flex items-center justify-between">
            <Link to="/" className="flex items-center gap-3">
              <span className="relative h-7 w-7 rounded-full bg-[conic-gradient(from_200deg,#00e0c6,#3b82f6,#8b5cf6,#00e0c6)] p-[3px]">
                <span className="block h-full w-full rounded-full bg-[#04060b]" />
              </span>
              <span className="text-[1.05rem] font-semibold tracking-tight text-ink">CareCircle</span>
              <span className="hidden rounded-full border border-white/10 px-2 py-0.5 text-[0.6875rem] text-muted sm:inline">for Alexa+</span>
            </Link>
            <div className="flex items-center gap-2">
              {demo === 'private' && (
                <button type="button" title="This is your own copy of the demo family. Nothing you do here reaches anyone else."
                  onClick={() => { void api.resetSandbox().then(() => { setMessages([]); setTraces([]); }); }}
                  className="whitespace-nowrap rounded-full border border-white/10 px-3 py-1.5 text-[0.75rem] text-muted transition hover:border-white/25 hover:text-ink">
                  Start over
                </button>
              )}
              <span className={`flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-[0.75rem] ${online ? 'text-muted' : 'text-sevHigh'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-confirmed' : 'bg-sevHigh'} animate-beat`} />
                {online ? 'Live' : 'Offline'}
              </span>
            </div>
          </header>

          {demo === 'private' && (
            <p className="-mt-2 text-[0.75rem] text-muted">Your own copy of the demo family. Nothing you do here reaches anyone else.</p>
          )}

          {/* Who is talking: Alexa+ recognises the voice; here you pick it. */}
          <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:gap-3 sm:px-0" role="group" aria-label="Who is speaking">
            {MEMBERS.map((m) => {
              const on = member.id === m.id;
              return (
                <button key={m.id} onClick={() => setMember(m)} aria-pressed={on} aria-label={`${m.label}, ${m.sub}`}
                  className={`group flex shrink-0 items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-4 transition ${on ? 'bg-white/[0.09] ring-1 ring-white/20' : 'hover:bg-white/[0.05]'}`}>
                  <span aria-hidden className={`flex h-9 w-9 items-center justify-center rounded-full text-[0.875rem] font-semibold text-[#04060b] ${AVATAR[m.id] ?? 'bg-white'} ${on ? '' : 'opacity-60 group-hover:opacity-90'}`}>
                    {m.label[0]}
                  </span>
                  <span className="text-left leading-tight">
                    <span className={`block text-[0.875rem] font-medium ${on ? 'text-ink' : 'text-ink/70'}`}>{m.label}</span>
                    <span className="hidden text-[0.6875rem] text-muted sm:block">{m.sub}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* The screen. One exchange at a time, large, the way Alexa+ shows it. */}
          <div className="relative flex min-h-[460px] flex-col overflow-hidden rounded-[28px] border border-white/[0.07] bg-gradient-to-b from-[#0c1120] to-[#070a13] shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
            <div className="flex items-center justify-between px-7 pt-5 text-[0.75rem] text-muted">
              <span>{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
              <span className="flex items-center gap-2">
                <span className={`h-5 w-5 rounded-full text-center text-[0.6875rem] font-semibold leading-5 text-[#04060b] ${AVATAR[member.id] ?? 'bg-white'}`}>{member.label[0]}</span>
                Hi, {member.label}
              </span>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-7 pb-8 pt-4" style={{ maxHeight: 520 }}>
              {earlier.length > 0 && (
                <div className="mb-6 space-y-2 border-b border-white/[0.06] pb-5">
                  {earlier.map((m, i) => (
                    <div key={i} className={`text-[0.875rem] leading-snug ${m.who === 'me' ? 'text-muted' : m.who === 'err' ? 'text-sevHigh/80' : 'text-ink/55'}`}>
                      {m.who === 'me' ? <>“{m.text}”</> : m.text}
                    </div>
                  ))}
                </div>
              )}

              {messages.length === 0 && !busy && (
                <div className="flex h-full min-h-[300px] flex-col justify-center">
                  <div className="text-[1.6rem] font-light leading-tight sm:text-[2.1rem] tracking-tight text-ink">What can I help with for Daddy?</div>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {SUGGESTIONS.map((t) => (
                      <button key={t} onClick={() => say(t)}
                        className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[0.875rem] text-ink/80 transition hover:border-white/25 hover:bg-white/[0.08]">
                        “{t}”
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {lastMe && (busy || lastAlexa !== undefined) && (
                <div key={`me-${messages.length}`} className="animate-rise text-[1.0625rem] text-muted">
                  “{lastMe.text}”
                  {lastMe.heard && <span className="ml-2 text-[0.75rem] text-muted/70">heard as {lastMe.heard}</span>}
                </div>
              )}
              {busy ? (
                <div className="mt-4 flex gap-1.5" aria-label="Thinking">
                  {[0, 1, 2].map((i) => <span key={i} className="h-2.5 w-2.5 rounded-full bg-[#5aa9ff] animate-beat" style={{ animationDelay: `${i * 0.2}s` }} />)}
                </div>
              ) : lastAlexa && messages[messages.length - 1] === lastAlexa && (
                <div key={`a-${messages.length}`} className={`mt-3 animate-rise text-[1.375rem] font-light sm:text-[1.75rem] leading-[1.3] tracking-tight ${lastAlexa.who === 'err' ? 'text-sevHigh' : 'text-ink'}`}>
                  {lastAlexa.text}
                </div>
              )}
              {listening && (
                <div className="mt-5 text-[1.375rem] font-light text-[#8fc2ff]">
                  {interim || (accurate ? 'Listening…' : 'Listening…')}
                </div>
              )}
              {voiceNote && (
                <div className="mt-5 rounded-xl border border-norecord/30 bg-norecord/10 px-4 py-2.5 text-[0.8125rem] text-norecord">{voiceNote}</div>
              )}
            </div>

            <AlexaGlow mode={mode} level={level} />
          </div>

          {/* Talk or type */}
          <form onSubmit={(e) => { e.preventDefault(); say(input); }} className="relative flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] p-1.5 pl-2 backdrop-blur-md focus-within:border-white/25">
            <button type="button" onClick={toggleMic} disabled={micDisabled}
              aria-label={listening ? 'Stop listening' : 'Start listening'} aria-pressed={listening}
              className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition disabled:opacity-40 ${listening ? 'bg-[#3b82f6] text-white' : 'bg-white/[0.07] text-ink hover:bg-white/[0.12]'}`}>
              {listening && <span className="absolute inset-0 rounded-full bg-[#3b82f6]/40 animate-ripple" aria-hidden />}
              <MicIcon />
            </button>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={`Speak as ${member.label}…`}
              className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-[0.9375rem] text-ink outline-none placeholder:text-muted" />
            <button type="button" onClick={() => setSettingsOpen((o) => !o)} aria-label="Voice settings" aria-expanded={settingsOpen}
              className="flex h-11 w-11 items-center justify-center rounded-full text-muted transition hover:bg-white/[0.07] hover:text-ink">
              <GearIcon />
            </button>
            <button disabled={busy} aria-label="Send"
              className="flex h-11 items-center gap-1.5 rounded-full bg-gradient-to-r from-[#00e0c6] to-[#3b82f6] px-5 text-[0.875rem] font-semibold text-[#04060b] transition hover:brightness-110 disabled:opacity-50">
              Send
            </button>

            {settingsOpen && (
              <div className="absolute bottom-[calc(100%+10px)] right-0 z-10 w-72 space-y-1 rounded-2xl border border-white/10 bg-[#0d1220]/95 p-2 shadow-card backdrop-blur-xl">
                <Toggle label="Speak replies" checked={speakOn} onChange={setSpeakOn} />
                <Toggle label="Amazon Transcribe" hint="Knows this family's names" checked={accurate} onChange={setAccurate} />
                <Toggle label="Hands-free" hint="Listens again after each reply" checked={handsfree} onChange={setHandsfree} />
                <div className="flex items-center justify-between rounded-xl px-3 py-2.5"
                  title="Slower speech is easier to follow for older listeners and anyone with hearing loss.">
                  <span className="text-[0.8125rem] text-ink">Pace</span>
                  <div className="flex rounded-full bg-white/[0.06] p-0.5">
                    {(['slow', 'gentle', 'normal'] as SpeechRate[]).map((r) => (
                      <button type="button" key={r} onClick={() => setRate(r)}
                        className={`rounded-full px-2.5 py-1 text-[0.75rem] capitalize ${rate === r ? 'bg-white/15 text-ink' : 'text-muted'}`}>{r}</button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </form>
          {micDisabled && <p className="-mt-2 text-center text-[0.75rem] text-muted">Voice needs Chrome. Typing works everywhere.</p>}
        </section>

        {/* RIGHT: the family's board */}
        <section className="flex min-w-0 flex-col gap-4">
          <div className="flex items-end justify-between pt-1">
            <div>
              <h2 className="text-[1.375rem] font-semibold tracking-tight">Daddy's care</h2>
              <p className="text-[0.8125rem] text-muted">
                {openCount ? `${openCount} need${openCount === 1 ? 's' : ''} someone` : 'Everything has an owner'}{owned.length ? ` · ${owned.length} taken care of` : ''}
              </p>
            </div>
            <Link to="/tv" className="rounded-full border border-white/10 px-3 py-1.5 text-[0.75rem] text-muted transition hover:border-white/25 hover:text-ink">TV view</Link>
          </div>

          <div className="space-y-3 overflow-y-auto pr-1" style={{ maxHeight: 'calc(100vh - 140px)' }}>
            {proposals.map((p) => (
              <BoardCard key={p.id} tone="inferred" pill="Needs a yes">
                <div className="text-[1.0625rem] font-semibold leading-snug">{p.what}</div>
                <div className="mt-1 text-[0.8125rem] text-muted">Inferred. Not real work until a person confirms it.</div>
                <div className="mt-3.5 flex flex-wrap items-center gap-2">
                  <button onClick={() => act('confirm_proposal', { obligationId: p.id, confirmed: true })} className="btn-primary">Yes, needed</button>
                  <button onClick={() => act('confirm_proposal', { obligationId: p.id, confirmed: false })} className="btn-ghost">Not needed</button>
                  <span className="ml-auto"><ProvChip kind="INFERRED" /></span>
                </div>
              </BoardCard>
            ))}

            {offers.map((o) => (
              <BoardCard key={o.offerId} tone="alexa" pill="Ready to buy">
                <div className="text-[1.0625rem] font-semibold leading-snug">{o.item}</div>
                <div className="mt-1 text-[0.8125rem] text-muted">{o.merchant} · {o.etaText} · <b className="text-ink">${(o.amountCents / 100).toFixed(2)}</b> · sandbox, no real payment</div>
                <div className="mt-3.5 flex flex-wrap items-center gap-2">
                  <button onClick={() => act('confirm_purchase', { offerId: o.offerId, confirmed: true })} className="btn-primary">Confirm · ${(o.amountCents / 100).toFixed(2)}</button>
                  <button onClick={() => act('confirm_purchase', { offerId: o.offerId, confirmed: false })} className="btn-ghost">Not now</button>
                </div>
              </BoardCard>
            ))}

            {gaps.map((g, i) => {
              const key: Provenance = provFromGap(g.kind, g.obligationId ? obById[g.obligationId]?.provenance : undefined);
              const tone = g.severity === 'HIGH' ? 'high' : g.severity === 'MEDIUM' ? 'med' : 'low';
              return (
                <BoardCard key={i} tone={tone} pill={g.kind === 'UNCLAIMED' ? 'Nobody has this' : g.kind.toLowerCase().replace(/_/g, ' ')}>
                  <div className="text-[1.0625rem] font-semibold leading-snug">{g.spoken}</div>
                  <details className="group mt-1">
                    <summary className="cursor-pointer list-none text-[0.75rem] text-muted hover:text-ink">Why this matters <span className="inline-block transition group-open:rotate-90">›</span></summary>
                    <div className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink/70">{g.because}</div>
                  </details>
                  <div className="mt-3.5 flex flex-wrap items-center gap-2">
                    {g.obligationId && <button onClick={() => act('claim_obligation', { obligationId: g.obligationId })} className="btn-primary">I'll take it</button>}
                    <span className="ml-auto"><ProvChip kind={key} /></span>
                  </div>
                </BoardCard>
              );
            })}

            {owned.map((o) => (
              <BoardCard key={o.id} tone="done" pill="Taken care of">
                <div className="flex items-center gap-3">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[0.8125rem] font-semibold text-[#04060b] ${AVATAR[MEMBERS.find((m) => m.label === o.owner)?.id ?? ''] ?? 'bg-confirmed'}`}>
                    {(o.owner ?? '?')[0]}
                  </span>
                  <div>
                    <div className="text-[1rem] font-semibold leading-snug">{o.what}</div>
                    <div className="text-[0.8125rem] text-muted"><b className="font-medium text-confirmed">{o.owner ?? 'Someone'}</b> has this</div>
                  </div>
                </div>
              </BoardCard>
            ))}

            {!proposals.length && !offers.length && !gaps.length && !owned.length && (
              <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] p-10 text-center text-muted">Nothing outstanding. Everything recorded has an owner.</div>
            )}

            {traces.length > 0 && (
              <details open className="group rounded-3xl border border-white/[0.07] bg-white/[0.02] p-4">
                <summary className="flex cursor-pointer list-none items-center justify-between text-[0.75rem] font-medium uppercase tracking-wider text-muted">
                  How it worked it out (real MCP calls)
                  <span className="transition group-open:rotate-90">›</span>
                </summary>
                <div className="mt-3 space-y-2.5">
                  {traces.map((entry, i) => <TraceCard key={i} entry={entry} />)}
                </div>
              </details>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

type GlowMode = 'idle' | 'listening' | 'thinking' | 'speaking';

/** Try-this prompts for a first visit: the three beats of the story. */
const SUGGESTIONS = ['Did Daddy use his evening eye drops?', 'What needs doing this week?', 'Ask Funmi if she can take Daddy to his check-up.'];

/** One colour per person, so the board and the screen say who at a glance. */
const AVATAR: Record<string, string> = {
  m_margaret: 'bg-[#ffd27a]', m_david: 'bg-[#7cf0c8]', m_renee: 'bg-[#f5a3d0]', m_aide: 'bg-[#9cc3ff]', m_kunle: 'bg-[#c5a8ff]',
};

/**
 * The Alexa+ light along the bottom of the screen. It means one thing at a time:
 * listening (blue, moving with the voice), thinking (a sweep), speaking (teal), or
 * nothing (a faint line).
 */
function AlexaGlow({ mode, level }: { mode: GlowMode; level: number }) {
  const h = mode === 'listening' ? 6 + Math.min(1, level) * 10 : mode === 'idle' ? 2 : 6;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24">
      <div className={`absolute inset-x-0 bottom-0 transition-all duration-300 ${mode === 'idle' ? 'opacity-30' : 'opacity-100'}`}
        style={{ height: h, background: mode === 'speaking' ? 'linear-gradient(90deg,#00e0c6,#5eead4,#3b82f6,#00e0c6)' : 'linear-gradient(90deg,#3b82f6,#00e0c6,#8b5cf6,#3b82f6)', backgroundSize: '200% 100%' }}>
        <div className={`h-full w-full ${mode === 'thinking' ? 'animate-sweep' : mode !== 'idle' ? 'animate-sweep-slow' : ''}`}
          style={{ background: 'inherit', backgroundSize: 'inherit' }} />
      </div>
      {mode !== 'idle' && (
        <div className="absolute inset-x-[10%] bottom-0 h-16 rounded-[100%] blur-2xl transition-opacity"
          style={{ background: mode === 'speaking' ? 'rgba(0,224,198,0.35)' : 'rgba(59,130,246,0.4)', opacity: mode === 'listening' ? 0.5 + Math.min(1, level) * 0.5 : 0.7 }} />
      )}
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5 hover:bg-white/[0.04]">
      <span>
        <span className="block text-[0.8125rem] text-ink">{label}</span>
        {hint && <span className="block text-[0.6875rem] text-muted">{hint}</span>}
      </span>
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="relative h-5 w-9 shrink-0 rounded-full bg-white/15 transition peer-checked:bg-[#00e0c6] after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4" />
    </label>
  );
}

const MicIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);
const GearIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" />
  </svg>
);

const TONE: Record<string, { bar: string; pill: string }> = {
  high: { bar: 'bg-sevHigh', pill: 'text-sevHigh bg-sevHigh/10' },
  med: { bar: 'bg-sevMed', pill: 'text-sevMed bg-sevMed/10' },
  low: { bar: 'bg-[#5aa9ff]', pill: 'text-[#8fc2ff] bg-[#5aa9ff]/10' },
  inferred: { bar: 'bg-inferred', pill: 'text-inferred bg-inferred/10' },
  alexa: { bar: 'bg-alexa', pill: 'text-alexa bg-alexa/10' },
  done: { bar: 'bg-confirmed', pill: 'text-confirmed bg-confirmed/10' },
};

function BoardCard({ children, tone, pill }: { children: React.ReactNode; tone: string; pill: string }) {
  const t = TONE[tone] ?? TONE.low;
  return (
    <div className="relative animate-rise overflow-hidden rounded-3xl border border-white/[0.07] bg-gradient-to-b from-white/[0.05] to-white/[0.02] p-5 pl-6 shadow-card">
      <span className={`absolute inset-y-5 left-0 w-1 rounded-r-full ${t.bar}`} aria-hidden />
      <div className={`mb-2 inline-block rounded-full px-2.5 py-0.5 text-[0.6875rem] font-medium uppercase tracking-wider ${t.pill}`}>{pill}</div>
      {children}
    </div>
  );
}
