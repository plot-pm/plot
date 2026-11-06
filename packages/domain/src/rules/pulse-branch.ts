import type { FleetReading } from '../entities/fleet.js';

/** What {@link pulseBranchReading} answers. */
export type PulseBranchReading =
  /** `pulse` lists the branch; read its desk from that pulse. */
  | { kind: 'listed'; pulse: FleetReading }
  /** There is no live fleet reading. */
  | { kind: 'no-pulse' }
  /** The live scan is unfinished, and neither it nor the last finished scan lists the branch. */
  | { kind: 'pulse-partial' }
  /** A finished reading does not list the branch. */
  | { kind: 'unknown-branch' };

const lists = (pulse: FleetReading, branch: string): boolean =>
  pulse.plans.some((plan) => plan.slices.some((slice) => slice.branches.some((b) => b.branch === branch)));

/**
 * Chooses the fleet reading a branch is looked up in.
 *
 * A plan absent from a partial pulse has not been reached by the scan, so the
 * absence says nothing about the plan. The last finished scan is asked before
 * the lookup refuses.
 *
 * @param live - the board's current pulse, or `null` on a cold cache.
 * @param liveComplete - whether the scan that produced `live` finished.
 * @param lastComplete - the pulse of the last scan that finished, or `null`.
 * @param branch - the branch name.
 * @returns `no-pulse` for a `null` live pulse; `listed` with `live` where it lists the branch; for an unfinished scan, `listed` with `lastComplete` where that lists it, else `pulse-partial`; otherwise `unknown-branch`.
 */
export const pulseBranchReading = (
  live: FleetReading | null,
  liveComplete: boolean,
  lastComplete: FleetReading | null,
  branch: string,
): PulseBranchReading => {
  if (live === null) return { kind: 'no-pulse' };
  if (lists(live, branch)) return { kind: 'listed', pulse: live };
  if (liveComplete) return { kind: 'unknown-branch' };
  if (lastComplete !== null && lists(lastComplete, branch)) return { kind: 'listed', pulse: lastComplete };
  return { kind: 'pulse-partial' };
};
