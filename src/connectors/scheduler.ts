import type { CareStore } from '../store/store.js';
import {
  googleCalendarConfigFromEnv,
  runGoogleCalendarSync,
  runCalendarWriteback,
} from './google-calendar.js';
import { gmailConfigFromEnv, runGmailSync } from './gmail.js';
import { beeConfigFromEnv, runBeeSync } from './bee.js';

/**
 * The connector sync loop: keep the care record and the family's calendar in step,
 * on their own, without anyone running a CLI.
 *
 * This is what turns the doors from "a command you run" into "it just works". On a
 * cadence it pulls the household's Google Calendar and appointment-invite emails in
 * (as observed, human-confirmable appointments) and writes owned, dated work back to
 * the shared calendar. Each connector is guarded independently: one failing (an
 * expired token, a network blip) is logged and never stops the others or the process.
 *
 * Single-household by design: one family, one linked Google account, named by
 * CARECIRCLE_HOUSEHOLD. Multi-tenant linking is a separate concern.
 *
 * Off unless both a Google account is configured and CARECIRCLE_CONNECTOR_INTERVAL_MS
 * is set - so tests, local runs, and CI never grow a background timer or touch a real
 * account by surprise.
 */

interface Log {
  info(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export interface ConnectorSyncDeps {
  store: CareStore;
  log: Log;
  householdId: string;
  forMemberId?: string;
  now?: () => Date;
  // Injectable so a test can drive one pass without touching the network. Default to
  // the real connector runs.
  calendarSync?: typeof runGoogleCalendarSync;
  calendarWriteback?: typeof runCalendarWriteback;
  gmailSync?: typeof runGmailSync;
  beeSync?: typeof runBeeSync;
}

/**
 * One reconciliation pass: calendar inbound, gmail inbound, calendar write-back.
 * Each step is isolated so a failure in one is reported and the rest still run.
 */
export async function runConnectorsOnce(deps: ConnectorSyncDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const calCfg = googleCalendarConfigFromEnv();
  const mailCfg = gmailConfigFromEnv();
  const beeCfg = beeConfigFromEnv();

  if (calCfg) {
    try {
      const r = await (deps.calendarSync ?? runGoogleCalendarSync)(
        deps.store,
        deps.householdId,
        calCfg,
        now,
        deps.forMemberId,
      );
      if (r.applied.length) deps.log.info('calendar sync applied', { applied: r.applied.length });
    } catch (err) {
      deps.log.error('calendar sync failed', { reason: (err as Error).message });
    }
    try {
      const w = await (deps.calendarWriteback ?? runCalendarWriteback)(
        deps.store,
        deps.householdId,
        calCfg,
      );
      if (w.created || w.updated)
        deps.log.info('calendar write-back', { created: w.created, updated: w.updated });
    } catch (err) {
      deps.log.error('calendar write-back failed', { reason: (err as Error).message });
    }
  }

  if (mailCfg) {
    try {
      const r = await (deps.gmailSync ?? runGmailSync)(
        deps.store,
        deps.householdId,
        mailCfg,
        now,
        deps.forMemberId,
      );
      if (r.applied.length) deps.log.info('gmail sync applied', { applied: r.applied.length });
    } catch (err) {
      deps.log.error('gmail sync failed', { reason: (err as Error).message });
    }
  }

  if (beeCfg) {
    try {
      const r = await (deps.beeSync ?? runBeeSync)(deps.store, deps.householdId, beeCfg, now);
      if (r.proposed.length || r.observed.length) {
        deps.log.info('bee sync applied', {
          proposed: r.proposed.length,
          observed: r.observed.length,
        });
      }
    } catch (err) {
      deps.log.error('bee sync failed', { reason: (err as Error).message });
    }
  }
}

/** Schedule {@link runConnectorsOnce} on an interval. Returns a stop function. */
export function startConnectorSync(
  deps: Omit<ConnectorSyncDeps, 'householdId'> & { householdId?: string },
): () => void {
  const ms = Number(process.env['CARECIRCLE_CONNECTOR_INTERVAL_MS'] ?? 0);
  const householdId = deps.householdId ?? process.env['CARECIRCLE_HOUSEHOLD']?.trim();
  const configured = googleCalendarConfigFromEnv() || gmailConfigFromEnv() || beeConfigFromEnv();

  if (!Number.isFinite(ms) || ms <= 0) {
    deps.log.info('connector sync disabled', {
      reason: 'CARECIRCLE_CONNECTOR_INTERVAL_MS not set',
    });
    return () => {};
  }
  if (!configured) {
    deps.log.info('connector sync disabled', { reason: 'no Google or Bee account configured' });
    return () => {};
  }
  if (!householdId) {
    deps.log.info('connector sync disabled', { reason: 'CARECIRCLE_HOUSEHOLD not set' });
    return () => {};
  }

  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return; // never overlap passes
    // One instance syncs at a time, or two would both see an item as new.
    if (!(await deps.store.lease('connectors', 3 * ms).catch(() => false))) return;
    running = true;
    try {
      // Another instance, or a script, may have written since the last pass.
      await deps.store.refresh().catch(() => undefined);
      await runConnectorsOnce({ ...deps, householdId });
    } finally {
      running = false;
    }
  };

  deps.log.info('connector sync enabled', { intervalMs: ms, householdId });
  const handle = setInterval(() => {
    void tick();
  }, ms);
  handle.unref?.();
  return () => clearInterval(handle);
}
