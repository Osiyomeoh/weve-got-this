import type { TurnTrace } from '../sim/host.js';

/**
 * A turn's trace with the care taken out, so it can be logged.
 *
 * The full trace holds what the person said, every argument and every result: medicine
 * names, notes, names. None of that may reach a log (see ./log.ts). What is left is still
 * enough to see which step went wrong: the order of the steps, which tool each one called,
 * whether it worked or came back with guidance, and how long each part took.
 *
 *   steps: ["log_care_event:guidance", "log_care_event:ok", "answer"]
 */
// A type, not an interface, so it can be passed to the logger as a field map.
export type TraceFields = {
  channel: TurnTrace['channel'];
  model: string;
  outcome: TurnTrace['outcome'];
  /** "tool:ok", "tool:guidance", then "answer" (or "cut_off" at the step limit). */
  steps: string[];
  calls: number;
  plannerMs: number;
  toolMs: number;
  totalMs: number;
};

export function traceFields(trace: TurnTrace): TraceFields {
  return {
    channel: trace.channel,
    model: trace.model,
    outcome: trace.outcome,
    // A reply with no calls is the answer; at the step limit, the last reply asked for more
    // tools and was cut off instead.
    steps: trace.steps.flatMap((s, i) => (s.calls.length
      ? s.calls.map((c) => `${c.name}:${c.isError ? 'guidance' : 'ok'}`)
      : [i === trace.steps.length - 1 && trace.outcome === 'step_limit' ? 'cut_off' : 'answer'])),
    calls: trace.steps.reduce((n, s) => n + s.calls.length, 0),
    plannerMs: trace.plannerMs,
    toolMs: trace.toolMs,
    totalMs: trace.totalMs,
  };
}
