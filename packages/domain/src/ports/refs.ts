import type { PortResult } from '../port-result.js';
import type { FleetReading } from '../entities/fleet.js';

/**
 * Whether a branch's work is on the default branch.
 *
 * Three values, never a boolean. A scan that could not fetch reads merged
 * branches as open, and `unknown` is what keeps that from being reported as a
 * claim about the branch.
 */
export type MergeStatus = 'merged' | 'not-merged' | 'unknown';

/**
 * One entry of a tree listing — a blob, with the mode that says what it is.
 *
 * The mode is carried rather than filtered out because a symlink and a file
 * are both blobs to git, and telling them apart is the caller's question: a
 * `120000` entry holds its target's PATH as its content, so a reader that
 * parsed one would be handed a line of text where a file should be.
 */
export interface TreeBlob {
  /** The six-digit git mode — `100644`, `100755`, `120000`. */
  mode: string;
  /** The blob's object name. */
  sha: string;
  /** The path, relative to the repository root. */
  path: string;
}

/** A branch and the commit its tip points at. */
export interface BranchTip {
  /** The branch name, without a remote prefix. */
  branch: string;
  /** The commit the tip resolves to. */
  sha: string;
}

/**
 * Reads git refs — the DERIVED source of truth about branches.
 *
 * Every answer here comes from refs rather than from the host: a ref is local
 * evidence, so it survives an unreachable host, and it is why `Refs` and
 * `Host` are separate ports rather than one.
 */
export interface Refs {
  /**
   * Names the repository's default branch.
   *
   * @returns the branch name, such as `main`.
   */
  defaultBranch(): Promise<PortResult<string>>;

  /**
   * Lists the branches the repository holds.
   *
   * @param remote - when true, list `origin/*` rather than local branches.
   * @returns the branch names, without their remote prefix.
   */
  listBranches(remote: boolean): Promise<PortResult<readonly string[]>>;

  /**
   * Whether a branch is an ancestor of the default branch.
   *
   * Ancestry alone never clears a squash-merged branch — the rewrite leaves it
   * permanently ahead of the default branch — so a `not-merged` answer here is
   * evidence and not a verdict.
   *
   * @param branch - the branch to test.
   * @returns `merged`, `not-merged`, or `unknown` when the refs cannot be read.
   */
  isMergedByAncestry(branch: string): Promise<PortResult<MergeStatus>>;

  /**
   * Resolves a ref to its commit sha.
   *
   * @param ref - any revision git accepts.
   * @returns the full sha.
   */
  resolve(ref: string): Promise<PortResult<string>>;

  /**
   * Lists the files a branch changed against the default branch.
   *
   * @param branch - the branch to read.
   * @returns the paths, relative to the repository root.
   */
  changedFiles(branch: string): Promise<PortResult<readonly string[]>>;

  /**
   * Reads the fleet's whole state in one pass.
   *
   * The expensive operation on this port, and deliberately one call: the scan
   * derives every plan's slice verdicts together, and asking per plan would
   * re-walk the same refs once per plan.
   *
   * @returns the pulse, as the scan derives it.
   */
  pulse(): Promise<PortResult<FleetReading>>;


  /**
   * Lists the blobs a tree holds beneath a path.
   *
   * Returns the MODE and the SHA alongside each path, because both are answers
   * the same listing already carries and asking for them separately would cost
   * a second read per entry. The mode separates a file from the symlink
   * pointing at it; the sha is what {@link readBlobs} is given.
   *
   * @param ref - the revision to list at.
   * @param dir - the path to list beneath, relative to the repository root.
   * @returns the blobs, or a failure when the ref cannot be read.
   */
  listBlobs(ref: string, dir: string): Promise<PortResult<readonly TreeBlob[]>>;

  /**
   * Reads many blobs by object name, in ONE read.
   *
   * Batched deliberately, and the batch is the contract rather than an
   * optimisation of it: a git call costs ~55 ms of process spawn regardless of
   * how little work it does, so a per-object implementation of this signature
   * would cost that once per blob. Measured on this repository 2026-08-27:
   * ~1.5 s for a per-file loop against 0.011 s for one batch, 136x apart.
   *
   * A sha the repository does not hold is simply absent from the map — a
   * missing object is a reading, not a failure of the call.
   *
   * @param shas - the object names to read.
   * @returns each readable blob's content, keyed by its sha.
   */
  readBlobs(shas: readonly string[]): Promise<PortResult<ReadonlyMap<string, string>>>;

  /**
   * Lists remote-tracking branches matching ref patterns, with their tip shas.
   *
   * The tip comes back in the SAME listing as the name because it is free
   * there, and it is what lets a caller skip work when no branch has moved.
   *
   * @param patterns - full ref patterns, such as `refs/remotes/origin/idea/*`.
   * @returns the branches, without their `origin/` prefix.
   */
  branchTips(patterns: readonly string[]): Promise<PortResult<readonly BranchTip[]>>;

  /**
   * Names the repository this ref reader is reading.
   *
   * Answers where git resolved to, which need not be where the caller pointed
   * it: git searches UPWARDS from a directory, so a plans directory nested in
   * an unrelated checkout resolves to that checkout. A caller comparing this
   * against its own root is asking whether it is reading the repository it
   * meant to.
   *
   * @returns the repository's top-level path.
   */
  repoRoot(): Promise<PortResult<string>>;

  /**
   * How many commits the checkout's HEAD is behind a ref.
   *
   * `null` where the question has no answer rather than a count, and the
   * distinction is the whole of it: a detached HEAD parked at the ref's tip
   * reports 0 commits behind, which is indistinguishable from a current
   * branch. So HEAD is tested for being a branch FIRST, and the count is taken
   * only once the question is known to be answerable.
   *
   * @param ref - the revision to measure against.
   * @returns the count, or null where HEAD is not a branch.
   */
  countBehind(ref: string): Promise<PortResult<number | null>>;

  /**
   * Reads a file's content at a ref, without checking it out.
   *
   * A phase read from `origin/<main>` is the gate `plot-phase-gate.sh` applies,
   * and it is a different question from the working tree's copy: an approval
   * nobody else can see is not one.
   *
   * @param ref - the revision to read at.
   * @param path - the file's path, relative to the repository root.
   * @returns the file's content.
   */
  showFile(ref: string, path: string): Promise<PortResult<string>>;
}
