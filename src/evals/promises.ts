import type { EvalCase } from './corpus.js';

/**
 * Answers to "still on?" - what the person who promised says back when CareCircle checks
 * in on work that slipped past its time (src/domain/agent.ts, CHECK_IN).
 *
 * The check-in arrives as a message, not as a turn of the chat, so the planner sees the
 * reply alone: "dropped him off at nine", "car broke down", "ten minutes away". Three
 * answers, three right moves:
 *
 *  - done      -> mark it done (resolve_obligation), or look it up first
 *  - can't     -> hand it back so the next person is asked (respond_to_request), or look it
 *                 up first. add_note is wrong here: it records the excuse and leaves the
 *                 ride with someone who has just said they cannot do it.
 *  - still on  -> nothing to change: answer, or confirm it stays theirs
 *
 * All held out: written once, before any run, never tuned against. Run with
 * `npm run evals -- --promises`.
 */
const DONE = ['resolve_obligation', 'get_care_gaps', 'get_my_requests'];
const CANT = ['respond_to_request', 'get_care_gaps', 'get_my_requests'];
/**
 * Looking up "what's mine?" first is right here too, as it is for done and can't. The key
 * as first written left it out for this group only; the first run (19/30, kept in
 * evals/results/2026-10-05-promises-sonnet-4-5-key-as-written.json) showed the model doing
 * exactly that, so these cases are marked `seen`.
 */
const STILL_ON = ['respond_to_request', 'get_my_requests', 'get_care_gaps'];
const KEY_FIX = '2026-10-05: answer key made consistent (lookup first) after the first run';

export const PROMISE_CASES: EvalCase[] = [
  // --- It was done; nobody had said so -----------------------------------
  { id: 'hpdone-01', member: 'm_renee', utterance: 'Yes, dropped Daddy at the eye clinic at nine.', expect: DONE },
  { id: 'hpdone-02', member: 'm_aide', utterance: "Done already, I just didn't mark it.", expect: DONE },
  { id: 'hpdone-03', member: 'm_renee', utterance: "He's at the clinic now, all good.", expect: DONE },
  { id: 'hpdone-04', member: 'm_david', utterance: 'Picked up the eye drops this morning, forgot to say.', expect: DONE },
  { id: 'hpdone-05', member: 'm_renee', utterance: 'We got there on time, he is with the doctor.', expect: DONE },
  { id: 'hpdone-06', member: 'm_aide', utterance: 'I don carry Daddy go hospital since morning.', expect: DONE, note: 'Pidgin: I took Daddy to the hospital this morning.' },
  { id: 'hpdone-07', member: 'm_renee', utterance: 'E don do, we reach clinic.', expect: DONE, note: 'Pidgin: it is done, we reached the clinic.' },
  { id: 'hpdone-08', member: 'm_david', utterance: 'Sorted, he has his refill.', expect: DONE },
  { id: 'hpdone-09', member: 'm_aide', utterance: 'Yeah that happened, I took him at half eight.', expect: DONE },
  { id: 'hpdone-10', member: 'm_renee', utterance: 'All done, he is back home resting.', expect: DONE },

  // --- Can't, after all -------------------------------------------------
  { id: 'hpcant-01', member: 'm_renee', utterance: "Sorry, I can't make it after all, my car broke down.", expect: CANT },
  { id: 'hpcant-02', member: 'm_aide', utterance: "I won't be able to do it anymore, something came up at work.", expect: CANT },
  { id: 'hpcant-03', member: 'm_renee', utterance: "No, I can't take him today, please find someone else.", expect: CANT },
  { id: 'hpcant-04', member: 'm_david', utterance: "I'm stuck in traffic and won't get there, someone else needs to do it.", expect: CANT },
  { id: 'hpcant-05', member: 'm_aide', utterance: 'I no fit go again, abeg find another person.', expect: CANT, note: "Pidgin: I can't go anymore, please find someone else." },
  { id: 'hpcant-06', member: 'm_renee', utterance: 'Something don happen, I no go fit carry am.', expect: CANT, note: "Pidgin: something happened, I won't be able to take him." },
  { id: 'hpcant-07', member: 'm_renee', utterance: "Can't do it, my daughter is sick.", expect: CANT },
  { id: 'hpcant-08', member: 'm_aide', utterance: 'Give it to someone else, I have to pull out.', expect: CANT },
  { id: 'hpcant-09', member: 'm_david', utterance: "I have to back out of the pharmacy run, I'm so sorry.", expect: CANT },
  { id: 'hpcant-10', member: 'm_renee', utterance: "Not going to happen today, I'm still at the office.", expect: CANT },

  // --- Still on, just late -----------------------------------------------
  { id: 'hplate-01', member: 'm_renee', utterance: "Yes, still on, I'm ten minutes away.", expect: STILL_ON, noneOk: true, seen: KEY_FIX },
  { id: 'hplate-02', member: 'm_aide', utterance: 'On my way now.', expect: STILL_ON, noneOk: true, seen: KEY_FIX },
  { id: 'hplate-03', member: 'm_renee', utterance: "Running a bit late but I'm coming.", expect: STILL_ON, noneOk: true, seen: KEY_FIX },
  { id: 'hplate-04', member: 'm_david', utterance: 'Still on, just leaving the house.', expect: STILL_ON, noneOk: true, seen: KEY_FIX },
  { id: 'hplate-05', member: 'm_aide', utterance: 'I dey come, I don near.', expect: STILL_ON, noneOk: true, seen: KEY_FIX, note: "Pidgin: I'm coming, I'm close." },
  { id: 'hplate-06', member: 'm_renee', utterance: "Yes yes, I'm parking outside.", expect: STILL_ON, noneOk: true, seen: KEY_FIX },
  { id: 'hplate-07', member: 'm_renee', utterance: 'Still mine, will be there by half past.', expect: STILL_ON, noneOk: true, seen: KEY_FIX },
  { id: 'hplate-08', member: 'm_david', utterance: "Don't worry, I've got it, five minutes.", expect: STILL_ON, noneOk: true, seen: KEY_FIX },
  { id: 'hplate-09', member: 'm_aide', utterance: 'Traffic but I go reach.', expect: STILL_ON, noneOk: true, seen: KEY_FIX, note: "Pidgin: there's traffic but I'll get there." },
  { id: 'hplate-10', member: 'm_renee', utterance: 'Yes, still doing it.', expect: STILL_ON, noneOk: true, seen: KEY_FIX },
];
