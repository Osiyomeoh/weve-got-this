import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useBoard } from '../lib/useBoard';

/**
 * The landing page: who it is for, what it does, and where to try it.
 *
 * It leads with the family and the one thing CareCircle does that nothing else does (it asks
 * the right person, and nothing is anyone's until they say yes), then sends the reader to the
 * simulation, where they can play a family's week by typing, speaking or sending a voice note.
 * The sections below are one argument, not a feature tour: the problem is shared
 * responsibility -> the hard part is not guessing -> the mechanism -> the devices as kinds of
 * evidence -> what it gives back to the protocol.
 */

const SURFACES = [
  { key: 'alexa', name: 'Alexa+', sub: 'what people say', color: '#4ea1ff', status: 'live' },
  { key: 'tv', name: 'Fire TV', sub: 'the shared screen', color: '#b46bff', status: 'built' },
  { key: 'ring', name: 'Ring', sub: 'the front door', color: '#25d3c2', status: 'simulated' },
  {
    key: 'bee',
    name: 'Bee',
    sub: 'what was overheard',
    color: '#ffb020',
    status: 'not on a device yet',
  },
] as const;

const NAV = [
  { to: '/world', label: 'Simulation' },
  { to: '/console', label: 'Console' },
  { to: '/tv', label: 'Fire TV' },
  { href: '#how', label: 'How it works' },
  { href: '/docs.html', label: 'Developers' },
] as const;

/** The conversation from the README, as it plays in the simulation. */
const TURNS: { who: string; color: string; text: string; alexa?: boolean; note?: string }[] = [
  { who: 'Daddy', color: '#ffcf70', text: 'I have my eye check-up tomorrow at ten.' },
  {
    who: 'Alexa',
    color: '#4ea1ff',
    alexa: true,
    text: 'Noted. Will Daddy need a ride to the eye check-up?',
    note: 'A guess from the appointment type, not something anyone said.',
  },
  { who: 'Tolu, his son', color: '#7cf0c8', text: "Yes. Ask whoever's free." },
  {
    who: 'Alexa',
    color: '#4ea1ff',
    alexa: true,
    text: "I've asked Funmi. It stays unowned until Funmi says yes.",
  },
  { who: 'Funmi, on her phone', color: '#b46bff', text: 'Yes, I can take him.' },
  {
    who: 'Alexa',
    color: '#4ea1ff',
    alexa: true,
    text: 'Thanks. Driving Daddy to the eye check-up is yours now.',
  },
];

const primary =
  'inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#00e0c6] to-[#3b82f6] px-6 py-3 text-[0.9375rem] font-semibold text-[#03050a] shadow-[0_10px_40px_rgba(0,224,198,0.3)] transition hover:-translate-y-0.5';
const ghost =
  'inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-6 py-3 text-[0.9375rem] font-medium text-ink backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-white/10';

function Nav({ online, gaps, owned }: { online: boolean; gaps: number; owned: number }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-6 px-6 py-3.5 md:px-10 tv:max-w-[80rem]">
        <Link to="/" className="flex items-center gap-3">
          <span className="h-7 w-7 shrink-0 rounded-full bg-[conic-gradient(from_200deg,#00e0c6,#3b82f6,#8b5cf6,#00e0c6)] p-[3px]">
            <span className="block h-full w-full rounded-full bg-bg" />
          </span>
          <b className="text-lg tracking-tight">CareCircle</b>
          <span className="hidden whitespace-nowrap rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[0.6875rem] font-medium text-white/70 sm:inline">
            for Alexa+
          </span>
        </Link>
        <nav className="ml-4 hidden items-center gap-5 text-[0.8125rem] font-medium text-muted lg:flex">
          {NAV.map((n) =>
            'to' in n ? (
              <Link key={n.label} to={n.to} className="transition hover:text-ink">
                {n.label}
              </Link>
            ) : (
              <a key={n.label} href={n.href} className="transition hover:text-ink">
                {n.label}
              </a>
            ),
          )}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <div
            className="hidden items-center gap-2 whitespace-nowrap text-[0.75rem] text-muted md:flex"
            title="The demo family's care board on the live server"
          >
            <span
              className={`h-2 w-2 rounded-full ${online ? 'bg-confirmed' : 'bg-sevHigh'} animate-beat`}
            />
            {online ? (
              <span>
                server live · <b className="text-ink">{gaps}</b> open ·{' '}
                <b className="text-ink">{owned}</b> owned
              </span>
            ) : (
              <span>server offline</span>
            )}
          </div>
          <Link
            to="/world"
            className="rounded-full bg-ink px-4 py-2 text-[0.8125rem] font-semibold text-bg transition hover:bg-white"
          >
            Try the simulation
          </Link>
        </div>
      </div>
    </header>
  );
}

function Conversation() {
  return (
    <div className="glass w-full max-w-md rounded-3xl p-5 shadow-card md:p-6">
      <div className="mb-4 flex items-center justify-between text-[0.6875rem] uppercase tracking-[0.16em] text-muted">
        <span>A family, one evening</span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-alexa" /> Alexa+ with CareCircle
        </span>
      </div>
      <ol className="space-y-3">
        {TURNS.map((t, i) => (
          <li
            key={i}
            className={`animate-rise ${t.alexa ? 'pr-6' : 'pl-6 text-right'}`}
            style={{ animationDelay: `${0.15 + i * 0.12}s` }}
          >
            <div className="text-[0.6875rem] font-semibold" style={{ color: t.color }}>
              {t.who}
            </div>
            <div
              className={`mt-1 inline-block rounded-2xl px-3.5 py-2 text-left text-[0.875rem] leading-snug ${
                t.alexa ? 'bg-[#13203a] text-ink' : 'bg-white/[0.06] text-[#dfe5f2]'
              }`}
            >
              {t.text}
              {t.note && <div className="mt-1 text-[0.75rem] italic text-inferred">{t.note}</div>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// --- page furniture -------------------------------------------------------

function Section({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-20 md:px-10 md:py-28 tv:max-w-[80rem]">
      <div className="text-[0.75rem] uppercase tracking-[0.22em] text-muted">{eyebrow}</div>
      <h2 className="mt-4 max-w-3xl text-3xl font-semibold leading-[1.12] tracking-tight md:text-5xl">
        {title}
      </h2>
      {lead && (
        <p className="mt-6 max-w-2xl text-[0.9375rem] leading-relaxed text-[#c3cad9] md:text-lg">
          {lead}
        </p>
      )}
      {children}
    </section>
  );
}

/**
 * A cited number, and the specific thing CareCircle does about it.
 *
 * The pairing is the point: a statistic with no mechanism beside it is
 * decoration, and a mechanism with no evidence behind it is a claim.
 */
function Evidence({
  figure,
  of,
  source,
  href,
  mechanism,
}: {
  figure: string;
  of: string;
  source: string;
  href: string;
  mechanism: string;
}) {
  return (
    <div className="glass flex flex-col rounded-3xl p-6">
      <div className="text-4xl font-semibold tracking-tight text-ink md:text-5xl">{figure}</div>
      <div className="mt-3 text-[0.9375rem] leading-relaxed text-[#c3cad9]">{of}</div>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="mt-3 text-[0.75rem] text-muted underline decoration-line underline-offset-4 transition hover:text-ink"
      >
        {source}
      </a>
      <div className="mt-5 border-t border-line pt-5 text-[0.875rem] leading-relaxed text-ink">
        <span className="text-[0.6875rem] uppercase tracking-[0.14em] text-core">
          What CareCircle does
        </span>
        <div className="mt-2 text-[#c3cad9]">{mechanism}</div>
      </div>
    </div>
  );
}

function Step({ n, name, body }: { n: string; name: string; body: string }) {
  return (
    <div className="glass rounded-3xl p-6">
      <div className="text-[0.75rem] tracking-[0.2em] text-muted">{n}</div>
      <div className="mt-3 text-lg font-semibold text-ink">{name}</div>
      <p className="mt-2 text-[0.875rem] leading-relaxed text-[#c3cad9]">{body}</p>
    </div>
  );
}

export default function Hero() {
  const { state, online } = useBoard();
  const gaps = state?.gaps?.length ?? 0;
  const owned = (state?.obligations ?? []).filter((o) => o.status === 'ASSIGNED').length;

  return (
    <div className="min-h-screen w-full bg-bg">
      <Nav online={online} gaps={gaps} owned={owned} />

      {/* ---------- 1. Who it is for, and what it does ---------- */}
      <div className="relative w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-40 -top-40 h-[36rem] w-[36rem] rounded-full bg-[#1b4dff]/20 blur-[120px]" />
          <div className="absolute -bottom-48 right-0 h-[32rem] w-[32rem] rounded-full bg-[#00e0c6]/10 blur-[120px]" />
        </div>
        <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-6 py-16 md:px-10 md:py-24 lg:grid-cols-[1.15fr_1fr] tv:max-w-[80rem]">
          <div className="animate-rise">
            <div className="mb-4 text-[0.8125rem] uppercase tracking-[0.16em] text-muted">
              An Alexa+ add-on for families looking after a parent
            </div>
            <h1 className="text-4xl font-semibold leading-[1.06] tracking-tight md:text-6xl">
              Nothing is anyone&rsquo;s job{' '}
              <span className="bg-gradient-to-r from-core to-alexa bg-clip-text text-transparent">
                until they say yes.
              </span>
            </h1>
            <p className="mt-6 max-w-xl text-[0.9375rem] leading-relaxed text-[#c3cad9] md:text-lg">
              CareCircle notices the care nobody has taken on yet, like the ride to Dad&rsquo;s eye
              check-up, and asks the person who has room. It never assigns, and it never turns a
              missing record into blame.
            </p>
            <p className="mt-4 max-w-xl text-[0.875rem] leading-relaxed text-muted">
              Built in Lagos for the builder&rsquo;s own dad: going on 70, home from eye surgery,
              with all his children at work. The family uses it now.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/world" className={primary}>
                Play a family&rsquo;s week →
              </Link>
              <Link to="/console" className={ghost}>
                Open the console
              </Link>
            </div>
            <p className="mt-3 text-[0.75rem] text-muted">
              In your browser. Type, speak, or send a voice note. No sign-up.
            </p>
          </div>
          <div className="flex justify-center lg:justify-end">
            <Conversation />
          </div>
        </div>
        <div className="relative mx-auto flex w-full max-w-6xl flex-wrap gap-2.5 px-6 pb-12 md:px-10 tv:max-w-[80rem]">
          {SURFACES.map((s) => (
            <div
              key={s.key}
              className="flex items-center gap-2.5 rounded-full border border-white/10 bg-white/5 px-3.5 py-2 text-[0.8125rem] backdrop-blur-xl"
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
              <span className="font-semibold text-ink">{s.name}</span>
              <span className="text-muted">{s.sub}</span>
              <span
                className={`ml-1 rounded-full border border-line px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wider ${s.status === 'live' ? 'text-core' : 'text-muted'}`}
              >
                {s.status}
              </span>
            </div>
          ))}
        </div>
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-1 opacity-70 animate-sweep-slow"
          style={{
            background: 'linear-gradient(90deg,#3b82f6,#00e0c6,#8b5cf6,#3b82f6)',
            backgroundSize: '200% 100%',
          }}
        />
      </div>

      {/* ---------- The simulation ---------- */}
      <div className="border-t border-line bg-[#0a0e18]">
        <Section
          eyebrow="Try it"
          title={<>Play one family&rsquo;s week, on the real server.</>}
          lead={
            <>
              Pick who you are: the son across town, Daddy after surgery, or the family driver. The
              others are played for you. Everything you say goes to the same Alexa+ planner and MCP
              server a real family uses, on your own throwaway copy of their record.
            </>
          }
        >
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            <Step
              n="TYPE"
              name="Say it your own way"
              body="Each turn suggests a line. Change it, refuse, or stay quiet, and the day goes differently."
            />
            <Step
              n="SPEAK"
              name="Talk to it"
              body="Tap Speak and talk, the way you would to an Echo. Amazon Transcribe hears you, and Alexa answers aloud."
            />
            <Step
              n="VOICE NOTE"
              name="Send a voice note"
              body="Hold the button and talk, as you would in a family chat. Play it back, see what was heard, then send it."
            />
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/world" className={primary}>
              Start the simulation →
            </Link>
            <Link to="/tv" className={ghost}>
              The Fire TV screen
            </Link>
          </div>
        </Section>
      </div>

      {/* ---------- 2. The problem, with its evidence ---------- */}
      <div id="problem" className="border-t border-line">
        <Section
          eyebrow="The problem"
          title={
            <>
              Nobody is in charge, so the work that falls through is the work nobody realised was
              anyone&rsquo;s job.
            </>
          }
          lead={
            <>
              Family care is not one person with a checklist. It is several people with partial
              information and no shared record - and the failure mode is not that someone refuses a
              task. It is that everyone assumes someone else has it.
            </>
          }
        >
          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            <Evidence
              figure="53M"
              of="adults in the US care for an adult or child with special needs - more than one in five."
              source="AARP & National Alliance for Caregiving, Caregiving in the U.S. 2020"
              href="https://www.caregiving.org/research/caregiving-in-the-us/caregiving-in-the-us-2020/"
              mechanism="CareCircle models the household, not the patient - several people with different authority over one shared record."
            />
            <Evidence
              figure="53%"
              of="of caregivers say someone else also provides unpaid help to the same person."
              source="AARP & NAC, Caregiving in the U.S. 2020"
              href="https://www.caregiving.org/research/caregiving-in-the-us/caregiving-in-the-us-2020/"
              mechanism="Ownership is the primitive. Every obligation has exactly one owner, or is visibly unowned - which is the thing a Care Gap actually measures."
            />
            <Evidence
              figure="58%"
              of="of caregivers perform medical or nursing tasks, including managing medications."
              source="AARP & NAC, Caregiving in the U.S. 2020"
              href="https://www.caregiving.org/research/caregiving-in-the-us/caregiving-in-the-us-2020/"
              mechanism="The Care Gap engine checks expected doses against what was actually recorded, and ranks what is unowned by expected harm."
            />
            <Evidence
              figure="~50%"
              of="average adherence to long-term therapy for chronic illness in developed countries."
              source="WHO, Adherence to Long-Term Therapies: Evidence for Action (2003)"
              href="https://www.paho.org/en/documents/who-adherence-long-term-therapies-evidence-action-2003"
              mechanism="A dose with no record is surfaced as a question for the family, never as a claim that it was missed."
            />
          </div>
        </Section>
      </div>

      {/* ---------- 3. The proof ---------- */}
      <div className="border-t border-line bg-gradient-to-b from-transparent to-[#0a0e18]">
        <Section
          eyebrow="Why it can be trusted"
          title={<>Known is not Assumed - and we measured what that is worth.</>}
          lead={
            <>
              Ask a language model whether Mom took her heart pill when the log simply has no entry,
              and it will often tell you she didn&rsquo;t. That is not a wording problem. In a house
              where someone is ill, it is an accusation aimed at whoever was supposed to be there.
            </>
          }
        >
          <div className="mt-12 grid items-stretch gap-5 lg:grid-cols-3">
            <div className="glass rounded-2xl p-7">
              <div className="text-[0.75rem] uppercase tracking-[0.18em] text-muted">
                Raw Claude Sonnet 4.5
              </div>
              <div className="mt-4 text-6xl font-semibold tracking-tight text-sevHigh">50%</div>
              <p className="mt-4 text-[0.875rem] leading-relaxed text-[#c3cad9]">
                In <b className="text-ink">6 of 12</b> scenarios the same model CareCircle plans
                with asserted the accusation outright - &ldquo;she missed it&rdquo;, &ldquo;she
                hasn&rsquo;t taken it&rdquo; - from a record that only ever said nothing.
              </p>
            </div>

            <div className="glass rounded-2xl p-7">
              <div className="text-[0.75rem] uppercase tracking-[0.18em] text-muted">
                CareCircle
              </div>
              <div className="mt-4 text-6xl font-semibold tracking-tight text-confirmed">0%</div>
              <p className="mt-4 text-[0.875rem] leading-relaxed text-[#c3cad9]">
                Same scenarios. The deterministic engine can only report what it has:
                <b className="text-ink"> &ldquo;there&rsquo;s no record of it.&rdquo;</b> The model
                never gets to narrate the gap - it only speaks the line the engine produced.
              </p>
            </div>

            <div className="glass flex flex-col rounded-2xl p-7">
              <div className="text-[0.75rem] uppercase tracking-[0.18em] text-muted">
                Check it yourself
              </div>
              <p className="mt-4 text-[0.875rem] leading-relaxed text-[#c3cad9]">
                Every answer in the benchmark is printed and auditable. It is a script in the repo,
                not a screenshot.
              </p>
              <code className="mt-auto block rounded-xl border border-line bg-black/40 px-4 py-3 font-mono text-[0.8125rem] text-core">
                npm run trust-benchmark
              </code>
            </div>
          </div>

          <p className="mt-8 max-w-3xl text-[0.875rem] leading-relaxed text-muted">
            Inference proposes, humans dispose. Work the system infers - a ride to an eye check-up,
            say - enters as <b className="text-ink">PROPOSED</b> and is excluded from Care Gaps
            entirely until a person confirms it. CareCircle is allowed to notice. It is not allowed
            to decide on the family&rsquo;s behalf.
          </p>
        </Section>
      </div>

      {/* ---------- 4. The mechanism ---------- */}
      <div id="how" className="border-t border-line">
        <Section
          eyebrow="How it works"
          title={<>Events become obligations. Obligations need an owner.</>}
          lead={
            <>
              Three nouns, in one direction. Everything in the system - every tool, every surface -
              is somewhere on this line.
            </>
          }
        >
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            <Step
              n="01 · EVENTS"
              name="Something is observed"
              body="Daddy says he used his eye drops. A doorbell sees a pharmacy delivery. A wearable notices he was up all night. Each carries how we came to know it."
            />
            <Step
              n="02 · OBLIGATIONS"
              name="Something is owed"
              body="An appointment implies a ride. A prescription implies a pickup. A daily dose implies a record. Inferred ones stay proposals until a human confirms them."
            />
            <Step
              n="03 · OWNERSHIP"
              name="Someone owes it"
              body="An obligation with no owner is a Care Gap, ranked by expected harm - cost x likelihood it is dropped x our confidence. Claimable by voice, or by tapping a card."
            />
          </div>
        </Section>
      </div>

      {/* ---------- 5. Four surfaces, one idea ---------- */}
      <div className="border-t border-line bg-gradient-to-b from-transparent to-[#0a0e18]">
        <Section
          eyebrow="Four surfaces, one responsibility layer"
          title={<>Not four integrations. Four kinds of evidence about one person.</>}
          lead={
            <>
              The devices around Daddy each see something the others cannot, and none of them is the
              product. MCP is the seam that lets all of it land in one record - which is why a Ring
              signal and a spoken sentence are handled by the same pipeline, with the same
              provenance rules.
            </>
          }
        >
          <div className="mt-12 grid gap-5 md:grid-cols-2">
            <div className="glass rounded-2xl p-7">
              <div className="flex items-center gap-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-alexa" />
                <span className="font-semibold text-ink">Alexa+</span>
                <span className="text-muted">· declared evidence</span>
                <span className="ml-auto rounded-md border border-line px-2 py-0.5 text-[0.625rem] uppercase tracking-wider text-core">
                  live
                </span>
              </div>
              <p className="mt-4 text-[0.875rem] leading-relaxed text-[#c3cad9]">
                What a person tells you. The MCP server itself: 25 tools, per-member identity bound
                to the session rather than to the conversation, purchase-in-place, and an
                interactive Care Board shipped as an MCP App.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link to="/console" className="btn-primary">
                  Open the console
                </Link>
                <Link to="/board" className="btn-ghost">
                  See the care board
                </Link>
              </div>
            </div>

            <div className="glass rounded-2xl p-7">
              <div className="flex items-center gap-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-tv" />
                <span className="font-semibold text-ink">Fire TV</span>
                <span className="text-muted">· the shared display</span>
                <span className="ml-auto rounded-md border border-line px-2 py-0.5 text-[0.625rem] uppercase tracking-wider text-muted">
                  built
                </span>
              </div>
              <p className="mt-4 text-[0.875rem] leading-relaxed text-[#c3cad9]">
                The most valuable moment is not a conversation - it is someone walking past the
                living room and noticing Thursday still has no driver. Real React Native, the same
                screen on a TV and on the web.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link to="/tv" className="btn-primary">
                  Watch the ambient screen
                </Link>
                <a href="/tv-native/" className="btn-ghost">
                  The native build
                </a>
              </div>
            </div>

            <div className="glass rounded-2xl p-7">
              <div className="flex items-center gap-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-ring" />
                <span className="font-semibold text-ink">Ring</span>
                <span className="text-muted">· physical evidence</span>
                <span className="ml-auto rounded-md border border-line px-2 py-0.5 text-[0.625rem] uppercase tracking-wider text-muted">
                  seam
                </span>
              </div>
              <p className="mt-4 text-[0.875rem] leading-relaxed text-[#c3cad9]">
                A delivery arrived; nobody said so. The adapter is real code against the shape of
                Ring&rsquo;s webhook, and it does what every signal does here - proposes an
                <b className="text-ink"> INFERRED</b> obligation a human still has to confirm. We
                are honest that it is a seam, not a live partnership.
              </p>
            </div>
          </div>
        </Section>
      </div>

      {/* ---------- 6. What it gives back ---------- */}
      <div className="border-t border-line">
        <Section
          eyebrow="The protocol"
          title={<>Built on MCP, and built back into it.</>}
          lead={
            <>
              A server this shape runs into the edges of the protocol, and the useful thing to do
              with an edge is write it down.
            </>
          }
        >
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            <div className="glass rounded-3xl p-6">
              <div className="text-lg font-semibold text-ink">The Care Board, as an MCP App</div>
              <p className="mt-3 text-[0.875rem] leading-relaxed text-[#c3cad9]">
                A ranked list with state does not survive being spoken. So the gaps also ship as an
                interactive view (SEP-1865): provenance on every row, the ranking&rsquo;s arithmetic
                openable, and a Claim button that calls the same tool voice would - down the same
                authorisation path.
              </p>
            </div>
            <div className="glass rounded-3xl p-6">
              <div className="text-lg font-semibold text-ink">
                Confirmation that survives a voice turn
              </div>
              <p className="mt-3 text-[0.875rem] leading-relaxed text-[#c3cad9]">
                MCP elicitation expects an answer inside the same call that raised it; an Alexa turn
                is over in seconds. CareCircle models confirmation as a separate tool call instead,
                so &ldquo;will Daddy need a ride?&rdquo; then &ldquo;yes&rdquo; survives any gap
                between turns with nothing parked.
              </p>
            </div>
            <div className="glass rounded-3xl p-6">
              <div className="text-lg font-semibold text-ink">Everything that got in the way</div>
              <p className="mt-3 text-[0.875rem] leading-relaxed text-[#c3cad9]">
                Every piece of friction, logged in the moment - the ones we worked around, and the
                ones we could not. Where the platform has since answered us, we say so rather than
                keep the complaint.
              </p>
            </div>
          </div>
        </Section>
      </div>

      {/* ---------- 7. Try it ---------- */}
      <div className="border-t border-line bg-[#0a0e18]">
        <Section
          eyebrow="See it"
          title={<>It is running right now.</>}
          lead={
            <>
              Not a mockup: a live MCP server with 710 tests and 94.8% measured first-tool accuracy.
              The full story also runs end to end on your machine in about a minute, with no AWS
              account and no keys.
            </>
          }
        >
          <pre className="mt-10 max-w-xl overflow-x-auto rounded-xl border border-line bg-black/40 px-5 py-4 font-mono text-[0.8125rem] leading-relaxed text-core">
            git clone https://github.com/Osiyomeoh/carecircle{'\n'}npm ci &amp;&amp; npm run story
          </pre>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/world" className={primary}>
              Play a family&rsquo;s week →
            </Link>
            <Link to="/console" className={ghost}>
              The console
            </Link>
            <Link to="/tv" className={ghost}>
              The Fire TV screen
            </Link>
            <a href="/docs.html" className={ghost}>
              Developer docs
            </a>
            <a
              href="https://github.com/Osiyomeoh/carecircle"
              target="_blank"
              rel="noreferrer"
              className={ghost}
            >
              Read the source
            </a>
          </div>

          <div className="mt-16 flex flex-wrap justify-between gap-4 border-t border-line pt-8 text-[0.8125rem] text-muted">
            <span>CareCircle · an open-source MCP server for families sharing care</span>
            <span>EVENTS &rarr; OBLIGATIONS &rarr; OWNERSHIP</span>
          </div>
        </Section>
      </div>
    </div>
  );
}
