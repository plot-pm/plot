/** The shortest interval between two temp sweeps the supervisor runs. */
export const TEMP_SWEEP_EVERY_MS = 60 * 60 * 1000;

/**
 * Whether the supervisor owes a temp sweep now.
 *
 * @param lastAt - when the last sweep ran, in epoch ms, or null when none has.
 * @param now - the current time, in epoch ms.
 * @returns true when no sweep has run, or the last one is at least an hour old.
 */
export const tempSweepDue = (lastAt: number | null, now: number): boolean =>
  lastAt === null || now - lastAt >= TEMP_SWEEP_EVERY_MS;
