/**
 * One-time Google OAuth, to mint the refresh token the connector uses.
 *
 *   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npm run google:auth
 *
 * This is the standard OAuth 2.0 loopback (installed-app) flow. It opens a local
 * server, prints a Google consent URL, and after you authorize in the browser it
 * exchanges the returned code for a long-lived refresh token and prints it. Put
 * that token in GOOGLE_REFRESH_TOKEN (e.g. in .env) and the connector can read your
 * real calendar. The token is the only durable secret; the code and the local
 * server exist only for these few seconds.
 *
 * Prerequisites (done once in the Google Cloud console, by you):
 *  - a project with the Google Calendar API enabled;
 *  - an OAuth client of type "Desktop app" -> its client id and secret;
 *  - your Google account added as a test user on the OAuth consent screen.
 */
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';

const clientId = process.env['GOOGLE_CLIENT_ID']?.trim();
const clientSecret = process.env['GOOGLE_CLIENT_SECRET']?.trim();

if (!clientId || !clientSecret) {
  console.error(
    'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first (from your Desktop OAuth client).',
  );
  process.exit(1);
}

// Both Google doors in one consent: calendar.events (read upcoming events + write
// owned work back to the shared calendar) and gmail.readonly (read invite emails).
// Neither grants access to calendar settings or the ability to send mail.
const SCOPE = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.readonly',
].join(' ');

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost`);
  const code = url.searchParams.get('code');
  const err = url.searchParams.get('error');

  if (err) {
    res.end(`Authorization failed: ${err}. You can close this tab.`);
    console.error('Authorization was denied:', err);
    server.close();
    process.exit(1);
  }
  if (!code) {
    res.end('Waiting for authorization…');
    return;
  }

  const { port } = server.address() as AddressInfo;
  try {
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `http://localhost:${port}`,
      grant_type: 'authorization_code',
    });
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = (await tokenRes.json()) as { refresh_token?: string; error_description?: string };
    if (!tokenRes.ok || !json.refresh_token) {
      throw new Error(json.error_description ?? `token exchange failed (${tokenRes.status})`);
    }
    res.end('CareCircle is connected to your Google Calendar. You can close this tab.');
    console.log('\n✅ Success. Add this to your .env:\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${json.refresh_token}\n`);
  } catch (e) {
    res.end('Token exchange failed. See the terminal.');
    console.error('\n❌ Token exchange failed:', (e as Error).message);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});

server.listen(0, () => {
  const { port } = server.address() as AddressInfo;
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', `http://localhost:${port}`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPE);
  // offline + consent guarantees a refresh_token even on a repeat authorization.
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  console.log('\nOpen this URL in your browser and authorize CareCircle:\n');
  console.log(authUrl.toString());
  console.log('\nListening for the redirect on http://localhost:' + port + ' …');
});
