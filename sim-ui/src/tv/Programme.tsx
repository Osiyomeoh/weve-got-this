import { useEffect, useRef, useState } from 'react';
import { Show, type Region } from './Show';

/**
 * A real programme on the set. The pictures and sound come from Amazon's own Fire TV sample
 * feed (scrap-tv-feed: imaginary shows, royalty-free, made for prototyping TV apps), the same
 * catalogue Amazon's react-native-multi-tv-app-sample plays. It is an ordinary media element,
 * the API Vega's W3C media player mirrors, so what happens here is what happens on the set:
 * the show plays, and when Alexa or the doorbell needs the screen the show's sound dips
 * under it and comes back, as Fire TV does.
 *
 * If the feed can't be reached the set falls back to the drawn programmes in Show.tsx.
 */

const FEED = 'https://giolaq.github.io/scrap-tv-feed/catalog.json';

interface Title {
  id: string;
  title: string;
  category: string;
  sources?: { type: string; url: string }[];
}

/** What tends to be on, by the hour: a daytime pick and an evening one, for a home's own clock. */
const DAYTIME = [
  'the-extra-mile',
  'parking-wars',
  'the-great-beige-bakeoff',
  'stone-cold-makeovers',
];
const EVENING = [
  'feline-assistant',
  'the-it-cats',
  'spot-hunters-season-1',
  'parking-lot-mysteries',
];

let catalogue: Promise<Title[]> | null = null;
function load(): Promise<Title[]> {
  catalogue ??= fetch(FEED)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then(
      (d: unknown) =>
        (Array.isArray(d) ? d : (Object.values(d as object).find(Array.isArray) ?? [])) as Title[],
    );
  return catalogue;
}

export function Programme({
  region,
  hour,
  raised,
  sound,
  ducked,
}: {
  region: Region;
  hour: number;
  raised: boolean;
  /** The world's sound switch. */
  sound: boolean;
  /** Something of the app's or the doorbell's is on screen: the show goes quiet under it. */
  ducked: boolean;
}) {
  const evening = hour >= 17 || hour < 4;
  const [pick, setPick] = useState<Title | null>(null);
  const [failed, setFailed] = useState(false);
  const [banner, setBanner] = useState(true);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let stop = false;
    load()
      .then((all) => {
        if (stop) return;
        const want = evening ? EVENING : DAYTIME;
        const t =
          want
            .map((id) => all.find((x) => x.id === id))
            .find((x) => x?.sources?.some((s) => s.type === 'mp4')) ??
          all.find((x) => x.sources?.some((s) => s.type === 'mp4'));
        if (t) {
          setPick(t);
          setBanner(true);
        } else setFailed(true);
      })
      .catch(() => {
        if (!stop) setFailed(true);
      });
    return () => {
      stop = true;
    };
  }, [evening]);

  // Fire TV's "now playing" strip, for a few seconds when a programme starts.
  useEffect(() => {
    if (!pick) return;
    const id = setTimeout(() => setBanner(false), 6000);
    return () => clearTimeout(id);
  }, [pick]);

  // Volume follows the world's switch, and dips while Alexa or the doorbell has the screen.
  // Browsers start a video only if it is muted, so it starts muted and is unmuted on the switch.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.volume = ducked ? 0.12 : 0.7;
    // An unmute the browser refuses (no click has reached it yet) falls back to muted, and is
    // tried again every couple of seconds, so the set is never left silent for the whole day.
    const tune = () => {
      v.muted = !sound;
      if (v.paused || !v.muted !== sound)
        void v.play().catch(() => {
          v.muted = true;
          void v.play().catch(() => undefined);
        });
    };
    tune();
    if (!sound) return;
    const id = setInterval(() => {
      if (v.muted || v.paused) tune();
    }, 2000);
    return () => clearInterval(id);
  }, [sound, ducked, pick]);

  const src = pick?.sources?.find((s) => s.type === 'mp4')?.url;
  if (failed || !src) return <Show region={region} hour={hour} raised={raised} />;
  return (
    <div className="tv-show bg-black">
      <video
        ref={video}
        key={src}
        src={src}
        autoPlay
        muted
        loop
        playsInline
        onError={() => setFailed(true)}
        className="absolute inset-0 h-full w-full object-cover"
      />
      {!ducked && <Break />}
      {banner && (
        <div className="tv-rise absolute left-[3vw] top-[4vh] rounded-[0.8vw] bg-black/60 px-[1.6vw] py-[1.2vh] backdrop-blur">
          <div className="text-[0.9vw] uppercase tracking-[0.25em] text-white/60">
            Now playing · {pick!.category}
          </div>
          <div className="text-[2vw] font-medium">{pick!.title}</div>
        </div>
      )}
    </div>
  );
}

/** The Amazon devices this story runs on. Our own cards about them, not Amazon's adverts. */
const BREAK = [
  {
    name: 'Alexa+',
    line: 'Say it once, in your own words. Here it keeps the whole family on one record.',
  },
  {
    name: 'Fire TV',
    line: 'The screen already in the room. A dose question answers with one press of the remote.',
  },
  { name: 'Ring Video Doorbell', line: 'Sees someone at the door, and says only that. Never who.' },
];
const EVERY_MS = 75_000;
const CARD_MS = 4_000;

/** A short break between scenes of the programme, as Fire TV shows one. */
function Break() {
  const [card, setCard] = useState(-1);
  useEffect(() => {
    let timers: ReturnType<typeof setTimeout>[] = [];
    const run = () => {
      timers = BREAK.map((_, i) => setTimeout(() => setCard(i), i * CARD_MS));
      timers.push(setTimeout(() => setCard(-1), BREAK.length * CARD_MS));
    };
    const first = setTimeout(run, 20_000);
    const id = setInterval(run, EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      timers.forEach(clearTimeout);
    };
  }, []);
  const c = BREAK[card];
  if (!c) return null;
  return (
    <div
      key={card}
      className="tv-rise absolute bottom-[6vh] right-[3vw] max-w-[34vw] rounded-[0.8vw] bg-black/70 px-[1.8vw] py-[1.6vh] backdrop-blur"
    >
      <div className="text-[0.8vw] uppercase tracking-[0.25em] text-[#00caff]">
        Works with We’ve Got This
      </div>
      <div className="text-[2vw] font-medium">{c.name}</div>
      <div className="text-[1.1vw] text-white/80">{c.line}</div>
    </div>
  );
}
