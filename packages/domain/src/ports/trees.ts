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
   * Lists the paths a worktree holds on the floor, leftovers dropped.
   *
   * The DIRTY PATHS, where {@link isClean} answers only whether there are any.
   * A monitor comparing two passes needs to know *what* moved, and a boolean
   * that flips from false to false says nothing across a rename.
   *
   * The filter is the operation's reason for existing rather than a
   * convenience on top of it. Three exclusions apply — Plot's own
   * `.plot-worker.` records, editor leftovers (`.tmp1`, `.swp`, `.orig`,
   * `.rej`, `.bak`), and tool scratch directories (`.playwright-mcp`,
   * `.plot/agents`, `.plot/state`, `.omc/state`). A worker monitor appends its
   * findings to a file INSIDE the worktree it watches, so an unfiltered
   * listing would show the monitor's own writing and no two passes could ever
   * agree.
   *
   * Two of the three exclusions match on a nested path, which is why this is
   * not {@link markers}: that one lists a directory's own entries by name
   * prefix and cannot see into `.plot/state` at all.
   *
   * @param path - the worktree's absolute path.
   * @returns the paths, relative to the worktree, without their status codes.
   */
  dirtyPaths(path: string): Promise<PortResult<readonly string[]>>;

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

  /**
   * Forgets the worktrees whose directories are gone.
   *
   * The one operation here that WRITES, and it writes only to git's own
   * administrative records. A `git worktree add` at a path a stale record still
   * claims is refused, so this runs before one — a caller that skipped it would
   * see the refusal and read it as the path being in use.
   *
   * @returns nothing; a failure means git's records were not updated.
   */
  prune(): Promise<PortResult<void>>;

  /**
   * Creates a worktree at a path, checked out DETACHED.
   *
   * Detached is the contract rather than an option: a caller makes a tree for
   * an agent that will create and check out its own branch there, and a tree
   * already holding one would refuse it.
   *
   * @param path - where to create it, absolute.
   * @param start - the revision to check out.
   * @returns nothing; a failure carries no tree.
   */
  add(path: string, start: string): Promise<PortResult<void>>;

  /**
   * What a checkout reports as changed, VERBATIM.
   *
   * The porcelain text and not a boolean, unlike {@link Trees.isClean}: a
   * caller that caches this compares two readings, and a boolean cannot say a
   * tree changed while staying dirty.
   *
   * @param path - the checkout's absolute path.
   * @returns `git status --porcelain`'s output as it stands.
   */
  statusSync(path: string): PortResult<string>;

  /**
   * Lists the worktrees, read on the CALLING THREAD.
   *
   * The synchronous twin, for the signal that gates a monitor's cache from a
   * synchronous pulse.
   *
   * @returns the worktrees, the main checkout among them.
   */
  listSync(): PortResult<readonly Worktree[]>;
}
