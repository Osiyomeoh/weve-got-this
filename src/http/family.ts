import express, { type Request, type Response } from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CareStore } from '../store/store.js';
import type { Notifier } from '../notify/notifier.js';
import { createCareCircleServer } from '../mcp/server.js';
import { calendarView } from '../domain/calendar-view.js';
import { capabilitiesOf } from '../domain/auth.js';
import { memberFromCalendarToken, telegramUserFromInitData } from '../domain/family-access.js';
import { FAMILY_PAGE } from './family-page.js';

/**
 * The family calendar on the web: the same page inside Telegram (as a Mini App) and in
 * any browser (from a personal link the bot gives). Every change made on it goes through
 * the same MCP tools, as the same person, with the same permissions as saying it to the
 * bot - the calendar is another way to talk to CareCircle, not a second system.
 */

export interface FamilyOptions {
  store: CareStore;
  botToken?: string;
  /** Signs browser links. */
  secret?: string;
  /** The shared demo household a judge can look at, read-only, without signing in. */
  demoHouseholdId?: string;
  notifier?: Notifier;
  now?: () => Date;
}

const ACTIONS = new Set([
  'record_appointment',
  'change_appointment',
  'claim_obligation',
  'resolve_obligation',
  'request_owner',
  'confirm_proposal',
  'log_care_event',
  'add_medication',
  'change_medication',
  'add_note',
]);

type Viewer = { memberId: string; readOnly: boolean } | { error: string; status: number };

export function createFamilyRoutes(opts: FamilyOptions): express.Router {
  const router = express.Router();
  const now = opts.now ?? (() => new Date());

  const viewer = (req: Request): Viewer => {
    const initData = req.header('x-telegram-init-data');
    if (initData) {
      const user = telegramUserFromInitData(initData, opts.botToken ?? '', now());
      if (!user) return { error: 'This did not come from Telegram.', status: 401 };
      const link = opts.store.telegramLinkFor(user.id);
      if (!link)
        return {
          error: 'Tap the personal link your family sent you first, then open the calendar again.',
          status: 403,
        };
      return { memberId: link.memberId, readOnly: false };
    }
    const token = req.header('x-family-token');
    if (token) {
      const memberId = memberFromCalendarToken(opts.secret ?? '', token, now());
      if (!memberId)
        return {
          error: 'This link has expired. Ask the bot for a new one with /calendar.',
          status: 401,
        };
      return { memberId, readOnly: false };
    }
    if (req.query['demo'] !== undefined && opts.demoHouseholdId) {
      const state = opts.store.getCareState(opts.demoHouseholdId);
      const lead = state.members.find((m) => m.role === 'primary_caregiver') ?? state.members[0];
      if (lead) return { memberId: lead.id, readOnly: true };
    }
    return {
      error: 'Open the calendar from CareCircle in Telegram (type /calendar).',
      status: 401,
    };
  };

  router.get('/family', (_req, res) => {
    // The page carries a person's family record once they are in: keep it out of caches
    // and never send the link (which may carry their token) to another site.
    res.set({
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    });
    res.type('html').send(FAMILY_PAGE);
  });

  router.get('/family/api/view', (req: Request, res: Response) => {
    const v = viewer(req);
    if ('error' in v) {
      res.status(v.status).json({ error: v.error });
      return;
    }
    try {
      const me = opts.store.getMember(v.memberId);
      const state = opts.store.getCareState(me.householdId);
      const days = Number(req.query['days'] ?? 7);
      const from = typeof req.query['from'] === 'string' ? req.query['from'] : undefined;
      res.set('cache-control', 'no-store').json({
        me: { name: me.spokenAs ?? me.name, role: me.role, can: capabilitiesOf(me) },
        readOnly: v.readOnly,
        view: calendarView(state, now(), Number.isFinite(days) ? days : 7, from),
      });
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  router.post('/family/api/act', async (req: Request, res: Response) => {
    const v = viewer(req);
    if ('error' in v) {
      res.status(v.status).json({ error: v.error });
      return;
    }
    if (v.readOnly) {
      res
        .status(403)
        .json({ error: 'This is the demo: look around, nothing here can be changed.' });
      return;
    }
    const { tool, args } = (req.body ?? {}) as { tool?: string; args?: Record<string, unknown> };
    if (!tool || !ACTIONS.has(tool)) {
      res.status(400).json({ error: 'That is not something the calendar can do.' });
      return;
    }
    try {
      const server = createCareCircleServer({
        store: opts.store,
        actorId: v.memberId,
        ...(opts.notifier ? { notifier: opts.notifier } : {}),
        ...(opts.now ? { now: opts.now } : {}),
      });
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await server.connect(serverSide);
      const client = new Client({ name: 'carecircle-calendar', version: '0.1.0' });
      await client.connect(clientSide);
      try {
        const out = await client.callTool({ name: tool, arguments: args ?? {} });
        const text = (out.content as { type: string; text?: string }[])
          .map((c) => c.text ?? '')
          .join(' ')
          .trim();
        res.json({ text, isError: out.isError === true });
      } finally {
        await client.close();
      }
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
