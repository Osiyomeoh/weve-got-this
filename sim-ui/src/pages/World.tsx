import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { advance, Canvas, useThree } from '@react-three/fiber';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { record, type Recording } from '../lib/mic';
import { tellStoryTime } from '../lib/storyTime';
import { CAST, PLAYABLE, type PersonKey } from '../world/cast';
import { useDirector, type WorldView } from '../world/director';
import { MODEL, preloadWorld } from '../world/models';
import { Scene } from '../world/Scene';
import { clockText, homeToday, STORY, type ShotName } from '../world/story';
import { SHOTS } from '../world/layout';
import { impactOf } from '../world/impact';
import { COUNTRIES, FAMILIES, family, setFamily, type Country } from '../world/families';
import type { CareCaseId } from '../lib/api';
import type { Key } from '../lib/dpad';
import '../world/world.css';

/** How many calls the record panel shows before the oldest give way. */
const TRACE_ROWS = 10;

preloadWorld([
  ...Object.values(CAST).map((p) => MODEL.character(p.model)),
  ...Object.values(FAMILIES).flatMap((f) => [f.recipient.model, f.tolu?.model, f.helper?.model])
    .filter((m): m is string => !!m).map((m) => MODEL.character(m)),
  MODEL.character('aid-sunglasses'), MODEL.character('wheelchair'), MODEL.car('sedan'),
]);

/**
 * One family's day, played on the real server. You choose who you are; everyone else is
 * played for you. Every line goes to the Alexa+ planner on your own copy of the record,
 * and the TV on Daddy's wall is the real Fire TV page reading that same copy.
 */
export default function World() {
  const [muted, setMuted] = useState(false);
  const tv = () => (document.getElementById('world-tv') as HTMLIFrameElement | null)?.contentWindow;
  const director = useDirector({ muted, tvFrame: tv, onStoryTime: (at) => tellStoryTime(tv(), at) });
  const { view } = director;
  const beat = STORY[view.beat]!;

  // ?shot=daddy opens on a given camera, for checking a scene by eye.
  useEffect(() => {
    const shot = new URLSearchParams(window.location.search).get('shot');
    if (shot && shot in SHOTS) { director.look(shot as ShotName); director.choose(null); }
    // A hidden tab gets no animation frames; let a checking script step the scene by hand.
    if (shot) Object.assign(window, {
      __advance: (t: number) => advance(t), __look: director.look, __pose: director.pose, __shots: SHOTS,
      // Switch family, then __look() any shot to redraw with them in it.
      __family: (id: CareCaseId) => setFamily(id),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="world">
      <Canvas shadows camera={{ position: [0.5, 7.5, 12.5], fov: 42, near: 0.05, far: 200 }} dpr={[1, 2]}>
        <Suspense fallback={null}>
          <Scene view={view} onPulseDone={director.pulseDone} />
        </Suspense>
        <ExposeForChecking />
      </Canvas>

      <header className="world-top">
        <Link to="/" className="world-brand">CareCircle</Link>
        <div className="world-clock">
          <span className="world-time">{clockText(view.clock)}</span>
          <span className="world-place">{family().places ? `${family().places!.home} · ${family().places!.tolu}` : 'Lagos'}</span>
        </div>
        {view.status !== 'cast' && (
          <div className="world-beat">
            <div className="world-beat-title">{beat.title}</div>
            <div className="world-beat-point">{beat.point}</div>
          </div>
        )}
        <div className="world-tools">
          {view.playing && <span className="world-you" style={{ color: CAST[view.playing]!.color }}>You are {CAST[view.playing]!.name}</span>}
          <button className="world-btn ghost" onClick={() => setMuted((m) => !m)}>{muted ? 'Sound off' : 'Sound on'}</button>
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
          {view.caption.who && <span className="who" style={view.caption.color ? { color: view.caption.color } : undefined}>{view.caption.who}</span>}
          {view.caption.to && <span className="to">to {view.caption.to}</span>}
          <span className="text">{view.caption.text}</span>
        </div>
      )}

      {view.status === 'cast' && <CastPicker onChoose={director.choose} onFamily={director.reclock} />}
      {view.evidence && view.status !== 'cast' && (
        <aside className="world-evidence" aria-label="What the doorbell reported">
          <div className="head"><span className="dot" />Ring · Front door · {clockText(view.evidence.at)}</div>
          <div className="row"><span className="k">Saw</span><span className="v">{view.evidence.saw}</span></div>
          <div className="row"><span className="k">Can't know</span><span className="v">{view.evidence.cannot}</span></div>
          <div className="foot">On the record as evidence, never as proof.</div>
        </aside>
      )}

      {view.status === 'yourTurn' && view.prompt && (view.prompt.remote
        ? <RemoteTurn who={view.prompt.who} hint={view.prompt.suggestion} onPress={director.press} />
        : <YourTurn who={view.prompt.who} suggestion={view.prompt.suggestion} onSay={director.say} />)}
      {view.status === 'stuck' && view.stuck && (
        <div className="world-panel">
          <h3>That didn't land the way the scene needs</h3>
          <p>{view.stuck.reason} The story needs <code>{view.stuck.expected.join(' or ')}</code> here. Nothing is faked: try again, or carry on as it is.</p>
          <div className="row">
            <button className="world-btn" onClick={() => director.decide(true)}>Try again</button>
            <button className="world-btn ghost" onClick={() => director.decide(false)}>Carry on</button>
          </div>
        </div>
      )}
      {view.status === 'error' && (
        <div className="world-panel">
          <h3>The server didn't answer</h3>
          <p>{view.error}</p>
          <div className="row"><button className="world-btn" onClick={() => void director.restart()}>Start the day again</button></div>
        </div>
      )}
      {view.status === 'done' && (
        <div className="world-panel">
          <h3>One day, one record</h3>
          <p>{family().ending}</p>
          <Impact log={view.log} playing={view.playing ? CAST[view.playing]!.name : null} />
          <div className="row">
            <button className="world-btn" onClick={() => void director.restart().then(() => director.choose(null)).then(() => director.restart())}>Play as someone else</button>
            <button className="world-btn ghost" onClick={() => void director.restart()}>Watch again</button>
          </div>
        </div>
      )}

      {view.status !== 'cast' && (
        <footer className="world-bottom">
          {view.status === 'ready' && <button className="world-btn big" onClick={() => void director.play(0)}>Start the day</button>}
          <nav className="world-beats" aria-label="Moments">
            {STORY.map((b, i) => (
              <button key={b.id} className={`world-chip${i === view.beat ? ' on' : ''}${i < view.beat ? ' past' : ''}`}
                onClick={() => director.skipTo(i)} title={b.point}>
                {clockText(homeToday(b.at[0], b.at[1]))} · {b.title}
              </button>
            ))}
          </nav>
          <button className="world-btn ghost" onClick={() => void director.restart()}>Restart</button>
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
        <span>{impact.calls} calls to the live server{impact.errors ? `, ${impact.errors} turned back` : ''}{playing ? ` · ${impact.yourCalls} were yours` : ''}</span>
      </div>
      <ul>
        {impact.lines.map((l) => (
          <li key={l.text} className={l.yours ? 'yours' : undefined}>
            <span className="tick">✓</span>
            <span className="text">{l.text}{l.yours && <b> You did this.</b>}</span>
            <code>{l.tools.join(' · ')}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** With ?shot=, the scene is reachable from a checking script. */
function ExposeForChecking() {
  const scene = useThree((s) => s.scene);
  if (new URLSearchParams(window.location.search).has('shot')) Object.assign(window, { __scene: scene });
  return null;
}

function CastPicker({ onChoose, onFamily }: { onChoose: (who: PersonKey | null) => void; onFamily: () => void }) {
  const [which, setWhich] = useState<CareCaseId>(family().id);
  const pick = (id: CareCaseId) => { setFamily(id); setWhich(id); onFamily(); };
  const f = FAMILIES[which];
  // Country first, then the family: the same coordination, in a home the visitor knows.
  const country = f.country;
  const goTo = (c: Country) => { if (c !== country) pick(Object.values(FAMILIES).find((x) => x.country === c)!.id); };
  const choose = async (who: PersonKey | null) => {
    // A fresh copy of the family for every visit: nothing anyone else did is in it.
    await api.resetSandbox({ liveMorning: true, careCase: which }).catch(() => undefined);
    onChoose(who);
  };
  return (
    <div className="world-cast">
      <h1>Who are you in this family?</h1>
      <div className="world-countries" role="tablist" aria-label="Which country">
        {(Object.keys(COUNTRIES) as Country[]).map((c) => (
          <button key={c} role="tab" aria-selected={c === country}
            className={`world-country${c === country ? ' on' : ''}`} onClick={() => goTo(c)}>
            {COUNTRIES[c].label}
          </button>
        ))}
      </div>
      <div className="world-families" role="tablist" aria-label="Which family">
        {Object.values(FAMILIES).filter((x) => x.country === country).map((x) => (
          <button key={x.id} role="tab" aria-selected={x.id === which}
            className={`world-family${x.id === which ? ' on' : ''}`} onClick={() => pick(x.id)}>
            <span className="name">{x.label}</span>
            <span className="tag">{x.tagline}</span>
          </button>
        ))}
      </div>
      <p className="lede">
        {f.lede} Pick one of them. The others are played for you. Every word goes to the real Alexa+ planner, on your own copy of their care record.
      </p>
      <div className="world-cast-cards">
        {PLAYABLE.map((key) => {
          const p = CAST[key]!;
          return (
            <button key={key} className="world-cast-card" style={{ borderColor: p.color }} onClick={() => void choose(key)}>
              <span className="name" style={{ color: p.color }}>{p.name}</span>
              <span className="role">{p.role}</span>
              <span className="play">{p.playAs}</span>
            </button>
          );
        })}
      </div>
      <button className="world-btn ghost" onClick={() => void choose(null)}>Just watch the day</button>
      <p className="fine">
        {f.simulated
          ? 'A simulated family, run on the live CareCircle server. The coordination is real; the family is made up to show it around a different need. Your copy is thrown away when you restart.'
          : 'A simulation of a real family\'s week, run on the live CareCircle server. Your copy is thrown away when you restart.'}
      </p>
    </div>
  );
}

/** Your line: say it your own way, type it, or speak it (Amazon Transcribe). */
function YourTurn({ who, suggestion, onSay }: { who: PersonKey; suggestion: string; onSay: (text: string) => void }) {
  const [text, setText] = useState(suggestion);
  const [listening, setListening] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const rec = useRef<Recording | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setText(suggestion); input.current?.focus(); input.current?.select(); }, [suggestion]);

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
      rec.current = await record({ onEnd: (reason) => { if (reason === 'nothing') { rec.current?.cancel(); rec.current = null; setListening(false); setNote("I didn't hear anything."); } else void finish(); } });
      setListening(true);
    } catch {
      setNote('The browser blocked the microphone. Type it instead.');
    }
  };

  const p = CAST[who]!;
  return (
    <form className="world-turn" style={{ borderColor: p.color }} onSubmit={(e) => { e.preventDefault(); if (text.trim()) onSay(text.trim()); }}>
      <div className="world-turn-head"><span style={{ color: p.color }}>Your turn, {p.name}.</span> Say it your own way, or use this:</div>
      <div className="row">
        <input ref={input} value={text} onChange={(e) => setText(e.target.value)} aria-label={`What ${p.name} says`} />
        <button type="button" className={`world-btn ghost${listening ? ' live' : ''}`} onClick={() => void mic()}>{listening ? 'Stop' : 'Speak'}</button>
        <button type="submit" className="world-btn">Say it</button>
      </div>
      {note && <div className="world-turn-note">{note}</div>}
    </form>
  );
}

/** Your turn is the TV remote: the same five buttons a Fire TV remote has, pressed on the TV on the wall. */
function RemoteTurn({ who, hint, onPress }: { who: PersonKey; hint: string; onPress: (key: Key) => void }) {
  const p = CAST[who]!;
  const keys: { key: Key; label: string }[] = [
    { key: 'left', label: '◀' }, { key: 'up', label: '▲' }, { key: 'ok', label: 'OK' }, { key: 'down', label: '▼' }, { key: 'right', label: '▶' }, { key: 'back', label: 'BACK' },
  ];
  return (
    <div className="world-turn" style={{ borderColor: p.color }}>
      <div className="world-turn-head"><span style={{ color: p.color }}>Your turn, {p.name}.</span> {hint} Use the remote: watch the TV on the wall.</div>
      <div className="row world-remote" role="group" aria-label="TV remote">
        {keys.map((k) => (
          <button key={k.key} type="button" className={`world-btn${k.key === 'ok' ? '' : ' ghost'}`} onClick={() => onPress(k.key)} aria-label={k.key}>{k.label}</button>
        ))}
      </div>
    </div>
  );
}
