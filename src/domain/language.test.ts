import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { CareStore } from '../store/store.ts';
import { createTelegramWebhook, SECRET_TOKEN_HEADER } from '../http/telegram-webhook.ts';
import { LANGUAGES, LANGUAGE_CODES, buttonLabel, languageNote, phrase, replyLanguageRule } from './language.ts';
import { dueReminders } from './reminders.ts';
import { systemPrompt } from '../sim/host.ts';

/**
 * A person is written to in their own language. The facts never change with it: the
 * medicine's name, the time, who recorded it. Where a translation is a draft, the English
 * goes underneath, so a wrong word is never the only copy.
 */

test('English is unchanged; a ready language is written in full; a draft one carries the English', () => {
  const dose = (lang: 'en' | 'es' | 'yo' | 'bin') => phrase(lang, ['dose', { time: '20:00', med: 'eye drops' }, { time: '8 PM', med: 'eye drops' }]);
  assert.equal(dose('en'), "It's 8 PM: time for your eye drops.");
  assert.equal(dose('es'), '20:00: es hora de su eye drops.', 'the medicine keeps the name the family gave it');
  assert.equal(dose('yo'), "Ó ti tó 20:00: àkókò láti lo eye drops yín.\n(It's 8 PM: time for your eye drops.)");
  assert.equal(dose('bin'), "It's 8 PM: time for your eye drops.", 'Edo has no phrasebook yet: English, not a guess');

  // Several pieces make one message, with one English line after all of it.
  const appt = phrase('ig', ['appt', { when: 'Fraịdee 10:00', kind: 'eye check-up' }, { when: 'Friday at 10 AM', kind: 'eye check-up' }], ['apptWithOne', { names: 'Sandra', it: 'the ride' }]);
  assert.equal(appt, 'Ncheta: Fraịdee 10:00, eye check-up gị. Sandra ga-ahụ maka ya.\n(Reminder: Friday at 10 AM, your eye check-up. Sandra is taking care of the ride.)');

  // What was heard carries no fact to lose, so no English is added to it.
  assert.equal(phrase('yo', ['heard', { text: 'mo ti lo oogun' }]), 'Ohun tí mo gbọ́: "mo ti lo oogun"');
  assert.equal(buttonLabel('yo', 'taken'), '✅ Mo ti lò ó / Taken');
  assert.equal(buttonLabel('fr', 'taken'), "✅ C'est pris");
});

test('every language says honestly what voice notes can do in it', () => {
  assert.match(languageNote('es'), /speak in Spanish and I'll understand/);
  assert.doesNotMatch(languageNote('es'), /in writing/);
  assert.match(languageNote('yo'), /please speak in English or Pidgin/);
  assert.match(languageNote('yo'), /answer in writing/);
  assert.match(languageNote('pcm'), /show you what I heard/);
  assert.match(languageNote('bin'), /answer in English/);
  for (const c of LANGUAGE_CODES) {
    const l = LANGUAGES[c];
    if (l.status === 'ready') assert.ok(l.hears && l.voice, `${c} is only "ready" when it can be heard and spoken`);
  }
});

test('the chat is told the language; the voice prompt, which is measured, is not', () => {
  assert.equal(replyLanguageRule(undefined), '');
  assert.equal(replyLanguageRule('en'), '');
  assert.equal(replyLanguageRule('klingon' as never), '', 'a bad value on the record is ignored, not a crash');
  const es = replyLanguageRule('es');
  assert.match(es, /Write every reply in Spanish/);
  assert.match(es, /"No record" must stay "no record"/);
  assert.match(es, /Write a medicine's name exactly as the tools give it/);
  assert.match(es, /nothing more/);
  assert.match(replyLanguageRule('yo'), /in English in brackets/);
  assert.match(replyLanguageRule('bin'), /reply in plain English/);

  const now = new Date('2026-09-24T12:00:00Z');
  const speaker = { name: 'Rosa', role: 'care_recipient' };
  assert.equal(
    systemPrompt({ now, speaker: { ...speaker, language: 'es' }, channel: 'voice' }),
    systemPrompt({ now, speaker, channel: 'voice' }),
    'voice prompt is identical with or without a language',
  );
  assert.match(systemPrompt({ now, speaker: { ...speaker, language: 'es' }, channel: 'chat' }), /Write every reply in Spanish/);
  assert.doesNotMatch(systemPrompt({ now, speaker, channel: 'chat' }), /Write every reply in/);
});

async function circle() {
  const store = new CareStore();
  await store.addHousehold({ id: 'h', name: 'circle', timezone: 'Africa/Lagos' });
  await store.addMember({ id: 'm_dad', householdId: 'h', name: 'Pius', role: 'care_recipient', spokenAs: 'Dad' });
  await store.addMember({ id: 'm_sam', householdId: 'h', name: 'Sam', role: 'primary_caregiver' });
  await store.addMedication({ id: 'med', householdId: 'h', name: 'eye drops', times: ['08:00'], forMemberId: 'm_dad' });
  return store;
}

test('reminders go out in the language of whoever receives them; choosing one leaves reminders as they were', async () => {
  const store = await circle();
  const at8 = new Date('2026-09-24T07:05:00Z'); // 8:05 in Lagos
  assert.equal(dueReminders(store.getCareState('h'), at8)[0]!.text, "It's 8 AM: time for your eye drops.");

  await store.setMemberPreference('m_dad', 'h', { reminders: 'off' });
  await store.setMemberPreference('m_dad', 'h', { language: 'yo' });
  assert.equal(store.getMember('m_dad').reminders, 'off', 'setting a language did not turn reminders back on');
  await store.setMemberPreference('m_dad', 'h', { reminders: undefined });

  const [r] = dueReminders(store.getCareState('h'), at8);
  assert.equal(r!.text, "Ó ti tó 08:00: àkókò láti lo eye drops yín.\n(It's 8 AM: time for your eye drops.)");
  assert.equal(r!.buttons![0]![0]!.text, '✅ Mo ti lò ó / Taken');
  assert.equal(r!.buttons![0]![0]!.data, 'dose:med:08:00', 'what a tap records does not change with the language');

  await store.setMemberPreference('m_dad', 'h', { language: 'en' });
  assert.equal(store.getMember('m_dad').language, undefined, 'English is the default, so it is not stored');
});

async function webhook() {
  const store = await circle();
  await store.linkTelegram({ telegramId: '10', memberId: 'm_dad', householdId: 'h', linkedAt: '2026-09-24T00:00:00Z' });
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  const heard: string[] = [];
  const spoken: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ method: String(url).split('/').pop()!, body: JSON.parse(String(init?.body)) });
    return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }), text: async () => '' } as unknown as Response;
  }) as unknown as typeof fetch;
  const h = createTelegramWebhook({
    store, secretToken: 's', botToken: 'b', memberByChat: new Map(), householdId: 'h', fetchImpl,
    now: () => new Date('2026-09-24T07:06:00Z'),
    chat: async () => 'reply',
    hear: async (_id, code) => { heard.push(code); return 'I don use my drops'; },
    speak: async (_chat, _text, voice) => { spoken.push(voice); },
  });
  let n = 1;
  const send = async (body: Record<string, unknown>) => {
    const res = { status() { return this; }, json(b: unknown) { (this as { body?: unknown }).body = b; return this; } } as unknown as Response & { body: { results: Array<{ status: string }> } };
    await h({ body: { update_id: n++, ...body }, header: (k: string) => (k.toLowerCase() === SECRET_TOKEN_HEADER ? 's' : undefined) } as unknown as Request, res);
    return res.body.results[0]!.status;
  };
  const say = (text: string) => send({ message: { message_id: 1, chat: { id: 10, type: 'private' }, from: { id: 10 }, text } });
  const voice = () => send({ message: { message_id: 2, chat: { id: 10, type: 'private' }, from: { id: 10 }, voice: { file_id: 'f', duration: 4 } } });
  const tap = (data: string) => send({ callback_query: { id: 'cb', data, from: { id: 10 }, message: { message_id: 5, chat: { id: 10 } } } });
  return { store, calls, heard, spoken, say, voice, tap };
}

test('/language offers every language as a button; a tap or a name sets it and says what to expect', async () => {
  const t = await webhook();
  assert.equal(await t.say('/language'), 'language-menu');
  const menu = t.calls.at(-1)!.body as { reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } };
  const offered = menu.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.deepEqual(offered, LANGUAGE_CODES.map((c) => `lang:${c}`));

  assert.equal(await t.tap('lang:ha'), 'language-set');
  assert.equal(t.store.getMember('m_dad').language, 'ha');
  const said = t.calls.find((c) => c.method === 'editMessageText')!.body['text'] as string;
  assert.match(said, /^To, zan riƙa rubuta maka da Hausa\./);
  assert.match(said, /No speech service can hear Hausa yet/);

  assert.equal(await t.say('/language yoruba'), 'language-set');
  assert.equal(t.store.getMember('m_dad').language, 'yo');
  assert.equal(await t.say('/language español'), 'language-set');
  assert.equal(t.store.getMember('m_dad').language, 'es');
  assert.equal(await t.tap('lang:xx'), 'tap-unknown');
});

test('a voice note is heard in their language, and answered aloud only in a voice that speaks it', async () => {
  const t = await webhook();
  await t.voice();
  assert.deepEqual([t.heard, t.spoken], [['en-US'], ['Ruth']]);

  await t.store.setMemberPreference('m_dad', 'h', { language: 'es' });
  await t.voice();
  assert.deepEqual([t.heard.at(-1), t.spoken.at(-1)], ['es-US', 'Lupe']);
  assert.match(t.calls.at(-1)!.body['text'] as string, /^Escuché: "/);

  // No service hears or speaks Yoruba: heard as English, as they were told, and answered in writing.
  await t.store.setMemberPreference('m_dad', 'h', { language: 'yo' });
  const before = t.spoken.length;
  await t.voice();
  assert.equal(t.heard.at(-1), 'en-US');
  assert.equal(t.spoken.length, before, 'no voice note in a voice that cannot speak Yoruba');
});

test('tapping Taken answers in their language, with the time written their way', async () => {
  const t = await webhook();
  await t.store.setMemberPreference('m_dad', 'h', { language: 'fr' });
  assert.equal(await t.tap('dose:med:08:00'), 'tap-taken');
  assert.equal(t.calls.find((c) => c.method === 'editMessageText')!.body['text'], '✅ Noté : eye drops, 8:06.');
});

test('every language with a phrasebook has every phrase, so nothing quietly falls back to English', () => {
  const keys = ['dose', 'taken', 'snooze', 'recorded', 'alreadyYou', 'alreadyBy', 'snoozed', 'repeat',
    'appt', 'apptWithOne', 'apptWithMany', 'apptHolder', 'apptUnowned', 'heard', 'languageSet'] as const;
  const vars = { time: 'T', med: 'eye drops', by: 'B', when: 'W', kind: 'K', names: 'N', it: 'it', them: 'M', tasks: 'X', text: 'Y' };
  for (const code of LANGUAGE_CODES) {
    if (code === 'en' || LANGUAGES[code].status === 'understood') continue;
    for (const key of keys) {
      const own = phrase(code, [key, vars]);
      assert.notEqual(own, phrase('en', [key, vars]), `${code} has its own "${key}"`);
      assert.doesNotMatch(own, /\{\w+\}/, `${code} "${key}" fills every blank`);
      if (key === 'dose' || key === 'recorded' || key === 'repeat') assert.match(own, /eye drops/, `${code} "${key}" keeps the medicine's name`);
    }
  }
  // Every language Alexa+ is sold in can be heard and spoken.
  for (const code of ['es', 'fr', 'pt', 'de', 'it', 'hi'] as const) assert.equal(LANGUAGES[code].status, 'ready');
  assert.equal(phrase('hi', ['dose', { time: '20:00', med: 'eye drops' }]), '20:00: eye drops का समय हो गया है।');
  assert.equal(phrase('de', ['dose', { time: '20:00', med: 'eye drops' }]), '20:00: Zeit für eye drops.');
});
