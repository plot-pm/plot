import { claimAnswer, ORPHANED_CLAIM_AGE_MS, type ClaimAnswerReadings } from './claim.js';

/**
 * Whether a claimed branch is a dead claim — no live agent, no commit beyond
 * the default branch that is not itself an empty claim marker, and a newest
 * claim commit older than {@link ORPHANED_CLAIM_AGE_MS}.
 *
 * **`claimAnswer` DECIDES THE SHAPE.** A dead claim is a branch `claimAnswer`
 * (`rules/claim.ts`) answers `stale-claim` for: nobody holds it, and the ref
 * carries only claim markers. `held-by-agent` and `work-on-ref` are never
 * dead.
 *
 * **THE AGE BOUND EXCLUDES A CLAIM STILL INSIDE ITS LAUNCH WINDOW.** A
 * dispatch pushes its claim commit before its manifest names the branch, so a
 * claim younger than {@link ORPHANED_CLAIM_AGE_MS} reads as held by nobody
 * while its agent is starting. The bound is the one `orphanedClaims` uses, so
 * on the same readings both rules name the same branches.
 *
 * **THIS NAMES CANDIDATES; IT RELEASES NOTHING.** `releaseClaim` and
 * `gatherReadingsAndRelease` (`fleet/src/shared/release-claim-reader.ts`)
 * perform a release, with their own live-holder and open-PR checks.
 *
 * @param readings - the readings `claimAnswer` takes for this branch: its
 *   ref, its commits ahead of the default branch, and its live holders.
 * @param newestClaimAt - the newest claim commit's committer time, epoch
 *   milliseconds; `0` where the ref carries no commit ahead.
 * @param tickStartedAt - the reading's own clock, epoch milliseconds.
 * @returns true where `claimAnswer` says `stale-claim` and the newest claim
 *   commit is older than {@link ORPHANED_CLAIM_AGE_MS}.
 */
export const deadClaim = (
  readings: ClaimAnswerReadings,
  newestClaimAt: number,
  tickStartedAt: number,
): boolean =>
  claimAnswer(readings) === 'stale-claim' && tickStartedAt - newestClaimAt > ORPHANED_CLAIM_AGE_MS;

/** One claimed branch, for {@link deadClaims} to judge. */
export interface DeadClaimReading {
  /** The branch, as the plan names it. */
  branch: string;
  /** What `claimAnswer` reads for this branch. */
  readings: ClaimAnswerReadings;
  /** The newest claim commit's committer time, epoch milliseconds. */
  newestClaimAt: number;
}

/**
 * The branches among a claimed set that are dead claims.
 *
 * @param branches - one reading per branch the fleet holds claimed.
 * @param tickStartedAt - the reading's own clock, epoch milliseconds.
 * @returns the branch names that are dead claims, in the order given.
 */
export const deadClaims = (
  branches: readonly DeadClaimReading[],
  tickStartedAt: number,
): readonly string[] =>
  branches
    .filter((b) => deadClaim(b.readings, b.newestClaimAt, tickStartedAt))
    .map((b) => b.branch);
