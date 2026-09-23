/**
 * End-to-end walkthrough of the demo story, driven through a real MCP client over
 * Streamable HTTP. This is the story the video tells, executed against the server.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const ENDPOINT = new URL(process.env.CARECIRCLE_URL ?? 'http://localhost:8787/mcp');

async function connect(token: string): Promise<Client> {
  const client = new Client({ name: 'carecircle-e2e', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(ENDPOINT, {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport as never);
  return client;
}

const say = (who: string, text: string) => console.log(`\n${who}: "${text}"`);
const alexa = (r: any) => {
  const text = r.content?.[0]?.text ?? '(no text)';
  console.log(`  Alexa: ${text}`);
  return r;
};
const call = (c: Client, name: string, args: Record<string, unknown> = {}) =>
  c.callTool({ name, arguments: args }) as Promise<any>;

const daddy = await connect('margaret-token');
const tolu = await connect('david-token');
const funmi = await connect('renee-token');
const musa = await connect('aide-token');

const tools = await tolu.listTools();
console.log(`Server exposes ${tools.tools.length} tools, protocol negotiated OK.`);

say('Daddy (Echo at home)', 'I used my eye drops.');
alexa(await call(daddy, 'log_care_event', { kind: 'medication_taken', medicationName: 'eye drops' }));

say('Funmi (phone)', 'Daddy has his eye check-up Thursday at 10.');
const appt = alexa(await call(funmi, 'record_appointment', {
  kind: 'eye check-up',
  startsAt: new Date(Date.now() + 2 * 86400000).toISOString(),
}));
const proposalId = appt.structuredContent?.proposals?.[0]?.id;

say('Funmi', 'Yes, he will need a ride.');
alexa(await call(funmi, 'confirm_proposal', { obligationId: proposalId, confirmed: true }));

say('Funmi', 'Daddy asked who is taking him on Thursday.');
alexa(await call(funmi, 'add_note', { note: 'Daddy asked who is taking him on Thursday.' }));

say('Tolu (driving)', "What's going to fall through the cracks this week?");
const gaps = alexa(await call(tolu, 'get_care_gaps', { withinDays: 7 }));
console.log('  [structured]', JSON.stringify(
  gaps.structuredContent.gaps.map((g: any) => ({ severity: g.severity, kind: g.kind })),
));

say('Tolu', "I'll take the check-up one.");
const first = gaps.structuredContent.gaps.find((g: any) => g.obligationId);
alexa(await call(tolu, 'claim_obligation', { obligationId: first.obligationId }));

say('Tolu', "How's Daddy doing today?");
alexa(await call(tolu, 'get_care_summary'));

console.log('\n--- authority checks ---');
say('Funmi (caregiver)', 'Assign the pharmacy run to Tolu.');
alexa(await call(funmi, 'assign_obligation', { obligationId: first.obligationId, assigneeName: 'Tolu' }));

say('Musa (driver)', "What's going on with the family?");
alexa(await call(musa, 'get_care_gaps'));

say('Musa (driver)', 'What do I need to know today?');
alexa(await call(musa, 'get_shift_brief'));

await Promise.all([daddy.close(), tolu.close(), funmi.close(), musa.close()]);
console.log('\nDone.');
