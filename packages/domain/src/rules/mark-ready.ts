import type { AgentState } from '../entities/agent.js';

/** What `markReadyDecision` reads to decide whether to mark a PR ready. */
export interface MarkReadyReadings {
  /** The agent's worker state for the slice that opened the PR. */
  readonly worker: AgentState;
  /** Whether the PR is open. */
  readonly prOpen: boolean;
  /** Whether the PR is still a draft. */
  readonly draft: boolean;
  /**
   * The PR's head commit, or absent where it could not be read.
   *
   * Absent is not a match: a caller must not read a missing head as one
   * that equals {@link lastPushSha}.
   */
  readonly headSha?: string;
  /** The last commit the agent pushed for this slice. */
  readonly lastPushSha: string;
}

/**
 * Whether to mark the PR ready, given the agent's worker state and the PR's
 * own readings.
 *
 * Answers `true` only where the worker state is `finished`, the PR is open,
 * the PR is a draft, and the PR's head equals the agent's last push. Every
 * other worker state, a closed or non-draft PR, and a missing or mismatched
 * head all answer `false`.
 *
 * @param readings - the worker state and the PR's draft flag, open state and head.
 * @returns whether to mark the PR ready.
 */
export const markReadyDecision = (readings: MarkReadyReadings): boolean =>
  readings.worker === 'finished' &&
  readings.prOpen &&
  readings.draft &&
  readings.headSha !== undefined &&
  readings.headSha === readings.lastPushSha;
