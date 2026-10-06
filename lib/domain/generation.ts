// Appointment generation for subscriptions (FR-SUB-02, FR-SUB-03).
//
// Pure planning: given a subscription and "today" in the tenant's zone, which
// visits should exist that do not yet? The caller inserts them with
// ON CONFLICT (tenant_id, subscription_id, occurrence_date) DO NOTHING, so
// running the plan twice, or concurrently, creates nothing extra.

import { occurrences, parseRule } from "./recurrence";
import { addDays, maxDate, type LocalDate, type LocalTime } from "./time";

export const GENERATION_HORIZON_DAYS = 60;

export interface SubscriptionForGeneration {
  id: string;
  status: "active" | "paused" | "cancelled";
  startDate: LocalDate;
  rrule: string;
  priceCents: number;
  initialPriceCents: number | null;
  durationMin: number;
  generatedThrough: LocalDate | null;
  pausedFrom: LocalDate | null;
  pausedUntil: LocalDate | null;
  preferredTechnicianId: string | null;
  preferredWindowStart: LocalTime | null;
  preferredWindowEnd: LocalTime | null;
}

export interface PlannedVisit {
  subscriptionId: string;
  occurrenceDate: LocalDate;
  localDate: LocalDate;
  isInitial: boolean;
  priceCents: number;
  durationMin: number;
  technicianId: string | null;
  windowStart: LocalTime | null;
  windowEnd: LocalTime | null;
}

export interface GenerationPlan {
  visits: PlannedVisit[];
  /** New value for subscriptions.generated_through, or null to leave it unchanged. */
  generatedThrough: LocalDate | null;
}

export function horizonEnd(today: LocalDate, days = GENERATION_HORIZON_DAYS): LocalDate {
  return addDays(today, days);
}

function inPause(sub: SubscriptionForGeneration, date: LocalDate): boolean {
  if (!sub.pausedFrom) return false;
  if (date < sub.pausedFrom) return false;
  return sub.pausedUntil === null || date <= sub.pausedUntil;
}

export function planGeneration(sub: SubscriptionForGeneration, today: LocalDate, horizonDays = GENERATION_HORIZON_DAYS): GenerationPlan {
  if (sub.status === "cancelled") return { visits: [], generatedThrough: null };

  const end = horizonEnd(today, horizonDays);
  const resumeFrom = sub.generatedThrough ? addDays(sub.generatedThrough, 1) : sub.startDate;
  // Never create visits in the past, and never before the plan starts.
  const from = maxDate(resumeFrom, today, sub.startDate);
  if (from > end) return { visits: [], generatedThrough: null };

  const rule = parseRule(sub.rrule);
  const visits = occurrences(rule, sub.startDate, from, end)
    .filter((date) => !inPause(sub, date))
    .map<PlannedVisit>((date) => {
      const isInitial = date === sub.startDate;
      return {
        subscriptionId: sub.id,
        occurrenceDate: date,
        localDate: date,
        isInitial,
        priceCents: isInitial && sub.initialPriceCents !== null ? sub.initialPriceCents : sub.priceCents,
        durationMin: sub.durationMin,
        technicianId: sub.preferredTechnicianId,
        windowStart: sub.preferredWindowStart,
        windowEnd: sub.preferredWindowEnd,
      };
    });

  // An open-ended pause stops the clock at the pause so resuming later
  // generates from there; a bounded pause just leaves a hole.
  const pausedOpenEnded = sub.status === "paused" && sub.pausedFrom !== null && sub.pausedUntil === null;
  const through = pausedOpenEnded ? maxDate(addDays(sub.pausedFrom!, -1), addDays(from, -1)) : end;
  return { visits, generatedThrough: through };
}
