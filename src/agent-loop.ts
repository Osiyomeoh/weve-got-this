import type { CareStore } from './store/store.js';
import type { Notifier } from './notify/notifier.js';
import { runAgentAll } from './domain/agent-runner.js';
import { sendDailyUpdates } from './domain/daily-update.js';
import { sendDueReminders } from './domain/reminders.js';
import { beeConfigFromEnv } from './connectors/bee.js';

/** Another instance holds the loops' lease; this one stays quiet. */
class NotLeader extends Error {}

interface Log {
  info(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export interface AgentLoopDeps {
  store: CareStore;
  notifier: Notifier;
  log: Log;
}

/**
 * The interval that gives the agent a chance to act.
 *
 * The word "chance" is deliberate. This does not decide to do anything - it decides
 * how often to let the policy look, and the policy decides whether anything is worth
 * doing. So the cadence here is not a safety parameter (the policy's fatigue and
 * quiet-hours arithmetic is), it is only responsiveness: check often enough that an
 * ageing gap is noticed within the hour, rarely enough that a quiet household costs
 * nothing.
 *
 * Off unless CARECIRCLE_AGENT_INTERVAL_MS is set, so tests, local runs, and CI never
 * grow a background timer by surprise. Production sets it.
 */
export function startAgentLoop(deps: AgentLoopDeps): () => void {
  const ms = Number(process.env['CARECIRCLE_AGENT_INTERVAL_MS'] ?? 0);
  if (!Number.isFinite(ms) || ms <= 0) {
    deps.log.info('agent loop disabled', { reason: 'CARECIRCLE_AGENT_INTERVAL_MS not set' });
    return () => {};
  }

  // Reminders keep their own, finer clock: a dose reminder should arrive at 8, not 8:14.
  const everyMs = Number(process.env['CARECIRCLE_REMINDER_INTERVAL_MS'] ?? 60_000);
  // With more than one instance, only one runs the loops. The reminder clock renews the
  // lease every minute; if that instance stops, another takes over within three.
  const leaseMs = 3 * everyMs;

  let running = false;
  const tick = async (): Promise<void> => {
    // Never let two passes overlap: a slow notifier must not stack ticks into a
    // burst of duplicate asks. Skipping is safe because the policy is idempotent
    // over the fatigue window.
    if (running) return;
    if (!(await deps.store.lease('loops', leaseMs).catch(() => false))) return;
    running = true;
    // Another instance, or a script, may have written since the last tick.
    await deps.store.refresh().catch((err: unknown) => deps.log.error('record refresh failed', { reason: (err as Error).name }));
    try {
      const runs = await runAgentAll(deps);
      const asked = runs.reduce((n, r) => n + r.performed.length, 0);
      if (asked > 0) deps.log.info('agent acted', { households: runs.length, asked });
    } catch (err) {
      // An agent that crashes the process is worse than an agent that misses a tick.
      deps.log.error('agent tick failed', { reason: (err as Error).message });
    }
    // The evening update rides the same tick, apart, so neither can stop the other.
    try {
      const updates = await sendDailyUpdates(deps);
      if (updates > 0) deps.log.info('daily updates sent', { updates });
    } catch (err) {
      deps.log.error('daily updates failed', { reason: (err as Error).message });
    } finally {
      running = false;
    }
  };

  deps.log.info('agent loop enabled', { intervalMs: ms });
  const handle = setInterval(() => { void tick(); }, ms);
  handle.unref?.(); // the loop must never hold the process open on its own

  // A connected Bee, and whose it is: their dose reminders also ring in their Bee app.
  const beeConfig = beeConfigFromEnv();
  const beeMember = process.env['BEE_MEMBER_ID']?.trim();
  const bee = beeConfig && beeMember ? { config: beeConfig, memberId: beeMember } : null;
  let reminding = false;
  const remind = setInterval(() => {
    if (reminding) return;
    reminding = true;
    void deps.store.lease('loops', leaseMs).catch(() => false)
      .then(async (mine) => {
        if (!mine) throw new NotLeader();
        await deps.store.refresh().catch((err: unknown) => deps.log.error('record refresh failed', { reason: (err as Error).name }));
      })
      .then(() => sendDueReminders({ ...deps, bee }))
      .then((n) => { if (n > 0) deps.log.info('reminders sent', { reminders: n }); })
      .catch((err: unknown) => { if (!(err instanceof NotLeader)) deps.log.error('reminders failed', { reason: (err as Error).message }); })
      .finally(() => { reminding = false; });
  }, everyMs);
  remind.unref?.();
  return () => { clearInterval(handle); clearInterval(remind); };
}
