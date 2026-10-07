import type { ToolCall } from '../lib/api';

// What this run of the day actually caught. Every line is counted from a call the live server
// answered without error, in this visitor's own copy; a beat that didn't land counts nothing.
// No line is written in advance and shown regardless: if the run skipped it, it isn't here.

export interface Logged { who: string; call: ToolCall }

export interface ImpactLine {
  /** What happened, said for a family, not a developer. */
  text: string;
  /** The tool calls it rests on, shown small beside it. */
  tools: string[];
  /** True when the visitor's own word or press did it. */
  yours: boolean;
}

export interface Impact { lines: ImpactLine[]; calls: number; errors: number; yourCalls: number }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function impactOf(log: Logged[], opts: { recipient: string; his: string; playing: string | null }): Impact {
  const ok = log.filter((l) => !l.call.isError);
  const mine = (l: Logged) => opts.playing !== null && l.who.startsWith(opts.playing);
  const of = (name: string) => ok.filter((l) => l.call.name === name);
  const lines: ImpactLine[] = [];
  const add = (items: Logged[], text: string) => {
    if (items.length) lines.push({ text, tools: [...new Set(items.map((l) => l.call.name))], yours: items.some(mine) });
  };

  const own = of('log_care_event').filter((l) => l.who.startsWith(opts.recipient));
  add(own, `${opts.recipient} put ${plural(own.length, 'dose', 'doses')} on the record on ${opts.his} own word. Nobody had to call and ask.`);

  const asked = of('request_owner');
  const said = of('respond_to_request');
  add(asked.length ? [...asked, ...said] : [], `${plural(asked.length, 'job was', 'jobs were')} asked for, never assigned${said.length ? `, and the answer came from the person asked` : ''}.`);

  const claimed = of('claim_obligation');
  add(claimed, `${plural(claimed.length, 'job', 'jobs')} taken on by someone who volunteered, from wherever they were.`);

  add(of('ingest_signal'), 'The doorbell added evidence. It said a person came, never who.');

  add(of('run_care_agent'), 'When a promise slipped past its time, the agent asked the one person who had said yes. Nobody prompted it.');

  const closed = of('resolve_obligation');
  add(closed, `${plural(closed.length, 'job', 'jobs')} closed by the person who did it, with the doorbell's evidence beside it.`);

  add(of('get_provenance'), 'Anyone in the family could see the trail: who asked, who said yes, who finished.');

  // "No record" said as a question, not as "missed": counted when the server answered with a
  // dose it holds no record of (an UNCONFIRMED gap), which is what the spoken "no record" rests on.
  const unconfirmed = (c: ToolCall) =>
    ((c.structured as { gaps?: { kind?: string }[] } | undefined)?.gaps ?? []).some((g) => g.kind === 'UNCONFIRMED');
  const unknown = ok.filter((l) => l.call.name === 'get_care_gaps' && unconfirmed(l.call));
  add(unknown, 'When nobody knew, it was said as "no record", never as "missed".');

  return {
    lines,
    calls: log.length,
    errors: log.length - ok.length,
    yourCalls: log.filter(mine).length,
  };
}
