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
  /** `disabled` shows the button with `reason`, `enabled` shows it live. The button is never hidden. */
  state: 'disabled' | 'enabled';
  /** The wording for a `disabled` button; empty otherwise. */
  reason: string;
}

const short = (sha: string): string => sha.slice(0, 9);

const ciReason = (pr: ReleasePrReading, head: string): string | null => {
  if (pr.ciChecks === undefined || pr.checksSha !== head) return `CI has not reported on ${short(head)}`;
  if (ciCounted(pr.ciChecks)) return null;
  if (pr.ciChecks === 'pending') return `CI is still running on ${short(head)}`;
  if (pr.ciChecks === 'failing') return `CI is failing on ${short(head)}`;
  return `CI reports no counted check on ${short(head)}`;
};

const reviewReason = (pr: ReleasePrReading, head: string): string | null => {
  const review = trustedReview(pr);
  if (review === undefined || review === 'absent') return `No review on ${short(head)} yet`;
  if (pr.plotReviewSha !== undefined && pr.plotReviewSha !== head) {
    return `The review names an older head; no review on ${short(head)} yet`;
  }
  if (review === 'success') return pr.plotReviewSha === head ? null : `No review on ${short(head)} yet`;
  if (review === 'pending') return `The review is still running on ${short(head)}`;
  if (review === 'unchecked') return `The review on ${short(head)} is not yet judged`;
  return `The review failed on ${short(head)}`;
};

/**
 * Decides whether the release PR's "Approve release" button is enabled, and why not.
 *
 * The answer is a convenience over the board's own reading. The server re-reads the head and
 * `plot/review` before it merges and refuses `head-moved`, `review-missing` and `checks-missing`.
 *
 * @param pr - the release PR's reading, or `null` where the row carries none.
 * @param held - the server's registration answer, or `null` while it is unread or unreachable.
 * @returns `enabled` where the PR is open, has a `head` with CI counted and a trusted `success` review
 * on that head, and a passkey is registered. Otherwise `disabled` with the first unmet criterion, in this
 * order: no reading, not open, no head, CI, review, then {@link APPROVE_PENDING} where `held` is `null`
 * and {@link APPROVE_REGISTER_FIRST} where `registered` is false.
 */
export const releaseApprovable = (pr: ReleasePrReading | null, held: PasskeyRegistration | null): ReleaseApprovable => {
  const no = (reason: string): ReleaseApprovable => ({ state: 'disabled', reason });
  if (pr === null) return no('The board has not read the release PR yet');
  if (!pr.open) return no('The release PR is not open');
  const head = pr.headSha;
  if (head === undefined) return no("The board has not read the release PR's head yet");
  const unmet = ciReason(pr, head) ?? reviewReason(pr, head);
  if (unmet !== null) return no(unmet);
  if (held === null) return no(APPROVE_PENDING);
  if (!held.registered) return no(APPROVE_REGISTER_FIRST);
  return { state: 'enabled', reason: '' };
};
