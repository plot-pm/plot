import type { FleetReading } from '@plot-pm/domain';
import {
  continueOnDesk,
  type ContinuationOptions,
  type DeskContinuation,
} from './continuation.js';
import type { DeskMonitors } from '@plot-pm/domain';

/** The desk a branch holds, as the pulse names it. */
export interface PulseBranch {
  worktree: string;
  plan: string;
  wave: string;
  worker: string;
  pid: string;
}

/**
 * Finds a branch in a fleet reading.
 *
 * A lookup and not a check: the branch names a record the scan already
 * produced, so no caller text becomes a path.
 *
 * @param pulse - a fleet reading, or `null` where there is none.
 * @param branch - the branch name.
 * @returns the desk the reading names for it, or `null` where the reading is absent or does not list it.
 */
export const branchFromPulse = (pulse: FleetReading | null, branch: string): PulseBranch | null => {
  if (!pulse) return null;
  for (const plan of pulse.plans) {
    for (const wave of plan.slices) {
      for (const b of wave.branches) {
        if (b.branch !== branch) continue;
        return {
          worktree: b.local_worktree ?? '',
          plan: plan.file ?? '',
          wave: wave.name ?? '',
          worker: b.worker ?? 'elsewhere',
          pid: b.worker_pid ?? '',
        };
      }
    }
  }
  return null;
};

/** What {@link continueBranch} needs. */
export interface ContinueBranchInput {
  opts: ContinuationOptions;
  /** Reads `## Plot Config` keys; the continuation engine's own reader where absent. */
  readCfg?: (opts: ContinuationOptions, key: string, fallback: string) => string;
  /** The fleet reading the branch is looked up in; `null` where there is none. */
  pulse: FleetReading | null;
  branch: string;
  /** The answer the new run reads; the caller has bounded it. */
  answer: string;
  /** Starts the desk's monitor; the shell script where absent. */
  monitors?: DeskMonitors;
}

/**
 * Continues the work on a branch's desk with a person's answer.
 *
 * Refuses `unknown-branch` where the reading does not list the branch and
 * `no-worktree` where it lists no worktree on this machine. A missing reading
 * is unknown, so it refuses rather than starting an agent in a directory it
 * guessed.
 *
 * @param input - the repository, the reading, the branch and the answer.
 * @returns what {@link continueOnDesk} answers, or a 404 refusal.
 */
export const continueBranch = async (input: ContinueBranchInput): Promise<DeskContinuation> => {
  const found = branchFromPulse(input.pulse, input.branch);
  if (!found) {
    return {
      kind: 'refused',
      status: 404,
      reason: 'unknown-branch',
      detail: 'no plan on this board names that branch',
    };
  }
  if (!found.worktree) {
    return {
      kind: 'refused',
      status: 404,
      reason: 'no-worktree',
      detail: 'this machine holds no worktree for that branch',
    };
  }
  return continueOnDesk({
    opts: input.opts,
    readCfg: input.readCfg,
    branch: input.branch,
    worktree: found.worktree,
    main: input.pulse?.main ?? '',
    previousPid: found.pid,
    answer: input.answer,
    monitors: input.monitors,
  });
};
