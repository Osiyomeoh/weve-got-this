import { z } from 'zod';

/**
 * Every tool's declared output shape, in one place so the whole contract reads at a
 * glance. Per the Alexa+ MCP design guide: "don't leave extension
 * fields undeclared ... treat your schema as a promise." Every tool already returns
 * structuredContent on success; these advertise its shape to the model. Fields are
 * optional and nested arrays left loose on purpose - the honest promise is "these
 * keys, when present." Error results carry no structured content and the SDK skips
 * them, so guidance() paths are unaffected.
 *
 * Hosts reject any field a schema does not declare, so the server checks every result
 * against these strictly (see createCareCircleServer).
 */
const arr = z.array(z.unknown());
export const OUT = {
  log_care_event: {
    eventId: z.string().optional(),
    matchedMedication: z.string().nullable().optional(),
    alreadyRecorded: z.object({ at: z.string(), by: z.string() }).optional(),
  },
  change_medication: { medicationId: z.string().optional(), eventId: z.string().optional() },
  change_appointment: {
    eventId: z.string().optional(),
    appointmentEventId: z.string().optional(),
    startsAt: z.string().optional(),
    cancelled: z.boolean().optional(),
  },
  raise_urgent: { eventId: z.string().optional(), reached: z.array(z.string()).optional() },
  get_promises: { promises: arr.optional() },
  record_appointment: { eventId: z.string().optional(), proposals: arr.optional() },
  add_note: {
    eventId: z.string().optional(),
    orphaned: arr.optional(),
    unanswered: arr.optional(),
  },
  get_care_gaps: { recordedToday: arr.optional(), gaps: arr.optional() },
  claim_obligation: {
    obligationId: z.string().optional(),
    ownerId: z.string().nullable().optional(),
  },
  assign_obligation: {
    obligationId: z.string().optional(),
    askedOfId: z.string().optional(),
    ownerId: z.string().nullable().optional(),
    status: z.string().optional(),
  },
  request_owner: {
    obligationId: z.string().optional(),
    askedOfId: z.string().optional(),
    status: z.string().optional(),
  },
  respond_to_request: {
    obligationId: z.string().optional(),
    status: z.string().optional(),
    ownerId: z.string().nullable().optional(),
    declined: z.boolean().optional(),
    nextCandidate: z.string().nullable().optional(),
  },
  get_my_requests: { requests: arr.optional() },
  get_provenance: {
    obligationId: z.string().optional(),
    what: z.string().optional(),
    owner: z.string().nullable().optional(),
    chain: arr.optional(),
  },
  get_connections: { connections: arr.optional() },
  confirm_proposal: { obligationId: z.string().optional(), status: z.string().optional() },
  resolve_obligation: { obligationId: z.string().optional() },
  run_care_agent: {
    would: arr.optional(),
    heldBack: arr.optional(),
    asked: arr.optional(),
    dryRun: z.boolean().optional(),
  },
  get_care_summary: {
    appointments: arr.optional(),
    medicationsLogged: z.number().optional(),
    medications: arr.optional(),
    notes: arr.optional(),
    gaps: arr.optional(),
    routinesToday: arr.optional(),
    pendingProposals: arr.optional(),
  },
  get_shift_brief: {
    medications: arr.optional(),
    assignedToMe: arr.optional(),
    appointments: arr.optional(),
    recordedToday: arr.optional(),
    routinesToday: arr.optional(),
  },
  notify_member: {
    eventId: z.string().optional(),
    recipientId: z.string().optional(),
    channel: z.string().optional(),
    delivered: z.boolean().optional(),
  },
  ingest_signal: {
    eventId: z.string().optional(),
    resolvesCandidate: z.unknown().optional(),
    proposalId: z.string().nullable().optional(),
  },
  reorder_prescription: {
    eventId: z.string().optional(),
    offer: z
      .object({
        offerId: z.string(),
        kind: z.string(),
        item: z.string(),
        merchant: z.string(),
        amountCents: z.number(),
        currency: z.string(),
        etaText: z.string(),
        obligationId: z.string().optional(),
        simulated: z.boolean(),
      })
      .optional(),
  },
  confirm_purchase: {
    offerId: z.string().optional(),
    placed: z.boolean().optional(),
    amountCents: z.number().optional(),
    closedObligation: z.string().nullable().optional(),
  },
  get_started: {
    step: z.string().optional(),
    done: arr.optional(),
    complete: z.boolean().optional(),
    firstGap: z.unknown().optional(),
    familyCode: z.string().optional(),
  },
  create_household: { householdId: z.string().optional(), memberId: z.string().optional() },
  add_member: { memberId: z.string().optional() },
  add_medication: { medicationId: z.string().optional() },
  remove_member: { memberId: z.string().optional(), released: z.number().optional() },
  set_routine: { routineId: z.string().optional(), stopped: z.number().optional() },
} satisfies Record<string, z.ZodRawShape>;
