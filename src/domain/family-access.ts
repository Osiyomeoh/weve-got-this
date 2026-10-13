import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Who is looking at the family calendar - proved, never claimed.
 *
 * Inside Telegram, the calendar opens as a Mini App and Telegram hands it `initData`,
 * signed with a key derived from the bot token (Telegram's documented scheme:
 * key = HMAC-SHA256("WebAppData", botToken), hash = HMAC-SHA256(key, data-check-string)).
 * Only Telegram and this server can produce that signature, so the Telegram user in it
 * is who opened it. It is then matched to a member the same way chat messages are.
 *
 * In an ordinary browser, a person asks the bot for a link (`/calendar`), and gets one
 * signed for them with an expiry. No passwords anywhere, and nothing in the page can
 * name a different person.
 */

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The Telegram user who opened the Mini App, or null if the data is not genuinely from Telegram. */
export function telegramUserFromInitData(
  initData: string,
  botToken: string,
  now: Date,
  maxAgeSeconds = 24 * 3600,
): { id: string; firstName?: string } | null {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const check = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const key = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', key).update(check).digest('hex');
  if (!safeEqual(hash, expected)) return null;
  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || now.getTime() / 1000 - authDate > maxAgeSeconds) return null;
  try {
    const user = JSON.parse(params.get('user') ?? '{}') as { id?: number; first_name?: string };
    if (user.id === undefined) return null;
    return { id: String(user.id), ...(user.first_name ? { firstName: user.first_name } : {}) };
  } catch {
    return null;
  }
}

/** A personal calendar link token: member and expiry, signed. */
export function calendarToken(secret: string, memberId: string, expiresAt: Date): string {
  const body = Buffer.from(
    JSON.stringify({ m: memberId, e: Math.floor(expiresAt.getTime() / 1000) }),
  ).toString('base64url');
  const sig = createHmac('sha256', secret).update(`calendar:${body}`).digest('base64url');
  return `${body}.${sig}`;
}

export function memberFromCalendarToken(secret: string, token: string, now: Date): string | null {
  if (!secret || !token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret).update(`calendar:${body}`).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const { m, e } = JSON.parse(Buffer.from(body, 'base64url').toString()) as {
      m?: string;
      e?: number;
    };
    if (!m || !e || e * 1000 < now.getTime()) return null;
    return m;
  } catch {
    return null;
  }
}
