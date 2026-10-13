import { localParts } from './gaps.js';
import type { CareState, MedicationSchedule } from './types.js';

/**
 * Care changes. The doctor stops the drops after two weeks, the check-up moves to
 * Friday, the dentist is cancelled. Nothing is rewritten: the record keeps what was, and
 * adds what changed, and who said so.
 */

/** Whether a medication is still expected at this moment. */
export function isActiveMedication(med: MedicationSchedule, now: Date, timezone: string): boolean {
  if (med.stoppedAt && Date.parse(med.stoppedAt) <= now.getTime()) return false;
  if (med.until && localParts(now, timezone).date > med.until) return false;
  return true;
}

/** The medications still expected now. Stopped ones stay on the record, not on the schedule. */
export function activeMedications(state: CareState, now: Date): MedicationSchedule[] {
  return state.medications.filter((m) => isActiveMedication(m, now, state.household.timezone));
}

export interface Appointment {
  /** The event that first recorded it; changes point back to it. */
  eventId: string;
  kind: string;
  /** When it is now, after any move. */
  at: string;
  forMemberId: string | null;
  cancelled: boolean;
  detail?: string;
}

/** Every appointment, as it stands after all its changes, soonest first. */
export function appointmentsOf(state: CareState): Appointment[] {
  const byId = new Map<string, Appointment>();
  for (const e of state.events) {
    if (e.kind === 'appointment_scheduled') {
      byId.set(e.id, {
        eventId: e.id,
        kind: String(e.data['appointmentKind'] ?? 'appointment'),
        at: e.occurredAt,
        forMemberId: (e.data['forMemberId'] as string | undefined) ?? null,
        cancelled: false,
        ...(e.detail ? { detail: e.detail } : {}),
      });
    } else if (e.kind === 'appointment_changed') {
      const a = byId.get(String(e.data['appointmentEventId']));
      if (!a) continue;
      if (e.data['cancelled'] === true) a.cancelled = true;
      if (typeof e.data['startsAt'] === 'string') a.at = e.data['startsAt'];
    }
  }
  return [...byId.values()].sort((a, b) => a.at.localeCompare(b.at));
}

/** Appointments still going ahead, from now until `days` ahead. */
export function upcomingAppointments(state: CareState, now: Date, days = 7): Appointment[] {
  const until = now.getTime() + days * 86_400_000;
  return appointmentsOf(state).filter(
    (a) =>
      !a.cancelled && Date.parse(a.at) >= now.getTime() - 60 * 60_000 && Date.parse(a.at) <= until,
  );
}

/**
 * Who to call, where the family lives. Only numbers we are sure of; anywhere else it
 * says "your local emergency number" rather than guess.
 */
export function emergencyAdvice(timezone: string): string {
  if (timezone === 'Africa/Lagos') return 'call 112 now, or 767 in Lagos';
  if (
    timezone.startsWith('America/') &&
    !/Sao_Paulo|Argentina|Bogota|Lima|Santiago|Caracas/.test(timezone)
  )
    return 'call 911 now';
  if (timezone === 'Europe/London') return 'call 999 now';
  if (timezone.startsWith('Europe/')) return 'call 112 now';
  return 'call your local emergency number now';
}
