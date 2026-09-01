import type { PortResult } from '../port-result.js';
import type { Worktree } from '../entities/worktree.js';

/**
 * Reads the worktrees on this machine — the DERIVED source of truth about desks.
 *
 * A worktree is found by asking git which one holds a branch, never by
 * rebuilding a path from the branch's name: hand-made worktrees are the
 * population with no claim, and they rarely follow any naming convention.
 */
export interface Trees {
  /**
   * Lists every worktree git knows about on this machine.
   *
   * @returns the worktrees, the main checkout among them.
   */
  list(): Promise<PortResult<readonly Worktree[]>>;

  /**
   * Finds the worktree holding a branch.
   *
   * @param branch - the branch to look for.
   * @returns the worktree, or null when no worktree on this machine holds it.
   */
  forBranch(branch: string): Promise<PortResult<Worktree | null>>;

  /**
   * Whether a worktree holds uncommitted changes or unpushed commits.
   *
   * A tree that cannot be checked reports unclean, so unlanded work stays
   * visible rather than being silently dropped.
   *
   * @param path - the worktree's absolute path.
   * @returns false where the tree holds anything unlanded.
   */
  isClean(path: string): Promise<PortResult<boolean>>;

  /**
   * Lists the marker files a worktree carries at its root.
   *
   * A blocked agent writes a file, so the marker is looked for BY NAME rather
   * than as a string any file may contain — a log that quotes the marker is
   * not a stopped agent.
   *
   * @param path - the worktree's absolute path.
   * @param prefix - the marker's filename prefix, such as `PLOT-BLOCKED`.
   * @returns the matching filenames, without their directory.
   */
  markers(path: string, prefix: string): Promise<PortResult<readonly string[]>>;

  /**
   * Names the branch a checkout is on.
   *
   * `''` for a detached HEAD, and the emptiness is an ANSWER rather than a
   * failure: several worktrees here are detached, and a reader shown a short
   * sha where a branch name belongs reads it as a branch. A caller that must
   * tell *detached* from *could not be read* reads the result's `ok` — which
   * is the distinction the old `execFileSync` collapsed into one empty string.
   *
   * Distinct from {@link list}, whose entries also carry a branch: this asks
   * about ONE checkout and needs no path comparison to find it. Matching a
   * caller's own root against a listing costs a symlink resolution on every
   * platform where a temporary directory is one.
   *
   * @param path - the checkout's absolute path.
   * @returns the branch name, or `''` where HEAD is detached.
   */
  currentBranch(path: string): Promise<PortResult<string>>;
}
