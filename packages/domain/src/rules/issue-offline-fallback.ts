import type { IssueIndex, IssueIndexRow } from '../entities/issue-index.js';

/** What a failed live issue read holds in memory, and what the index file holds. */
export interface OfflineIssueReading {
  /** The rows a prior successful read left in memory; `null` where none has ever answered. */
  readonly memoryRows: readonly IssueIndexRow[] | null;
  /** The decoded index file, or `null` where it is missing, unparseable or another version. */
  readonly index: IssueIndex | null;
  /** This repository's own `issueSource` reading, compared against the index's `source`. */
  readonly ownSource: string;
}

/** The rows a failed live read should show, and where they came from. */
export type OfflineIssueRows =
  | { readonly from: 'memory'; readonly rows: readonly IssueIndexRow[] }
  | { readonly from: 'index'; readonly rows: readonly IssueIndexRow[]; readonly at: string }
  | { readonly from: 'none' };

/**
 * Decides which rows a failed live issue read shows: the rows already in
 * memory, the index file's rows, or none.
 *
 * **Memory beats the file.** Rows already held from a successful read are at
 * least as new as the file's `at` unless another process wrote it, so a board
 * that has read anything keeps what it read.
 *
 * **Only a matching source counts.** An index whose `source` differs from this
 * repository's own `issueSource` reading is another repository's answer, or a
 * stale one from before a `Tracker` config change — never shown.
 *
 * **The index never says no.** A missing or unparseable file, or one with no
 * `rows`, means *ask the host*, not *no issues* — the same rows `readIssuesFromStore`
 * already read, never treated as an empty inbox.
 *
 * @param reading - the in-memory rows, the decoded index file, and this
 *   repository's own issue source.
 * @returns the rows to show and their origin, or `none` where neither has any.
 */
export const offlineIssueRows = (reading: OfflineIssueReading): OfflineIssueRows => {
  if (reading.memoryRows !== null) return { from: 'memory', rows: reading.memoryRows };
  const index = reading.index;
  if (index === null || index.source !== reading.ownSource || index.rows === undefined) return { from: 'none' };
  return { from: 'index', rows: index.rows, at: index.at ?? '' };
};
