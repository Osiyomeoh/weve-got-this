// The people in the world, and where things are. Every person here is a real member of
// the visitor's own copy of the demo household, reached with their own credential.

export type Place = 'daddy' | 'tolu' | 'street' | 'pharmacy';

export interface Person {
  /** The member this person is, in the care record. */
  memberId: string;
  name: string;
  /** Who they are to the family, said plainly. */
  role: string;
  /** What playing them is like, for the role picker. */
  playAs: string;
  model: string;
  /** Polly voice (allowlisted by the console server); the browser's own voice if Polly is down. */
  voice: string;
  /** Pitch for the browser fallback voice, so people still sound different. */
  fallbackPitch: number;
  color: string;
  place: Place;
  /** What they hold, wear or ride, from the same CC0 kit. */
  aid?: 'sunglasses' | 'glasses' | 'wheelchair';
}

export const CAST: Record<string, Person> = {
  daddy: {
    memberId: 'm_margaret',
    name: 'Daddy',
    role: 'Recovering from eye surgery, at home',
    playAs: "You can't read a screen this week. Everything you do, you do by voice.",
    model: 'character-male-f',
    voice: 'Gregory',
    fallbackPitch: 0.8,
    color: '#ffd27a',
    place: 'daddy',
    aid: 'sunglasses',
  },
  tolu: {
    memberId: 'm_david',
    name: 'Tolu',
    role: 'His son, coordinating care around a full-time job',
    playAs: 'You hold it all together from across town, between meetings.',
    model: 'character-male-b',
    voice: 'Matthew',
    fallbackPitch: 1.0,
    color: '#7cf0c8',
    place: 'tolu',
  },
  musa: {
    memberId: 'm_aide',
    name: 'Musa',
    role: "The family's driver and helper",
    playAs: "You're on the road. Your phone is how the family reaches you.",
    model: 'character-male-d',
    voice: 'Stephen',
    fallbackPitch: 1.1,
    color: '#9cc3ff',
    place: 'street',
  },
};

export const ALEXA_VOICE = 'Ruth';

/** Who can be played. The rest are played by the world, on cue. */
export const PLAYABLE = ['tolu', 'daddy', 'musa'] as const;
export type PersonKey = keyof typeof CAST;
