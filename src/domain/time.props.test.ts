import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { toInstant } from './time.ts';
import { clockTime, dueSpoken, happenedAt, isLocalToday } from './local-time.ts';
import { localParts } from './gaps.ts';

/**
 * Time as the family lives it, in every kind of zone: Lagos (no clock changes), the US and
 * Europe (an hour, at different weeks), Sydney and São Paulo (the other half of the year),
 * India and Nepal (half and quarter hours), Lord Howe (a half-hour change), Chatham (+12:45).
 * Instants are drawn across three years so every clock change in them is crossed many times.
 *
 * TIME_RUNS sets the cases per property (default 2,000).
 */

const RUNS = Number(process.env.TIME_RUNS ?? 2_000);
const ZONES = [
  'Africa/Lagos',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'America/St_Johns',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Australia/Sydney',
  'Australia/Lord_Howe',
  'Pacific/Chatham',
  'Pacific/Honolulu',
  'UTC',
];
const MIN = 60_000;
const zone = fc.constantFrom(...ZONES);
// 2025 to 2027, to the minute.
const instant = fc
  .integer({ min: 0, max: 3 * 366 * 24 * 60 })
  .map((m) => new Date(Date.UTC(2025, 0, 1) + m * MIN));

/** The wall clock an instant shows in a zone, as a planner writes it: no offset. */
function wall(at: Date, tz: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

test('a wall-clock time is read as that time in the household, across every clock change', () => {
  fc.assert(
    fc.property(instant, zone, (at, tz) => {
      const said = wall(at, tz);
      const read = toInstant(said, tz);
      assert.ok(read, `${said} in ${tz} was not read`);
      // An hour that happens twice (clocks back) may be either one; it must show the same clock.
      assert.equal(wall(new Date(read), tz), said, `${said} in ${tz} was read as ${read}`);
    }),
    { numRuns: RUNS },
  );
});

test('a time with an offset is that instant, whatever the household zone', () => {
  fc.assert(
    fc.property(instant, zone, (at, tz) => {
      assert.equal(toInstant(at.toISOString(), tz), at.toISOString());
      const plusOne = new Date(at.getTime() + 60 * MIN).toISOString().slice(0, 19) + '+01:00';
      assert.equal(toInstant(plusOne, tz), at.toISOString());
    }),
    { numRuns: RUNS },
  );
});

test('"it happened at <time>" lands on that local time, or is refused when it is still to come', () => {
  fc.assert(
    fc.property(
      instant,
      zone,
      fc.integer({ min: -48 * 60, max: 48 * 60 }),
      (now, tz, minutesAgo) => {
        const at = new Date(now.getTime() - minutesAgo * MIN);
        const said = wall(at, tz);
        const out = happenedAt(said, tz, now);
        if (minutesAgo < -10) {
          assert.ok(
            'problem' in out,
            `${said} is ${-minutesAgo} minutes ahead of now in ${tz} and was accepted`,
          );
        } else if (minutesAgo >= 0) {
          assert.ok(
            'at' in out,
            `${said}, ${minutesAgo} minutes ago in ${tz}, was refused: ${'problem' in out ? out.problem : ''}`,
          );
          assert.equal(wall(new Date(out.at), tz), said);
        }
      },
    ),
    { numRuns: RUNS },
  );
});

test('what a planner writes for a time never throws, and is a time or a reason', () => {
  const junk = fc.oneof(
    fc.string({ maxLength: 30 }),
    fc.constantFrom(
      '',
      ' ',
      'tomorrow',
      '25:99',
      '2026-02-30T10:00',
      '2026-13-01',
      '10:00',
      'T10:00',
      'null',
      '0',
      '-1',
    ),
    instant.map((d) => d.toISOString().slice(0, 16)),
    instant.map((d) => d.toISOString().slice(0, 10)),
  );
  fc.assert(
    fc.property(junk, zone, instant, (said, tz, now) => {
      const out = happenedAt(said, tz, now);
      if ('at' in out)
        assert.ok(!Number.isNaN(new Date(out.at).getTime()), `${said} gave ${out.at}`);
      else assert.ok(out.problem.length > 0);
    }),
    { numRuns: RUNS },
  );
});

test("today, tomorrow and yesterday are the household's days, not the server's", () => {
  fc.assert(
    fc.property(instant, zone, fc.integer({ min: 0, max: 24 * 60 - 1 }), (now, tz, minuteOfDay) => {
      const today = localParts(now, tz).date;
      const on = (date: string) =>
        toInstant(
          `${date}T${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}:00`,
          tz,
        )!;
      const shift = (days: number) =>
        new Date(Date.parse(`${today}T12:00:00Z`) + days * 24 * 60 * MIN)
          .toISOString()
          .slice(0, 10);
      const sameDay = on(today);
      // A minute skipped by the clock change lands on the next hour: still today unless it was 23:xx.
      if (localParts(new Date(sameDay), tz).date === today) {
        assert.ok(isLocalToday(sameDay, now, tz));
        assert.match(dueSpoken(sameDay, tz, now) ?? '', /^today at /);
      }
      assert.ok(isLocalToday(now.toISOString(), now, tz));
      const tomorrow = on(shift(1));
      if (localParts(new Date(tomorrow), tz).date === shift(1)) {
        assert.ok(!isLocalToday(tomorrow, now, tz));
        assert.match(
          dueSpoken(tomorrow, tz, now) ?? '',
          /^tomorrow at /,
          `${tomorrow} from ${now.toISOString()} in ${tz}`,
        );
      }
      const yesterday = on(shift(-1));
      if (localParts(new Date(yesterday), tz).date === shift(-1)) {
        assert.match(dueSpoken(yesterday, tz, now) ?? '', /^yesterday at /);
      }
    }),
    { numRuns: RUNS },
  );
});

test('a clock time is always speakable and agrees with the local wall clock', () => {
  fc.assert(
    fc.property(instant, zone, (at, tz) => {
      const spoken = clockTime(at.toISOString(), tz);
      assert.match(spoken, /^(1[0-2]|[1-9]):[0-5]\d (AM|PM)$/, spoken);
      const { minutes } = localParts(at, tz);
      assert.ok(minutes >= 0 && minutes < 24 * 60);
      const [h, m] = wall(at, tz).slice(11, 16).split(':').map(Number);
      assert.equal(minutes, h! * 60 + m!);
      const due = dueSpoken(at.toISOString(), tz, at) ?? '';
      assert.doesNotMatch(due, /undefined|NaN|Invalid/);
    }),
    { numRuns: RUNS },
  );
});
