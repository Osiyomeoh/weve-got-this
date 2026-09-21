import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getStarted, FOUNDER_ID, type OnboardingProgress, type OnboardingStep } from '../lib/api';

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
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'; }
  catch { return 'America/New_York'; }
};

export default function Setup() {
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try { setProgress(await getStarted()); setError(null); }
    catch (e) { setError((e as Error).message); }
  };

  // Start clean each visit, so a demo always begins at "create your circle".
  useEffect(() => { void api.resetSetup().then(refresh).catch(() => void refresh()); }, []);

  const run = async (tool: string, args: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const call = await api.act(FOUNDER_ID, tool, args);
      if (call.isError) { setError(call.result); return; }
      // Creating the circle maps the founder's token to a real member; the open
      // session is still the bootstrap principal, so refresh it before continuing.
      if (tool === 'create_household') await api.rebindSetup().catch(() => undefined);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const step = progress?.step ?? 'create_circle';

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-5 py-10 text-ink">
      <div className="mb-8 flex items-center justify-between">
        <div className="text-lg font-semibold tracking-tight">CareCircle · set up</div>
        <Link to="/" className="text-sm text-muted hover:text-ink">Exit</Link>
      </div>

      <ol className="mb-8 flex gap-2">
        {ORDER.map((s) => {
          const done = progress?.done.includes(s) || (s === 'ready' && progress?.complete);
          const here = s === step;
          return (
            <li key={s} className="flex-1">
              <div className={`h-1.5 rounded-full ${done ? 'bg-confirmed' : here ? 'bg-alexa' : 'bg-white/10'}`} />
              <div className={`mt-2 text-[0.7rem] uppercase tracking-wide ${here ? 'text-ink' : 'text-muted'}`}>
                {STEP_LABELS[s]}
              </div>
            </li>
          );
        })}
      </ol>

      {/* What the server says next, spoken aloud in the voice flow - shown here. */}
      {progress && (
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
      {step === 'ready' && <Ready progress={progress!} onReset={() => void api.resetSetup().then(refresh)} />}
    </div>
  );
}

interface StepProps {
  busy: boolean;
  onSubmit: (tool: string, args: Record<string, unknown>) => void;
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
const btnCls =
  'rounded-lg bg-alexa px-5 py-2.5 font-semibold text-black disabled:opacity-50';

function CreateCircle({ busy, onSubmit }: StepProps) {
  const [circle, setCircle] = useState('');
  const [me, setMe] = useState('');
  const tz = useMemo(GUESS_TZ, []);
  const ok = circle.trim() && me.trim();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => { e.preventDefault(); if (ok) onSubmit('create_household', { name: circle.trim(), timezone: tz, callerName: me.trim() }); }}
    >
      <Field label="What would you like to call the circle?">
        <input className={inputCls} value={circle} onChange={(e) => setCircle(e.target.value)} placeholder="Mum's care circle" />
      </Field>
      <Field label="Your name">
        <input className={inputCls} value={me} onChange={(e) => setMe(e.target.value)} placeholder="e.g. Ada" />
      </Field>
      <p className="text-xs text-muted">Times will be read in {tz}.</p>
      <button className={btnCls} disabled={!ok || busy}>{busy ? 'Setting up…' : 'Create the circle'}</button>
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
        if (ok) onSubmit('add_member', {
          name: name.trim(), role: 'care_recipient',
          ...(spokenAs.trim() ? { spokenAs: spokenAs.trim() } : {}),
        });
      }}
    >
      <Field label="Who is the circle caring for?">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Grace" />
      </Field>
      <Field label="What do you call them? (optional)">
        <input className={inputCls} value={spokenAs} onChange={(e) => setSpokenAs(e.target.value)} placeholder="e.g. Mum" />
      </Field>
      <button className={btnCls} disabled={!ok || busy}>{busy ? 'Adding…' : 'Add them'}</button>
    </form>
  );
}

function AddCareDetail({ busy, onSubmit }: StepProps) {
  const [name, setName] = useState('');
  const [times, setTimes] = useState('08:00, 20:00');
  const parsed = times.split(',').map((t) => t.trim()).filter(Boolean);
  const ok = name.trim() && parsed.length > 0;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => { e.preventDefault(); if (ok) onSubmit('add_medication', { name: name.trim(), times: parsed }); }}
    >
      <Field label="A medication to keep an eye on">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. heart pill" />
      </Field>
      <Field label="Times it's due (24-hour, comma-separated)">
        <input className={inputCls} value={times} onChange={(e) => setTimes(e.target.value)} placeholder="08:00, 20:00" />
      </Field>
      <button className={btnCls} disabled={!ok || busy}>{busy ? 'Adding…' : 'Add it'}</button>
    </form>
  );
}

function Ready({ progress, onReset }: { progress: OnboardingProgress; onReset: () => void }) {
  return (
    <div className="space-y-5">
      {progress.firstGap ? (
        <div className="rounded-2xl border border-white/12 bg-white/5 p-5">
          <div className="mb-1 text-[0.7rem] uppercase tracking-wide text-norecord">First thing that needs someone</div>
          <div className="text-lg font-medium">{progress.firstGap.what}</div>
          <div className="mt-1.5 text-sm text-[#c3cad9]">{progress.firstGap.because}</div>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/12 bg-white/5 p-5 text-ink/80">
          Nothing needs anyone yet. CareCircle will keep watch and let the circle know the
          moment something does.
        </div>
      )}
      <div className="flex gap-3">
        <Link to="/console" className={btnCls}>Open the care board</Link>
        <button onClick={onReset} className="rounded-lg border border-white/15 px-5 py-2.5 text-ink/80">Set up another</button>
      </div>
    </div>
  );
}
