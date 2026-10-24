import { claimAnswer, type ClaimAnswerReadings } from './claim.js';

/**
 * Whether a claimed branch is a dead claim — no live agent, and no commit
 * beyond the default branch that is not itself an empty claim marker.
 *
 * **THIS IS THE SWEEP `claimAnswer` HAS NO SHAPE FOR.** `claimAnswer`
 * (`rules/claim.ts`) answers one branch's claim at ask-time — read when a
 * push is rejected, or a person asks about one named branch. This rule reads
 * the SAME readings, but for a different question: of every branch the fleet
 * already holds claimed, which ones are dead and safe to release without
 * being asked? It never re-derives `claimAnswer`'s commit-emptiness or
 * holder logic — `stale-claim` (nobody holds it, ref carries only claim
 * markers) already names exactly the dead-claim shape this rule selects, and
 * `held-by-agent`/`work-on-ref` already name the two cases that must not be
 * released: a live holder, or real work with nobody watching it right now.
 *
 * **THIS NAMES CANDIDATES; IT RELEASES NOTHING.** Once a branch answers true
 * here, `releaseClaim`/`gatherReadingsAndRelease`
 * (`fleet/src/shared/release-claim-reader.ts`) is still the mechanism that
 * performs the release — it already holds the live-holder and open-PR checks
 * this rule does not re-test, so a caller runs this rule to SELECT branches
 * and `releaseClaim` to act on each one.
 *
 * @param readings - the same readings `claimAnswer` takes for this branch:
 *   its ref, its commits ahead of the default branch, and its live holders.
 * @returns true where `claimAnswer` would say `stale-claim` — the ref exists
 *   but carries nothing beyond claim markers, and nobody live holds it.
 */
export const deadClaim = (readings: ClaimAnswerReadings): boolean =>
  claimAnswer(readings) === 'stale-claim';

/**
 * The branches among a claimed set that are dead claims.
 *
 * @param branches - one `claimAnswer` reading per branch the fleet holds
 *   claimed, each paired with its name.
 * @returns the branch names that are dead claims, in the order given.
 */
export const deadClaims = (
  branches: readonly { branch: string; readings: ClaimAnswerReadings }[],
): readonly string[] => branches.filter((b) => deadClaim(b.readings)).map((b) => b.branch);
