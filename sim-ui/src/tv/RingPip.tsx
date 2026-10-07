import './tv.css';

/**
 * The doorbell's live view, in the corner of whatever is on.
 *
 * On Fire TV in the US and Canada, a Ring doorbell press opens a picture-in-picture of the
 * door camera over the programme, which keeps playing. This is our drawing of that moment,
 * not Ring's video: a figure walks up to a door. What it says is only what a doorbell can
 * know, that a person is there. Never who.
 */
export function RingPip({ dark }: { dark: boolean }) {
  return (
    <div className="tv-pip absolute right-[2.5vw] top-[4vh] z-20 w-[30vw] overflow-hidden rounded-[0.8vw] border border-white/25 bg-black shadow-[0_2vw_5vw_rgba(0,0,0,0.6)]">
      <div className="relative aspect-video">
        <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
          <defs>
            <radialGradient id="porch" cx="0.5" cy="0.15" r="0.75">
              <stop offset="0" stopColor={dark ? '#f6d9a0' : '#ffffff'} stopOpacity={dark ? 0.55 : 0.2} />
              <stop offset="1" stopColor="#000" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="fisheye" cx="0.5" cy="0.5" r="0.75">
              <stop offset="0.55" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.85" />
            </radialGradient>
          </defs>
          {/* Looking out from the door: the path, the gate, the street beyond. */}
          <rect width="160" height="90" fill={dark ? '#1b2026' : '#7f8a80'} />
          <rect width="160" height="38" fill={dark ? '#0b1020' : '#a9c6de'} />
          <path d="M0 38 H160 V44 H0 Z" fill={dark ? '#262b26' : '#5f7a52'} />
          <path d="M62 90 L74 40 H86 L98 90 Z" fill={dark ? '#3a3a3a' : '#b8b0a2'} />
          <g stroke={dark ? '#4a4a4a' : '#40463c'} strokeWidth="1.2">
            {Array.from({ length: 9 }, (_, k) => <line key={k} x1={8 + k * 6} y1="30" x2={8 + k * 6} y2="44" />)}
            {Array.from({ length: 9 }, (_, k) => <line key={`r${k}`} x1={104 + k * 6} y1="30" x2={104 + k * 6} y2="44" />)}
          </g>
          {dark && <circle cx="130" cy="14" r="2" fill="#f4ecd0" opacity="0.7" />}
          {/* Someone walks up the path and stops at the door. */}
          <g className="tv-walk">
            <ellipse cx="80" cy="86" rx="13" ry="2.5" fill="#000" opacity="0.35" />
            <path d="M66 90 Q66 58 80 55 Q94 58 94 90 Z" fill={dark ? '#2b3440' : '#334155'} />
            <circle cx="80" cy="44" r="10" fill={dark ? '#3a2b22' : '#4a3426'} />
            <rect x="88" y="66" width="10" height="13" rx="1.5" fill={dark ? '#cfc6b0' : '#e8e0c8'} opacity="0.85" />
          </g>
          <rect width="160" height="90" fill="url(#porch)" />
          <rect width="160" height="90" fill="url(#fisheye)" />
        </svg>
        <div className="tv-grain pointer-events-none absolute inset-0" />
        <div className="absolute left-[0.8vw] top-[0.8vh] flex items-center gap-[0.5vw] rounded-[0.3vw] bg-black/55 px-[0.6vw] py-[0.2vh] text-[1vw] font-semibold text-white">
          <span className="h-[0.6vw] w-[0.6vw] rounded-full bg-[#ff3b3b] tv-flicker" /> LIVE · Front Door
        </div>
        <div className="absolute right-[0.8vw] top-[0.8vh] rounded-[0.3vw] bg-black/55 px-[0.6vw] py-[0.2vh] text-[0.9vw] text-white/75">Ring</div>
      </div>
      <div className="flex items-center justify-between gap-[1vw] bg-[#0d1424] px-[1vw] py-[1vh]">
        <span className="text-[1.25vw] font-medium text-white">A person is at your Front Door</span>
        <span className="shrink-0 text-[0.95vw] text-white/55"><kbd className="rounded border border-white/40 px-[0.3vw]">BACK</kbd> to close</span>
      </div>
    </div>
  );
}
