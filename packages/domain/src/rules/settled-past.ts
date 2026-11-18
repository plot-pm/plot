import { ANCESTOR_ASKS_MAX } from './default-branch.js';
import { syncPathVerdict } from './state-sync.js';

/** One first-parent commit past the settled commit, with the paths it changed. */
export interface UnsettledCommit {
  /** The full object name. */
  readonly sha: string;
  /** The paths the commit changed, rename sources included; `'unknown'` where the diff could not be read. */
  readonly files: readonly string[] | 'unknown';
}

/**
 * The first-parent line from the settled commit to the default branch's head.
 *
 * `'unread'` where the line could not be read. A line read is values, so a rule
 * over it stays synchronous.
 */
export type UnsettledReading =
  | 'unread'
  | {
      /** The head the line ends at. */
      readonly headSha: string;
      /** The commits in `settled.sha..headSha`, newest first. */
      readonly commits: readonly UnsettledCommit[];
    };

/**
 * Whether a settled reading covers the head, because every commit past it
 * changes only paths in a set.
 *
 * The judgement reads paths through {@link syncPathVerdict} and never a
 * commit's subject or author. Answers `false` for: an unread line; a line not
 * ending at its head; no commit between a settled commit and a different head;
 * more than {@link ANCESTOR_ASKS_MAX} commits, which one refresh of the reading
 * never asked about; an empty set; a commit with one path outside the set, a path with `..`
 * segments or an unread diff.
 *
 * @param settled - the settled commit of the reading.
 * @param unsettled - the line past it.
 * @param pathSet - the entries from `syncPathSet` and the generated bundles.
 * @returns true where `settled.sha` is the head, or where every commit past it
 *   lies inside the set.
 */
export const settledPast = (settled: { readonly sha: string }, unsettled: UnsettledReading, pathSet: readonly string[]): boolean => {
  if (unsettled === 'unread' || pathSet.length === 0) return false;
  if (unsettled.headSha === settled.sha) return true;
  const { commits } = unsettled;
  if (commits.length === 0 || commits.length > ANCESTOR_ASKS_MAX || commits[0]?.sha !== unsettled.headSha) return false;
  return commits.every((commit) => syncPathVerdict(commit.files, pathSet).ok);
};
