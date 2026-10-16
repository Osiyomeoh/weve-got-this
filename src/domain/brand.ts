/**
 * What the product is called wherever a person reads it: a page title, the sender of a
 * message, the server's name in an agent's list of connections.
 *
 * Only what people read changes with the name. Stored ids (`system:carecircle`), env
 * names (`CARECIRCLE_*`), resource URIs, OAuth scopes and AWS resources keep the old one,
 * so nothing already connected or recorded breaks.
 */
export const BRAND = "We've Got This";

/**
 * What the agent is called inside a sentence. The name does not work as a subject -
 * spoken, "We've Got This asked Funmi" is heard as two sentences - so when the agent does
 * something it is "the app", and the name stays on titles and senders.
 */
export const AGENT_IN_A_SENTENCE = 'the app';
