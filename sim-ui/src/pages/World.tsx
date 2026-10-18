import { music } from '../world/music';
import { CardFigure, Intro, introSeen, useHover } from '../world/Landing';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { advance, Canvas, useThree } from '@react-three/fiber';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { LISTENING_EVENT, pcmToWav, record, type Recording } from '../lib/mic';
import { SPEECH_LANGUAGES, setSpeechLanguage, speechLanguage } from '../lib/speech-language';
import { tellStoryTime } from '../lib/storyTime';
import { CAST, PLAYABLE, type PersonKey } from '../world/cast';
import { SAY_NO, STAY_QUIET, useDirector, type WorldView } from '../world/director';
import type { BoardState, WeekPromise } from '../lib/api';
import { MODEL, preloadWorld } from '../world/models';
import { Scene } from '../world/Scene';
import { clockText, homeToday, STORY, type ShotName } from '../world/story';
import { SHOTS } from '../world/layout';
import { impactOf } from '../world/impact';
import {
  BASE_NAMES,
  COUNTRIES,
  FAMILIES,
  family,
  familyNames,
  namesProblem,
  setFamily,
  type Country,
  type FamilyNames,
} from '../world/families';
import type { Stuck } from '../world/director';
import type { CareCaseId } from '../lib/api';
import type { Key } from '../lib/dpad';
import { useHostRoom } from '../world/room';
import { soundTv } from '../lib/remote';
import '../world/world.css';

/** How many calls the record panel shows before the oldest give way. */
const TRACE_ROWS = 10;

preloadWorld([
  ...Object.values(CAST).map((p) => MODEL.character(p.model)),
  ...Object.values(FAMILIES)
    .flatMap((f) => [f.recipient.model, f.tolu?.model, f.helper?.model, f.away?.model])
    .filter((m): m is string => !!m)
    .map((m) => MODEL.character(m)),
  MODEL.character('aid-sunglasses'),
  MODEL.character('wheelchair'),
  MODEL.car('sedan'),
  MODEL.car('delivery'),
]);

/**
 * One family's day, played on the real server. You choose who you are; everyone else is
 * played for you. Every line goes to the Alexa+ planner on your own copy of the record,
 * and the TV on Daddy's wall is the real Fire TV page reading that same copy.
 */
export default function World() {
  const [muted, setMuted] = useState(false);
  // The start-up shows on a first visit, and again with ?intro.
  const [intro, setIntro] = useState(
    () => !introSeen() || new URLSearchParams(window.location.search).has('intro'),
  );
  const tv = () => (document.getElementById('world-tv') as HTMLIFrameElement | null)?.contentWindow;
  const director = useDirector({
    muted,
    tvFrame: tv,
    onStoryTime: (at) => tellStoryTime(tv(), at),
  });
  const { view } = director;
  // The set in the house is heard only while the camera is on it, and only when the world's
  // sound is on; told again whenever it reloads. Elsewhere in the day it plays on, silent.
  const [micOpen, setMicOpen] = useState(false);
  useEffect(() => {
    const on = (e: Event) => setMicOpen(!!(e as CustomEvent<boolean>).detail);
    window.addEventListener(LISTENING_EVENT, on);
    return () => window.removeEventListener(LISTENING_EVENT, on);
  }, []);
  const tvHeard = !muted && !micOpen && view.shot === 'daddyTv';
  useEffect(() => {
    soundTv(tv(), tvHeard);
    const id = setInterval(() => soundTv(tv(), tvHeard), 2000);
    return () => clearInterval(id);
  }, [tvHeard]);
  // The score starts once the day does (after a click, as browsers require) and follows Sound.
  const started = view.status !== 'cast';
  useEffect(() => {
    music(started && !muted);
    return () => music(false);
  }, [started, muted]);
  const beat = STORY[view.beat]!;
  const [room, setRoom] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);
  const { held, error: relayError } = useHostRoom(room, view, director);
  const invite = async () => {
    setInviting(true);
    if (room) return;
    try {
      setRoom((await api.room.open()).code);
      setRoomError(null);
    } catch (e) {
      setRoomError((e as Error).message);
    }
  };

  // ?shot=daddy opens on a given camera, for checking a scene by eye.
  useEffect(() => {
    const shot = new URLSearchParams(window.location.search).get('shot');
    if (shot && shot in SHOTS) {
      director.look(shot as ShotName);
      director.choose(null);
    }
    // A hidden tab gets no animation frames; let a checking script step the scene by hand.
    if (shot)
      Object.assign(window, {
        __advance: (t: number) => advance(t),
        __look: director.look,
        __pose: director.pose,
        __shots: SHOTS,
        // Switch family, then __look() any shot to redraw with them in it.
        __family: (id: CareCaseId) => setFamily(id),
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="world">
      <Canvas
        shadows
        camera={{ position: [0.5, 7.5, 12.5], fov: 42, near: 0.05, far: 200 }}
        dpr={[1, 2]}
      >
        <Suspense fallback={null}>
          <Scene view={view} onPulseDone={director.pulseDone} />
        </Suspense>
        <ExposeForChecking />
      </Canvas>

      <header className="world-top">
        <Link to="/" className="world-brand">
          We’ve Got This
        </Link>
        <div className="world-clock">
          <span className="world-time">{clockText(view.clock)}</span>
          <span className="world-place">
            {family().places ? `${family().places!.home} · ${family().places!.tolu}` : 'Lagos'}
          </span>
        </div>
        {view.status !== 'cast' && (
          <div className="world-beat">
            <div className="world-beat-title">{beat.title}</div>
            <div className="world-beat-point">{view.point ?? beat.point}</div>
          </div>
        )}
        <div className="world-tools">
          {view.playing && (
            <span className="world-you" style={{ color: CAST[view.playing]!.color }}>
              You are {CAST[view.playing]!.name}
            </span>
          )}
          {view.status !== 'cast' && (
            <button
              className="world-btn ghost"
              onClick={() => (inviting ? setInviting(false) : void invite())}
            >
              {room ? `Family · ${held.length}` : 'Invite family'}
            </button>
          )}
          <button className="world-btn ghost" onClick={() => setMuted((m) => !m)}>
            {muted ? 'Sound off' : 'Sound on'}
          </button>
        </div>
      </header>

      {view.trace.length > 0 && (
        <aside className="world-trace" aria-label="What the server did">
          <div className="world-trace-head">On the record</div>
          {/* The newest calls are the ones the day is talking about, so the oldest give way. */}
          {view.trace.length > TRACE_ROWS && (
            <div className="world-trace-more">{view.trace.length - TRACE_ROWS} earlier</div>
          )}
          {view.trace.slice(-TRACE_ROWS).map((t) => (
            <div key={t.id} className={`world-trace-row${t.call.isError ? ' err' : ''}`}>
              <span className="who">{t.who}</span>
              <code>{t.call.name}</code>
              <span className="at">{clockText(new Date(t.at))}</span>
            </div>
          ))}
        </aside>
      )}

      {view.caption && view.status !== 'cast' && view.status !== 'done' && (
        <div className={`world-caption ${view.caption.tone}`}>
          {view.caption.who && (
            <span
              className="who"
              style={view.caption.color ? { color: view.caption.color } : undefined}
            >
              {view.caption.who}
            </span>
          )}
          {view.caption.to && <span className="to">to {view.caption.to}</span>}
          <span className="text">{view.caption.text}</span>
        </div>
      )}

      {view.status === 'cast' &&
        (intro ? (
          <Intro muted={muted} onDone={() => setIntro(false)} />
        ) : (
          <CastPicker onChoose={director.choose} onFamily={director.reclock} />
        ))}
      {view.evidence && view.status !== 'cast' && (
        <aside className="world-evidence" aria-label="What the doorbell reported">
          <div className="head">
            <span className="dot" />
            Ring · Front door · {clockText(view.evidence.at)}
          </div>
          <div className="row">
            <span className="k">Saw</span>
            <span className="v">{view.evidence.saw}</span>
          </div>
          <div className="row">
            <span className="k">Can't know</span>
            <span className="v">{view.evidence.cannot}</span>
          </div>
          <div className="foot">On the record as evidence, never as proof.</div>
        </aside>
      )}

      {inviting && view.status !== 'cast' && (
        <aside className="world-invite" aria-label="Invite family">
          <div className="head">
            Play this day together
            <button className="world-btn ghost" onClick={() => setInviting(false)}>
              Close
            </button>
          </div>
          {room ? (
            <>
              <p>
                On another phone, open <b>{window.location.host}/join</b> and type
              </p>
              <div className="code">{room}</div>
              <p className="link">
                <a href={`/join?code=${room}`} target="_blank" rel="noreferrer">
                  {window.location.origin}/join?code={room}
                </a>
              </p>
              <ul>
                {PLAYABLE.map((k) => (
                  <li key={k}>
                    <span style={{ color: CAST[k]!.color }}>{CAST[k]!.name}</span>{' '}
                    {view.playing === k
                      ? 'you'
                      : held.includes(k)
                        ? 'on their phone'
                        : 'played for you'}
                  </li>
                ))}
              </ul>
              <p className="note">
                Their words come here and go to Alexa from this screen, on this one copy. Nothing
                they type is kept.
              </p>
              {relayError && <p className="note">Lost touch with the room: {relayError}</p>}
            </>
          ) : roomError ? (
            <p>Couldn't open a room: {roomError}</p>
          ) : (
            <p>Opening a room…</p>
          )}
        </aside>
      )}

      {view.status === 'yourTurn' && view.prompt?.guest && (
        <div className="world-panel world-waiting">
          <h3>Waiting for {CAST[view.prompt.who]!.name}</h3>
          <p>It's {CAST[view.prompt.who]!.name}'s turn, on their phone.</p>
        </div>
      )}
      {view.status === 'yourTurn' &&
        view.prompt &&
        !view.prompt.guest &&
        (view.prompt.remote ? (
          <RemoteTurn
            who={view.prompt.who}
            hint={view.prompt.suggestion}
            onPress={director.press}
            onLeave={director.leave}
          />
        ) : (
          <YourTurn
            key={`${view.prompt.who}${view.prompt.reply ? '-r' : ''}${view.trace.length}`}
            who={view.prompt.who}
            suggestion={view.prompt.suggestion}
            no={view.prompt.no}
            reply={!!view.prompt.reply}
            onSay={director.say}
          />
        ))}
      {view.status === 'stuck' && view.stuck && (
        <StuckPanel stuck={view.stuck} onDecide={director.decide} />
      )}
      {view.status === 'error' && (
        <div className="world-panel">
          <h3>The server didn't answer</h3>
          <p>{view.error}</p>
          <div className="row">
            <button className="world-btn" onClick={() => void director.restart()}>
              Start the day again
            </button>
          </div>
        </div>
      )}
      {view.status === 'done' && (
        <div className="world-panel">
          <h3>{view.choices.length ? 'Your day, as it went' : 'One day, one record'}</h3>
          {/* The written ending is the day as scripted; a day that went another way is told by its record. */}
          {!view.choices.length && <p>{family().ending}</p>}
          <DayScore view={view} />
          <Impact log={view.log} playing={view.playing ? CAST[view.playing]!.name : null} />
          <div className="row">
            <button className="world-btn" onClick={() => void director.restart('cast')}>
              Play as someone else
            </button>
            <button className="world-btn ghost" onClick={() => void director.restart()}>
              Watch again
            </button>
          </div>
        </div>
      )}

      {view.status !== 'cast' && (
        <footer className="world-bottom">
          {view.status === 'ready' && (
            <button className="world-btn big" onClick={() => void director.play(0)}>
              Start the day
            </button>
          )}
          <nav className="world-beats" aria-label="Moments">
            {STORY.map((b, i) => (
              <button
                key={b.id}
                className={`world-chip${i === view.beat ? ' on' : ''}${i < view.beat ? ' past' : ''}`}
                onClick={() => director.skipTo(i)}
                title={b.point}
              >
                {clockText(homeToday(b.at[0], b.at[1]))} · {b.title}
              </button>
            ))}
          </nav>
          <button className="world-btn ghost" onClick={() => void director.restart()}>
            Restart
          </button>
        </footer>
      )}
    </div>
  );
}

/**
 * What this run caught, counted from the calls the server answered in this copy. A beat that
 * didn't land adds nothing, so two visitors can see two different lists.
 */
function Impact({ log, playing }: { log: WorldView['log']; playing: string | null }) {
  const f = family();
  const impact = impactOf(log, { recipient: f.recipient.name, his: f.words.his, playing });
  if (!impact.lines.length) return null;
  return (
    <div className="world-impact" aria-label="What your run caught">
      <div className="head">
        What your run caught
        <span>
          {impact.calls} calls to the live server
          {impact.errors ? `, ${impact.errors} turned back` : ''}
          {playing ? ` · ${impact.yourCalls} were yours` : ''}
        </span>
      </div>
      <ul>
        {impact.lines.map((l) => (
          <li key={l.text} className={l.yours ? 'yours' : undefined}>
            <span className="tick">✓</span>
            <span className="text">
              {l.text}
              {l.yours && <b> You did this.</b>}
            </span>
            <code>{l.tools.join(' · ')}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Where a promise stands, as the card in a chat host words it. Nothing here is an alarm. */
const PROMISE_STAGE: Record<WeekPromise['stage'], string> = {
  checking: 'Checking in',
  open: 'Back with nobody',
  asking: 'Asking someone',
  still_on: 'Still on',
  promised: 'Said yes',
  done: 'Done',
  set_aside: 'Set aside',
};

/**
 * The day's score, read from the record the day left behind, not from the script: doses
 * with someone's word on them, work that has an owner, work that has none, and what it cost
 * the family in messages. The sim's own weights, shown so nobody has to trust a number.
 */
function DayScore({ view }: { view: WorldView }) {
  const [state, setState] = useState<BoardState | null>(null);
  useEffect(() => {
    void api.state(view.clock).then(setState, () => setState(null));
  }, [view.clock]);
  if (!state) return null;
  const doses = state.schedule ?? [];
  const recorded = doses.filter((d) => d.recorded).length;
  // The day's own work. A routine's next day goes on the record a day ahead, so by evening
  // tomorrow's lunch is there too, and was listed as "still nobody's" under today's, done.
  const dayEnds = homeToday(23, 59, view.clock).getTime() + 60_000;
  const work = (state.obligations ?? []).filter(
    (o) => o.status !== 'DISMISSED' && !(o.routineId && o.dueAt && Date.parse(o.dueAt) >= dayEnds),
  );
  // Done is nobody's no longer, owner or not: anyone but a helper can mark unowned work done.
  const done = work.filter((o) => o.status === 'RESOLVED');
  const owned = work.filter((o) => o.status === 'RESOLVED' || (o.owner && o.status !== 'PROPOSED'));
  const open = work.filter((o) => o.status !== 'RESOLVED' && (!o.owner || o.status === 'PROPOSED'));
  const covered = recorded + owned.length;
  const score = 10 * covered - 10 * open.length - view.interrupts;
  const promises = state.promises ?? [];
  return (
    <div className="world-score" aria-label="How the day went">
      <div className="head">
        How the day went<span>Read from the record this run left, not the script</span>
      </div>
      <div className="world-score-grid">
        <div>
          <b>
            {recorded}/{doses.length}
          </b>
          doses with someone's word on them
        </div>
        <div>
          <b>{owned.length}</b>jobs with an owner{done.length ? `, ${done.length} done` : ''}
        </div>
        <div className={open.length ? 'bad' : undefined}>
          <b>{open.length}</b>
          {open.length === 1 ? 'job' : 'jobs'} nobody has
        </div>
        <div>
          <b>{view.interrupts}</b>
          {view.interrupts === 1 ? 'message' : 'messages'} to the family
        </div>
      </div>
      {open.length > 0 && (
        <ul className="world-score-open">
          {open.map((o) => (
            <li key={o.id}>Still nobody's: {o.what}</li>
          ))}
        </ul>
      )}
      {promises.length > 0 && (
        <div className="world-score-promises" aria-label="This week’s promises">
          <div className="sub">The family’s word this week</div>
          <ul>
            {promises.map((p) => (
              <li key={p.obligationId} className={`stage-${p.stage}`}>
                <span className="chip">{PROMISE_STAGE[p.stage]}</span>
                {p.spoken}
              </li>
            ))}
          </ul>
        </div>
      )}
      {view.choices.length > 0 && (
        <ul className="world-score-choices">
          {view.choices.map((c, i) => (
            <li key={i}>
              {c.who} {c.choice === 'no' ? <>said no: “{c.said}”</> : 'let it go'}
              {c.yours && <b> Your choice.</b>}
            </li>
          ))}
        </ul>
      )}
      <div className="world-score-total">
        Day score <b>{score}</b>
        <span>
          10 for every dose on the record and job with an owner, minus 10 for every job nobody has,
          minus 1 for every message it took. Covered without nagging scores highest.
        </span>
      </div>
    </div>
  );
}

/** With ?shot=, the scene is reachable from a checking script. */
function ExposeForChecking() {
  const scene = useThree((s) => s.scene);
  if (new URLSearchParams(window.location.search).has('shot'))
    Object.assign(window, { __scene: scene });
  return null;
}

function CastPicker({
  onChoose,
  onFamily,
}: {
  onChoose: (who: PersonKey | null) => void;
  onFamily: () => void;
}) {
  const [which, setWhich] = useState<CareCaseId>(family().id);
  const [own, setOwn] = useState<FamilyNames | null>(familyNames());
  const [editing, setEditing] = useState(false);
  // A new family drops the visitor's names: they were written for the one before.
  const pick = (id: CareCaseId) => {
    setFamily(id);
    setWhich(id);
    setOwn(null);
    setEditing(false);
    onFamily();
  };
  const useNames = (n: FamilyNames | null) => {
    setFamily(which, n);
    setOwn(n);
    setEditing(false);
    onFamily();
  };
  const f = family();
  // Country first, then the family: the same coordination, in a home the visitor knows.
  const country = f.country;
  const goTo = (c: Country) => {
    if (c !== country) pick(Object.values(FAMILIES).find((x) => x.country === c)!.id);
  };
  const choose = async (who: PersonKey | null) => {
    // A fresh copy of the family for every visit: nothing anyone else did is in it.
    await api
      .resetSandbox({ liveMorning: true, careCase: which, ...(own ? { names: own } : {}) })
      .catch(() => undefined);
    onChoose(who);
  };
  return (
    <div className="world-cast">
      <h1>Who are you in this family?</h1>
      <div className="world-countries" role="tablist" aria-label="Which country">
        {(Object.keys(COUNTRIES) as Country[]).map((c) => (
          <button
            key={c}
            role="tab"
            aria-selected={c === country}
            className={`world-country${c === country ? ' on' : ''}`}
            onClick={() => goTo(c)}
          >
            {COUNTRIES[c].label}
          </button>
        ))}
      </div>
      <div className="world-families" role="tablist" aria-label="Which family">
        {Object.values(FAMILIES)
          .filter((x) => x.country === country)
          .map((x) => (
            <button
              key={x.id}
              role="tab"
              aria-selected={x.id === which}
              className={`world-family${x.id === which ? ' on' : ''}`}
              onClick={() => pick(x.id)}
            >
              <span className="name">{x.label}</span>
              <span className="tag">{x.tagline}</span>
            </button>
          ))}
      </div>
      <p className="lede">
        {f.lede} Pick one of them. The others are played for you. Every word goes to the real Alexa+
        planner, on your own copy of their care record.
      </p>
      {editing ? (
        <MakeItYours
          base={BASE_NAMES[which]}
          start={own ?? BASE_NAMES[which]}
          onDone={useNames}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <button type="button" className="world-link" onClick={() => setEditing(true)}>
          {own
            ? `Playing with your names (${own.recipient}, ${own.primary}…). Change them`
            : "Make it yours: use your own family's names"}
        </button>
      )}
      <div className="world-cast-cards">
        {PLAYABLE.map((key) => {
          return <CastCard key={`${which}-${key}`} who={key} onPick={() => void choose(key)} />;
        })}
      </div>
      <button className="world-btn ghost" onClick={() => void choose(null)}>
        Just watch the day
      </button>
      <p className="fine">
        {f.simulated
          ? 'A simulated family, run on the live We’ve Got This server. The coordination is real; the family is made up to show it around a different need. Your copy is thrown away when you restart.'
          : "A simulation of a real family's week, run on the live We’ve Got This server. Your copy is thrown away when you restart."}
      </p>
    </div>
  );
}

/** One person to play, standing on their card in 3D. */
function CastCard({ who, onPick }: { who: PersonKey; onPick: () => void }) {
  const p = CAST[who]!;
  const { hover, bind } = useHover();
  return (
    <button className="world-cast-card" style={{ borderColor: p.color }} onClick={onPick} {...bind}>
      <CardFigure who={who} hover={hover} />
      <span className="name" style={{ color: p.color }}>
        {p.name}
      </span>
      <span className="role">{p.role}</span>
      <span className="play">{p.playAs}</span>
    </button>
  );
}

/**
 * When a line didn't land. If the words were the visitor's own, they can say "that's not what
 * I meant" and, only if they tick the box, send those words so the phrasing can be taught.
 */
function StuckPanel({ stuck, onDecide }: { stuck: Stuck; onDecide: (again: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  const [sent, setSent] = useState<'no' | 'sending' | 'yes' | 'failed'>('no');
  const send = async () => {
    if (!consent || !stuck.said) return;
    setSent('sending');
    try {
      await api.phrasing({
        said: stuck.said,
        meant: stuck.expected,
        got: stuck.got ?? [],
        country: family().country,
      });
      setSent('yes');
    } catch {
      setSent('failed');
    }
  };
  return (
    <div className="world-panel">
      <h3>That didn't land the way the scene needs</h3>
      <p>
        {stuck.reason} The story needs <code>{stuck.expected.join(' or ')}</code> here. Nothing is
        faked: try again, or carry on as it is.
      </p>
      {stuck.said && !open && (
        <button type="button" className="world-link" onClick={() => setOpen(true)}>
          That's not what I meant
        </button>
      )}
      {stuck.said && open && (
        <div className="world-meant">
          <p>
            You said: <q>{stuck.said}</q>
          </p>
          {sent === 'yes' ? (
            <p className="ok">
              Saved. Thank you: phrasings like yours are how Alexa learns to hear people the way
              they talk.
            </p>
          ) : (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />{' '}
                Save these words so the app can learn this way of saying it. Only the sentence
                above, what the scene needed and what Alexa did are kept. No name, no family,
                nothing that identifies you.
              </label>
              <button
                type="button"
                className="world-btn ghost"
                disabled={!consent || sent === 'sending'}
                onClick={() => void send()}
              >
                {sent === 'sending' ? 'Saving…' : 'Save my words'}
              </button>
              {sent === 'failed' && (
                <p className="world-turn-note">That didn't save. Nothing was kept.</p>
              )}
            </>
          )}
        </div>
      )}
      <div className="row">
        <button className="world-btn" onClick={() => onDecide(true)}>
          Try again
        </button>
        <button className="world-btn ghost" onClick={() => onDecide(false)}>
          Carry on
        </button>
      </div>
    </div>
  );
}

/**
 * "Make it yours": the names the visitor's family goes by, over the family they picked. They
 * go into this visitor's copy of the demo only, which is thrown away on restart: never saved.
 */
function MakeItYours({
  base,
  start,
  onDone,
  onCancel,
}: {
  base: FamilyNames;
  start: FamilyNames;
  onDone: (n: FamilyNames | null) => void;
  onCancel: () => void;
}) {
  const [n, setN] = useState<FamilyNames>(start);
  const problem = namesProblem(n);
  const rows: { k: keyof FamilyNames; label: string }[] = [
    { k: 'recipient', label: `What you call them (instead of ${base.recipient})` },
    { k: 'primary', label: `Who keeps it together (instead of ${base.primary})` },
    { k: 'caregiver', label: `Who else helps (instead of ${base.caregiver})` },
    { k: 'away', label: `Who's far away (instead of ${base.away})` },
    { k: 'helper', label: `Who's nearby (instead of ${base.helper})` },
  ];
  return (
    <form
      className="world-yours"
      onSubmit={(e) => {
        e.preventDefault();
        if (!problem) onDone(n);
      }}
    >
      <div className="grid">
        {rows.map((r) => (
          <label key={r.k}>
            <span>{r.label}</span>
            <input
              value={n[r.k]}
              maxLength={24}
              autoComplete="off"
              onChange={(e) => setN({ ...n, [r.k]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <p className="fine">
        Names only, no surnames needed. They go into your copy of the demo, which is thrown away
        when you restart. Nothing is saved, and the need, the town and the day stay as they are.
      </p>
      {problem && <p className="world-turn-note">{problem}</p>}
      <div className="row">
        <button type="submit" className="world-btn" disabled={!!problem}>
          Use these names
        </button>
        <button type="button" className="world-btn ghost" onClick={() => onDone(null)}>
          Use theirs
        </button>
        <button type="button" className="world-btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** How many bars a voice note's waveform is drawn with. */
const NOTE_BARS = 32;

interface Note {
  url: string;
  secs: number;
  bars: number[];
  heard?: string;
  failed?: string;
}

/**
 * A voice note, the way the family already talks in their group chat: hold to record, let go,
 * hear it back and see what was heard, then send it. What is sent is the transcript, so a
 * misheard word is caught before it reaches the record.
 */
function VoiceNote({ color, onSend }: { color: string; onSend: (text: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const rec = useRef<Recording | null>(null);
  const peaks = useRef<number[]>([]);
  const started = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);

  const discard = useCallback(() => {
    audio.current?.pause();
    setPlaying(false);
    setNote((n) => {
      if (n) URL.revokeObjectURL(n.url);
      return null;
    });
  }, []);
  useEffect(() => () => rec.current?.cancel(), []);

  const start = async () => {
    if (rec.current) return;
    discard();
    setHint(null);
    peaks.current = [];
    try {
      rec.current = await record({ onLevel: (l) => peaks.current.push(l) });
      started.current = performance.now();
      setRecording(true);
    } catch (e) {
      setHint(
        (e as Error).name === 'NotAllowedError'
          ? 'The browser blocked the microphone. Allow it in the address bar, or type it instead.'
          : 'No microphone is available. Type it instead.',
      );
    }
  };

  const stop = async () => {
    const r = rec.current;
    rec.current = null;
    if (!r) return;
    setRecording(false);
    const secs = (performance.now() - started.current) / 1000;
    if (secs < 0.6) {
      r.cancel();
      setHint('Hold the button down while you talk.');
      return;
    }
    const pcm = await r.stop();
    const all = peaks.current;
    const per = Math.max(1, Math.floor(all.length / NOTE_BARS));
    const bars = Array.from({ length: Math.min(NOTE_BARS, all.length) }, (_, i) =>
      Math.min(1, Math.max(...all.slice(i * per, i * per + per), 0) * 1.6),
    );
    const url = URL.createObjectURL(pcmToWav(pcm));
    setNote({ url, secs, bars });
    try {
      const { text } = await api.transcribe(pcm);
      setNote((n) =>
        n?.url === url
          ? text.trim()
            ? { ...n, heard: text.trim() }
            : { ...n, failed: 'Nothing was heard in it. Record it again, or type it.' }
          : n,
      );
    } catch (e) {
      setNote((n) =>
        n?.url === url ? { ...n, failed: `Couldn't transcribe it: ${(e as Error).message}` } : n,
      );
    }
  };

  const play = () => {
    if (!note) return;
    if (playing) {
      audio.current?.pause();
      setPlaying(false);
      return;
    }
    const a = new Audio(note.url);
    audio.current = a;
    a.onended = () => setPlaying(false);
    void a.play();
    setPlaying(true);
  };

  const length = (secs: number) => `0:${String(Math.round(secs)).padStart(2, '0')}`;

  return (
    <div className="world-note">
      {note ? (
        <div className="world-note-bubble" style={{ borderColor: color }}>
          <button
            type="button"
            className="world-note-play"
            style={{ background: color }}
            onClick={play}
            aria-label={playing ? 'Pause the voice note' : 'Play the voice note'}
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <div className="world-note-wave" aria-hidden>
            {note.bars.map((b, i) => (
              <span key={i} style={{ height: `${12 + b * 88}%`, background: color }} />
            ))}
          </div>
          <span className="world-note-len">{length(note.secs)}</span>
          <div className="world-note-heard">
            {note.heard ? (
              <>
                Heard: <q>{note.heard}</q>
              </>
            ) : note.failed ? (
              note.failed
            ) : (
              'Listening to your note…'
            )}
          </div>
          <div className="row">
            <button
              type="button"
              className="world-btn"
              disabled={!note.heard}
              onClick={() => {
                const text = note.heard!;
                discard();
                onSend(text);
              }}
            >
              Send voice note
            </button>
            <button type="button" className="world-btn ghost" onClick={discard}>
              Delete
            </button>
          </div>
        </div>
      ) : null}
      <button
        type="button"
        className={`world-btn ghost world-note-hold${recording ? ' live' : ''}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          void start();
        }}
        onPointerUp={() => void stop()}
        onPointerCancel={() => void stop()}
        onKeyDown={(e) => {
          if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
            e.preventDefault();
            void start();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === ' ' || e.key === 'Enter') void stop();
        }}
        title="Hold to record a voice note, let go to stop"
      >
        {recording
          ? '● Recording… let go to stop'
          : note
            ? 'Record again'
            : '🎙 Hold for a voice note'}
      </button>
      {hint && <div className="world-turn-note">{hint}</div>}
    </div>
  );
}

/** Your line: say it your own way, type it, speak it, or send a voice note (Amazon Transcribe). */
function YourTurn({
  who,
  suggestion,
  no,
  reply,
  onSay,
}: {
  who: PersonKey;
  suggestion: string;
  no?: string;
  reply: boolean;
  onSay: (text: string) => void;
}) {
  const [text, setText] = useState(suggestion);
  const [listening, setListening] = useState(false);
  const [lang, setLang] = useState(() => speechLanguage().code);
  const [note, setNote] = useState<string | null>(null);
  const rec = useRef<Recording | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setText(suggestion);
    input.current?.focus();
    input.current?.select();
  }, [suggestion]);

  const finish = useCallback(async () => {
    const r = rec.current;
    rec.current = null;
    setListening(false);
    if (!r) return;
    try {
      const { text: heard } = await api.transcribe(await r.stop());
      if (heard.trim()) onSay(heard);
      else setNote("I didn't catch that. Try again, or type it.");
    } catch (e) {
      setNote(`Couldn't transcribe: ${(e as Error).message}`);
    }
  }, [onSay]);

  const mic = async () => {
    if (listening) return void finish();
    setNote(null);
    try {
      rec.current = await record({
        onEnd: (reason) => {
          if (reason === 'nothing') {
            rec.current?.cancel();
            rec.current = null;
            setListening(false);
            setNote("I didn't hear anything.");
          } else void finish();
        },
      });
      setListening(true);
    } catch (e) {
      const name = (e as Error).name;
      setNote(
        name === 'NotAllowedError'
          ? 'The browser blocked the microphone. Allow it in the address bar, or type it instead.'
          : name === 'NotFoundError'
            ? 'No microphone found. Type it instead.'
            : `The microphone wouldn't start (${(e as Error).message}). Type it instead.`,
      );
    }
  };

  const p = CAST[who]!;
  return (
    <form
      className="world-turn"
      style={{ borderColor: p.color }}
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onSay(text.trim());
      }}
    >
      <div className="world-turn-head">
        <span style={{ color: p.color }}>
          {reply ? `Answer Alexa, ${p.name}.` : `Your turn, ${p.name}.`}
        </span>{' '}
        {reply
          ? "She hasn't done it yet. Reply to her, or say it again:"
          : 'Say it your own way, or use this:'}
      </div>
      <div className="row">
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={`What ${p.name} says`}
        />
        <button type="submit" className="world-btn">
          Say it
        </button>
      </div>
      {/* Other ways to say it, and the day doesn't have to go to script: a no is an answer, silence is a choice too. */}
      <div className="row world-choices">
        <button
          type="button"
          className={`world-btn ghost${listening ? ' live' : ''}`}
          onClick={() => void mic()}
        >
          {listening ? 'Stop' : 'Speak'}
        </button>
        <VoiceNote color={p.color} onSend={onSay} />
        <select
          className="world-btn ghost"
          value={lang}
          aria-label="The language you speak in"
          title="You're heard in it, and Alexa answers in it"
          onChange={(e) => {
            setSpeechLanguage(e.target.value);
            setLang(e.target.value);
            setNote(
              speechLanguage().hears
                ? null
                : 'Nothing hears this one spoken yet: speak English, or type it. Alexa answers in writing.',
            );
          }}
        >
          {SPEECH_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.native}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="world-btn ghost"
          disabled={text === suggestion}
          title="Put the story's line back in the box"
          onClick={() => {
            setText(suggestion);
            input.current?.focus();
          }}
        >
          Suggest
        </button>
        {no && (
          <button
            type="button"
            className="world-btn ghost"
            title={`Say: "${no}"`}
            onClick={() => onSay(SAY_NO)}
          >
            Say no
          </button>
        )}
        {!reply && (
          <button
            type="button"
            className="world-btn ghost"
            title="Say nothing to Alexa. Nothing goes on the record."
            onClick={() => onSay(STAY_QUIET)}
          >
            Stay quiet
          </button>
        )}
      </div>
      {note && <div className="world-turn-note">{note}</div>}
    </form>
  );
}

/** Your turn is the TV remote: the same five buttons a Fire TV remote has, pressed on the TV on the wall. */
function RemoteTurn({
  who,
  hint,
  onPress,
  onLeave,
}: {
  who: PersonKey;
  hint: string;
  onPress: (key: Key) => void;
  onLeave: () => void;
}) {
  const p = CAST[who]!;
  const keys: { key: Key; label: string }[] = [
    { key: 'left', label: '◀' },
    { key: 'up', label: '▲' },
    { key: 'ok', label: 'OK' },
    { key: 'down', label: '▼' },
    { key: 'right', label: '▶' },
    { key: 'back', label: 'BACK' },
  ];
  return (
    <div className="world-turn" style={{ borderColor: p.color }}>
      <div className="world-turn-head">
        <span style={{ color: p.color }}>Your turn, {p.name}.</span> {hint} Use the remote: watch
        the TV on the wall.
      </div>
      <div className="row world-remote" role="group" aria-label="TV remote">
        {keys.map((k) => (
          <button
            key={k.key}
            type="button"
            className={`world-btn${k.key === 'ok' ? '' : ' ghost'}`}
            onClick={() => onPress(k.key)}
            aria-label={k.key}
          >
            {k.label}
          </button>
        ))}
        <button
          type="button"
          className="world-btn ghost"
          title="Leave the question on the TV"
          onClick={onLeave}
        >
          Ignore it
        </button>
      </div>
    </div>
  );
}
