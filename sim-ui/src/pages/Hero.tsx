import { useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * The landing page, led by pictures: one big photo that says what it is about, then
 * a photo per kind of family as you scroll, a few words each, and the way into the simulation.
 * Free Pexels photos of models, credited at the foot; none of them is a real user.
 */

const ACCENT = '#0f766e';

const STORIES = [
  {
    src: '/people/wheelchair.jpg',
    alt: 'A young man pushes an older person in a wheelchair down a street',
    title: 'The ride nobody offered.',
    body: 'Alexa hears about the appointment, sees it needs a ride, and asks the person who is free.',
    pos: 'center',
  },
  {
    src: '/people/alone.jpg',
    alt: 'A grandmother knits in an armchair beside her granddaughter',
    title: 'What today holds, on the TV.',
    body: 'Lunch, the medicine, someone there tonight: who is coming, and what is done. Nobody has to keep it all in their head.',
    pos: 'center 30%',
  },
  {
    src: '/people/special.jpg',
    alt: 'A mother and her daughter, who has Down syndrome, finger painting at a table',
    title: 'Shared, never assigned.',
    body: 'Therapy runs, pickups, refills. Nothing is anyone’s job until they say yes.',
    pos: 'center 35%',
  },
];

const STEPS = [
  ['Someone says it', '“Dad’s eye check-up is Thursday at ten.”'],
  ['It notices', 'He will need a ride, and nobody has it yet.'],
  ['It asks, never assigns', 'The right person says yes, and everyone can see it.'],
  [
    'Far away? Order it in',
    'A brother abroad orders lunch wherever he already shops, and someone nearby takes it in.',
  ],
];

const CREDITS = [
  ['Kampus Production', 'https://www.pexels.com/photo/7551686/'],
  ['RDNE Stock project', 'https://www.pexels.com/photo/6646919/'],
  ['Alex Green', 'https://www.pexels.com/photo/5692181/'],
  ['Antoni Shkraba', 'https://www.pexels.com/photo/6288114/'],
];

const VIDEO_ID = 'MiZ5TYDT6jM';

/** The demo video. YouTube loads only on a click, so the page stays fast and nobody is tracked
 *  just for visiting. */
function Video() {
  const [playing, setPlaying] = useState(false);
  return (
    <section id="video" className="mx-auto max-w-5xl px-6 py-16 md:px-10 md:py-24">
      <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
        The story in three minutes
      </h2>
      <div className="relative mt-8 aspect-video w-full overflow-hidden rounded-3xl bg-black">
        {playing ? (
          <iframe
            className="absolute inset-0 h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&rel=0`}
            title="We’ve Got This demo video"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="group absolute inset-0 h-full w-full"
            aria-label="Play the We’ve Got This demo video"
          >
            <img
              src={`https://i.ytimg.com/vi/${VIDEO_ID}/maxresdefault.jpg`}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover opacity-90 transition group-hover:opacity-100"
            />
            <span className="absolute inset-0 m-auto flex h-20 w-20 items-center justify-center rounded-full bg-white/95 shadow-lg transition group-hover:scale-105">
              <svg viewBox="0 0 24 24" className="ml-1 h-8 w-8" fill={ACCENT} aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </button>
        )}
      </div>
    </section>
  );
}

const button =
  'inline-flex items-center rounded-full px-7 py-3.5 text-[0.95rem] font-semibold transition hover:-translate-y-0.5';

export default function Hero() {
  return (
    <div className="min-h-screen bg-[#f6f4ef] text-[#16181d] antialiased">
      {/* ---------- The picture that says what it is ---------- */}
      <section className="relative h-[100svh] min-h-[560px] w-full overflow-hidden">
        <img
          src="/people/parent.jpg"
          alt="Two adults help an older man stand up from his bed"
          className="absolute inset-0 h-full w-full object-cover object-[70%_30%] md:object-[right_30%]"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/55 to-black/0" />

        <header className="relative z-10 mx-auto flex max-w-6xl items-center px-6 py-5 text-white md:px-10">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            We’ve Got This
          </Link>
          <nav className="ml-auto flex items-center gap-6 text-sm text-white/85">
            <a href="#video" className="hidden hover:text-white sm:inline">
              Video
            </a>
            <a href="#how" className="hidden hover:text-white sm:inline">
              How it works
            </a>
            <a href="/docs.html" className="hidden hover:text-white sm:inline">
              Developers
            </a>
            <Link
              to="/world"
              className="rounded-full bg-white px-4 py-2 font-semibold text-[#16181d] hover:bg-white/90"
            >
              Try it
            </Link>
          </nav>
        </header>

        <div className="absolute inset-x-0 bottom-0 z-10 mx-auto max-w-6xl px-6 pb-16 text-white md:px-10 md:pb-24">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-white/75">
            For Alexa+ · for families looking after a parent
          </p>
          <h1 className="mt-4 max-w-2xl text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
            Nothing is anyone’s job until they say yes.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-white/85">
            It notices the care nobody has taken on yet, and asks the right person.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/world" className={`${button} bg-white text-[#16181d]`}>
              Play a family’s week →
            </Link>
            <Link
              to="/setup"
              className={`${button} border border-white/40 text-white hover:bg-white/10`}
            >
              Set up your own family
            </Link>
            <Link
              to="/console"
              className={`${button} border border-white/40 text-white hover:bg-white/10`}
            >
              Open the console
            </Link>
          </div>
        </div>
      </section>

      <Video />

      {/* ---------- A picture per family, a few words each ---------- */}
      {STORIES.map((s, i) => (
        <section
          key={s.src}
          className="mx-auto grid max-w-6xl items-center gap-8 px-6 py-16 md:grid-cols-5 md:gap-14 md:px-10 md:py-24"
        >
          <img
            src={s.src}
            alt={s.alt}
            loading="lazy"
            style={{ objectPosition: s.pos }}
            className={`aspect-[4/3] w-full rounded-3xl object-cover md:col-span-3 ${i % 2 ? 'md:order-2' : ''}`}
          />
          <div className="md:col-span-2">
            <h2 className="text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
              {s.title}
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-[#4b5058]">{s.body}</p>
          </div>
        </section>
      ))}

      {/* ---------- How it works, in four lines ---------- */}
      <section id="how" className="border-t border-black/10 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-20 md:px-10 md:py-28">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">How it works</h2>
          <ol className="mt-12 grid gap-10 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(([t, b], i) => (
              <li key={t}>
                <div className="text-sm font-semibold" style={{ color: ACCENT }}>
                  0{i + 1}
                </div>
                <div className="mt-2 text-xl font-semibold">{t}</div>
                <p className="mt-2 leading-relaxed text-[#4b5058]">{b}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------- Where it came from, and the way in ---------- */}
      <section className="mx-auto max-w-3xl px-6 py-20 text-center md:py-28">
        <p className="text-2xl font-medium leading-snug tracking-tight md:text-3xl">
          “I built it for my dad, home from eye surgery, with all of us at work.”
        </p>
        <p className="mt-4 text-[#4b5058]">The builder’s family uses it now.</p>
        <Link
          to="/world"
          className={`${button} mt-10 text-white`}
          style={{ backgroundColor: ACCENT }}
        >
          Try the simulation →
        </Link>
        <p className="mt-3 text-sm text-[#6b7078]">
          Type, speak, or send a voice note. Or{' '}
          <Link to="/setup" className="underline hover:text-[#16181d]">
            set up your own family
          </Link>
          .
        </p>
      </section>

      <footer className="border-t border-black/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-8 text-sm text-[#6b7078] md:px-10">
          <span className="font-semibold text-[#16181d]">We’ve Got This</span>
          <Link to="/world" className="hover:text-[#16181d]">
            Simulation
          </Link>
          <Link to="/setup" className="hover:text-[#16181d]">
            Set up
          </Link>
          <Link to="/console" className="hover:text-[#16181d]">
            Console
          </Link>
          <Link to="/tv" className="hover:text-[#16181d]">
            Fire TV
          </Link>
          <a href="/docs.html" className="hover:text-[#16181d]">
            Developers
          </a>
          <span className="w-full text-xs">
            Stock photos of models, not real users, from Pexels:{' '}
            {CREDITS.map(([n, h], i) => (
              <span key={n}>
                {i > 0 && ', '}
                <a href={h} target="_blank" rel="noreferrer" className="underline">
                  {n}
                </a>
              </span>
            ))}
            .
          </span>
        </div>
      </footer>
    </div>
  );
}
