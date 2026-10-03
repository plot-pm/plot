/**
 * Whether a commit is an empty claim marker, and how many commits in a list
 * are real work.
 *
 * A claim marker is the commit a dispatch pushes to claim a branch. It is
 * titled `plot: claim …` AND changes no file: its tree equals its first
 * parent's tree. Both facts are required. A commit titled
 * `plot: claim handling refactor` that changes a file is real work.
 */

/** The prefix every claim marker's subject starts with. */
export const CLAIM_SUBJECT_PREFIX = 'plot: claim ';

/** What git records about one commit. */
export interface CommitReading {
  /** The commit's subject line. */
  readonly subject: string;
  /** The commit's tree id. */
  readonly tree: string;
  /**
   * The tree id of the commit's first parent, or `null` where the commit has
   * no parent or the parent's tree could not be read.
   */
  readonly parentTree: string | null;
}

/**
 * Answers whether one commit is an empty claim marker.
 *
 * @param commit - the commit's subject, tree and first parent's tree.
 * @returns `true` when the subject starts with `plot: claim ` and the tree is
 *   non-empty and equal to the parent's tree. A `null` or empty parent tree
 *   answers `false`, so a reading that is missing counts as real work.
 */
export const isEmptyClaim = ({ subject, tree, parentTree }: CommitReading): boolean =>
  subject.startsWith(CLAIM_SUBJECT_PREFIX) && tree !== '' && tree === parentTree;

/**
 * Counts the commits that are real work.
 *
 * @param commits - the commits a branch carries beyond the default branch.
 * @returns the number of commits that are not empty claim markers. `0` for an
 *   empty list; a caller that needs at least one commit checks the length.
 */
export const realCommits = (commits: readonly CommitReading[]): number =>
  commits.filter((commit) => !isEmptyClaim(commit)).length;
