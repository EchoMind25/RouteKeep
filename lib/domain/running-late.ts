// "Running late" (FR-TEC-02, FR-MSG-01): the delays a technician can pick, and
// what a delay does to a stop's arrival window. Pure, shared by the phone, the
// board and the email.

export const LATE_DELAYS = [15, 30, 45, 60] as const;
export type LateDelay = (typeof LATE_DELAYS)[number];

/** "Running late +30 min", for the board badge and the technician's confirmation. */
export function lateLabel(delayMin: number): string {
  return `Running late +${delayMin} min`;
}

/** Moves an "HH:MM" arrival window later; either end may be missing. Stays within the same day. */
export function shiftWindow(start: string | null, end: string | null, delayMin: number): { start: string | null; end: string | null } {
  const shift = (t: string | null) => {
    if (!t) return null;
    const [h, m] = t.split(":").map(Number) as [number, number];
    const total = Math.min(23 * 60 + 59, h * 60 + m + delayMin);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  };
  return { start: shift(start), end: shift(end) };
}
