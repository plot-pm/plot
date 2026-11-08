import type { Checks } from '../entities/pr.js';
import { trustedReview, type ReviewReading } from './pr-index.js';
import { ciCounted } from './release-checks-counted.js';
import type { PasskeyRegistration } from './passkey-settings.js';

/** The wording of a disabled button while the registration read has not answered. */
export const APPROVE_PENDING = 'Reading the registered passkey…';

/** The wording of a disabled button where no passkey is registered. */
export const APPROVE_REGISTER_FIRST = 'Register a passkey in Settings first';

/** What the board has read of the release PR. */
export interface ReleasePrReading extends ReviewReading {
  /** Whether the PR is open. */
  open: boolean;
  /** The rollup's colour without `plot/review`, bound to `checksSha`; absent where the host did not report it. */
  ciChecks?: Checks;
  /** The commit `ciChecks` was computed for. */
  checksSha?: string;
}

/** The release PR's approval button. */
export interface ReleaseApprovable {
  /** `hidden` shows no button, `disabled` shows it with `reason`, `enabled` shows it live. */
  state: 'hidden' | 'disabled' | 'enabled';
  /** The wording for a `disabled` button; empty otherwise. */
  reason: string;
}

/**
 * Decides whether the release PR's row offers "Approve release".
 *
 * The answer is a convenience over the board's own reading. The server re-reads the head and
 * `plot/review` before it merges and refuses `head-moved`, `review-missing` and `checks-missing`.
 *
 * @param pr - the release PR's reading, or `null` where the row carries none.
 * @param held - the server's registration answer, or `null` while it is unread or unreachable.
 * @returns `hidden` unless the PR is open, has a `head` with a trusted `success` review naming that head,
 * and has CI counted on that head; absent fields count as not ready. Among ready PRs, `enabled` where a
 * passkey is registered, `disabled` with {@link APPROVE_REGISTER_FIRST} where `registered` is false and
 * `disabled` with {@link APPROVE_PENDING} where `held` is `null`.
 */
export const releaseApprovable = (pr: ReleasePrReading | null, held: PasskeyRegistration | null): ReleaseApprovable => {
  const head = pr?.headSha;
  const ready =
    pr !== null &&
    head !== undefined &&
    pr.open &&
    trustedReview(pr) === 'success' &&
    pr.plotReviewSha === head &&
    ciCounted(pr.ciChecks) &&
    pr.checksSha === head;
  if (!ready) return { state: 'hidden', reason: '' };
  if (held === null) return { state: 'disabled', reason: APPROVE_PENDING };
  if (!held.registered) return { state: 'disabled', reason: APPROVE_REGISTER_FIRST };
  return { state: 'enabled', reason: '' };
};
