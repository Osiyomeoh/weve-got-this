import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { CareStore } from '../store/store.ts';
import { createTelegramWebhook, SECRET_TOKEN_HEADER } from './telegram-webhook.ts';
import { parseTelegramUpdate } from '../domain/telegram.ts';

/**
 * Voice notes. After eye surgery, speaking is easier than typing and listening easier
 * than reading, so a voice note to the bot is heard, answered in text and aloud, and
 * what was heard is shown so a misheard word is caught before it becomes the record.
 */

const SECRET = 's';

async function setup(hear?: (id: string) => Promise<string>) {
  const store = new CareStore();
  await store.addHousehold({ id: 'h', name: 'circle', timezone: 'Africa/Lagos' });
  await store.addMember({
    id: 'm_dad',
    householdId: 'h',
    name: 'Pius',
    role: 'care_recipient',
    spokenAs: 'Dad',
  });
  const texts: Array<{ chat_id: string; text: string }> = [];
  const spoken: Array<{ chatId: string; text: string }> = [];
  const heardIds: string[] = [];
  const said: string[] = [];
  const fetchImpl = (async (_u: string, init?: RequestInit) => {
    texts.push(JSON.parse(String(init?.body)));
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: {} }),
      text: async () => '',
    } as unknown as Response;
  }) as unknown as typeof fetch;
  const h = createTelegramWebhook({
    store,
    secretToken: SECRET,
    botToken: 'b',
    memberByChat: new Map([['10', 'm_dad']]),
    householdId: 'h',
    fetchImpl,
    chat: async (_m, text) => {
      said.push(text);
      return "Got it, I've logged the eye drops.";
    },
    ...(hear
      ? {
          hear: async (id: string) => {
            heardIds.push(id);
            return hear(id);
          },
        }
      : {}),
    speak: async (chatId, text) => {
      spoken.push({ chatId, text });
    },
  });
  let n = 1;
  const post = async (message: Record<string, unknown>) => {
    const res = {
      status() {
        return this;
      },
      json(b: unknown) {
        (this as { body?: unknown }).body = b;
        return this;
      },
    } as unknown as Response & { body: { results: Array<{ status: string }> } };
    await h(
      {
        body: { update_id: n++, message: { message_id: 1, from: { id: 10 }, ...message } },
        header: (k: string) => (k.toLowerCase() === SECRET_TOKEN_HEADER ? SECRET : undefined),
      } as unknown as Request,
      res,
    );
    return res.body.results[0]!.status;
  };
  return { texts, spoken, heardIds, said, post };
}

const dm = { chat: { id: 10, type: 'private' } };

test('a voice note is heard, answered in text with what was heard, and answered aloud', async () => {
  const t = await setup(async () => "I've taken my eye drops");
  assert.equal(await t.post({ ...dm, voice: { file_id: 'f1', duration: 4 } }), 'chat');
  assert.deepEqual(t.said, ["I've taken my eye drops"]);
  assert.equal(
    t.texts.at(-1)!.text,
    'I heard: "I\'ve taken my eye drops"\n\nGot it, I\'ve logged the eye drops.',
  );
  assert.deepEqual(
    t.spoken,
    [{ chatId: '10', text: "Got it, I've logged the eye drops." }],
    'the spoken reply leaves out the transcript',
  );
});

test("the family's voice notes to each other are never listened to", async () => {
  const t = await setup(async () => 'anything');
  assert.equal(
    await t.post({ chat: { id: -5, type: 'group' }, voice: { file_id: 'f2', duration: 4 } }),
    'unparsed',
  );
  assert.deepEqual(t.heardIds, []);
});

test("a voice note that can't be made out, or is too long, gets a gentle ask; nothing is recorded", async () => {
  const unclear = await setup(async () => '  ');
  assert.equal(
    await unclear.post({ ...dm, voice: { file_id: 'f3', duration: 3 } }),
    'voice-unclear',
  );
  assert.match(unclear.texts.at(-1)!.text, /couldn't make out that voice note/);
  assert.deepEqual(unclear.said, []);
  const long = await setup(async () => 'x');
  assert.equal(
    await long.post({ ...dm, voice: { file_id: 'f4', duration: 300 } }),
    'voice-too-long',
  );
  assert.deepEqual(long.heardIds, [], 'not even downloaded');
  const deaf = await setup();
  assert.equal(
    await deaf.post({ ...dm, voice: { file_id: 'f5', duration: 3 } }),
    'voice-unsupported',
  );
});

test('Telegram voice updates parse with their file id and length', () => {
  const [m] = parseTelegramUpdate({
    update_id: 1,
    message: {
      chat: { id: 10, type: 'private' },
      from: { id: 10 },
      voice: { file_id: 'abc', duration: 7 },
    },
  });
  assert.deepEqual(m!.voice, { fileId: 'abc', seconds: 7 });
  assert.equal(m!.text, '');
});
