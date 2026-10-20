import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  getStarted,
  FOUNDER_ID,
  type OnboardingProgress,
  type OnboardingStep,
} from '../lib/api';

/**
 * First run, on a screen.
 *
 * The voice path already walks a family in (get_started + the planner). This is the
 * same journey a judge can *watch*: four steps, one at a time, ending on the family's
 * own first Care Gap - the moment the product starts earning its keep.
 *
 * Every field here drives a real MCP tool against a brand-new circle. Nothing is
 * mocked: the gap on the final screen is computed by the real engine from what was
 * just typed in. The screen only ever asks for the one thing the server says is next,
 * because onboarding that demands a whole form up front is how you lose someone.
 */

const STEP_LABELS: Record<OnboardingStep, string> = {
  create_circle: 'Your circle',
  add_recipient: 'Who you care for',
  add_care_detail: 'One thing to watch',
  ready: 'Ready',
};
const ORDER: OnboardingStep[] = ['create_circle', 'add_recipient', 'add_care_detail', 'ready'];

const GUESS_TZ = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  } catch {
    return 'America/New_York';
  }
};

export default function Setup() {
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the app said back to the last yes, no or "I'll take it", in its own words.
  const [said, setSaid] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setProgress(await getStarted());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Start clean each visit, so a demo always begins at "create your circle".
  useEffect(() => {
    void api
      .resetSetup()
      .then(refresh)
      .catch(() => void refresh());
  }, []);

  const run = async (tool: string, args: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const call = await api.act(FOUNDER_ID, tool, args);
      if (call.isError) {
        setError(call.result);
        return false;
      }
      setSaid(tool === 'confirm_proposal' || tool === 'claim_obligation' ? call.result : null);
      // Creating the circle maps the founder's token to a real member; the open
      // session is still the bootstrap principal, so refresh it before continuing.
      if (tool === 'create_household') await api.rebindSetup().catch(() => undefined);
      await refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const step = progress?.step ?? 'create_circle';

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-5 py-10 text-ink">
      <div className="mb-8 flex items-center justify-between">
        <div className="text-lg font-semibold tracking-tight">We’ve Got This · set up</div>
        <Link to="/" className="text-sm text-muted hover:text-ink">
          Exit
        </Link>
      </div>

      <ol className="mb-8 flex gap-2">
        {ORDER.map((s) => {
          const done = progress?.done.includes(s) || (s === 'ready' && progress?.complete);
          const here = s === step;
          return (
            <li key={s} className="flex-1">
              <div
                className={`h-1.5 rounded-full ${done ? 'bg-confirmed' : here ? 'bg-alexa' : 'bg-white/10'}`}
              />
              <div
                className={`mt-2 text-[0.7rem] uppercase tracking-wide ${here ? 'text-ink' : 'text-muted'}`}
              >
                {STEP_LABELS[s]}
              </div>
            </li>
          );
        })}
      </ol>

      {/* What the server says next, spoken aloud in the voice flow - shown here. The last
          screen says it in its cards instead. */}
      {progress && step !== 'ready' && (
        <p className="mb-6 text-lg leading-relaxed text-ink/90">{progress.spoken}</p>
      )}

      {error && (
        <div className="mb-5 rounded-lg border border-norecord/40 bg-norecord/10 px-3 py-2 text-sm text-norecord">
          {error}
        </div>
      )}

      {step === 'create_circle' && <CreateCircle busy={busy} onSubmit={run} />}
      {step === 'add_recipient' && <AddRecipient busy={busy} onSubmit={run} />}
      {step === 'add_care_detail' && <AddCareDetail busy={busy} onSubmit={run} />}
      {step === 'ready' && (
        <Ready
          progress={progress!}
          said={said}
          busy={busy}
          onSubmit={run}
          onReset={() => {
            setSaid(null);
            void api.resetSetup().then(refresh);
          }}
        />
      )}
    </div>
  );
}

interface StepProps {
  busy: boolean;
  /** Resolves to whether the tool call succeeded. */
  onSubmit: (tool: string, args: Record<string, unknown>) => Promise<boolean>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-muted">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  'w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-ink outline-none focus:border-alexa';
const btnCls = 'rounded-lg bg-alexa px-5 py-2.5 font-semibold text-black disabled:opacity-50';

function CreateCircle({ busy, onSubmit }: StepProps) {
  const [circle, setCircle] = useState('');
  const [me, setMe] = useState('');
  const tz = useMemo(GUESS_TZ, []);
  const ok = circle.trim() && me.trim();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok)
          onSubmit('create_household', {
            name: circle.trim(),
            timezone: tz,
            callerName: me.trim(),
          });
      }}
    >
      <Field label="What would you like to call the circle?">
        <input
          className={inputCls}
          value={circle}
          onChange={(e) => setCircle(e.target.value)}
          placeholder="Mum's circle"
        />
      </Field>
      <Field label="Your name">
        <input
          className={inputCls}
          value={me}
          onChange={(e) => setMe(e.target.value)}
          placeholder="e.g. Ada"
        />
      </Field>
      <p className="text-xs text-muted">
        Times will be read in {tz}. This is a public demo, so please use made-up names and details:
        the circle is kept on our server.
      </p>
      <button className={btnCls} disabled={!ok || busy}>
        {busy ? 'Setting up…' : 'Create the circle'}
      </button>
    </form>
  );
}

function AddRecipient({ busy, onSubmit }: StepProps) {
  const [name, setName] = useState('');
  const [spokenAs, setSpokenAs] = useState('');
  const ok = name.trim();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok)
          onSubmit('add_member', {
            name: name.trim(),
            role: 'care_recipient',
            ...(spokenAs.trim() ? { spokenAs: spokenAs.trim() } : {}),
          });
      }}
    >
      <Field label="Who is the circle caring for?">
        <input
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Grace"
        />
      </Field>
      <Field label="What do you call them? (optional)">
        <input
          className={inputCls}
          value={spokenAs}
          onChange={(e) => setSpokenAs(e.target.value)}
          placeholder="e.g. Mum"
        />
      </Field>
      <button className={btnCls} disabled={!ok || busy}>
        {busy ? 'Adding…' : 'Add them'}
      </button>
    </form>
  );
}

/** Tomorrow's date in this browser's time zone, as an <input type="date"> value. */
function tomorrow(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/**
 * One thing to watch: an appointment coming up, or a medication and its times. The
 * appointment comes first because it shows the product working on day one: the app
 * guesses what it will need, asks before treating the guess as work, and then finds
 * out who has it.
 */
function AddCareDetail({ busy, onSubmit }: StepProps) {
  const [kind, setKind] = useState<'appointment' | 'medication'>('appointment');
  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        {(['appointment', 'medication'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`rounded-full border px-4 py-1.5 text-sm ${
              kind === k ? 'border-alexa bg-alexa/15 text-ink' : 'border-white/15 text-muted'
            }`}
          >
            {k === 'appointment' ? 'An appointment' : 'A medication'}
          </button>
        ))}
      </div>
      {kind === 'appointment' ? (
        <AddAppointment busy={busy} onSubmit={onSubmit} />
      ) : (
        <AddMedication busy={busy} onSubmit={onSubmit} />
      )}
    </div>
  );
}

function AddAppointment({ busy, onSubmit }: StepProps) {
  const [what, setWhat] = useState('');
  const [day, setDay] = useState(tomorrow);
  const [time, setTime] = useState('10:00');
  const ok = what.trim() && day && time;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        // The household's local time, which is this browser's (set on the first step).
        if (ok)
          onSubmit('record_appointment', { kind: what.trim(), startsAt: `${day}T${time}:00` });
      }}
    >
      <Field label="An appointment coming up">
        <input
          className={inputCls}
          value={what}
          onChange={(e) => setWhat(e.target.value)}
          placeholder="e.g. eye check-up"
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Day">
          <input
            type="date"
            className={inputCls}
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </Field>
        <Field label="Time">
          <input
            type="time"
            className={inputCls}
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </Field>
      </div>
      <button className={btnCls} disabled={!ok || busy}>
        {busy ? 'Adding…' : 'Add it'}
      </button>
    </form>
  );
}

function AddMedication({ busy, onSubmit }: StepProps) {
  const [name, setName] = useState('');
  const [times, setTimes] = useState('08:00, 20:00');
  const parsed = times
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const ok = name.trim() && parsed.length > 0;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSubmit('add_medication', { name: name.trim(), times: parsed });
      }}
    >
      <Field label="A medication to keep an eye on">
        <input
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. eye drops"
        />
      </Field>
      <Field label="Times it's due (24-hour, comma-separated)">
        <input
          className={inputCls}
          value={times}
          onChange={(e) => setTimes(e.target.value)}
          placeholder="08:00, 20:00"
        />
      </Field>
      <button className={btnCls} disabled={!ok || busy}>
        {busy ? 'Adding…' : 'Add it'}
      </button>
    </form>
  );
}

const ghostCls = 'rounded-lg border border-white/15 px-5 py-2.5 text-ink/80 disabled:opacity-50';

/**
 * Set up, and the product's first move: a guess put to them as a question, then the
 * work nobody has yet, which they can take. Each button is the same tool the voice
 * flow calls, and what the app says back is shown as it said it.
 */
function Ready({
  progress,
  said,
  busy,
  onSubmit,
  onReset,
}: StepProps & { progress: OnboardingProgress; said: string | null; onReset: () => void }) {
  const { question, firstGap } = progress;
  return (
    <div className="space-y-5">
      {said && (
        <div className="rounded-lg border border-confirmed/40 bg-confirmed/10 px-4 py-3 text-ink">
          {said}
        </div>
      )}
      {question ? (
        <div className="rounded-2xl border border-white/12 bg-white/5 p-5">
          <div className="mb-1 text-[0.7rem] uppercase tracking-wide text-alexa">
            One question first
          </div>
          <div className="text-lg font-medium">{question.ask}</div>
          <div className="mt-4 flex gap-3">
            <button
              className={btnCls}
              disabled={busy}
              onClick={() =>
                void onSubmit('confirm_proposal', {
                  obligationId: question.obligationId,
                  confirmed: true,
                })
              }
            >
              Yes, it's needed
            </button>
            <button
              className={ghostCls}
              disabled={busy}
              onClick={() =>
                void onSubmit('confirm_proposal', {
                  obligationId: question.obligationId,
                  confirmed: false,
                })
              }
            >
              No
            </button>
          </div>
        </div>
      ) : firstGap ? (
        <div className="rounded-2xl border border-white/12 bg-white/5 p-5">
          <div className="mb-1 text-[0.7rem] uppercase tracking-wide text-norecord">
            First thing that needs someone
          </div>
          <div className="text-lg font-medium">{firstGap.what}</div>
          <div className="mt-1.5 text-sm text-[#c3cad9]">{firstGap.because}</div>
          {firstGap.obligationId && (
            <button
              className={`${btnCls} mt-4`}
              disabled={busy}
              onClick={() =>
                void onSubmit('claim_obligation', { obligationId: firstGap.obligationId })
              }
            >
              I'll take it
            </button>
          )}
        </div>
      ) : (
        !said && (
          <div className="rounded-2xl border border-white/12 bg-white/5 p-5 text-ink/80">
            Nothing needs anyone yet. The app will keep watch and let the circle know the moment
            something does.
          </div>
        )
      )}
      <AddFamily busy={busy} onSubmit={onSubmit} />
      <div className="flex flex-wrap gap-3">
        <Link to="/world" className={btnCls}>
          See a family's whole day
        </Link>
        <button onClick={onReset} className={ghostCls}>
          Set up another
        </button>
      </div>
    </div>
  );
}

/**
 * The rest of the family, optional and one at a time. "Lives far away" is for the
 * sibling abroad: the app never picks them on its own for something that needs
 * someone there, and they can have a short update on the day every evening instead.
 */
function AddFamily({ busy, onSubmit }: StepProps) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<'caregiver' | 'helper'>('caregiver');
  const [away, setAway] = useState(false);
  const [city, setCity] = useState('');
  const [evening, setEvening] = useState(true);
  const [added, setAdded] = useState<string[]>([]);
  const ok = name.trim() && (!away || city.trim());
  return (
    <form
      className="space-y-4 rounded-2xl border border-white/12 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        const who = name.trim();
        void onSubmit('add_member', {
          name: who,
          role,
          ...(away ? { livesAway: city.trim(), dailyUpdate: evening } : {}),
        }).then((saved) => {
          if (!saved) return;
          setAdded((a) => [...a, who]);
          setName('');
          setAway(false);
          setCity('');
        });
      }}
    >
      <div>
        <div className="font-medium">Add family (optional)</div>
        <div className="text-sm text-muted">
          {added.length
            ? `Added ${added.join(', ')}. Anyone else?`
            : 'Brothers, sisters, a paid helper: whoever shares the care.'}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Kunle"
          />
        </Field>
        <Field label="They are">
          <select
            className={inputCls}
            value={role}
            onChange={(e) => setRole(e.target.value as 'caregiver' | 'helper')}
          >
            <option value="caregiver">Family</option>
            <option value="helper">Paid help</option>
          </select>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={away} onChange={(e) => setAway(e.target.checked)} />
        Lives far away
      </label>
      {away && (
        <div className="space-y-3 border-l-2 border-white/10 pl-4">
          <Field label="Where?">
            <input
              className={inputCls}
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. London"
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={evening}
              onChange={(e) => setEvening(e.target.checked)}
            />
            Send them an update on the day, every evening
          </label>
          <p className="text-xs text-muted">
            The app won't ask them to do things that need someone there, like a ride. You can still
            ask them by name.
          </p>
        </div>
      )}
      <button className={btnCls} disabled={!ok || busy}>
        {busy ? 'Adding…' : 'Add to the circle'}
      </button>
    </form>
  );
}
