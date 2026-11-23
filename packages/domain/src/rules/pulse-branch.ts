import type { FleetReading } from '../entities/fleet.js';
import { dispatchReadingFor, planSlug, type DispatchReadingFor } from './auto-dispatch.js';

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

/** What {@link pulsePlanReading} answers. */
export type PulsePlanReading =
  /** `pulse` lists the plan; read its slices from that pulse. */
  | { kind: 'listed'; pulse: FleetReading }
  /** There is no live fleet reading. */
  | { kind: 'no-pulse' }
  /** The live scan is unfinished, and neither it nor the last finished scan lists the plan. */
  | { kind: 'pulse-partial' }
  /** A finished reading does not list the plan. */
  | { kind: 'unknown-plan' };

const listsPlan = (pulse: FleetReading, slug: string): boolean => pulse.plans.some((plan) => planSlug(plan.file) === slug);

/**
 * Chooses the fleet reading a plan is looked up in.
 *
 * A plan absent from a partial pulse has not been reached by the scan, so the
 * absence says nothing about the plan. The last finished scan is asked before
 * the lookup refuses.
 *
 * @param live - the board's current pulse, or `null` on a cold cache.
 * @param liveComplete - whether the scan that produced `live` finished.
 * @param lastComplete - the pulse of the last scan that finished, or `null`.
 * @param slug - the plan's file slug, as {@link planSlug} derives it.
 * @returns `no-pulse` for a `null` live pulse; `listed` with `live` where it lists the plan; for an unfinished scan, `listed` with `lastComplete` where that lists it, else `pulse-partial`; otherwise `unknown-plan`.
 */
export const pulsePlanReading = (
  live: FleetReading | null,
  liveComplete: boolean,
  lastComplete: FleetReading | null,
  slug: string,
): PulsePlanReading => {
  if (live === null) return { kind: 'no-pulse' };
  if (listsPlan(live, slug)) return { kind: 'listed', pulse: live };
  if (liveComplete) return { kind: 'unknown-plan' };
  if (lastComplete !== null && listsPlan(lastComplete, slug)) return { kind: 'listed', pulse: lastComplete };
  return { kind: 'pulse-partial' };
};

/**
 * What the board's pulses say about starting `slug`, at `branch` where one is named.
 *
 * The plan is looked up through {@link pulsePlanReading}. Where neither the
 * unfinished live scan nor the last finished scan lists the plan, the answer is
 * `pulse-partial`: a `branch-refused` reading of that reason where a branch is
 * named, else a `pulse-partial` reading. Every other case is
 * {@link dispatchReadingFor} over the pulse the lookup chose, or over `live`
 * where none lists the plan.
 *
 * @param live - the board's current pulse, or `null` on a cold cache.
 * @param liveComplete - whether the scan that produced `live` finished.
 * @param lastComplete - the pulse of the last scan that finished, or `null`.
 * @param slug - the plan slug.
 * @param branch - the branch the caller names, or `undefined`.
 * @returns the reading.
 */
export const dispatchReadingForPulses = (
  live: FleetReading | null,
  liveComplete: boolean,
  lastComplete: FleetReading | null,
  slug: string,
  branch?: string,
): DispatchReadingFor => {
  const reading = pulsePlanReading(live, liveComplete, lastComplete, slug);
  if (reading.kind === 'listed') return dispatchReadingFor(reading.pulse, slug, branch);
  if (reading.kind !== 'pulse-partial') return dispatchReadingFor(live, slug, branch);
  const detail = `the fleet scan has not reached plan ${slug} yet; ask again after the scan finishes`;
  return branch === undefined ? { kind: 'pulse-partial', detail } : { kind: 'branch-refused', reason: 'pulse-partial', branch, detail };
};

/** The desk a branch holds, as the pulse names it. */
export interface PulseBranch {
  worktree: string;
  plan: string;
  wave: string;
  worker: string;
  pid: string;
}

/** What {@link lookupBranch} finds. */
export type BranchLookup =
  /** There is no fleet reading to look the branch up in. */
  | { kind: 'no-pulse' }
  /** The fleet reading does not list the branch. */
  | { kind: 'unknown-branch' }
  /** The fleet reading lists the branch. */
  | { kind: 'found'; desk: PulseBranch };

/**
 * Finds a branch in a fleet reading and says why it found none.
 *
 * A lookup and not a check: the branch names a record the scan already
 * produced, so no caller text becomes a path.
 *
 * @param pulse - a fleet reading, or `null` where there is none.
 * @param branch - the branch name.
 * @returns `no-pulse` for a `null` reading, `unknown-branch` where the reading does not list the branch, else the desk it names.
 */
export const lookupBranch = (pulse: FleetReading | null, branch: string): BranchLookup => {
  if (!pulse) return { kind: 'no-pulse' };
  for (const plan of pulse.plans) {
    for (const wave of plan.slices) {
      for (const b of wave.branches) {
        if (b.branch !== branch) continue;
        return {
          kind: 'found',
          desk: {
            worktree: b.local_worktree ?? '',
            plan: plan.file ?? '',
            wave: wave.name ?? '',
            worker: b.worker ?? 'elsewhere',
            pid: b.worker_pid ?? '',
          },
        };
      }
    }
  }
  return { kind: 'unknown-branch' };
};

/**
 * Finds a branch in a fleet reading.
 *
 * @param pulse - a fleet reading, or `null` where there is none.
 * @param branch - the branch name.
 * @returns the desk the reading names for it, or `null` where the reading is absent or does not list it.
 */
export const branchFromPulse = (pulse: FleetReading | null, branch: string): PulseBranch | null => {
  const lookup = lookupBranch(pulse, branch);
  return lookup.kind === 'found' ? lookup.desk : null;
};
