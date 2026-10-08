// The language you speak in, on your turn. The same choices as a member's language on the
// record (src/domain/language.ts): Transcribe hears it where it can, Alexa answers in it,
// and Polly speaks the answer in that language's voice. Where no service hears or speaks
// it (Yoruba, Igbo, Hausa, Edo), you are heard in English and the answer is written.

export interface SpeechLanguage { code: string; native: string; hears: boolean; voice: string | null }

export const SPEECH_LANGUAGES: SpeechLanguage[] = [
  { code: 'en', native: 'English', hears: true, voice: 'Ruth' },
  { code: 'pcm', native: 'Naijá (Pidgin)', hears: true, voice: 'Ruth' },
  { code: 'yo', native: 'Yorùbá', hears: false, voice: null },
  { code: 'ig', native: 'Igbo', hears: false, voice: null },
  { code: 'ha', native: 'Hausa', hears: false, voice: null },
  { code: 'bin', native: 'Ẹ̀dó', hears: false, voice: null },
  { code: 'es', native: 'Español', hears: true, voice: 'Lupe' },
  { code: 'fr', native: 'Français', hears: true, voice: 'Lea' },
  { code: 'pt', native: 'Português', hears: true, voice: 'Camila' },
  { code: 'de', native: 'Deutsch', hears: true, voice: 'Vicki' },
  { code: 'it', native: 'Italiano', hears: true, voice: 'Bianca' },
  { code: 'hi', native: 'हिन्दी', hears: true, voice: 'Kajal' },
  { code: 'zh', native: '中文', hears: true, voice: 'Zhiyu' },
];

const KEY = 'carecircle-speech-language';
let current = (() => { try { return localStorage.getItem(KEY) ?? 'en'; } catch { return 'en'; } })();
if (!SPEECH_LANGUAGES.some((l) => l.code === current)) current = 'en';

export const speechLanguage = (): SpeechLanguage => SPEECH_LANGUAGES.find((l) => l.code === current)!;

export function setSpeechLanguage(code: string): void {
  if (!SPEECH_LANGUAGES.some((l) => l.code === code)) return;
  current = code;
  try { localStorage.setItem(KEY, code); } catch { /* the choice lasts this visit */ }
}
