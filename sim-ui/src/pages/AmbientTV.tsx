import { useEffect, useRef, useState } from 'react';
import { useBoard } from '../lib/useBoard';
import { api, MEMBERS } from '../lib/api';
import { START, keyOf, reduce, type Nav } from '../lib/dpad';

/**
 * The Fire TV surface, designed to look like TV content - not a dashboard.
 *
 * A calm ambient home screen (clock, date, the household) with care gaps arriving
 * as notification cards that slide in over it, the way a TV OS surfaces an alert.
 * On a real Fire TV the same gap also fires a native heads-up notification via the
 * WebView bridge (AndroidBridge.notify); here it is shown on-screen so the surface
 * reads as ambient TV with a notification, whether or not the native bridge exists.
 *
 * It is also **operable by the remote**. That is the third channel: CareCircle's
 * thesis is that no single modality is load-bearing, and until now the television
 * proved only half of it. Voice serves someone who cannot see; the screen serves
 * someone who cannot hear; neither serves someone who cannot easily speak - after a
 * stroke, or with advanced Parkinson's, or simply across a room from the Echo. A
 * D-pad closes that, and the navigation logic lives in ../lib/dpad.ts so it can be
 * tested without a browser.
 */

interface AndroidBridge { notify(title: string, body: string): void; }
declare global { interface Window { AndroidBridge?: AndroidBridge } }

const ACCENT: Record<string, string> = {
  HIGH: '#ff6b6b', MEDIUM: '#ffc234', LOW: '#5aa9ff',
};

/** Seeded demo household, shown only when the live board can't be reached (dead
 *  network, or no backend). Mirrors src/demo/scenario.ts and always carries a HIGH
 *  gap; the online dot stays red, so it never masquerades as live. */
const DEMO_GAPS = [
  { spoken: "There's no record of Daddy's evening eye drops from 20:00.", severity: 'HIGH', obligationId: 'demo_heart_pm' },
  { spoken: "Pick up Daddy's eye drops refill - nobody has taken this yet.", severity: 'MEDIUM', obligationId: 'demo_rx' },
  { spoken: 'Take Daddy to his eye check-up Thursday at 10 AM', severity: 'LOW', obligationId: 'demo_ride' },
];

/**
 * The order the household is offered in on the television.
 *
 * Daddy is on this list because he is a participant in his own care, not a
 * subject of it - he can take something on. But he is never the *default*: the
 * chooser opens on whoever is highlighted, and a viewer who presses OK twice
 * quickly would otherwise assign work in the care recipient's name without ever
 * having chosen him. A default that quietly decides who is responsible is the same
 * mistake as reading a missing record as a missed dose, and this is the one product
 * that cannot afford to make it.
 */
const CHOOSERS = [...MEMBERS].sort((a, b) =>
  Number(a.id === 'm_margaret') - Number(b.id === 'm_margaret'));

/** A gap turned into a spoken alert line. */
function alertText(spoken: string): string {
  return spoken.replace(/\s-\s.*$/, '').trim() || spoken;
}

/**
 * One or more remote keys, drawn as caps with their meaning beside them.
 *
 * Text and shape, never colour alone: a viewer who cannot distinguish the accent
 * still reads the glyph and the word.
 */
function Keys({ glyphs, label }: { glyphs: string[]; label: string }) {
  return (
    <span className="flex items-center gap-2">
      {glyphs.map((g) => (
        <kbd
          key={g}
          className="rounded-lg border-2 border-white/60 bg-white/15 px-[0.7vw] py-[0.5vh] text-[1.15vw] font-semibold leading-none text-white"
        >
          {g}
        </kbd>
      ))}
      <span className="text-[1.15vw] text-white/80">{label}</span>
    </span>
  );
}

export default function AmbientTV() {
  const { state, online } = useBoard();
  // The ambient card cycles every open gap (a LOW one still needs an owner); the
  // interruptive native heads-up below is gated to above-routine gaps only. When
  // the board was never reachable, fall back to the seeded demo set so the surface
  // stays alive offline.
  const gaps = state?.gaps ?? (online ? [] : DEMO_GAPS);

  // Live clock.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // ---- the remote -------------------------------------------------------------
  const [nav, setNav] = useState<Nav>(START);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<string | null>(null);
  const navRef = useRef(nav);
  navRef.current = nav;
  const gapsRef = useRef(gaps);
  gapsRef.current = gaps;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = keyOf(e.key);
      if (!key) return;
      // An unhandled arrow scrolls the page and an unhandled Backspace navigates the
      // WebView out of the app, so a key we recognise is a key we consume.
      e.preventDefault();

      const step = reduce(navRef.current, key, {
        gaps: gapsRef.current.length,
        members: CHOOSERS.length,
      });
      setNav(step.nav);
      if (!step.claim) return;

      const gap = gapsRef.current[step.nav.gap];
      const member = CHOOSERS[navRef.current.member];
      if (!member) return;
      if (!gap?.obligationId) {
        // A gap with no obligation behind it is real (a medication with no record
        // is a gap, not a task) but there is nothing to claim. Say so, rather than
        // swallowing the press and looking broken.
        setClaimed('There is nothing to take on for that one.');
        return;
      }
      // Nothing about this is special-cased for the television: it is the same
      // claim_obligation the voice path calls, under the same identity rules.
      setClaiming(`${member.label} is taking it on…`);
      api.act(member.id, 'claim_obligation', { obligationId: gap.obligationId })
        .then(() => { setClaimed(`${member.label} has it.`); })
        .catch((err) => { setClaimed(`Couldn't claim that: ${String(err.message ?? err)}`); })
        .finally(() => setClaiming(null));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Put the remote down and the set goes back to being a set.
  useEffect(() => {
    if (nav.mode === 'ambient') return;
    const id = setTimeout(() => setNav((n) => ({ ...n, mode: 'ambient' })), 25000);
    return () => clearTimeout(id);
  }, [nav]);

  // Clear the outcome line after it has been read at ten feet.
  useEffect(() => {
    if (!claimed) return;
    const id = setTimeout(() => setClaimed(null), 6000);
    return () => clearTimeout(id);
  }, [claimed]);

  const steering = nav.mode !== 'ambient';

  // Cycle the notification through the current gaps. `cycle` is monotonic (not an
  // index) so the loop keeps re-showing even with a single gap - idx % 1 stays 0
  // and would otherwise freeze the effect after the first hide.
  const [cycle, setCycle] = useState(0);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!gaps.length) { setShow(false); return; }
    // While someone is holding the remote the card must stay put; a surface that
    // slides away mid-press is unusable with a D-pad.
    if (steering) { setShow(true); return; }
    setShow(true);
    const dwell = setTimeout(() => setShow(false), 6500);      // visible
    const advance = setTimeout(() => {                          // then next cycle
      setCycle((c) => c + 1);
    }, 8000);
    return () => { clearTimeout(dwell); clearTimeout(advance); };
  }, [cycle, gaps.length, steering]);

  // Ambient picks the next card on a timer; the remote picks it deliberately.
  const index = steering ? Math.min(nav.gap, gaps.length - 1) : cycle % gaps.length;
  const current = gaps.length ? gaps[index] : undefined;

  // Fire the real Fire TV heads-up once per distinct gap (no-op in a browser).
  const notified = useRef<Set<string>>(new Set());
  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? window.AndroidBridge : undefined;
    if (!bridge || !current || current.severity === 'LOW') return;
    const key = current.obligationId ?? current.spoken;
    if (notified.current.has(key)) return;
    notified.current.add(key);
    try { bridge.notify('CareCircle', current.spoken); } catch { /* no bridge */ }
  }, [current?.obligationId, current?.spoken]);

  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const day = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const owned = (state?.obligations ?? []).filter((o) => o.status === 'ASSIGNED');

  return (
    <div className="relative h-screen overflow-hidden bg-[#03050a] text-white">
      {/* Ambient light, the Echo Show way: slow colour, nothing to read in it. */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-[15vw] -top-[20vh] h-[80vh] w-[80vh] rounded-full bg-[#1b4dff]/25 blur-[12vw] animate-drift-slow" />
        <div className="absolute -bottom-[30vh] right-[-10vw] h-[85vh] w-[85vh] rounded-full bg-[#00e0c6]/[0.12] blur-[12vw] animate-drift-slower" />
        <div className="absolute right-[20vw] top-[10vh] h-[50vh] w-[50vh] rounded-full bg-[#8b5cf6]/[0.12] blur-[10vw] animate-drift-slow" />
        <div className="absolute inset-0 bg-[radial-gradient(130%_100%_at_30%_20%,transparent_0%,#03050a_80%)]" />
      </div>

      {/* Top bar */}
      <div className="absolute inset-x-[4vw] top-[4vh] flex items-center justify-between">
        <div className="flex items-center gap-[0.9vw]">
          <span className="h-[2vw] w-[2vw] rounded-full bg-[conic-gradient(from_200deg,#00e0c6,#3b82f6,#8b5cf6,#00e0c6)] p-[0.22vw]">
            <span className="block h-full w-full rounded-full bg-[#03050a]" />
          </span>
          <span className="text-[1.5vw] font-semibold tracking-tight">CareCircle</span>
        </div>
        <div className="flex items-center gap-[0.7vw] text-[1.1vw] text-white/55">
          <span className={`h-[0.6vw] w-[0.6vw] rounded-full ${online ? 'bg-confirmed' : 'bg-sevHigh'} animate-beat`} />
          Daddy's care circle
        </div>
      </div>

      <div className="relative grid h-full grid-cols-[1.15fr_1fr] gap-[4vw] px-[4vw] pb-[9vh] pt-[14vh]">
        {/* Clock, bottom-left, the way an Echo Show sits at rest. */}
        <div className="flex flex-col justify-end">
          <div className="text-[11vw] font-extralight leading-[0.9] tracking-[-0.03em] tabular-nums drop-shadow-[0_6px_40px_rgba(0,0,0,0.6)]">
            {time}
          </div>
          <div className="mt-[1.5vh] text-[2.3vw] font-light text-white/65">{day}</div>

          {/*
            The remote, drawn. One line of faint prose used to be here, and the first
            person in front of it couldn't find a remote: real contrast, key caps, and
            it stays while you steer so BACK is discoverable too.
          */}
          <div className="mt-[4vh] min-h-[5vh]">
            {claimed ? (
              <div className="inline-block rounded-full border border-white/20 bg-white/10 px-[1.6vw] py-[1vh] text-[1.4vw] text-white/90">{claimed}</div>
            ) : gaps.length > 0 && (
              <div className="inline-flex items-center gap-[1.4vw] rounded-2xl border border-white/20 bg-white/[0.07] px-[1.4vw] py-[1.2vh] backdrop-blur-xl">
                {steering ? (
                  <>
                    <Keys glyphs={['◀', '▶']} label="choose" />
                    <Keys glyphs={['OK']} label="take it on" />
                    <Keys glyphs={['BACK']} label="the clock" />
                  </>
                ) : (
                  <Keys glyphs={['◀', '▲', '▼', '▶']} label="on your remote to start" />
                )}
              </div>
            )}
          </div>
        </div>

        {/* Widgets, right: what needs someone, and who has what. */}
        <div className="flex min-h-0 flex-col justify-end gap-[2.2vh]">
          <div className="rounded-[1.6vw] border border-white/10 bg-white/[0.06] p-[1.6vw] backdrop-blur-2xl">
            <div className="flex items-baseline justify-between">
              <div className="text-[1vw] font-medium uppercase tracking-[0.22em] text-white/50">Needs someone</div>
              <div className="text-[2.2vw] font-light tabular-nums">{gaps.length}</div>
            </div>
            <div className="mt-[1.2vh] space-y-[1vh]">
              {gaps.length === 0 && <div className="text-[1.4vw] font-light text-white/70">Everything has an owner.</div>}
              {gaps.slice(0, 3).map((g, i) => {
                const on = i === index && (steering || show);
                return (
                  <div key={g.obligationId ?? g.spoken}
                    className={`flex items-center gap-[1vw] rounded-[1vw] px-[1vw] py-[1.1vh] transition-all duration-300 ${on ? 'bg-white/[0.1]' : ''} ${steering && i === index ? 'ring-[0.25vw] ring-white' : ''}`}>
                    <span className="h-[2.6vw] w-[0.3vw] shrink-0 rounded-full" style={{ background: ACCENT[g.severity] }} />
                    <span className="text-[1.45vw] leading-snug text-white/90">{alertText(g.spoken)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {owned.length > 0 && (
            <div className="rounded-[1.6vw] border border-white/10 bg-white/[0.06] p-[1.6vw] backdrop-blur-2xl">
              <div className="text-[1vw] font-medium uppercase tracking-[0.22em] text-white/50">Taken care of</div>
              <div className="mt-[1.2vh] space-y-[1.2vh]">
                {owned.slice(0, 3).map((o) => (
                  <div key={o.id} className="flex items-center gap-[1vw]">
                    <span className={`flex h-[2.6vw] w-[2.6vw] shrink-0 items-center justify-center rounded-full text-[1.2vw] font-semibold text-[#03050a] ${AVATAR[MEMBERS.find((m) => m.label === o.owner)?.id ?? ''] ?? 'bg-confirmed'}`}>
                      {(o.owner ?? '?')[0]}
                    </span>
                    <span className="text-[1.35vw] leading-snug text-white/85"><b className="font-medium text-white">{o.owner ?? 'Someone'}</b> · {o.what}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* The notification: slides in from the top like a TV OS alert. */}
      <div className={`absolute left-1/2 top-[4vh] w-[50vw] max-w-[1100px] -translate-x-1/2 transition-all duration-700 ease-out
          ${show && current && !steering ? 'translate-y-0 opacity-100' : steering && current ? 'translate-y-0 opacity-100' : '-translate-y-24 opacity-0'}`}>
        {current && (
          <div className={`flex items-center gap-[1.3vw] rounded-[1.6vw] bg-[#0d1424]/80 p-[1.2vw] backdrop-blur-2xl transition-all duration-200
              ${steering
                ? 'border-[0.25vw] border-white shadow-[0_0_0_0.7vw_rgba(255,255,255,0.12),0_30px_80px_rgba(0,0,0,0.55)] scale-[1.03]'
                : 'border border-white/15 shadow-[0_30px_80px_rgba(0,0,0,0.55)]'}`}>
            <div className="flex h-[4vw] w-[4vw] shrink-0 items-center justify-center rounded-[1vw] text-[2vw]"
              style={{ background: `${ACCENT[current.severity]}22`, color: ACCENT[current.severity] }}>
              ♥
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-[0.7vw] text-[0.95vw] uppercase tracking-[0.2em] text-white/50">
                CareCircle
                <span className="h-[0.4vw] w-[0.4vw] rounded-full" style={{ background: ACCENT[current.severity] }} />
                <span style={{ color: ACCENT[current.severity] }}>needs an owner</span>
              </div>
              <div className="mt-[0.4vh] text-[1.7vw] font-medium leading-snug">{alertText(current.spoken)}</div>
            </div>
            <div className="shrink-0 text-right">
              {/* Focus is never colour alone: the word SELECTED and the position carry it. */}
              {steering && (
                <div className="mb-[0.5vh] text-[0.9vw] font-semibold uppercase tracking-[0.2em] text-white">
                  ▶ Selected · {index + 1} of {gaps.length}
                </div>
              )}
              <div className="rounded-full border border-white/20 px-[1vw] py-[0.8vh] text-[0.95vw] text-white/70">
                {steering ? 'OK to take it on' : 'Say “Alexa, I’ll take it”'}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* The Alexa+ light along the bottom edge: present, quiet. */}
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-[0.5vh] opacity-60 animate-sweep-slow"
        style={{ background: 'linear-gradient(90deg,#3b82f6,#00e0c6,#8b5cf6,#3b82f6)', backgroundSize: '200% 100%' }} />

      {/* Who is taking this on. A remote carries no identity, so the set asks. */}
      {nav.mode === 'identifying' && current && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#03050a]/85 backdrop-blur-2xl">
          <div className="max-w-[70vw] text-center text-[2.2vw] font-light leading-snug text-white/85">
            {alertText(current.spoken)}
          </div>
          <div className="mt-[4vh] text-[1.2vw] uppercase tracking-[0.3em] text-white/45">Who is taking this on?</div>
          <div className="mt-[4vh] flex flex-wrap items-stretch justify-center gap-[1.4vw]">
            {CHOOSERS.map((m, i) => {
              const on = i === nav.member;
              return (
                <div key={m.id}
                  className={`flex w-[14vw] flex-col items-center rounded-[1.4vw] px-[1vw] py-[2.4vh] text-center transition-all duration-150
                    ${on ? 'scale-105 border-[0.25vw] border-white bg-white/15' : 'border border-white/15 bg-white/5'}`}>
                  <span className={`flex h-[5vw] w-[5vw] items-center justify-center rounded-full text-[2.2vw] font-semibold text-[#03050a] ${AVATAR[m.id] ?? 'bg-white'} ${on ? '' : 'opacity-70'}`}>
                    {m.label[0]}
                  </span>
                  <div className="mt-[1.4vh] text-[1.6vw] font-medium text-white">{m.label}</div>
                  <div className="mt-[0.4vh] text-[0.9vw] text-white/50">{m.sub}</div>
                  <div className={`mt-[1vh] text-[0.85vw] font-semibold uppercase tracking-[0.2em] ${on ? 'text-white' : 'text-transparent'}`}>▶ Selected</div>
                </div>
              );
            })}
          </div>
          <div className="mt-[5vh] text-[1.05vw] text-white/45">
            {claiming ?? 'Left and right to choose · OK to confirm · Back to cancel'}
          </div>
        </div>
      )}
    </div>
  );
}

/** Same colours as the console, so a person is the same colour on every screen. */
const AVATAR: Record<string, string> = {
  m_margaret: 'bg-[#ffd27a]', m_david: 'bg-[#7cf0c8]', m_renee: 'bg-[#f5a3d0]', m_aide: 'bg-[#9cc3ff]', m_kunle: 'bg-[#c5a8ff]',
};
