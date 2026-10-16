import { useEffect, useRef, useState } from 'react';
import { useBoard } from '../lib/useBoard';
import { storyNow, useNow } from '../lib/storyTime';
import {
  api,
  MEMBERS,
  type BoardMember,
  type BoardState,
  type DoseSlot,
  type Gap,
  type Member,
} from '../lib/api';
import { START, keyOf, reduce, type Key, type Nav } from '../lib/dpad';
import { onPower, onRemote, onRing, onSound, reportToWorld } from '../lib/remote';
import { regionOf } from '../tv/Show';
import { Programme } from '../tv/Programme';
import { hush, speak } from '../world/voice';
import { ALEXA_VOICE } from '../world/cast';
import { RingPip } from '../tv/RingPip';

/**
 * The Fire TV surface, designed to look like TV content - not a dashboard.
 *
 * A calm ambient home screen (clock, date, the household) with care gaps arriving
 * as notification cards that slide in over it, the way a TV OS surfaces an alert.
 * On a real Fire TV the same gap also fires a native heads-up notification via the
 * WebView bridge (AndroidBridge.notify); here it is shown on-screen so the surface
 * reads as ambient TV with a notification, whether or not the native bridge exists.
 *
 * It is also **operable by the remote**. That is the third channel: the app's
 * thesis is that no single modality is load-bearing, and until now the television
 * proved only half of it. Voice serves someone who cannot see; the screen serves
 * someone who cannot hear; neither serves someone who cannot easily speak - after a
 * stroke, or with advanced Parkinson's, or simply across a room from the Echo. A
 * D-pad closes that, and the navigation logic lives in ../lib/dpad.ts so it can be
 * tested without a browser.
 *
 * **Watching.** In the world, and at /tv?watch, the set is doing what a set in their home
 * mostly does: playing something. The app then behaves the way Alexa and Ring behave on
 * Fire TV today: its question rises along the bottom over the programme, which keeps
 * playing, and a doorbell opens a live view in the corner. While they watch, the set
 * interrupts only for what is theirs to answer, their own dose. Who drives on Thursday is
 * the family's business, and stays on the family's phones.
 */

interface AndroidBridge {
  notify(title: string, body: string): void;
}
declare global {
  interface Window {
    AndroidBridge?: AndroidBridge;
  }
}

const ACCENT: Record<string, string> = {
  HIGH: '#ff6b6b',
  MEDIUM: '#ffc234',
  LOW: '#5aa9ff',
};

/** Seeded demo household, shown only when the live board can't be reached (dead
 *  network, or no backend). Mirrors src/demo/scenario.ts and always carries a HIGH
 *  gap; the online dot stays red, so it never masquerades as live. */
const DEMO_GAPS = [
  {
    spoken: "There's no record of Daddy's evening eye drops from 20:00.",
    severity: 'HIGH',
    obligationId: 'demo_heart_pm',
  },
  {
    spoken: "Pick up Daddy's eye drops refill - nobody has taken this yet.",
    severity: 'MEDIUM',
    obligationId: 'demo_rx',
  },
  {
    spoken: 'Take Daddy to his eye check-up Thursday at 10 AM',
    severity: 'LOW',
    obligationId: 'demo_ride',
  },
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
function choosersOf(members: BoardMember[] | undefined): Member[] {
  const list: Member[] = members?.length
    ? members.map((m) => ({
        id: m.id,
        label: m.role === 'care_recipient' ? (m.spokenAs ?? m.name) : m.name,
        sub: subOf(m),
      }))
    : MEMBERS;
  return [...list].sort((a, b) => Number(a.id === 'm_margaret') - Number(b.id === 'm_margaret'));
}

/** Who someone is to the household, in a few words, and where they are if not here. */
function subOf(m: BoardMember): string {
  const part =
    m.role === 'care_recipient'
      ? 'at home · this TV'
      : m.role === 'primary_caregiver'
        ? 'coordinates care'
        : m.role === 'helper'
          ? 'helps in person'
          : 'family';
  return m.livesAway ? `${part} · lives in ${m.livesAway}` : part;
}

/** The person this household cares for, as the family says it. */
function recipientOf(state: BoardState | null): { id: string; spoken: string } {
  const r = state?.members?.find((m) => m.role === 'care_recipient');
  return { id: r?.id ?? 'm_margaret', spoken: r?.spokenAs ?? r?.name ?? 'Daddy' };
}

/** Minutes past local midnight in the household's own zone. */
function localMinutes(at: Date, timeZone: string): number {
  const [h, m] = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(at)
    .split(':')
    .map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const clockOf = (hhmm: string) => {
  const t = minutesOf(hhmm);
  const h = Math.floor(t / 60),
    m = t % 60;
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
};

/**
 * Their doses the set can ask about: today's, for them, with no record yet, and due within
 * the hour or already past. One question at a time is asked; the screen lists the rest.
 */
function dueDoses(
  schedule: DoseSlot[] | undefined,
  recipientId: string,
  nowMin: number,
): DoseSlot[] {
  return (schedule ?? [])
    .filter((d) => d.forMemberId === recipientId && !d.recorded && minutesOf(d.time) <= nowMin + 60)
    .sort((a, b) => minutesOf(a.time) - minutesOf(b.time));
}

type Item = { type: 'dose'; dose: DoseSlot } | { type: 'gap'; gap: Gap };

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

/** Embedded in the world, or asked for: the set is playing something. */
const WATCHING =
  typeof window !== 'undefined' &&
  (window.parent !== window || new URLSearchParams(window.location.search).has('watch'));

export default function AmbientTV() {
  const { state, online, refresh } = useBoard();
  // Live clock: real time, or the story's time when this TV hangs in the world.
  const { now } = useNow();

  const zoneName = state?.household?.timezone ?? 'Africa/Lagos';
  const recipient = recipientOf(state);
  const choosers = choosersOf(state?.members);
  const doses = dueDoses(state?.schedule, recipient.id, localMinutes(now, zoneName));
  // The ambient card cycles every open gap (a LOW one still needs an owner); the
  // interruptive native heads-up below is gated to above-routine gaps only. When
  // the board was never reachable, fall back to the seeded demo set so the surface
  // stays alive offline. A "no record" gap for a dose the set is already asking them
  // about is the same thing said twice, so it waits behind the question.
  const allGaps: Gap[] = state?.gaps ?? (online ? [] : (DEMO_GAPS as Gap[]));
  const gaps = doses.length ? allGaps.filter((g) => g.kind !== 'UNCONFIRMED') : allGaps;
  const items: Item[] = [
    ...doses.map((dose) => ({ type: 'dose' as const, dose })),
    ...(WATCHING ? [] : gaps.map((gap) => ({ type: 'gap' as const, gap }))),
  ];

  // The doorbell's live view, open over the programme until it times out or they press BACK.
  const [ring, setRing] = useState(0);
  useEffect(() => onRing(() => setRing(Date.now())), []);
  // The world's sound switch. Off until the world says otherwise: a set nobody asked to hear stays quiet.
  const [sound, setSound] = useState(false);
  useEffect(
    () =>
      onSound((on) => {
        setSound(on);
        if (!on) hush();
      }),
    [],
  );
  const [power, setPower] = useState(true);
  useEffect(
    () =>
      onPower((on) => {
        setPower(on);
        if (!on) hush();
      }),
    [],
  );
  useEffect(() => {
    if (!ring) return;
    const id = setTimeout(() => setRing(0), 16000);
    return () => clearTimeout(id);
  }, [ring]);

  // ---- the remote -------------------------------------------------------------
  const [nav, setNav] = useState<Nav>(START);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<string | null>(null);
  const live = useRef({ nav, items, doses: doses.length, choosers, recipient, ring });
  live.current = { nav, items, doses: doses.length, choosers, recipient, ring };

  /** One button on the remote: a real one, or the world's, pressed for someone in the story. */
  const press = (key: Key) => {
    const {
      nav: before,
      items: list,
      doses: n,
      choosers: people,
      recipient: them,
      ring: open,
    } = live.current;
    // BACK closes the doorbell's view first, as it does on the set.
    if (open && key === 'back') {
      setRing(0);
      return;
    }
    const step = reduce(before, key, { gaps: list.length - n, doses: n, members: people.length });
    setNav(step.nav);
    const item = list[step.nav.gap];

    if (step.log && item?.type === 'dose') {
      // Their answer, about their own dose, recorded as theirs and as pressed on this set.
      setClaiming(null);
      api
        .act(
          them.id,
          'log_care_event',
          { kind: 'medication_taken', medicationName: item.dose.name },
          storyNow(),
          'tv',
        )
        .then((call) => {
          reportToWorld(them.spoken, call);
          setClaimed(
            call.isError
              ? call.result
              : `Thank you, ${them.spoken}. Your ${item.dose.name} is on the record.`,
          );
          refresh();
        })
        .catch((err) => setClaimed(`That didn't reach the record: ${String(err.message ?? err)}`));
      return;
    }
    if (!step.claim) return;

    const member = people[before.member];
    if (!member) return;
    if (item?.type !== 'gap' || !item.gap.obligationId) {
      // A gap with no obligation behind it is real (a medication with no record
      // is a gap, not a task) but there is nothing to claim. Say so, rather than
      // swallowing the press and looking broken.
      setClaimed('There is nothing to take on for that one.');
      return;
    }
    // Nothing about this is special-cased for the television: it is the same
    // claim_obligation the voice path calls, under the same identity rules.
    setClaiming(`${member.label} is taking it on…`);
    api
      .act(member.id, 'claim_obligation', { obligationId: item.gap.obligationId }, storyNow(), 'tv')
      .then((call) => {
        reportToWorld(member.label, call);
        setClaimed(`${member.label} has it.`);
        refresh();
      })
      .catch((err) => {
        setClaimed(`Couldn't claim that: ${String(err.message ?? err)}`);
      })
      .finally(() => setClaiming(null));
  };
  const pressRef = useRef(press);
  pressRef.current = press;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = keyOf(e.key);
      if (!key) return;
      // An unhandled arrow scrolls the page and an unhandled Backspace navigates the
      // WebView out of the app, so a key we recognise is a key we consume.
      e.preventDefault();
      pressRef.current(key);
    };
    window.addEventListener('keydown', onKey);
    // In the world, someone in the story is holding this remote.
    const off = onRemote((key) => pressRef.current(key));
    return () => {
      window.removeEventListener('keydown', onKey);
      off();
    };
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
    if (!items.length) {
      setShow(false);
      return;
    }
    // While someone is holding the remote the card must stay put; a surface that
    // slides away mid-press is unusable with a D-pad.
    if (steering) {
      setShow(true);
      return;
    }
    setShow(true);
    const dwell = setTimeout(() => setShow(false), 6500); // visible
    const advance = setTimeout(() => {
      // then next cycle
      setCycle((c) => c + 1);
    }, 8000);
    return () => {
      clearTimeout(dwell);
      clearTimeout(advance);
    };
  }, [cycle, items.length, steering]);

  // Ambient picks the next card on a timer; the remote picks it deliberately.
  const index = steering ? Math.min(nav.gap, items.length - 1) : cycle % Math.max(1, items.length);
  const focused = items.length ? items[index] : undefined;
  const current = focused?.type === 'gap' ? focused.gap : undefined;
  const dose = focused?.type === 'dose' ? focused.dose : undefined;
  // Alexa says on the set what she shows: the question when it rises, and what their press did.
  const spoken = useRef('');
  const say =
    WATCHING && sound && power
      ? (claimed ??
        (dose ? `${recipient.spoken}, it's time for your ${dose.name}. Have you taken it?` : ''))
      : '';
  useEffect(() => {
    if (!say || say === spoken.current) return;
    spoken.current = say;
    void speak(say, ALEXA_VOICE, 1.15);
  }, [say]);
  const gapIndex = index - doses.length;

  // Fire the real Fire TV heads-up once per distinct gap (no-op in a browser).
  const notified = useRef<Set<string>>(new Set());
  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? window.AndroidBridge : undefined;
    if (!bridge || !current || current.severity === 'LOW') return;
    const key = current.obligationId ?? current.spoken;
    if (notified.current.has(key)) return;
    notified.current.add(key);
    try {
      bridge.notify('We’ve Got This', current.spoken);
    } catch {
      /* no bridge */
    }
  }, [current?.obligationId, current?.spoken]);

  // The set is in their house, so it shows their time: in the world, and on a real TV whose
  // own clock may be set to another zone (the Vega Virtual Device runs on UTC).
  const zone = { timeZone: zoneName };
  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...zone });
  const day = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...zone,
  });
  const atTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: zoneName,
    });

  const owned = (state?.obligations ?? []).filter((o) => o.status === 'ASSIGNED');
  const today = (state?.schedule ?? [])
    .filter((d) => d.forMemberId === recipient.id)
    .sort((a, b) => minutesOf(a.time) - minutesOf(b.time));
  const shown = show || steering;

  /** How a recorded dose came to be known, in their words: pressed here, said aloud, or someone's word. */
  const howKnown = (d: DoseSlot) => {
    const r = d.recorded!;
    const theirs =
      !r.saidBy ||
      r.saidBy === recipient.spoken ||
      state?.members?.some((m) => m.id === recipient.id && m.name === r.saidBy);
    const how = r.via === 'tv' ? 'pressed on this TV' : r.via ? `by ${r.via}` : 'said to Alexa';
    return theirs ? `${atTime(r.at)} · ${how}` : `${atTime(r.at)} · ${r.saidBy} says so`;
  };

  if (WATCHING && !power) {
    // Standby: the set is off, so nothing rises on it. Only the little red light.
    return (
      <div className="relative h-screen bg-black">
        <span
          className="absolute bottom-[3vh] right-[3vw] h-[1vw] w-[1vw] rounded-full bg-red-600/80"
          aria-label="TV off"
        />
      </div>
    );
  }
  if (WATCHING) {
    const hour = Math.floor(localMinutes(now, zoneName) / 60);
    return (
      <div className="relative h-screen overflow-hidden bg-black text-white">
        <Programme
          region={regionOf(zoneName)}
          hour={hour}
          raised={!!(claimed || dose)}
          sound={sound}
          ducked={!!(claimed || dose || ring)}
        />
        {ring > 0 && <RingPip key={ring} dark={hour >= 18 || hour < 6} />}

        {/* Alexa, along the bottom, over the programme: their question, or what their press did. */}
        {(claimed || dose) && (
          <div
            key={claimed ? 'done' : `${dose!.medicationId}-${dose!.time}`}
            className={`tv-rise absolute inset-x-[3vw] bottom-[3vh] z-10 overflow-hidden rounded-[1.2vw] bg-[#0b1220]/88 backdrop-blur-xl transition-all duration-200
              ${steering && !claimed ? 'border-[0.25vw] border-white shadow-[0_0_0_0.6vw_rgba(255,255,255,0.12),0_2vw_5vw_rgba(0,0,0,0.6)]' : 'border border-white/15 shadow-[0_2vw_5vw_rgba(0,0,0,0.55)]'}`}
          >
            <div className="tv-alexa-bar h-[0.6vh]" />
            {claimed ? (
              <div className="flex items-center gap-[1.4vw] px-[2vw] py-[2.2vh]">
                <span className="flex h-[3.4vw] w-[3.4vw] shrink-0 items-center justify-center rounded-full bg-confirmed text-[1.8vw] font-bold text-[#03050a]">
                  ✓
                </span>
                <span className="text-[2vw] font-medium leading-snug">{claimed}</span>
              </div>
            ) : nav.mode === 'confirming' ? (
              <div className="flex items-center gap-[2.4vw] px-[2vw] py-[2.4vh]">
                <div className="min-w-0 flex-1">
                  <div className="text-[1vw] uppercase tracking-[0.25em] text-white/50">
                    We’ve Got This · for {recipient.spoken} · {clockOf(dose!.time)}
                  </div>
                  <div className="mt-[0.6vh] text-[2.6vw] font-light leading-tight">
                    Have you taken your {dose!.name}?
                  </div>
                  <div className="mt-[0.8vh] text-[1vw] text-white/50">
                    Your word, pressed on this TV. Your family sees it at once, wherever they are.
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-[1.2vw]">
                  <div className="flex flex-col items-center rounded-[1vw] border-[0.25vw] border-white bg-white/15 px-[1.8vw] py-[1.6vh]">
                    <Keys glyphs={['OK']} label="" />
                    <div className="mt-[0.8vh] text-[1.5vw] font-medium">Yes, I have</div>
                  </div>
                  <div className="flex flex-col items-center rounded-[1vw] border border-white/15 bg-white/5 px-[1.8vw] py-[1.6vh]">
                    <Keys glyphs={['BACK']} label="" />
                    <div className="mt-[0.8vh] text-[1.5vw] font-light text-white/80">Not yet</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-[1.4vw] px-[2vw] py-[1.8vh]">
                <span className="flex h-[3.4vw] w-[3.4vw] shrink-0 items-center justify-center rounded-[0.8vw] bg-[#ffd27a]/20 text-[1.8vw] text-[#ffd27a]">
                  ✚
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[1vw] uppercase tracking-[0.25em] text-white/50">
                    We’ve Got This · via Alexa
                  </div>
                  <div className="mt-[0.3vh] text-[2vw] font-medium leading-snug">
                    {recipient.spoken}, it's time for your {dose!.name}. Have you taken it?
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {steering && (
                    <div className="mb-[0.5vh] text-[0.9vw] font-semibold uppercase tracking-[0.2em]">
                      ▶ Selected
                    </div>
                  )}
                  <Keys glyphs={['OK']} label={steering ? 'answer' : 'to answer'} />
                  <div className="mt-[0.6vh] text-[1vw] text-white/50">
                    or say “Alexa, I took it”
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

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
          <span className="text-[1.5vw] font-semibold tracking-tight">We’ve Got This</span>
        </div>
        <div className="flex items-center gap-[0.7vw] text-[1.1vw] text-white/55">
          <span
            className={`h-[0.6vw] w-[0.6vw] rounded-full ${online ? 'bg-confirmed' : 'bg-sevHigh'} animate-beat`}
          />
          {state?.household?.name ?? "Daddy's care circle"}
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
              <div className="inline-block rounded-full border border-white/20 bg-white/10 px-[1.6vw] py-[1vh] text-[1.4vw] text-white/90">
                {claimed}
              </div>
            ) : (
              items.length > 0 && (
                <div className="inline-flex items-center gap-[1.4vw] rounded-2xl border border-white/20 bg-white/[0.07] px-[1.4vw] py-[1.2vh] backdrop-blur-xl">
                  {steering ? (
                    <>
                      <Keys glyphs={['◀', '▶']} label="choose" />
                      <Keys glyphs={['OK']} label={dose ? 'answer' : 'take it on'} />
                      <Keys glyphs={['BACK']} label="the clock" />
                    </>
                  ) : (
                    <Keys
                      glyphs={['OK']}
                      label={
                        doses.length
                          ? `${recipient.spoken}, press when you've taken it`
                          : 'on your remote to start'
                      }
                    />
                  )}
                </div>
              )
            )}
          </div>
        </div>

        {/* Widgets, right: their day, what needs someone, and who has what. */}
        <div className="flex min-h-0 flex-col justify-end gap-[2.2vh]">
          {today.length > 0 && (
            <div className="rounded-[1.6vw] border border-white/10 bg-white/[0.06] p-[1.6vw] backdrop-blur-2xl">
              <div className="text-[1vw] font-medium uppercase tracking-[0.22em] text-white/50">
                For {recipient.spoken} today
              </div>
              <div className="mt-[1.2vh] space-y-[0.9vh]">
                {today.slice(0, 4).map((d) => {
                  const on = dose === d && shown;
                  const due = doses.includes(d);
                  return (
                    <div
                      key={`${d.medicationId}-${d.time}`}
                      className={`flex items-center gap-[1vw] rounded-[1vw] px-[1vw] py-[0.9vh] transition-all duration-300 ${on ? 'bg-white/[0.1]' : ''} ${steering && dose === d ? 'ring-[0.25vw] ring-white' : ''}`}
                    >
                      <span className="w-[5.5vw] shrink-0 text-[1.25vw] tabular-nums text-white/60">
                        {clockOf(d.time)}
                      </span>
                      <span className="flex-1 text-[1.4vw] leading-snug text-white/90">
                        {d.name}
                      </span>
                      {/* Words and a mark, never colour alone. */}
                      <span
                        className={`shrink-0 text-right text-[1.05vw] ${d.recorded ? 'text-confirmed' : due ? 'text-[#ffc234]' : 'text-white/40'}`}
                      >
                        {d.recorded ? `✓ ${howKnown(d)}` : due ? 'Not on the record yet' : 'Later'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="rounded-[1.6vw] border border-white/10 bg-white/[0.06] p-[1.6vw] backdrop-blur-2xl">
            <div className="flex items-baseline justify-between">
              <div className="text-[1vw] font-medium uppercase tracking-[0.22em] text-white/50">
                Needs someone
              </div>
              <div className="text-[2.2vw] font-light tabular-nums">{gaps.length}</div>
            </div>
            <div className="mt-[1.2vh] space-y-[1vh]">
              {gaps.length === 0 && (
                <div className="text-[1.4vw] font-light text-white/70">
                  Everything has an owner.
                </div>
              )}
              {gaps.slice(0, 3).map((g, i) => {
                const on = i === gapIndex && shown;
                return (
                  <div
                    key={g.obligationId ?? g.spoken}
                    className={`flex items-center gap-[1vw] rounded-[1vw] px-[1vw] py-[1.1vh] transition-all duration-300 ${on ? 'bg-white/[0.1]' : ''} ${steering && i === gapIndex ? 'ring-[0.25vw] ring-white' : ''}`}
                  >
                    <span
                      className="h-[2.6vw] w-[0.3vw] shrink-0 rounded-full"
                      style={{ background: ACCENT[g.severity] }}
                    />
                    <span className="text-[1.45vw] leading-snug text-white/90">
                      {alertText(g.spoken)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {owned.length > 0 && (
            <div className="rounded-[1.6vw] border border-white/10 bg-white/[0.06] p-[1.6vw] backdrop-blur-2xl">
              <div className="text-[1vw] font-medium uppercase tracking-[0.22em] text-white/50">
                Taken care of
              </div>
              <div className="mt-[1.2vh] space-y-[1.2vh]">
                {owned.slice(0, 3).map((o) => (
                  <div key={o.id} className="flex items-center gap-[1vw]">
                    <span
                      className={`flex h-[2.6vw] w-[2.6vw] shrink-0 items-center justify-center rounded-full text-[1.2vw] font-semibold text-[#03050a] ${AVATAR[choosers.find((m) => m.label === o.owner)?.id ?? ''] ?? 'bg-confirmed'}`}
                    >
                      {(o.owner ?? '?')[0]}
                    </span>
                    <span className="text-[1.35vw] leading-snug text-white/85">
                      <b className="font-medium text-white">{o.owner ?? 'Someone'}</b> · {o.what}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* The notification: slides in from the top like a TV OS alert. */}
      <div
        className={`absolute left-1/2 top-[4vh] w-[50vw] max-w-[1100px] -translate-x-1/2 transition-all duration-700 ease-out
          ${shown && focused ? 'translate-y-0 opacity-100' : '-translate-y-24 opacity-0'}`}
      >
        {focused &&
          (() => {
            const accent = dose ? '#ffd27a' : ACCENT[current!.severity]!;
            return (
              <div
                className={`flex items-center gap-[1.3vw] rounded-[1.6vw] bg-[#0d1424]/80 p-[1.2vw] backdrop-blur-2xl transition-all duration-200
                ${
                  steering
                    ? 'border-[0.25vw] border-white shadow-[0_0_0_0.7vw_rgba(255,255,255,0.12),0_30px_80px_rgba(0,0,0,0.55)] scale-[1.03]'
                    : 'border border-white/15 shadow-[0_30px_80px_rgba(0,0,0,0.55)]'
                }`}
              >
                <div
                  className="flex h-[4vw] w-[4vw] shrink-0 items-center justify-center rounded-[1vw] text-[2vw]"
                  style={{ background: `${accent}22`, color: accent }}
                >
                  {dose ? '✚' : '♥'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-[0.7vw] text-[0.95vw] uppercase tracking-[0.2em] text-white/50">
                    We’ve Got This
                    <span
                      className="h-[0.4vw] w-[0.4vw] rounded-full"
                      style={{ background: accent }}
                    />
                    <span style={{ color: accent }}>
                      {dose ? `for ${recipient.spoken} · ${clockOf(dose.time)}` : 'needs an owner'}
                    </span>
                  </div>
                  <div className="mt-[0.4vh] text-[1.7vw] font-medium leading-snug">
                    {dose
                      ? `${recipient.spoken}, your ${dose.name}. Have you taken it?`
                      : alertText(current!.spoken)}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {/* Focus is never colour alone: the word SELECTED and the position carry it. */}
                  {steering && (
                    <div className="mb-[0.5vh] text-[0.9vw] font-semibold uppercase tracking-[0.2em] text-white">
                      ▶ Selected · {index + 1} of {items.length}
                    </div>
                  )}
                  <div className="rounded-full border border-white/20 px-[1vw] py-[0.8vh] text-[0.95vw] text-white/70">
                    {dose
                      ? 'Press OK, or tell Alexa'
                      : steering
                        ? 'OK to take it on'
                        : 'Say “Alexa, I’ll take it”'}
                  </div>
                </div>
              </div>
            );
          })()}
      </div>

      {/* The Alexa+ light along the bottom edge: present, quiet. */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-[0.5vh] opacity-60 animate-sweep-slow"
        style={{
          background: 'linear-gradient(90deg,#3b82f6,#00e0c6,#8b5cf6,#3b82f6)',
          backgroundSize: '200% 100%',
        }}
      />

      {/* Their own dose: one question, addressed to them by name, answered with one button. */}
      {nav.mode === 'confirming' && dose && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#03050a]/85 backdrop-blur-2xl">
          <div className="text-[1.2vw] uppercase tracking-[0.3em] text-white/45">
            For {recipient.spoken} · {clockOf(dose.time)}
          </div>
          <div className="mt-[3vh] max-w-[70vw] text-center text-[4vw] font-light leading-tight text-white">
            Have you taken your {dose.name}?
          </div>
          <div className="mt-[6vh] flex items-center gap-[3vw]">
            <div className="flex scale-105 flex-col items-center rounded-[1.4vw] border-[0.25vw] border-white bg-white/15 px-[3vw] py-[2.6vh]">
              <Keys glyphs={['OK']} label="" />
              <div className="mt-[1.2vh] text-[2vw] font-medium">Yes, I have</div>
            </div>
            <div className="flex flex-col items-center rounded-[1.4vw] border border-white/15 bg-white/5 px-[3vw] py-[2.6vh]">
              <Keys glyphs={['BACK']} label="" />
              <div className="mt-[1.2vh] text-[2vw] font-light text-white/80">Not yet</div>
            </div>
          </div>
          <div className="mt-[5vh] max-w-[60vw] text-center text-[1.1vw] text-white/50">
            It goes on the record as your word, pressed on this TV. Your family sees it at once,
            wherever they are.
          </div>
        </div>
      )}

      {/* Who is taking this on. A remote carries no identity, so the set asks. */}
      {nav.mode === 'identifying' && current && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#03050a]/85 backdrop-blur-2xl">
          <div className="max-w-[70vw] text-center text-[2.2vw] font-light leading-snug text-white/85">
            {alertText(current.spoken)}
          </div>
          <div className="mt-[4vh] text-[1.2vw] uppercase tracking-[0.3em] text-white/45">
            Who is taking this on?
          </div>
          <div className="mt-[4vh] flex flex-wrap items-stretch justify-center gap-[1.4vw]">
            {choosers.map((m, i) => {
              const on = i === nav.member;
              return (
                <div
                  key={m.id}
                  className={`flex w-[14vw] flex-col items-center rounded-[1.4vw] px-[1vw] py-[2.4vh] text-center transition-all duration-150
                    ${on ? 'scale-105 border-[0.25vw] border-white bg-white/15' : 'border border-white/15 bg-white/5'}`}
                >
                  <span
                    className={`flex h-[5vw] w-[5vw] items-center justify-center rounded-full text-[2.2vw] font-semibold text-[#03050a] ${AVATAR[m.id] ?? 'bg-white'} ${on ? '' : 'opacity-70'}`}
                  >
                    {m.label[0]}
                  </span>
                  <div className="mt-[1.4vh] text-[1.6vw] font-medium text-white">{m.label}</div>
                  <div className="mt-[0.4vh] text-[0.9vw] text-white/50">{m.sub}</div>
                  <div
                    className={`mt-[1vh] text-[0.85vw] font-semibold uppercase tracking-[0.2em] ${on ? 'text-white' : 'text-transparent'}`}
                  >
                    ▶ Selected
                  </div>
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
  m_margaret: 'bg-[#ffd27a]',
  m_david: 'bg-[#7cf0c8]',
  m_renee: 'bg-[#f5a3d0]',
  m_aide: 'bg-[#9cc3ff]',
  m_kunle: 'bg-[#c5a8ff]',
};
