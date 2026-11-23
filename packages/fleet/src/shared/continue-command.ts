import { branchFromPulse, pulseBranchReading, type Caller, type FleetReading } from '@plot-pm/domain';
import {
  continueOnDesk,
  type ContinuationOptions,
  type DeskContinuation,
} from './continuation.js';
import type { DeskMonitors } from '@plot-pm/domain';

const REFUSAL_DETAIL = {
  'no-pulse': 'no current fleet reading to look the branch up in',
  'pulse-partial':
    "the board's scan has not finished and the last finished scan does not name that branch; ask again after the next pulse",
  'unknown-branch': 'no plan on this board names that branch',
} as const;

/**
 * The 404 refusal for a pulse lookup that found no branch.
 *
 * @param reason - the rule's answer other than `listed`.
 * @returns a refusal carrying the reason's detail.
 */
export const refusal = (reason: keyof typeof REFUSAL_DETAIL): DeskContinuation => ({
  kind: 'refused',
  status: 404,
  reason,
  detail: REFUSAL_DETAIL[reason],
});

/** What {@link continueBranch} needs. */
export interface ContinueBranchInput {
  opts: ContinuationOptions;
  /** Reads `## Plot Config` keys; the continuation engine's own reader where absent. */
  readCfg?: (opts: ContinuationOptions, key: string, fallback: string) => string;
  /** The fleet reading the branch is looked up in; `null` where there is none. */
  pulse: FleetReading | null;
  /** Whether the scan behind `pulse` finished; absent reads as `true`. */
  pulseComplete?: boolean;
  /** The pulse of the last scan that finished; absent reads as `null`. */
  lastCompletePulse?: FleetReading | null;
  branch: string;
  /** Who is asking; an unattended caller is refused before any read. */
  caller: Caller;
  /** The answer the new run reads; the caller has bounded it. */
  answer: string;
  /**
   * The `askedAt` of the question this answer targets, where the caller named
   * one. Absent, today's behaviour: the desk's current marker is used with no
   * comparison.
   */
  questionKey?: string;
  /** Who gave this answer: `unblocker`, or a person's handle. */
  author?: string;
  /** Starts the desk's monitor; the shell script where absent. */
  monitors?: DeskMonitors;
}

/**
 * Continues the work on a branch's desk with a person's answer.
 *
 * Refuses `no-pulse` where there is no fleet reading, `pulse-partial` where an
 * unfinished scan and the last finished one both miss the branch,
 * `unknown-branch` where a finished reading does not list it, and
 * `no-worktree` where it lists no worktree on this machine. All four come before the `unattended` check. A
 * missing reading is unknown, so it refuses rather than starting an agent in a
 * directory it guessed.
 *
 * @param input - the repository, the reading, the branch and the answer.
 * @returns what {@link continueOnDesk} answers, or a 404 refusal.
 */
export const continueBranch = async (input: ContinueBranchInput): Promise<DeskContinuation> => {
  const reading = pulseBranchReading(
    input.pulse,
    input.pulseComplete ?? true,
    input.lastCompletePulse ?? null,
    input.branch,
  );
  if (reading.kind !== 'listed') return refusal(reading.kind);
  const found = branchFromPulse(reading.pulse, input.branch);
  if (!found) return refusal('unknown-branch');
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
    caller: input.caller,
    branch: input.branch,
    worktree: found.worktree,
    main: input.pulse?.main ?? '',
    previousPid: found.pid,
    answer: input.answer,
    expectedAskedAt: input.questionKey,
    author: input.author,
    monitors: input.monitors,
  });
};
