import { useEffect, useState } from 'react';
import './tv.css';

/**
 * Whatever is on. A person cared for spends a lot of the day in front of the set, and the
 * honest picture of a Fire TV in their home is a programme playing, not a care dashboard.
 * So in the world the set is showing something, and CareCircle arrives over it the way
 * Alexa and a Ring doorbell really do on Fire TV: the programme keeps playing underneath.
 *
 * Every programme here is drawn from shapes and original lines. Nothing is recorded,
 * borrowed, or named after a real channel or show.
 */

export type Region = 'ng' | 'us';

/** Which side of the world a household's zone is in, for what is on its television. */
export function regionOf(timeZone: string): Region {
  return timeZone.startsWith('America/') ? 'us' : 'ng';
}

/** Lines that change on a timer, the way subtitles and headlines do. */
function useCycle(n: number, ms: number): number {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1) % n), ms);
    return () => clearInterval(id);
  }, [n, ms]);
  return i;
}

/** `raised`: something is along the bottom of the screen, so captions step up out of its way. */
export function Show({
  region,
  hour,
  raised = false,
}: {
  region: Region;
  hour: number;
  raised?: boolean;
}) {
  if (hour >= 17 || hour < 4)
    return region === 'us' ? <GameShow raised={raised} /> : <FamilyDrama raised={raised} />;
  return <NewsDesk region={region} afternoon={hour >= 12} />;
}

// ---- the morning news --------------------------------------------------------

const HEADLINES: Record<Region, string[]> = {
  ng: [
    'Showers expected across the south-west by afternoon',
    'Commuters advised to leave early as roadworks continue',
    'Local football: home side through to the semi-final',
    'Market prices steady ahead of the weekend',
  ],
  us: [
    'Cool and clear this morning, warming to 64 by afternoon',
    'Delays on the interstate after an early-morning lane closure',
    'High school team heads to the state final this weekend',
    'City council meets tonight on the new library hours',
  ],
};

const TICKER: Record<Region, string> = {
  ng: 'WEATHER  Humid, 29°, showers later   •   TRAFFIC  Slow on the expressway into the city   •   SPORT  Home side wins 2–1   •   BUSINESS  Markets open as usual   •   ',
  us: 'WEATHER  54° now, high of 64   •   TRAFFIC  Lane closed on the interstate southbound   •   SPORTS  Final score 27–20   •   COMMUNITY  Farmers market open Saturday 8 to noon   •   ',
};

function NewsDesk({ region, afternoon }: { region: Region; afternoon: boolean }) {
  const i = useCycle(HEADLINES[region].length, 7000);
  const skin = region === 'ng' ? ['#6b4429', '#8a5a3b'] : ['#e0b48f', '#6b4429'];
  return (
    <div className="tv-show bg-[#0a1a3a]">
      <div className="tv-push">
        {/* Studio: a city through the glass behind the desk. */}
        <svg
          viewBox="0 0 160 90"
          preserveAspectRatio="xMidYMid slice"
          className="absolute inset-0 h-full w-full"
        >
          <defs>
            <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={afternoon ? '#4f8fd6' : '#f3a76b'} />
              <stop offset="1" stopColor={afternoon ? '#b9dcf5' : '#ffd9a8'} />
            </linearGradient>
            <linearGradient id="desk" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#1d3d78" />
              <stop offset="1" stopColor="#0b1b3c" />
            </linearGradient>
          </defs>
          <rect width="160" height="90" fill="url(#sky)" />
          <g fill="#2b4b7e" opacity="0.75">
            {[
              [4, 34, 12],
              [18, 26, 9],
              [29, 40, 14],
              [45, 22, 10],
              [57, 30, 16],
              [75, 18, 11],
              [88, 36, 13],
              [103, 24, 9],
              [114, 32, 15],
              [131, 20, 10],
              [143, 38, 14],
            ].map(([x, h, w]) => (
              <rect key={x} x={x} y={62 - h!} width={w} height={h! + 20} />
            ))}
          </g>
          {/* Window mullions, so it reads as a studio and not a sky. */}
          <g stroke="#0a1a3a" strokeWidth="1.4" opacity="0.6">
            <line x1="40" y1="0" x2="40" y2="62" />
            <line x1="80" y1="0" x2="80" y2="62" />
            <line x1="120" y1="0" x2="120" y2="62" />
          </g>
          <rect y="58" width="160" height="32" fill="#0d2350" />
          {/* Two presenters at the desk. */}
          <g className="tv-bob">
            <path d="M44 74 Q44 58 56 57 Q68 58 68 74 Z" fill="#7a1f2b" />
            <circle cx="56" cy="49" r="7" fill={skin[0]} />
            <path
              d="M48.5 47 Q49 40 56 40 Q63 40 63.5 47 Q60 43 56 43.5 Q52 43 48.5 47 Z"
              fill="#1b120c"
            />
            <rect
              className="tv-talk"
              x="54.4"
              y="52.6"
              width="3.2"
              height="1.2"
              rx="0.6"
              fill="#3b1a12"
            />
          </g>
          <g className="tv-bob late">
            <path d="M92 74 Q92 58 104 57 Q116 58 116 74 Z" fill="#20314f" />
            <path d="M101 57 L104 64 L107 57 Z" fill="#e8eef8" />
            <circle cx="104" cy="49" r="7" fill={skin[1]} />
            <path
              d="M97 46 Q98 41 104 41 Q110 41 111 46 Q107 44 104 44 Q100 44 97 46 Z"
              fill="#20140d"
            />
          </g>
          <path d="M18 70 H142 L136 90 H24 Z" fill="url(#desk)" />
          <rect x="18" y="69" width="124" height="1.6" fill="#5fa8ff" opacity="0.8" />
        </svg>
      </div>

      {/* Channel bug. */}
      <div className="absolute right-[3vw] top-[3.5vh] flex items-center gap-[0.6vw] rounded-[0.4vw] bg-black/35 px-[0.8vw] py-[0.4vh] text-[1.2vw] font-bold tracking-wide text-white/85">
        <span className="h-[0.7vw] w-[0.7vw] rounded-full bg-[#ff3b3b] tv-flicker" /> LIVE · CH 4
      </div>

      {/* Lower third and ticker. */}
      <div className="absolute inset-x-0 bottom-[6.5vh] flex items-stretch">
        <div className="flex items-center bg-[#c8102e] px-[1.6vw] text-[1.5vw] font-extrabold uppercase tracking-wide text-white">
          {afternoon ? 'The afternoon' : 'The morning desk'}
        </div>
        <div
          key={i}
          className="tv-sub flex flex-1 items-center bg-white/95 px-[1.6vw] py-[1.1vh] text-[1.9vw] font-semibold text-[#0b1730]"
        >
          {HEADLINES[region][i]}
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-[6.5vh] overflow-hidden bg-[#0b1730] text-[1.5vw] font-medium leading-[6.5vh] text-white/90">
        <span className="tv-ticker">{TICKER[region].repeat(2)}</span>
      </div>
    </div>
  );
}

// ---- the evening drama (Nigeria) ---------------------------------------------

const DRAMA_LINES = [
  'Mama, you cannot keep this from your children.',
  'Who said I am keeping anything? I am fine.',
  'Fine? Since when did "fine" mean you skip the clinic?',
  'Sit down, my daughter. Let me tell you something.',
  'I am listening, Mama. I have always been listening.',
  '…your father said the same thing, the year before he travelled.',
];

function FamilyDrama({ raised }: { raised: boolean }) {
  const i = useCycle(DRAMA_LINES.length, 4200);
  return (
    <div className="tv-show bg-[#1a0f08]">
      <div className="tv-push">
        <svg
          viewBox="0 0 160 90"
          preserveAspectRatio="xMidYMid slice"
          className="absolute inset-0 h-full w-full"
        >
          <defs>
            <radialGradient id="lamp" cx="0.82" cy="0.35" r="0.6">
              <stop offset="0" stopColor="#ffcc7a" stopOpacity="0.85" />
              <stop offset="1" stopColor="#ffcc7a" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="wall" x1="0" x2="1">
              <stop offset="0" stopColor="#4a2a18" />
              <stop offset="1" stopColor="#7a4a26" />
            </linearGradient>
          </defs>
          <rect width="160" height="90" fill="url(#wall)" />
          {/* Night through the window, a curtain, a framed photograph. */}
          <rect x="14" y="12" width="34" height="30" fill="#0e1a3a" />
          <circle cx="40" cy="20" r="2.4" fill="#f4ecd0" opacity="0.8" />
          <path d="M12 10 H24 Q20 30 24 46 H12 Z" fill="#8e2a2a" />
          <rect
            x="70"
            y="14"
            width="14"
            height="17"
            fill="#2a1a10"
            stroke="#c9a46a"
            strokeWidth="0.8"
          />
          <rect x="72.5" y="16.5" width="9" height="12" fill="#5a3c28" />
          <rect width="160" height="90" fill="url(#lamp)" />
          {/* Sofa. */}
          <path d="M8 62 Q8 52 18 52 H92 Q102 52 102 62 V80 H8 Z" fill="#3b5a3a" />
          {/* Mama, seated, in a head-tie. */}
          <g className="tv-bob">
            <path d="M34 80 Q32 58 46 56 Q60 58 58 80 Z" fill="#d06a1c" />
            <path d="M38 64 Q46 70 54 64 L55 70 Q46 75 37 70 Z" fill="#f2c14e" opacity="0.8" />
            <circle cx="46" cy="47" r="6.5" fill="#5a3520" />
            {/* Gele: the wrap over the head, and its knot standing up behind. */}
            <path d="M47 38 Q52 26 60 31 Q58 37 52 40 Z" fill="#d06a1c" />
            <path
              d="M38.6 46 Q37 35.5 46 34.5 Q55.5 34 53.8 45 Q50 41.2 46 41.2 Q42 41.2 38.6 46 Z"
              fill="#f2c14e"
            />
            <path d="M39 42.5 Q46 38.5 53.5 42" stroke="#d06a1c" strokeWidth="0.9" fill="none" />
          </g>
          {/* Her daughter, standing. */}
          <g className="tv-bob late">
            <path d="M112 90 L114 58 Q122 52 130 58 L132 90 Z" fill="#2d4f8a" />
            <circle cx="122" cy="47" r="6.5" fill="#6b4029" />
            <path
              d="M114.5 46 Q114 37 122 37 Q130 37 129.5 46 Q131 42 129 39 Q124 33 117 37 Q113.5 41 114.5 46 Z"
              fill="#160d08"
            />
            <rect
              className="tv-talk"
              x="120.4"
              y="50.6"
              width="3.2"
              height="1.1"
              rx="0.5"
              fill="#3b1a12"
            />
          </g>
          {/* Floor lamp. */}
          <rect x="138" y="30" width="1.4" height="58" fill="#2a1a10" />
          <path d="M132 22 H146 L143 31 H135 Z" fill="#f6dba0" />
          <rect y="80" width="160" height="10" fill="#2a170c" />
        </svg>
      </div>
      <div className="absolute left-[3vw] top-[3.5vh] rounded-[0.4vw] bg-black/30 px-[0.8vw] py-[0.3vh] text-[1.15vw] font-bold tracking-[0.2em] text-[#f2c14e]/90">
        HOME TRUTHS · EP 14
      </div>
      <div
        className={`absolute inset-x-0 flex justify-center px-[10vw] transition-all duration-500 ${raised ? 'bottom-[26vh]' : 'bottom-[8vh]'}`}
      >
        <div
          key={i}
          className="tv-sub rounded-[0.3vw] bg-black/60 px-[1.2vw] py-[0.6vh] text-center text-[2.1vw] font-medium leading-snug text-white"
        >
          {DRAMA_LINES[i]}
        </div>
      </div>
    </div>
  );
}

// ---- the evening game show (United States) -----------------------------------

const PUZZLE = 'ONE DAY AT A TIME';
const ORDER = [...PUZZLE]
  .map((c, i) => [c, i] as const)
  .filter(([c]) => c !== ' ')
  .map(([, i]) => i)
  .sort((a, b) => ((a * 7) % 11) - ((b * 7) % 11));
const HOST_LINES = [
  "Diane, it's your turn. Pick a letter.",
  "There are two T's!",
  'Ray, do you want to solve?',
  "Folks, we'll be right back after this.",
];

function GameShow({ raised }: { raised: boolean }) {
  const [shown, setShown] = useState(4);
  useEffect(() => {
    const id = setInterval(() => setShown((n) => (n >= ORDER.length + 3 ? 4 : n + 1)), 1600);
    return () => clearInterval(id);
  }, []);
  const open = new Set(ORDER.slice(0, Math.min(shown, ORDER.length)));
  const line = useCycle(HOST_LINES.length, 4800);
  const words = PUZZLE.split(' ');
  let at = 0;
  return (
    <div className="tv-show bg-[radial-gradient(120%_90%_at_50%_10%,#3a1a7a_0%,#160a35_55%,#07031a_100%)]">
      <div className="tv-push">
        <div className="tv-beam left-[8vw]" />
        <div className="tv-beam right-[8vw]" style={{ animationDelay: '-3.5s' }} />
        <div
          className="tv-beam left-[42vw]"
          style={{ animationDelay: '-1.8s', animationDuration: '9s' }}
        />

        {/* The board. */}
        <div className="absolute left-1/2 top-[13vh] flex -translate-x-1/2 flex-wrap justify-center gap-[1.6vw] rounded-[1vw] border-[0.35vw] border-[#ffd34d] bg-[#0c3b2e] px-[2vw] py-[2.4vh] shadow-[0_0_4vw_rgba(255,211,77,0.35)]">
          {words.map((w) => {
            const start = at;
            at += w.length + 1;
            return (
              <div key={start} className="flex gap-[0.4vw]">
                {[...w].map((c, k) => (
                  <div
                    key={k}
                    className="flex h-[7vh] w-[3.6vw] items-center justify-center rounded-[0.3vw] bg-white text-[3.4vw] font-black text-[#0b1730] shadow-inner"
                  >
                    {open.has(start + k) ? c : ''}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        <div className="absolute left-1/2 top-[6vh] -translate-x-1/2 text-[1.3vw] font-bold uppercase tracking-[0.35em] text-[#ffd34d]/90">
          Category · Phrase
        </div>

        {/* Three contestants. */}
        <div className="absolute inset-x-[10vw] bottom-[9vh] flex justify-between">
          {[
            ['MARCUS', '$4,200', '#e04848'],
            ['DIANE', '$1,850', '#f2c14e'],
            ['RAY', '$3,100', '#3a8be0'],
          ].map(([n, s, c]) => (
            <div key={n} className="flex w-[20vw] flex-col items-center">
              <div className="h-[8vh] w-[8vh] rounded-full bg-[#2a1a10]/90" />
              <div
                className="w-full rounded-t-[0.6vw] py-[0.8vh] text-center text-[2vw] font-black text-white"
                style={{ background: c }}
              >
                {s}
              </div>
              <div className="w-full bg-[#0b0b1a] py-[0.6vh] text-center text-[1.3vw] font-bold tracking-[0.2em] text-white/90">
                {n}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="absolute right-[3vw] top-[3.5vh] rounded-[0.4vw] bg-black/35 px-[0.8vw] py-[0.3vh] text-[1.1vw] font-bold text-white/80">
        CH 9 · HD
      </div>
      <div
        className={`absolute inset-x-0 flex justify-center transition-all duration-500 ${raised ? 'bottom-[26vh]' : 'bottom-[2vh]'}`}
      >
        <div
          key={line}
          className="tv-sub bg-black/80 px-[1vw] py-[0.3vh] font-mono text-[1.6vw] text-white"
        >
          {HOST_LINES[line]}
        </div>
      </div>
    </div>
  );
}
