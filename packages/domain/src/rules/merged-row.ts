import type { PrIndex, PrIndexRow } from '../entities/pr-index.js';

/**
 * The one PR state a stored row is trusted for without asking the host.
 *
 * A merged PR cannot revert on the host. `OPEN`, `CLOSED` and a draft can each
 * become another, so a stored one is stale in either direction.
 */
export const TERMINAL_PR_STATE = 'MERGED';

/**
 * Whether a stored row may be answered from without asking the host.
 *
 * @param row - the row the store holds.
 * @returns true for a `MERGED` row that is not a draft, false otherwise.
 */
export const isTerminalRow = (row: PrIndexRow): boolean =>
  row.state.toUpperCase() === TERMINAL_PR_STATE && !row.draft;

/**
 * The merged row whose head is this branch.
 *
 * Matches terminal rows only. Where several match, the lowest PR number wins,
 * so the answer is stable across reads.
 *
 * @param held - the store, already read.
 * @param branch - the branch to match against row heads.
 * @returns the lowest-numbered terminal row for the branch, or undefined where none is.
 */
export const mergedRowByHead = (held: PrIndex, branch: string): PrIndexRow | undefined =>
  held.rows
    .filter((row) => row.head === branch && isTerminalRow(row))
    .sort((a, b) => a.number - b.number)[0];
