/**
 * What CareCircle is connected to, as a first-class thing the MCP surface can report.
 *
 * The data doors (Calendar, Gmail, Ring, Bee, WhatsApp, Telegram) live at the edges as
 * webhooks and pollers - they cannot themselves be MCP tools, because a webhook is an
 * inbound push, not something the agent calls. But *whether* each one is connected, and
 * whether it is actually carrying events, is exactly the kind of question an Alexa+ agent
 * should be able to ask through MCP. This is the pure core of that answer: given the
 * environment (what is configured) and the event log (what has actually arrived), say for
 * each source whether it is live, merely configured, or not set up - honestly, never
 * claiming a connection that is not there.
 *
 * "Configured" is read from the same environment variables the connectors require, so this
 * cannot drift from what actually runs. "Live" additionally requires that at least one real
 * event from that source has landed - a connected door that has never spoken is told apart
 * from one that has.
 */

export type ConnectionStatus = 'live' | 'configured' | 'not_configured';

export interface Connection {
  /** The source key, matching the EventSource an event from here carries. */
  source: string;
  /** Human label for speech. */
  label: string;
  status: ConnectionStatus;
  /** A sentence phrased for a voice assistant to read verbatim. */
  detail: string;
  /** ISO time of the most recent event from this source, when any. */
  lastEventAt?: string;
}

export interface ConnectionsReport {
  connections: Connection[];
  spoken: string;
}

interface Spec {
  source: string;
  /** The EventSource value an inbound event from this door carries. */
  eventSource: string;
  label: string;
  /** Env vars that must all be present for the door to be configured. */
  required: string[];
  /** What to do to connect it, when it is not. */
  hint: string;
}

const SPECS: Spec[] = [
  {
    source: 'calendar',
    eventSource: 'calendar',
    label: 'Google Calendar',
    required: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'],
    hint: 'add Google OAuth with the Calendar scope',
  },
  {
    source: 'gmail',
    eventSource: 'email',
    label: 'Gmail',
    required: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'],
    hint: 'add Google OAuth with the Gmail scope',
  },
  {
    source: 'ring',
    eventSource: 'ring',
    label: 'Ring',
    required: ['RING_HMAC_KEY'],
    hint: 'set RING_HMAC_KEY and point the Ring webhook here',
  },
  {
    source: 'bee',
    eventSource: 'bee',
    label: 'Bee',
    required: ['BEE_TOKEN', 'BEE_API_BASE'],
    hint: 'set BEE_TOKEN and BEE_API_BASE',
  },
  {
    source: 'whatsapp',
    eventSource: 'whatsapp',
    label: 'WhatsApp',
    required: ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_RECIPIENTS'],
    hint: 'set the WHATSAPP_* variables (going live needs Meta business verification)',
  },
  {
    source: 'telegram',
    eventSource: 'telegram',
    label: 'Telegram',
    required: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_RECIPIENTS'],
    hint: 'set TELEGRAM_BOT_TOKEN and TELEGRAM_RECIPIENTS',
  },
];

function present(env: NodeJS.ProcessEnv, key: string): boolean {
  return typeof env[key] === 'string' && env[key]!.trim().length > 0;
}

export function describeConnections(
  env: NodeJS.ProcessEnv,
  events: ReadonlyArray<{ source?: string; occurredAt?: string }>,
): ConnectionsReport {
  const connections: Connection[] = SPECS.map((spec) => {
    const configured = spec.required.every((k) => present(env, k));

    let lastEventAt: string | undefined;
    for (const e of events) {
      if (e.source !== spec.eventSource || !e.occurredAt) continue;
      if (!lastEventAt || e.occurredAt > lastEventAt) lastEventAt = e.occurredAt;
    }

    const status: ConnectionStatus = configured
      ? lastEventAt
        ? 'live'
        : 'configured'
      : 'not_configured';

    // Telegram alone has a mode worth naming: a private DM vs the whole family group.
    const telegramMode =
      spec.source === 'telegram' && present(env, 'TELEGRAM_GROUP_CHAT_ID')
        ? ' in family-group mode'
        : '';

    const detail =
      status === 'live'
        ? `${spec.label} is live${telegramMode} and receiving events.`
        : status === 'configured'
          ? `${spec.label} is connected${telegramMode} but has not received an event yet.`
          : `${spec.label} is not connected — ${spec.hint}.`;

    return {
      source: spec.source,
      label: spec.label,
      status,
      detail,
      ...(lastEventAt ? { lastEventAt } : {}),
    };
  });

  const live = connections.filter((c) => c.status === 'live').map((c) => c.label);
  const ready = connections.filter((c) => c.status === 'configured').map((c) => c.label);
  const off = connections.filter((c) => c.status === 'not_configured').map((c) => c.label);

  const parts: string[] = [];
  if (live.length) parts.push(`Live: ${live.join(', ')}.`);
  if (ready.length) parts.push(`Connected but quiet: ${ready.join(', ')}.`);
  if (off.length) parts.push(`Not set up yet: ${off.join(', ')}.`);
  const spoken = parts.length ? parts.join(' ') : 'No data connections are configured.';

  return { connections, spoken };
}
