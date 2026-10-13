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
 *
 * The same claims in every voice: missed, skipped and forgot, as done ("he skipped them"),
 * ongoing ("he's skipping doses") or done to the dose ("the drops were not given", "they
 * haven't been taken"). A blunt word costs a rephrase, not a wrong answer: the planner is
 * asked again, and an honest "the clinic run hasn't been given to anyone" comes back as "the
 * clinic run has no owner yet". "Missing" is left out: "a missing record" is the honest one.
 */
export const BLAME = new RegExp(
  [
    String.raw`\bmissed\b`,
    String.raw`\bskip(?:ped|ping)\b`,
    String.raw`\bforg(?:ot|otten|etting)\b`,
    String.raw`\b(?:did|has|have|had|was|were|is|are)(?:n['’]t| not)(?: yet)?(?: been)? (?:take|taken|give|given)\b`,
    String.raw`\bfailed to (?:take|give)\b`,
    String.raw`\bnever (?:took|taken|gave|given)\b`,
  ].join('|'),
  'i',
);

/** The blaming words in `text`, or null when there are none. */
export function blameIn(text: string): string | null {
  return BLAME.exec(text)?.[0] ?? null;
}
