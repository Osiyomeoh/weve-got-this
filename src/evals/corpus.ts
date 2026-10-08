/**
 * Tool-selection corpus.
 *
 * Each case is something a real member of a care circle would say, paired with the
 * tool the server intends them to reach. This measures the one thing that decides
 * whether an MCP server is any good in practice: given only the tool descriptions,
 * does the model pick the right tool?
 *
 * `expect` lists every acceptable first call. Some utterances legitimately admit
 * more than one route - "I'll take the cardiology one" may reasonably begin with
 * get_care_gaps to resolve which item is meant - and marking those as failures
 * would measure our opinions rather than the model's judgement.
 *
 * get_my_requests joined ten claim/confirm/resolve keys on 2026-10-08, after a run scored
 * 139/155 with it counted wrong. It is the route the planner was told to take on 2026-10-03
 * (cc42789, src/sim/host.ts): a short "I've got it" first checks whether someone asked them,
 * because then it is respond_to_request. shift-04 ("Anything assigned to me?") is the same
 * question that tool's description has named since it was written. Disclosed in the README.
 *
 * `expectNone` marks utterances where reaching for a tool at all is the error.
 */

export interface EvalCase {
  id: string;
  /** Who is speaking. Their role changes what is plausible. */
  member: 'm_margaret' | 'm_david' | 'm_renee' | 'm_aide';
  utterance: string;
  /** Acceptable first tool calls. */
  expect?: string[];
  /** True when the right behaviour is to answer or ask, not to call a tool. */
  expectNone?: boolean;
  /**
   * True when calling nothing is as right as any tool in `expect` - for requests another
   * part of the assistant could equally own (a reminder, a calendar question), where
   * leaving it alone is correct and taking it is in scope.
   */
  noneOk?: boolean;
  /** Argument assertions on the chosen call. */
  args?: Record<string, (value: unknown) => boolean>;
  /** Why this case exists, when it is not obvious. */
  note?: string;
  /**
   * Set when a held-out case was later used to fix the server. It still runs, but it
   * no longer measures phrasing the tools were never tuned against, so it is reported
   * apart from the unseen held-out cases.
   */
  seen?: string;
}

const PURCHASE_FIX = '2026-09-23: used to fix the purchase tools';
const CARE_CHANGES = '2026-09-23: answer key widened after the run that added change_appointment';
const RESOLVE_FIX = '2026-09-23: looked at while fixing resolve vs log, from the Alexa bridge run';

const contains = (needle: string) => (v: unknown) =>
  typeof v === 'string' && v.toLowerCase().includes(needle);

export const CORPUS: EvalCase[] = [
  // --- Daddy logs his own life ------------------------------------------
  { id: 'log-01', member: 'm_margaret', utterance: 'I took my eye drops.', expect: ['log_care_event'] },
  { id: 'log-02', member: 'm_margaret', utterance: 'Just took my supplement.', expect: ['log_care_event'] },
  { id: 'log-03', member: 'm_margaret', utterance: "I've had my morning tablets.", expect: ['log_care_event'] },
  { id: 'log-04', member: 'm_margaret', utterance: 'I took the little white one about an hour ago.', expect: ['log_care_event'],
    note: 'Vague medication name - should still log, or ask which one.' },
  { id: 'log-05', member: 'm_margaret', utterance: "I'm feeling alright today.", expect: ['log_care_event', 'add_note'] },
  { id: 'log-06', member: 'm_margaret', utterance: 'I had my pills with breakfast.', expect: ['log_care_event'] },
  { id: 'log-07', member: 'm_david', utterance: 'Daddy took his evening pill, I watched him.', expect: ['log_care_event'],
    note: 'Logging on behalf of someone else.' },
  { id: 'log-08', member: 'm_aide', utterance: 'Daddy took his eye drops at two.', expect: ['log_care_event'] },

  // --- Appointments ------------------------------------------------------
  { id: 'appt-01', member: 'm_renee', utterance: 'Daddy has his eye check-up on Thursday at ten.', expect: ['record_appointment'],
    args: { kind: contains('eye') } },
  { id: 'appt-02', member: 'm_margaret', utterance: 'I have a dentist appointment next Tuesday at 2pm.', expect: ['record_appointment'] },
  { id: 'appt-03', member: 'm_david', utterance: 'Put Daddy down for physical therapy Friday morning at nine.', expect: ['record_appointment'] },
  { id: 'appt-04', member: 'm_renee', utterance: 'The clinic moved his bloodwork to Monday at eight.', expect: ['record_appointment', 'change_appointment'],
    note: 'change_appointment was added 2026-09-23 and is the better home when the bloodwork is already on the record; a single turn cannot know whether it is.' },
  { id: 'appt-05', member: 'm_david', utterance: "He's got an eye test on the fourth at 11:30.", expect: ['record_appointment'] },
  { id: 'appt-06', member: 'm_renee', utterance: 'Book club is Wednesday evening at seven.', expect: ['record_appointment'],
    note: 'Non-medical: should record but propose no transport.' },

  // --- When care changes (added 2026-09-23 with the tools) ------------------
  { id: 'medchange-01', member: 'm_david', utterance: 'The doctor says Daddy can stop the eye drops now.', expect: ['change_medication'] },
  { id: 'medchange-02', member: 'm_renee', utterance: 'His eye drops are at nine and nine now, not eight.', expect: ['change_medication'] },
  { id: 'medchange-03', member: 'm_david', utterance: 'He only needs the antibiotic until Sunday.', expect: ['change_medication'] },
  { id: 'medchange-04', member: 'm_david', utterance: 'Add his new vitamin, every morning at nine.', expect: ['add_medication'],
    note: 'A new medication is add_medication, not a change.' },
  { id: 'move-01', member: 'm_renee', utterance: 'The eye check-up has moved to Friday at two.', expect: ['change_appointment'] },
  { id: 'move-02', member: 'm_david', utterance: "They cancelled Daddy's physio tomorrow.", expect: ['change_appointment'] },
  { id: 'move-03', member: 'm_renee', utterance: 'The clinic pushed his appointment back an hour.', expect: ['change_appointment'] },
  { id: 'urgent-01', member: 'm_margaret', utterance: "I've fallen in the bathroom and I can't get up.", expect: ['raise_urgent'] },
  { id: 'urgent-02', member: 'm_renee', utterance: 'Daddy is having chest pains, tell everyone now.', expect: ['raise_urgent'] },
  { id: 'urgent-03', member: 'm_aide', utterance: "He's suddenly very confused and doesn't know where he is.", expect: ['raise_urgent'] },
  { id: 'urgent-04', member: 'm_renee', utterance: 'Daddy fell asleep early tonight.', expect: ['add_note', 'log_care_event'],
    note: 'Not an emergency: "fell asleep" must not alert the whole family.' },

  // --- Notes and observations -------------------------------------------
  { id: 'note-01', member: 'm_renee', utterance: 'Daddy sounded tired on the phone.', expect: ['add_note'] },
  { id: 'note-02', member: 'm_david', utterance: 'The doctor changed his dose to twice a day.', expect: ['add_note', 'change_medication'],
    note: 'change_medication was added 2026-09-23; without the new times it may still ask or note it.' },
  { id: 'note-03', member: 'm_aide', utterance: "He didn't eat much lunch today.", expect: ['add_note'] },
  { id: 'note-04', member: 'm_renee', utterance: 'Just so everyone knows, the pharmacy called about the refill.', expect: ['add_note'] },
  { id: 'note-05', member: 'm_david', utterance: 'He seemed a bit confused this morning but fine by lunch.', expect: ['add_note'] },
  { id: 'note-06', member: 'm_aide', utterance: 'Her ankles looked a little swollen.', expect: ['add_note'] },

  // --- The core question -------------------------------------------------
  { id: 'gap-01', member: 'm_david', utterance: "What's going to fall through the cracks this week?", expect: ['get_care_gaps'] },
  { id: 'gap-02', member: 'm_david', utterance: "What hasn't been assigned?", expect: ['get_care_gaps'] },
  { id: 'gap-03', member: 'm_renee', utterance: 'Is anything being missed with Daddy?', expect: ['get_care_gaps'] },
  { id: 'gap-04', member: 'm_david', utterance: 'What still needs doing for Daddy?', expect: ['get_care_gaps'] },
  { id: 'gap-05', member: 'm_renee', utterance: 'What does Daddy need this week?', expect: ['get_care_gaps', 'get_care_summary'] },
  { id: 'gap-06', member: 'm_david', utterance: 'Is there anything nobody has picked up?', expect: ['get_care_gaps'] },
  { id: 'gap-07', member: 'm_david', utterance: 'Anything I need to worry about?', expect: ['get_care_gaps', 'get_care_summary'] },
  { id: 'gap-08', member: 'm_renee', utterance: 'What are the open items?', expect: ['get_care_gaps'] },

  // --- Claiming ----------------------------------------------------------
  { id: 'claim-01', member: 'm_david', utterance: "I'll take the check-up one.", expect: ['claim_obligation', 'get_care_gaps', 'get_my_requests'] },
  { id: 'claim-02', member: 'm_david', utterance: "I've got Thursday.", expect: ['claim_obligation', 'get_care_gaps', 'get_my_requests'] },
  { id: 'claim-03', member: 'm_renee', utterance: "I'll do the prescription pickup.", expect: ['claim_obligation', 'get_care_gaps'] },
  { id: 'claim-04', member: 'm_david', utterance: "I'll handle both of those.", expect: ['claim_obligation', 'get_care_gaps'] },
  { id: 'claim-05', member: 'm_aide', utterance: "I can take that one.", expect: ['claim_obligation', 'get_care_gaps', 'get_shift_brief', 'get_my_requests'] },
  { id: 'claim-06', member: 'm_renee', utterance: 'Put me down for the drive.', expect: ['claim_obligation', 'get_care_gaps'] },

  // --- Assigning (distinct from claiming) --------------------------------
  { id: 'assign-01', member: 'm_david', utterance: 'Give the pharmacy run to Funmi.', expect: ['assign_obligation', 'get_care_gaps'],
    note: 'Must not be confused with claim_obligation.' },
  { id: 'assign-02', member: 'm_david', utterance: 'Ask Funmi to take Thursday.', expect: ['assign_obligation', 'notify_member', 'get_care_gaps'] },
  { id: 'assign-03', member: 'm_david', utterance: 'Funmi should do the prescription.', expect: ['assign_obligation', 'get_care_gaps'] },
  { id: 'assign-04', member: 'm_renee', utterance: 'Assign the check-up drive to Tolu.', expect: ['assign_obligation', 'get_care_gaps'],
    note: 'Funmi lacks the capability - the tool should refuse, but choosing it is correct.' },
  { id: 'assign-05', member: 'm_david', utterance: 'Can Musa cover the Monday visit?', expect: ['assign_obligation', 'notify_member', 'get_care_gaps'] },

  // --- Confirming what the system guessed --------------------------------
  { id: 'confirm-01', member: 'm_renee', utterance: "Yes, he'll need a ride.", expect: ['confirm_proposal', 'get_care_gaps'] },
  { id: 'confirm-02', member: 'm_david', utterance: "No, he doesn't need anyone to go in with him.", expect: ['confirm_proposal', 'get_care_gaps'] },
  { id: 'confirm-03', member: 'm_renee', utterance: "That's right, someone should drive him.", expect: ['confirm_proposal', 'get_care_gaps'] },
  { id: 'confirm-04', member: 'm_david', utterance: 'He can get himself there, leave it out.', expect: ['confirm_proposal', 'get_care_gaps'] },

  // --- Resolving ---------------------------------------------------------
  { id: 'resolve-01', member: 'm_renee', utterance: 'Picked up the prescription.', expect: ['resolve_obligation', 'get_care_gaps'] },
  { id: 'resolve-02', member: 'm_david', utterance: 'Took him to the eye clinic, all done.', expect: ['resolve_obligation', 'get_care_gaps'] },
  { id: 'resolve-03', member: 'm_aide', utterance: 'Finished the shopping for him.', expect: ['resolve_obligation', 'get_care_gaps', 'get_shift_brief'] },
  { id: 'resolve-04', member: 'm_renee', utterance: "That's sorted now.", expect: ['resolve_obligation', 'get_care_gaps'] },

  // --- How is he doing ---------------------------------------------------
  { id: 'sum-01', member: 'm_david', utterance: "How's Daddy doing today?", expect: ['get_care_summary'] },
  { id: 'sum-02', member: 'm_renee', utterance: 'Catch me up on Daddy.', expect: ['get_care_summary'] },
  { id: 'sum-03', member: 'm_david', utterance: 'What happened with Daddy today?', expect: ['get_care_summary'] },
  { id: 'sum-04', member: 'm_renee', utterance: 'Has Daddy taken his medication today?', expect: ['get_care_summary', 'get_care_gaps'],
    note: 'The answer must never assert that he did not.' },
  { id: 'sum-05', member: 'm_david', utterance: 'Did Daddy use his evening eye drops?', expect: ['get_care_summary', 'get_care_gaps'],
    note: 'The trust model case: absence of a record is not a no.' },

  // --- The aide's shift ---------------------------------------------------
  { id: 'shift-01', member: 'm_aide', utterance: 'What do I need to know today?', expect: ['get_shift_brief'] },
  { id: 'shift-02', member: 'm_aide', utterance: "What's on for this shift?", expect: ['get_shift_brief'] },
  { id: 'shift-03', member: 'm_aide', utterance: 'What medications is he on today?', expect: ['get_shift_brief'] },
  { id: 'shift-04', member: 'm_aide', utterance: 'Anything assigned to me?', expect: ['get_shift_brief', 'get_care_gaps', 'get_my_requests'] },

  // --- Telling a person ---------------------------------------------------
  { id: 'notify-01', member: 'm_david', utterance: "Tell Funmi I'm taking Daddy Thursday.", expect: ['notify_member'] },
  { id: 'notify-02', member: 'm_renee', utterance: 'Let Tolu know the pharmacy called.', expect: ['notify_member'] },
  { id: 'notify-03', member: 'm_david', utterance: 'Message Funmi about the appointment change.', expect: ['notify_member'] },
  { id: 'notify-04', member: 'm_aide', utterance: 'Let the family know he slept badly.', expect: ['notify_member', 'add_note'] },

  // --- Constraints: work coming loose -------------------------------------
  { id: 'cons-01', member: 'm_renee', utterance: "I can't drive Thursday, I'm out of town.", expect: ['add_note'],
    args: { unavailable: (v) => typeof v === 'object' && v !== null } },
  { id: 'cons-02', member: 'm_david', utterance: "I'm away all next week.", expect: ['add_note'],
    args: { unavailable: (v) => typeof v === 'object' && v !== null } },
  { id: 'cons-03', member: 'm_renee', utterance: "I won't be able to make Friday after all.", expect: ['add_note'],
    args: { unavailable: (v) => typeof v === 'object' && v !== null } },
  { id: 'cons-04', member: 'm_aide', utterance: "I'm off sick tomorrow.", expect: ['add_note'],
    args: { unavailable: (v) => typeof v === 'object' && v !== null } },

  // ======================================================================
  // HELD-OUT SET. Written after the descriptions were tuned, and never tuned
  // against: harder phrasings, distractors, multi-intent, wrong-role attempts,
  // the purchase flow, and out-of-scope lines that name care words on purpose.
  // Whatever this scores is the honest number.
  // ======================================================================

  // --- logging, harder ---------------------------------------------------
  { id: 'h-log-01', member: 'm_margaret', utterance: "I already had my tablets, don't fuss.", expect: ['log_care_event'] },
  { id: 'h-log-02', member: 'm_david', utterance: 'I gave Daddy his insulin this morning.', expect: ['log_care_event'] },
  { id: 'h-log-03', member: 'm_aide', utterance: 'He had everything that was due before noon.', expect: ['log_care_event', 'add_note'] },
  { id: 'h-log-04', member: 'm_margaret', utterance: 'I skipped my evening pill on purpose, the doctor said to.', expect: ['add_note'],
    note: 'Adversarial: a deliberate skip is a note, NOT a medication_taken.' },
  { id: 'h-log-05', member: 'm_margaret', utterance: 'Had my blood pressure one just now.', expect: ['log_care_event'] },
  { id: 'h-log-06', member: 'm_margaret', utterance: "I can't remember if I took my morning pill.", expect: ['get_care_summary', 'get_care_gaps', 'add_note'],
    note: 'Adversarial: uncertainty is not a log; check the record or note it.' },
  { id: 'h-log-07', member: 'm_aide', utterance: 'Gave him the antibiotic at noon.', expect: ['log_care_event'] },

  // --- appointments, harder ---------------------------------------------
  { id: 'h-appt-01', member: 'm_renee', utterance: 'Move his eye check-up to Friday instead.', expect: ['record_appointment', 'add_note', 'change_appointment'],
    seen: CARE_CHANGES, note: 'Chose change_appointment in the 2026-09-23 run, which is right; the key predated the tool.' },
  { id: 'h-appt-02', member: 'm_david', utterance: 'Her hair appointment got cancelled.', expect: ['add_note', 'record_appointment', 'change_appointment'],
    note: 'Answer key widened 2026-09-23 when change_appointment was added - the product gained the right tool; no description was tuned on this case.' },
  { id: 'h-appt-03', member: 'm_margaret', utterance: "My grandson's graduation is on the 20th.", expect: ['record_appointment'],
    note: 'Non-medical dated commitment.' },
  { id: 'h-appt-04', member: 'm_david', utterance: 'Schedule his flu shot for next week sometime.', expect: ['record_appointment'] },
  { id: 'h-appt-05', member: 'm_renee', utterance: 'He needs to fast before the Monday bloodwork.', expect: ['add_note', 'record_appointment'],
    note: 'A prep instruction on an existing appointment, not a new one.' },

  // --- notes, harder -----------------------------------------------------
  { id: 'h-note-01', member: 'm_aide', utterance: "FYI he's been coughing a bit.", expect: ['add_note'] },
  { id: 'h-note-02', member: 'm_david', utterance: 'Daddy mentioned his knee hurts when it rains.', expect: ['add_note'] },
  { id: 'h-note-03', member: 'm_renee', utterance: 'The new aide starts Monday.', expect: ['add_note'] },
  { id: 'h-note-04', member: 'm_david', utterance: 'He’s in good spirits today.', expect: ['add_note'] },
  { id: 'h-note-05', member: 'm_renee', utterance: 'Her cardiologist is Dr. Patel now.', expect: ['add_note'] },

  // --- the core question, harder ----------------------------------------
  { id: 'h-gap-01', member: 'm_david', utterance: "Who's got room to take something on?", expect: ['get_care_gaps'] },
  { id: 'h-gap-02', member: 'm_renee', utterance: 'Are we covered for the week?', expect: ['get_care_gaps', 'get_care_summary'] },
  { id: 'h-gap-03', member: 'm_david', utterance: 'Walk me through what nobody owns.', expect: ['get_care_gaps'] },
  { id: 'h-gap-04', member: 'm_renee', utterance: 'Anything slipping through?', expect: ['get_care_gaps', 'get_care_summary'] },
  { id: 'h-gap-05', member: 'm_david', utterance: 'Is everything handled for tomorrow?', expect: ['get_care_gaps', 'get_care_summary'] },

  // --- claiming, harder / elliptical ------------------------------------
  { id: 'h-claim-01', member: 'm_david', utterance: 'Leave that with me.', expect: ['claim_obligation', 'get_care_gaps', 'get_my_requests'] },
  { id: 'h-claim-02', member: 'm_renee', utterance: "I've got it.", expect: ['claim_obligation', 'get_care_gaps', 'get_my_requests'] },
  { id: 'h-claim-03', member: 'm_david', utterance: 'Sign me up for the Monday one.', expect: ['claim_obligation', 'get_care_gaps'] },
  { id: 'h-claim-04', member: 'm_aide', utterance: "I'll cover the shopping.", expect: ['claim_obligation', 'get_care_gaps', 'get_shift_brief'] },
  { id: 'h-claim-05', member: 'm_renee', utterance: "I'll be the one driving.", expect: ['claim_obligation', 'get_care_gaps'] },

  // --- assigning, harder -------------------------------------------------
  { id: 'h-assign-01', member: 'm_david', utterance: "Have Funmi handle Thursday's drive.", expect: ['assign_obligation', 'get_care_gaps'] },
  { id: 'h-assign-02', member: 'm_david', utterance: 'Get Musa to pick up the meds.', expect: ['assign_obligation', 'notify_member', 'get_care_gaps'] },
  { id: 'h-assign-03', member: 'm_renee', utterance: 'Tolu should really take this one.', expect: ['assign_obligation', 'get_care_gaps'] },

  // --- confirming, harder / elliptical ----------------------------------
  { id: 'h-confirm-01', member: 'm_david', utterance: "Yep, that's needed.", expect: ['confirm_proposal', 'get_care_gaps'] },
  { id: 'h-confirm-02', member: 'm_renee', utterance: 'Correct, book the ride.', expect: ['confirm_proposal', 'get_care_gaps'] },
  { id: 'h-confirm-03', member: 'm_david', utterance: 'No, skip that one.', expect: ['confirm_proposal', 'get_care_gaps', 'get_my_requests'] },
  { id: 'h-confirm-04', member: 'm_renee', utterance: 'Right, he needs company for that.', expect: ['confirm_proposal', 'get_care_gaps'] },

  // --- resolving, harder -------------------------------------------------
  { id: 'h-resolve-01', member: 'm_david', utterance: 'Done and dusted.', expect: ['resolve_obligation', 'get_care_gaps', 'get_my_requests'] },
  { id: 'h-resolve-02', member: 'm_renee', utterance: 'Handled it.', expect: ['resolve_obligation', 'get_care_gaps', 'get_my_requests'] },
  { id: 'h-resolve-03', member: 'm_aide', utterance: 'Took care of that already.', expect: ['resolve_obligation', 'get_care_gaps', 'get_shift_brief', 'get_my_requests'] },
  { id: 'h-resolve-04', seen: RESOLVE_FIX, member: 'm_david', utterance: "Dropped him at the clinic and he's home now.", expect: ['resolve_obligation', 'get_care_gaps'] },

  // --- summary, harder ---------------------------------------------------
  { id: 'h-sum-01', member: 'm_renee', utterance: 'Give me the rundown on Daddy.', expect: ['get_care_summary'] },
  { id: 'h-sum-02', member: 'm_david', utterance: 'Is he okay today?', expect: ['get_care_summary', 'get_care_gaps'] },
  { id: 'h-sum-03', member: 'm_david', utterance: "What's his day looked like?", expect: ['get_care_summary'] },

  // --- the aide's shift, harder -----------------------------------------
  { id: 'h-shift-01', member: 'm_aide', utterance: 'Bring me up to speed for my shift.', expect: ['get_shift_brief'] },
  { id: 'h-shift-02', member: 'm_aide', utterance: "What's due while I'm here?", expect: ['get_shift_brief', 'get_care_gaps'] },
  { id: 'h-shift-03', member: 'm_aide', utterance: 'Do I have anything to do today?', expect: ['get_shift_brief', 'get_care_gaps'] },

  // --- telling a person, harder -----------------------------------------
  { id: 'h-notify-01', member: 'm_renee', utterance: 'Ping Tolu about the dose change.', expect: ['notify_member'] },
  { id: 'h-notify-02', member: 'm_david', utterance: "Shoot Funmi a note that I'm running late.", expect: ['notify_member'] },
  { id: 'h-notify-03', member: 'm_aide', utterance: 'Can you let Tolu know he is resting?', expect: ['notify_member', 'add_note'] },
  { id: 'h-notify-04', member: 'm_david', utterance: "Text the family that Daddy's home safe.", expect: ['notify_member', 'add_note'] },

  // --- constraints, harder ----------------------------------------------
  { id: 'h-cons-01', member: 'm_david', utterance: "Something's come up, I can't do Thursday.", expect: ['add_note'],
    args: { unavailable: (v) => typeof v === 'object' && v !== null } },
  { id: 'h-cons-02', member: 'm_renee', utterance: 'Count me out this weekend.', expect: ['add_note'],
    args: { unavailable: (v) => typeof v === 'object' && v !== null } },
  { id: 'h-cons-03', member: 'm_renee', utterance: "I'll be unreachable this afternoon.", expect: ['add_note'],
    args: { unavailable: (v) => typeof v === 'object' && v !== null } },

  // --- purchase: reorder + confirm (the new commerce surface) ------------
  { id: 'h-buy-01', seen: PURCHASE_FIX, member: 'm_david', utterance: "Reorder Daddy's eye drops.", expect: ['reorder_prescription'] },
  { id: 'h-buy-02', seen: PURCHASE_FIX, member: 'm_renee', utterance: 'Can you refill his prescription?', expect: ['reorder_prescription'] },
  { id: 'h-buy-03', seen: PURCHASE_FIX, member: 'm_david', utterance: 'Order more of his supplement.', expect: ['reorder_prescription'] },
  { id: 'h-buy-04', seen: PURCHASE_FIX, member: 'm_david', utterance: 'Set up a refill for his supplement.', expect: ['reorder_prescription'] },
  { id: 'h-buy-05', seen: PURCHASE_FIX, member: 'm_david', utterance: 'He’s nearly out of his eye drops.', expect: ['reorder_prescription', 'add_note', 'get_care_gaps'],
    note: 'A statement of need - reorder, note, or check are all reasonable.' },
  { id: 'h-buy-06', seen: PURCHASE_FIX, member: 'm_david', utterance: 'Yes, place the order.', expect: ['confirm_purchase'],
    note: 'Cold: confirming a pending offer. Held-out and strict on purpose.' },
  { id: 'h-buy-07', seen: PURCHASE_FIX, member: 'm_david', utterance: 'Go ahead and buy it.', expect: ['confirm_purchase'] },

  // --- wrong-role: choosing the tool is correct even if it will refuse ---
  { id: 'h-role-01', member: 'm_aide', utterance: 'Assign the pharmacy run to Tolu.', expect: ['assign_obligation', 'get_care_gaps'],
    note: 'Aide lacks the capability; selecting assign_obligation is still correct.' },
  { id: 'h-role-02', seen: PURCHASE_FIX, member: 'm_margaret', utterance: 'Reorder my own prescription please.', expect: ['reorder_prescription'] },

  // --- multi-intent: the first acceptable tool --------------------------
  { id: 'h-multi-01', member: 'm_david', utterance: 'Daddy took his pill and he seemed tired.', expect: ['log_care_event', 'add_note'] },
  { id: 'h-multi-02', member: 'm_david', utterance: "What's outstanding, and I'll take the first one.", expect: ['get_care_gaps'] },

  // --- out-of-scope distractors that name care words --------------------
  { id: 'h-none-01', member: 'm_margaret', utterance: 'Is it going to rain on Thursday?', expectNone: true,
    note: 'Names a day, but it is weather, not care.' },
  { id: 'h-none-02', member: 'm_david', utterance: 'Remind me what a cardiologist actually does.', expectNone: true,
    note: 'General knowledge, not a care action.' },
  { id: 'h-none-03', member: 'm_renee', utterance: "You're doing a great job, thanks.", expectNone: true },
  { id: 'h-none-04', member: 'm_margaret', utterance: 'Play some music for me.', expectNone: true },
  { id: 'h-none-05', member: 'm_margaret', utterance: 'Good night.', expectNone: true },

  // ======================================================================
  // HELD-OUT, SECOND SET (2026-09-23). The purchase cases above were used to fix
  // the purchase tools, so they no longer count as unseen. These were written after
  // that fix and before any run against it - different verbs, a decline, and a
  // helper who may not buy - to measure whether the fix generalises or only learned
  // the eight sentences it was shown.
  // ======================================================================
  { id: 'h2-buy-01', member: 'm_renee', utterance: "Can we get more of Daddy's eye drops delivered?", expect: ['reorder_prescription'] },
  { id: 'h2-buy-02', member: 'm_david', utterance: 'His medicine is running low, please order some.', expect: ['reorder_prescription'] },
  { id: 'h2-buy-03', member: 'm_david', utterance: 'Buy another bottle of his supplement.', expect: ['reorder_prescription'] },
  { id: 'h2-buy-04', member: 'm_renee', utterance: 'Get the refill sent to the house.', expect: ['reorder_prescription'] },
  { id: 'h2-buy-05', member: 'm_david', utterance: 'Okay, order it.', expect: ['confirm_purchase'] },
  { id: 'h2-buy-06', member: 'm_renee', utterance: 'Sure, go ahead with the purchase.', expect: ['confirm_purchase'] },
  { id: 'h2-buy-07', member: 'm_david', utterance: "No, don't buy it.", expect: ['confirm_purchase'],
    args: { confirmed: (v) => v === false },
    note: 'Declining is an answer too: the waiting offer should be closed, not left hanging.' },
  { id: 'h2-buy-08', member: 'm_aide', utterance: 'Order his supplement.', expect: ['reorder_prescription'],
    note: 'Musa may not buy; choosing the tool is still correct, and the server refuses.' },
  { id: 'h2-buy-09', member: 'm_david', utterance: 'How much would a refill of his eye drops cost?', expect: ['reorder_prescription'],
    note: 'Asking the price is asking for the offer, which never charges.' },

  // --- Nothing to call ----------------------------------------------------
  { id: 'none-01', member: 'm_margaret', utterance: 'Thank you, that\'s all.', expectNone: true },
  { id: 'none-02', member: 'm_david', utterance: 'What can you help me with?', expectNone: true },
  { id: 'none-03', member: 'm_margaret', utterance: "What's the weather like?", expectNone: true,
    note: 'Out of scope - must not reach for a care tool.' },
  { id: 'none-04', member: 'm_renee', utterance: 'Never mind.', expectNone: true },
];

export const MEMBER_LABEL: Record<EvalCase['member'], string> = {
  m_margaret: 'Daddy (care recipient)',
  m_david: 'Tolu (primary caregiver)',
  m_renee: 'Funmi (caregiver)',
  m_aide: 'Musa (the driver, paid help)',
};
