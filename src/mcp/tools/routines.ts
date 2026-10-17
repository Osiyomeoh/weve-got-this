/**
 * Work that comes round again: lunch every day, someone there at night, diesel on Saturdays.
 */

import { z } from 'zod';
import { can, require as requireCap } from '../../domain/auth.js';
import { spokenClock } from '../../domain/gaps.js';
import {
  activeRoutines,
  putRoutinesOnRecord,
  ROUTINE_AREAS,
  takeRoutineOffRecord,
} from '../../domain/routines.js';
import { subjectOf } from '../../domain/who.js';
import { currentChannel } from '../channel.js';
import { OUT } from '../output-schemas.js';
import { joinSpoken } from '../text.js';
import {
  describeError,
  guidance,
  reply,
  type ToolContext,
  validMedicationTimes,
} from '../toolkit.js';

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function when(times: string[], days?: number[]): string {
  const at = joinSpoken(times.map(spokenClock));
  if (!days?.length || days.length === 7) return `every day at ${at}`;
  const names = days.map((d) => {
    const n = WEEKDAYS[d]!;
    return `${n[0]!.toUpperCase()}${n.slice(1)}s`;
  });
  return `${joinSpoken(names)} at ${at}`;
}

/**
 * "Someone needs to bring Daddy lunch every day at one."
 */
export function registerSetRoutine({ server, store, actor, state, now }: ToolContext): void {
  server.registerTool(
    'set_routine',
    {
      title: 'Set up care work that comes round again',
      description:
        'Set up care work that comes round again and needs a person each time: a meal made or ' +
        'brought, someone with them at night or while they are alone, help washing or getting ' +
        'around, diesel for the generator, water, the electricity token. Each time it comes round ' +
        'goes on the board a day ahead and someone free is asked to take it on. Times are 24-hour ' +
        '"HH:MM" in the household timezone. Not for medicine: use add_medication. Set stop to end ' +
        'a routine the family no longer needs.',
      inputSchema: {
        what: z
          .string()
          .describe('The work as the family says it, naming who it is for: "Bring Daddy lunch".'),
        area: z
          .enum(ROUTINE_AREAS as [string, ...string[]])
          .describe(
            'meal: food or drink. safety: someone there or checking in. personal: washing, ' +
              'dressing, getting around. household: fuel, water, power, bills.',
          ),
        times: z
          .array(z.string())
          .optional()
          .describe(
            'When it comes round, 24-hour "HH:MM", e.g. ["13:00"]. Needed unless stopping.',
          ),
        days: z
          .array(z.enum(WEEKDAYS))
          .optional()
          .describe('Only on these days of the week. Leave it out for every day.'),
        forMemberId: z
          .string()
          .optional()
          .describe(
            'Who it is for: their name as the family says it (e.g. "Mum"), or their id. Leave it out when only one person is being cared for.',
          ),
        mine: z
          .boolean()
          .optional()
          .describe(
            'True only when the speaker says they will do it themselves every time ("I\'ll bring his lunch every day").',
          ),
        stop: z.boolean().optional().describe('True to end a routine the family no longer needs.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      outputSchema: OUT.set_routine,
    },
    async ({ what, area, times, days, forMemberId, mine, stop }) => {
      try {
        const me = actor();
        requireCap(me, 'create_obligation');
        const at = now();
        const running = activeRoutines(state(), at);

        if (stop) {
          const matches = running.filter(
            (r) => same(r.what, what) || r.what.toLowerCase().includes(what.trim().toLowerCase()),
          );
          if (matches.length === 0) {
            return guidance(
              running.length
                ? `There's no routine called "${what}". The ones set up are ${joinSpoken(running.map((r) => `"${r.what}"`))}. Ask which one they meant.`
                : 'There are no routines set up, so there is nothing to stop.',
            );
          }
          if (matches.length > 1) {
            return guidance(
              `More than one routine fits "${what}": ${joinSpoken(matches.map((r) => `"${r.what}"`))}. Ask which one they meant.`,
            );
          }
          const r = matches[0]!;
          // Ending a routine is the family's call: whoever set it up, or whoever coordinates.
          if (r.setBy !== me.id && !can(me, 'manage_circle')) {
            return guidance(
              `Only the person who set up "${r.what}", or whoever coordinates the family, can stop it. Offer to tell them.`,
            );
          }
          await store.appendEvent({
            householdId: me.householdId,
            kind: 'routine_stopped',
            reportedBy: me.id,
            occurredAt: at.toISOString(),
            source: currentChannel() ?? 'voice',
            confidence: 'reported',
            detail: r.what,
            data: { routineId: r.id },
          });
          const off = await takeRoutineOffRecord(store, me.householdId, r.id, me.id, at);
          return reply(
            `Stopped "${r.what}".` +
              (off
                ? ` ${off === 1 ? 'The time' : `The ${off} times`} ahead came off the board.`
                : '') +
              ' What was already done stays on the record.',
            { routineId: r.id, stopped: off },
          );
        }

        if (!times || !validMedicationTimes(times)) {
          return guidance(
            'I need the times as 24-hour "HH:MM" - for example ["13:00"]. Say them again that way.',
          );
        }
        if (running.some((r) => same(r.what, what))) {
          return guidance(
            `"${what}" is already set up. To change its times, stop it and set it up again.`,
          );
        }
        const who = subjectOf(state(), forMemberId, 'this');
        if ('problem' in who) return guidance(who.problem);
        const dayNumbers = days?.length
          ? [...new Set(days.map((d) => WEEKDAYS.indexOf(d)))].sort()
          : undefined;

        const set = await store.appendEvent({
          householdId: me.householdId,
          kind: 'routine_set',
          reportedBy: me.id,
          occurredAt: at.toISOString(),
          source: currentChannel() ?? 'voice',
          confidence: 'reported',
          detail: what,
          data: {
            what,
            area,
            times,
            ...(dayNumbers ? { days: dayNumbers } : {}),
            forMemberId: who.member.id,
            // A person can promise their own time, never someone else's.
            ...(mine ? { ownerId: me.id } : {}),
          },
        });
        await putRoutinesOnRecord(store, me.householdId, at);
        const said = `Set up "${what}" ${when(times, dayNumbers)}.`;
        return reply(
          mine
            ? `${said} Each time is yours, and goes on the board a day ahead.`
            : `${said} Each time goes on the board a day ahead, and I'll ask someone free to take it on.`,
          { routineId: set.id },
        );
      } catch (err) {
        return guidance(describeError(err));
      }
    },
  );
}
