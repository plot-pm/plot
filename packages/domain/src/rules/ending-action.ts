import type { EndingReason } from '../entities/ending.js';
import type { CommitReading } from './sample.js';

/**
 * What one tick read of a desk whose worker ended, for {@link endingAction}
 * alone to answer.
 *
 * **THE DESK, NOT THE REGISTRY.** The same reason `FreshAgentReadings`
 * (`rules/fresh-agent.ts`) reads the desk rather than an agent entry: a
 * manifest is gone by the time a worker's loop has ended, and a rule keyed on
 * a registry entry never sees this ending at all.
 */
export interface EndingActionReadings {
  /** The ending this desk's worker wrote, or `null` where none was written or it could not be read. */
  readonly ending: EndingReason | null;
  /** The branch the ending names. */
  readonly branch: string;
  /**
   * Whether a manifest already names this desk.
   *
   * **A DESK THE TICK IS ABOUT TO START IS NOT A DESK WITH NO MANIFEST.**
   * Mirrors `FreshAgentReadings.hasManifest`'s own reasoning: the ending and
   * the manifest's removal are not one atomic write, so a desk a start
   * already has in flight answers `leave` for every reason — acting on the
   * ending here would race that start.
   */
  readonly hasManifest: boolean;
  /** How many fresh sessions this slice already had. Unused by the rows this branch implements; carried for the rows wave 2 adds. */
  readonly priorFreshSessions: number;
  /**
   * Whether the branch holds a commit beyond its claim, or an open PR —
   * `nothing-done`'s own two readings, carried here rather than re-asked.
   *
   * `commitBeyondClaim: 'unanswerable'` takes the same branch as `'yes'`:
   * releasing a claim on a failed git read is the destructive direction.
   */
  readonly commitBeyondClaim: CommitReading;
  /** Whether an open pull request still carries the branch. */
  readonly prOpen: boolean;
}

/**
 * What the supervisor's tick should do about a desk whose worker ended.
 *
 * - `release-claim` — the claim this ending's branch holds is this tick's to
 *   release through `ClaimRelease`, because nothing it did survives: no
 *   commit beyond the claim and no open PR.
 * - `start-fresh` — not implemented by this branch; the rows that answer it
 *   belong to `corrections-spent` and `turn-limit`, wave 2's to add.
 * - `needs-a-person` — not implemented by this branch either, for the same
 *   reason.
 * - `leave` — every other case, including a desk a manifest already names,
 *   and the default where no row of this branch's table answers otherwise.
 *
 * The full four-value type is declared now so a later wave adds a row
 * without widening every caller's switch.
 */
export type EndingActionVerdict = 'release-claim' | 'start-fresh' | 'needs-a-person' | 'leave';

/**
 * Decides what the supervisor's tick should do about a desk whose worker
 * ended — this branch answers `release-claim` for `nothing-done` and
 * `leave` for everything else; later waves add rows for `corrections-spent`
 * and `turn-limit` without changing this signature.
 *
 * **THE LOOP ENDS, THE TICK RELEASES.** `agentLoop` cannot tell a live peer
 * from itself, and `releaseClaim` refuses an `agent-live` read from the
 * manifests — so a `nothing-done` ending only ever names what to do; this
 * rule's `release-claim` verdict is the tick's instruction to ask
 * `ClaimRelease`, not a release already performed.
 *
 * **A MANIFEST-NAMED DESK ANSWERS `leave` FOR EVERY REASON.** The ending and
 * the manifest's removal are not one atomic write, so a desk a start already
 * has in flight must not have its claim released out from under it.
 *
 * **ABSENT IS NOT FALSE.** A missing or unreadable ending answers `leave`;
 * `commitBeyondClaim: 'unanswerable'` takes the same arm as `'yes'`, for the
 * same reason `priorFreshSessions` reads `0` rather than refusing — a failed
 * read must never point toward the destructive action.
 *
 * Pure: it reads no disk and holds nothing between calls.
 *
 * @param readings - what the tick measured of one desk.
 * @returns what the tick should do about it.
 */
export const endingAction = (readings: EndingActionReadings): EndingActionVerdict => {
  if (readings.hasManifest) return 'leave';
  if (readings.ending !== 'nothing-done') return 'leave';
  if (readings.commitBeyondClaim !== 'no') return 'leave';
  if (readings.prOpen) return 'leave';
  return 'release-claim';
};
