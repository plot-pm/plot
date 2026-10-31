import type { PortResult } from '../port-result.js';

/** What reverting one commit came to. */
export type RevertOutcome = 'reverted' | 'conflict';

/**
 * Reverts a breaking commit of the default branch.
 *
 * A local git operation; no remote service is involved. The revert is made in
 * a checkout the caller owns, and pushing it is {@link Trees.push}'s job.
 */
export interface Revert {
  /**
   * Whether `ref` already holds a commit that reverts `sha`.
   *
   * @param sha - the commit that may have been reverted.
   * @param ref - the ref whose history is read, such as `origin/main`.
   * @returns `true` where a commit on `ref` carries git's `This reverts commit <sha>` line.
   */
  isReverted(sha: string, ref: string): Promise<PortResult<boolean>>;

  /**
   * Reverts `sha` in the checkout at `path` and commits the result.
   *
   * A merge commit is reverted against its first parent; a squash commit has
   * one parent and is reverted as it is. A conflict leaves the checkout as it
   * was before the call: the revert is aborted, never committed half-applied.
   *
   * @param path - a checkout on the branch that receives the revert.
   * @param sha - the commit to revert.
   * @returns `conflict` where the revert does not apply cleanly; `failed` where git refused for another reason.
   */
  revertCommit(path: string, sha: string): Promise<PortResult<RevertOutcome>>;
}
