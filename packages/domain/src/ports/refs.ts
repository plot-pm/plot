import type { PortResult } from '../port-result.js';
import type { FleetPulse } from '../entities/fleet.js';

/**
 * Whether a branch's work is on the default branch.
 *
 * Three values, never a boolean. A scan that could not fetch reads merged
 * branches as open, and `unknown` is what keeps that from being reported as a
 * claim about the branch.
 */
export type MergeStatus = 'merged' | 'not-merged' | 'unknown';

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
  pulse(): Promise<PortResult<FleetPulse>>;

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
