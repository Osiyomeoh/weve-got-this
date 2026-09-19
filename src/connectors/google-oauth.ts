/**
 * Shared Google OAuth: the one refresh-grant both Google doors use.
 *
 * The Calendar and Gmail connectors authenticate the same way against the same
 * account, so the token exchange lives here rather than in either one. The refresh
 * token is minted once, out of band (scripts/google-auth.ts), and never leaves the
 * server; each connector trades it for a short-lived access token per run.
 */

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Exchange a long-lived refresh token for a short-lived access token. */
export async function refreshAccessToken(creds: GoogleCredentials): Promise<string> {
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: creds.refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google token refresh failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('Google token refresh returned no access_token.');
  return json.access_token;
}
