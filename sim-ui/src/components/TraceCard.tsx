import type { TurnTrace } from '../lib/api';

/** A turn as it happened: what was said, and the trace the server sent back for it. */
export interface TraceEntry {
  said: string;
  trace: TurnTrace;
  tapped?: boolean;
}

const time = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

/**
 * How a turn was worked out, step by step: each reply from the model, the tools it called
 * with what they said back, and where the time went. Real MCP calls, not a replay - the
 * server returns this with every turn.
 */
export function TraceCard({ entry }: { entry: TraceEntry }) {
  const { trace, said, tapped } = entry;
  const last = trace.steps.length - 1;
  return (
    <div className="border-t border-line pt-2.5 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline gap-x-2 text-[0.75rem]">
        <span className="max-w-[60%] truncate font-semibold text-ink" title={said}>
          {tapped ? said : `“${said}”`}
        </span>
        <span className="tabular-nums text-muted">{time(trace.totalMs)}</span>
        <span className="tabular-nums text-muted">
          {tapped
            ? 'no model: the card calls the tool itself'
            : `model ${time(trace.plannerMs)} · tools ${time(trace.toolMs)}`}
        </span>
        {trace.outcome === 'step_limit' && (
          <span className="font-semibold text-sevHigh">cut off</span>
        )}
      </div>
      <ol className="mt-1.5 space-y-1">
        {trace.steps.map((step, i) => (
          <li key={i} className="flex gap-2 text-[0.75rem]">
            <span className="w-4 shrink-0 text-right tabular-nums text-muted">{i + 1}</span>
            <div className="min-w-0 flex-1">
              {!tapped && (
                <div className="text-[0.6875rem] text-muted">model {time(step.plannerMs)}</div>
              )}
              {step.calls.length === 0 ? (
                <div
                  className={
                    i === last && trace.outcome === 'step_limit' ? 'text-sevHigh' : 'text-confirmed'
                  }
                >
                  {i === last && trace.outcome === 'step_limit'
                    ? 'asked for more tools and was cut off'
                    : 'answered'}
                </div>
              ) : (
                step.calls.map((c, j) => (
                  <div key={j} className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-ink">{c.name}</span>
                      <span
                        className={`rounded-full border px-1.5 text-[0.625rem] uppercase tracking-wider ${c.isError ? 'border-sevHigh text-sevHigh' : 'border-line text-muted'}`}
                      >
                        {c.isError ? 'guidance' : 'ok'}
                      </span>
                      <span className="tabular-nums text-muted">{time(c.ms)}</span>
                      <span className="truncate text-muted" title={JSON.stringify(c.arguments)}>
                        {JSON.stringify(c.arguments)}
                      </span>
                    </div>
                    <div className="truncate text-muted" title={c.result}>
                      → {c.result}
                    </div>
                  </div>
                ))
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
