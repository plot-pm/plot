import type { PortResult } from '../port-result.js';

/** What running the release reported. */
export interface ClaimReleaseRun {
  /** Whether the script itself refused — one of the four it still enforces. */
  refused: boolean;
  /** The script's own sentence: its stderr on a refusal, its stdout otherwise. */
  sentence: string;
}

/**
 * Runs the release a `releaseClaim` decision names.
 *
 * ONE METHOD, because the decision already named everything the script needs
 * — the branch — and the four refusals the domain does not read (a live
 * worker pid, a file-changing remote commit, unpushed or dirty desk work, a
 * `PLOT-BLOCKED` marker) are the script's own job to enforce.
 */
export interface ClaimRelease {
  /**
   * Releases `branch`'s claim: clears the manifests naming it, deletes its
   * remote ref, and detaches its desk.
   *
   * @param branch - the branch to release.
   * @returns `answered` once the script ran, naming whether IT refused —
   *   `refused: false` covers both an actual release and the script's own
   *   "nothing to release" no-op, since both exit 0. `failed` when the script
   *   could not be run at all.
   */
  release(branch: string): PortResult<ClaimReleaseRun>;
}
