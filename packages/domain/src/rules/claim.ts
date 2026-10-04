import type { PortResult } from '../port-result.js';
import type { RemoteHeadAnswer } from '../ports/refs.js';
import { isEmptyClaim, realCommits, type CommitReading } from './empty-claim.js';

/**
 * What a branch's commits ahead of the default branch say about its claim.
 *
 * - `absent` — no remote-tracking ref exists.
 * - `claim-only` — the ref exists and carries nothing but claim markers (or no
 *   commit ahead of the default branch at all). It locks a slice and nobody
 *   has started the work.
 * - `work` — at least one commit ahead is not a claim marker.
 * - `unknown` — the ref's presence or its commits could not be read.
 */
export type ClaimAnswer = 'absent' | 'claim-only' | 'work' | 'unknown';

/**
 * Answers what a branch's remote ref says about its claim, from readings
 * taken elsewhere.
 *
 * **IT NEVER COMPARES A SUBJECT ITSELF.** The claim vocabulary — a commit
 * titled `plot: claim ` whose tree equals its first parent's — lives in
 * {@link isEmptyClaim} and nowhere else; this calls {@link realCommits} and
 * reads its count.
 *
 * **THE CALL'S RESULT IS READ BEFORE ITS OUTPUT.** A failed commits read and
 * an answered one holding nothing are different facts: the first means the
 * reading could not be taken, and reading emptiness alone would mistake it for
 * `claim-only` — naming a ref with real work on it as safe to release.
 *
 * **`ref` IS ASKED FIRST, SO `unknown` THERE SHORT-CIRCUITS THE COMMITS
 * ANSWER.** A ref that could not be read says nothing about what it carries,
 * and `absent` is reserved for a ref positively known not to exist.
 *
 * @param ref - whether the branch's remote-tracking ref exists.
 * @param commits - the branch's commits ahead of the default branch, newest
 *   first, or a failed result.
 * @returns the claim answer.
 */
export const claimTip = (
  ref: RemoteHeadAnswer,
  commits: PortResult<readonly CommitReading[]>,
): ClaimAnswer => {
  if (ref === 'unknown') return 'unknown';
  if (ref === 'absent') return 'absent';
  if (!commits.ok) return 'unknown';
  if (commits.value.length === 0) return 'claim-only';
  return realCommits(commits.value) === 0 ? 'claim-only' : 'work';
};

/** One branch's claim, for {@link orphanedClaims} to judge. */
export interface ClaimReading {
  /** The branch, as the plan names it. */
  branch: string;
  /** What the branch's remote ref and commits answered. */
  claim: ClaimAnswer;
  /**
   * The newest claim commit's committer time, epoch milliseconds — meaningless
   * where `claim` is not `claim-only`.
   */
  newestClaimAt: number;
  /** The agent this branch is assigned to, or `''` where none holds it. */
  assignedTo: string;
}

/**
 * Milliseconds a claim-only branch may sit before it is named orphaned —
 * one tick interval.
 *
 * **THE BOUND EXCLUDES AN AGENT THAT CLAIMED AFTER THE TICK READ ITS
 * MANIFEST.** A dispatch pushes its claim commit and then writes the
 * manifest; a tick that read the manifest a moment before the push would see
 * an unassigned claim-only branch that is not actually orphaned. One interval
 * is the longest such a race can last before the NEXT tick's manifest read
 * would have caught up.
 */
export const ORPHANED_CLAIM_AGE_MS = 60_000;

/**
 * Which branches carry a claim ref nobody is working and nobody is coming
 * back for.
 *
 * **NAMES A BRANCH ONLY WHERE EVERY ONE OF FOUR READINGS AGREES.** `claim` must
 * be `claim-only` — a branch carrying work, an unreadable ref, or no ref at all
 * is not this rule's question. `assignedTo` must be empty — a branch a live
 * agent holds is not orphaned even while its claim push is still in flight.
 * And the newest claim commit must be older than {@link ORPHANED_CLAIM_AGE_MS},
 * taken from `tickStartedAt` rather than `Date.now()` so the rule stays a pure
 * function of its readings.
 *
 * **IT NAMES, AND NEVER RELEASES.** Deleting a ref is the one write here that
 * cannot be undone, so this answers which branches a person should look at and
 * performs nothing.
 *
 * @param readings - one reading per branch a plan names, with a ref and no
 *   merged PR.
 * @param tickStartedAt - the tick's own clock reading, epoch milliseconds.
 * @returns the branches to name, in the order given.
 */
export const orphanedClaims = (
  readings: readonly ClaimReading[],
  tickStartedAt: number,
): readonly string[] =>
  readings
    .filter(
      (reading) =>
        reading.claim === 'claim-only' &&
        reading.assignedTo === '' &&
        tickStartedAt - reading.newestClaimAt > ORPHANED_CLAIM_AGE_MS,
    )
    .map((reading) => reading.branch);

/**
 * What a branch's ref and its live holders together say about a claim on it —
 * {@link ClaimTip} answers the ref alone; this adds who else holds it.
 *
 * **NOT {@link ClaimAnswer}.** That type is `claimTip`'s result, read by
 * `orphanedClaims` and its tests, and widening it would change both. This is a
 * new, disjoint vocabulary for the question `claimAnswer` answers.
 *
 * - `held-by-agent` — a live agent other than the asker already holds the
 *   branch. The only case where two agents hold one slice.
 * - `work-on-ref` — nobody holds it, and the ref carries real work.
 * - `stale-claim` — nobody holds it, and the ref carries only claim markers.
 * - `absent` — nobody holds it, and no remote-tracking ref exists.
 * - `unknown` — nobody holds it, and the ref's presence or commits could not
 *   be read.
 */
export type ClaimHolderAnswer = 'held-by-agent' | 'work-on-ref' | 'stale-claim' | 'absent' | 'unknown';

/** What `claimAnswer` reads to answer one branch. */
export interface ClaimAnswerReadings {
  /** Whether the branch's remote-tracking ref exists. */
  ref: RemoteHeadAnswer;
  /** The branch's commits ahead of the default branch, newest first. */
  commits: PortResult<readonly CommitReading[]>;
  /**
   * The live agents whose manifests name the branch, the asker already
   * excluded by whoever builds this list — see {@link claimAnswer}.
   */
  holders: readonly string[];
}

/**
 * Answers what a branch's ref and its live holders together say about a
 * claim on it.
 *
 * **A LIVE HOLDER IS TESTED FIRST.** It is the only row where two agents hold
 * one slice, and it must win over whatever the ref itself says: a holder
 * mid-push may show `work-on-ref` or `stale-claim` on the ref alone, and
 * either would hide the double assignment this exists to report.
 *
 * **`holders` MUST ALREADY EXCLUDE THE ASKER.** The caller building this
 * list — `--release` has no asker and excludes nobody; the loop's rejection
 * path excludes the manifest it owns — decides whose own manifest does not
 * count. Counting the asker's own manifest would answer `held-by-agent` on
 * every rejection and the `stale-claim` row would never be reached.
 *
 * @param readings - the ref, its commits, and the live holders other than
 *   the asker.
 * @returns the claim answer.
 */
export const claimAnswer = ({ ref, commits, holders }: ClaimAnswerReadings): ClaimHolderAnswer => {
  if (holders.length > 0) return 'held-by-agent';
  const tip = claimTip(ref, commits);
  if (tip === 'work') return 'work-on-ref';
  if (tip === 'claim-only') return 'stale-claim';
  return tip;
};
