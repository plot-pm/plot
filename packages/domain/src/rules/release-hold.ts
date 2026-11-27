import type { PrIndexRow } from '../entities/pr-index.js';
import type { ReleaseHoldRecord } from '../entities/release-hold.js';
import { RELEASE_BRANCH_PREFIX } from './loose-delete.js';
import { trustedReview } from './pr-index.js';
import { ciCounted } from './release-checks-counted.js';

/** Why the release PR holds no merge. */
export type ReleaseHoldNone =
  | 'no-release'
  | 'not-open'
  | 'not-release-branch'
  | 'base-not-default'
  | 'no-head'
  | 'ci-not-counted'
  | 'review-not-on-head'
  | 'lifted'
  | 'since-unparseable'
  | 'expired';

/** Whether a waiting release head holds merges into the default branch. */
export type ReleaseHoldVerdict =
  | {
      readonly verdict: 'holds';
      /** The release PR's number. */
      readonly pr: number;
      /** The release head that holds. */
      readonly head: string;
      /** When the hold for `head` began, ISO-8601: the record's `since`, or `now` where the record names another head or none. */
      readonly since: string;
    }
  | { readonly verdict: 'none'; readonly reason: ReleaseHoldNone };

/**
 * Decides whether the release PR's head is ready and waits, so that fleetd holds its merges into the default branch.
 *
 * The head is ready where the row is open, its head branch starts with `changeset-release/`, its `base` is
 * `defaultBranchName`, `ciChecks` reads counted-green on `checksSha === headSha`, and the trusted `plot/review`
 * reading names the head and reads `pending` or `success`. A record for another head, or no record, reads as a
 * hold that begins at `now`.
 *
 * @param release - the release PR's index row, or `null` where the index holds none.
 * @param record - the release hold record, or `null` where there is none or it did not read.
 * @param now - epoch milliseconds of the pass.
 * @param boundMs - how long one head may hold, from its `since`: the `Checks wait` bound.
 * @param defaultBranchName - the default branch's name.
 * @returns `holds` with the PR, the head and the hold's `since`; otherwise `none` with the first unmet
 *   condition. A lift for this head answers `lifted`, a `since` that does not parse answers
 *   `since-unparseable`, and `now - since >= boundMs` answers `expired`.
 */
export const releaseHold = (
  release: PrIndexRow | null,
  record: ReleaseHoldRecord | null,
  now: number,
  boundMs: number,
  defaultBranchName: string,
): ReleaseHoldVerdict => {
  const no = (reason: ReleaseHoldNone): ReleaseHoldVerdict => ({ verdict: 'none', reason });
  if (release === null) return no('no-release');
  if (release.state !== 'OPEN') return no('not-open');
  if (!release.head.startsWith(RELEASE_BRANCH_PREFIX)) return no('not-release-branch');
  if (defaultBranchName === '' || release.base !== defaultBranchName) return no('base-not-default');
  const head = release.headSha;
  if (head === undefined) return no('no-head');
  if (release.checksSha !== head || !ciCounted(release.ciChecks)) return no('ci-not-counted');
  const review = trustedReview(release);
  if (release.plotReviewSha !== head || (review !== 'pending' && review !== 'success')) return no('review-not-on-head');
  if (record === null || record.head !== head) {
    return { verdict: 'holds', pr: release.number, head, since: new Date(now).toISOString() };
  }
  if (record.liftedBy !== undefined) return no('lifted');
  const since = Date.parse(record.since);
  if (Number.isNaN(since)) return no('since-unparseable');
  if (now - since >= boundMs) return no('expired');
  return { verdict: 'holds', pr: release.number, head, since: record.since };
};
