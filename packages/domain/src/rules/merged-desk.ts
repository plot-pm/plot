import type { AgentState } from '../entities/agent.js';
import type { PrIndex } from '../entities/pr-index.js';
import { mergedRowByHead } from './merged-row.js';

/**
 * What a reader measured of one desk whose readings produced a state.
 *
 * READINGS AS VALUES, NO I/O. The caller reads the desk, the worker's pid and
 * the PR index, and hands the answers in.
 *
 * @concept merged-desk
 */
export interface MergedDeskReading {
  /** The state the desk's readings produced. */
  readonly state: AgentState;
  /** Whether the worker pid the desk records answers `kill -0`. */
  readonly workerAlive: boolean;
  /** Whether a MERGED PR has the desk's branch as its head. */
  readonly merged: boolean;
}

/**
 * Whether the PR index holds a merged PR whose head is this branch.
 *
 * Only a `MERGED`, non-draft row answers `true`. A missing store, an empty
 * branch and a missing row each answer `false`, which means *not known to have
 * merged* and never *known not to have merged*.
 *
 * @param index - the store as it was read, or null where there is none.
 * @param branch - the branch the desk has checked out.
 * @returns true where a merged row names the branch as its head.
 */
export const deskBranchMerged = (index: PrIndex | null, branch: string): boolean =>
  index !== null && branch !== '' && mergedRowByHead(index, branch) !== undefined;

/**
 * The state a desk shows once its branch's merged PR is known.
 *
 * A `waiting` desk whose worker pid is not alive and whose branch's PR merged
 * reads `finished`: the work is on the default branch, and no live worker
 * holds the `PLOT-BLOCKED` marker. Every other state is returned unchanged. A
 * live worker keeps `waiting`, and a desk with no merged PR keeps `waiting`.
 *
 * @param reading - the desk's state, its worker's liveness and its merge fact.
 * @returns the state the desk shows.
 */
export const mergedDeskState = (reading: MergedDeskReading): AgentState =>
  reading.state === 'waiting' && reading.merged && !reading.workerAlive ? 'finished' : reading.state;
