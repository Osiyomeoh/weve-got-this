/**
 * The words CareCircle never says about a person.
 *
 * The record only knows what somebody recorded. A dose with no record may have been taken
 * and not logged, so "he missed his drops" is a claim nobody made, about a person who is
 * listening. The server's own sentences are tested against this list (mcp/fuzz.props.test.ts);
 * a planner that speaks them is checked against it before anything is said (strands/no-blame.ts).
 *
 * It is deliberately blunt: "nothing was missed" is caught too, because the record cannot
 * show that either.
 */
export const BLAME = /\bmissed\b|\bskipped\b|\bforgot\b|\bdid(?:n['’]t| not) take\b|\bhas(?:n['’]t| not) taken\b|\bfailed to take\b/i;

/** The blaming words in `text`, or null when there are none. */
export function blameIn(text: string): string | null {
  return BLAME.exec(text)?.[0] ?? null;
}
