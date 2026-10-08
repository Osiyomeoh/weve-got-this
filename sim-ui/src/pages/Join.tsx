import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { record, type Recording } from '../lib/mic';
import type { Feed } from '../world/room';
import { hush, speak } from '../world/voice';
import '../world/world.css';

const POLL_MS = 1000;
const KEYS = [
  { key: 'left', label: '◀' }, { key: 'up', label: '▲' }, { key: 'ok', label: 'OK' },
  { key: 'down', label: '▼' }, { key: 'right', label: '▶' }, { key: 'back', label: 'BACK' },
] as const;

/**
 * A family member's phone, in a day someone else is running (/join?code=ABC123). They take a
 * person nobody is playing and see what the host's screen shows. When it is their turn they
 * say it here; the host's world sends it to Alexa on the one shared copy of the record.
 * Nothing on this page acts on the record by itself.
 */
export default function Join() {
  const [params, setParams] = useSearchParams();
  const code = (params.get('code') ?? '').toUpperCase();
  const [typed, setTyped] = useState('');
  const [feed, setFeed] = useState<Feed | null>(null);
  const [taken, setTaken] = useState<string[]>([]);
  const [mine, setMine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sound, setSound] = useState(false);
  const said = useRef(0);

  useEffect(() => {
    if (!code) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const v = await api.room.view<Feed>(code);
        if (stop) return;
        setFeed(v.feed); setTaken(v.taken); setMine(v.mine); setError(null);
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
      if (!stop) timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [code]);

  // Each new line said once, in that person's voice, when this phone has sound on. Their own
  // lines are not said back to them.
  useEffect(() => {
    const c = feed?.caption;
    if (!feed || !c || feed.captionId === said.current) return;
    said.current = feed.captionId;
    const me = feed.people.find((p) => p.key === mine)?.name;
    if (sound && c.voice && c.who !== me) { hush(); void speak(c.text, c.voice); }
  }, [feed, mine, sound]);

  if (!code) {
    return (
      <div className="join">
        <h1>Join a family's day</h1>
        <p>Type the code on the screen of the person running it.</p>
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) setParams({ code: typed.trim().toUpperCase() }); }}>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={6} placeholder="ABC123" aria-label="Code" autoCapitalize="characters" />
          <button className="world-btn" type="submit">Join</button>
        </form>
      </div>
    );
  }

  if (error && !feed) {
    return (
      <div className="join">
        <h1>Couldn't join</h1>
        <p>{error}</p>
        <Link className="world-btn ghost" to="/join">Try another code</Link>
      </div>
    );
  }
  if (!feed) return <div className="join"><p>Joining {code}…</p></div>;

  const me = feed.people.find((p) => p.key === mine) ?? null;
  const take = async (who: string) => {
    try { await api.room.seat(code, who); setMine(who); } catch (e) { setError((e as Error).message); }
  };

  if (!me) {
    const host = feed.people.find((p) => p.key === feed.hostAs);
    return (
      <div className="join">
        <div className="join-top"><span>{feed.family}'s day</span><span>{feed.place}</span></div>
        <h1>Who are you in this family?</h1>
        <p>{host ? `${host.name} is taken by whoever is running the day. ` : ''}Pick someone nobody is playing. Everyone else is played for you.</p>
        <div className="join-people">
          {feed.people.map((p) => {
            const busy = taken.includes(p.key);
            return (
              <button key={p.key} className="world-cast-card" style={{ borderColor: p.color }} disabled={busy} onClick={() => void take(p.key)}>
                <span className="name" style={{ color: p.color }}>{p.name}</span>
                <span className="role">{p.role}</span>
                <span className="play">{busy ? 'Someone is playing them.' : p.playAs}</span>
              </button>
            );
          })}
        </div>
        {error && <p className="world-turn-note">{error}</p>}
      </div>
    );
  }

  const myTurn = feed.prompt && feed.prompt.who === mine ? feed.prompt : null;
  return (
    <div className="join">
      <div className="join-top">
        <span style={{ color: me.color }}>You are {me.name}</span>
        <span>{feed.clock} · {feed.place}</span>
        <button className="world-btn ghost" onClick={() => { if (sound) hush(); setSound((s) => !s); }}>{sound ? 'Sound on' : 'Sound off'}</button>
      </div>
      {feed.status === 'cast' || feed.status === 'ready'
        ? <p className="join-wait">Waiting for the day to start…</p>
        : feed.beat && <div className="join-beat"><b>{feed.beat}</b><span>{feed.point}</span></div>}

      {feed.caption && feed.status !== 'done' && (
        <div className={`world-caption join-caption ${feed.caption.tone}`}>
          {feed.caption.who && <span className="who" style={feed.caption.color ? { color: feed.caption.color } : undefined}>{feed.caption.who}</span>}
          {feed.caption.to && <span className="to">to {feed.caption.to}</span>}
          <span className="text">{feed.caption.text}</span>
        </div>
      )}

      {myTurn && !myTurn.remote && <GuestLine key={feed.captionId + myTurn.suggestion} reply={!!myTurn.reply} name={me.name} color={me.color} suggestion={myTurn.suggestion} onSay={(text) => void api.room.send(code, { text })} />}
      {myTurn && myTurn.remote && (
        <div className="world-turn join-turn" style={{ borderColor: me.color }}>
          <div className="world-turn-head"><span style={{ color: me.color }}>Your turn, {me.name}.</span> {myTurn.suggestion} This is the TV remote.</div>
          <div className="row world-remote" role="group" aria-label="TV remote">
            {KEYS.map((k) => (
              <button key={k.key} type="button" className={`world-btn${k.key === 'ok' ? '' : ' ghost'}`} onClick={() => void api.room.send(code, { key: k.key })} aria-label={k.key}>{k.label}</button>
            ))}
          </div>
        </div>
      )}
      {!myTurn && feed.prompt && <p className="join-wait">Waiting for {feed.people.find((p) => p.key === feed.prompt!.who)?.name}…</p>}

      {feed.status === 'done' && feed.ending && <div className="join-end"><h2>End of the day</h2><p>{feed.ending}</p></div>}

      {feed.trace.length > 0 && (
        <div className="join-trace" aria-label="What the server did">
          <div className="world-trace-head">On the record</div>
          {feed.trace.map((t, i) => (
            <div key={i} className={`world-trace-row${t.err ? ' err' : ''}`}>
              <span className="who">{t.who}</span><code>{t.call}</code><span className="at">{t.at}</span>
            </div>
          ))}
        </div>
      )}
      {error && <p className="world-turn-note">Lost touch with the day: {error}</p>}
    </div>
  );
}

/** A guest's line: their own words, typed or spoken, or the one the story suggests. */
function GuestLine({ name, color, suggestion, reply, onSay }: { reply: boolean; name: string; color: string; suggestion: string; onSay: (text: string) => void }) {
  const [text, setText] = useState(suggestion);
  const [sent, setSent] = useState(false);
  const [listening, setListening] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const rec = useRef<Recording | null>(null);
  const send = (t: string) => { if (t.trim()) { setSent(true); onSay(t.trim()); } };

  const finish = useCallback(async () => {
    const r = rec.current;
    rec.current = null;
    setListening(false);
    if (!r) return;
    try {
      const { text: heard } = await api.transcribe(await r.stop());
      if (heard.trim()) { setText(heard); send(heard); } else setNote("I didn't catch that. Try again, or type it.");
    } catch (e) {
      setNote(`Couldn't transcribe: ${(e as Error).message}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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

  if (sent) return <p className="join-wait">Sent. Alexa is hearing it now…</p>;
  return (
    <form className="world-turn join-turn" style={{ borderColor: color }} onSubmit={(e) => { e.preventDefault(); send(text); }}>
      <div className="world-turn-head"><span style={{ color }}>{reply ? `Answer Alexa, ${name}.` : `Your turn, ${name}.`}</span> {reply ? 'She hasn\'t done it yet. Reply to her, or say it again:' : 'Say it your own way, or use this:'}</div>
      <input value={text} onChange={(e) => setText(e.target.value)} aria-label={`What ${name} says`} />
      <div className="row">
        <button type="button" className={`world-btn ghost${listening ? ' live' : ''}`} onClick={() => void mic()}>{listening ? 'Stop' : 'Speak'}</button>
        <button type="button" className="world-btn ghost" disabled={text === suggestion} onClick={() => setText(suggestion)}>Suggest</button>
        <button type="submit" className="world-btn">Say it</button>
      </div>
      {note && <div className="world-turn-note">{note}</div>}
    </form>
  );
}
