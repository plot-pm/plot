import type { PrReviewReading } from '../ports/host.js';

/**
 * Whether the reading was judged against a trusted writer.
 *
 * `checked`: the Review app's bot login was known and the reading is its
 * newest status. `unchecked`: no `Review app` key is declared, or the backend
 * keeps no writer, so the newest status from any writer is read as before.
 * `unread`: the trusted login could not be resolved.
 */
export type ReviewWriterReading = 'checked' | 'unchecked' | 'unread';

/** A `plot/review` status from a writer other than the trusted one, newer than the trusted one's. */
export interface ForeignReview {
  /** The login that wrote it. */
  readonly login: string;
  /** The state it carries. */
  readonly state: string;
  /** When the host recorded it. */
  readonly time: string;
}

/** A `pr-review` reading after the writer check. */
export interface JudgedReview {
  /** The PR's head commit. */
  readonly sha: string;
  /** The trusted writer's newest state (`absent` where none), or the newest from any writer where `writer` is `unchecked`. */
  readonly state: string;
  /** The description of the status `state` names, or `''`. */
  readonly description: string;
  /** The time of the status `state` names, or `''`. */
  readonly time: string;
  /** Whether a PR comment starts with `review-bypass:`. */
  readonly bypass: boolean;
  /** How the reading was judged. */
  readonly writer: ReviewWriterReading;
  /** The newest foreign status where it is newer than the trusted one, else null. */
  readonly foreign: ForeignReview | null;
}

/**
 * Judges a `pr-review` reading against the Review app's bot login.
 *
 * `reading.statuses` lists the `plot/review` statuses newest first, so a
 * status that precedes the first trusted one is newer than it. A reading with
 * no `statuses` holds none.
 *
 * @param reading - what `Host.prReview` answered.
 * @param trusted - the bot login `Host.reviewWriter` answered; `''` where no
 *   writer is declared; `null` where it could not be resolved.
 * @returns the trusted writer's newest status in `state`, `description` and
 *   `time` with any newer foreign status in `foreign`; the reading unchanged
 *   with `foreign: null` where `trusted` is `''`; `writer: 'unread'` where
 *   `trusted` is null, carrying `absent` so it cannot read as a pass.
 */
export const checkedReview = (reading: PrReviewReading, trusted: string | null): JudgedReview => {
  const base = { sha: reading.sha, bypass: reading.bypass, foreign: null };
  if (trusted === null) {
    return { ...base, state: 'absent', description: '', time: '', writer: 'unread' };
  }
  if (trusted === '') {
    return { ...base, state: reading.state, description: reading.description, time: reading.time, writer: 'unchecked' };
  }
  const statuses = reading.statuses ?? [];
  const own = statuses.findIndex((s) => s.writer === trusted);
  const newer = own < 0 ? statuses : statuses.slice(0, own);
  const other = newer.find((s) => s.writer !== trusted);
  const mine = own < 0 ? undefined : statuses[own];
  return {
    ...base,
    state: mine?.state ?? 'absent',
    description: mine?.description ?? '',
    time: mine?.time ?? '',
    writer: 'checked',
    foreign: other === undefined ? null : { login: other.writer, state: other.state, time: other.time },
  };
};

/** The refusal a caller names for a review that is missing or not `success`. */
export type PlainRefusal = 'review-not-passed' | 'review-missing';

/** What {@link reviewPasses} answers. `seen` completes the sentence "<seen> for PR #n." */
export type ReviewPass<Plain extends PlainRefusal = PlainRefusal> =
  | { readonly pass: true }
  | { readonly pass: false; readonly reason: Plain | 'review-foreign-writer' | 'review-writer-unread'; readonly seen: string };

/** How a caller reads the head and names the plain refusal. */
export interface ReviewPassOptions<Plain extends PlainRefusal> {
  /** The refusal for a read that failed, a state other than `success`, or a review of another head. */
  readonly plain: Plain;
  /** Whether two commit names are one commit; strict equality where absent. */
  readonly sameHead?: (a: string, b: string) => boolean;
}

const shortSha = (sha: string): string => (sha === '' ? 'none' : sha.slice(0, 12));

/**
 * Answers the merge question for both controllers: does this review pass on `head`.
 *
 * Refuses `review-writer-unread` where the trusted login could not be
 * resolved, `review-foreign-writer` where a foreign status is newer than the
 * trusted one, and `options.plain` where the read failed, the state is not
 * `success` or the review names another head.
 *
 * @param judged - the judged reading, or `'unaskable'` where the read failed.
 * @param head - the PR's head commit.
 * @param options - the plain refusal's name and the commit comparison.
 * @returns a pass, or the refusal with the sentence naming what was seen.
 */
export const reviewPasses = <Plain extends PlainRefusal>(
  judged: JudgedReview | 'unaskable',
  head: string,
  options: ReviewPassOptions<Plain>,
): ReviewPass<Plain> => {
  const refuse = (reason: Plain | 'review-foreign-writer' | 'review-writer-unread', seen: string): ReviewPass<Plain> => ({ pass: false, reason, seen });
  const same = options.sameHead ?? ((a: string, b: string) => a === b);
  if (judged === 'unaskable') return refuse(options.plain, 'the review read failed');
  if (judged.writer === 'unread') {
    return refuse('review-writer-unread', "the Review app's login could not be resolved, so 'plot/review' cannot be attributed");
  }
  if (judged.foreign !== null) {
    return refuse('review-foreign-writer', `a 'plot/review' status '${judged.foreign.state}' from ${judged.foreign.login} at ${judged.foreign.time} is newer than the Review app's own`);
  }
  if (!same(judged.sha, head)) return refuse(options.plain, `'plot/review' names ${shortSha(judged.sha)}, not the head ${shortSha(head)}`);
  if (judged.state !== 'success') return refuse(options.plain, `'plot/review' reads '${judged.state}'`);
  return { pass: true };
};

/** The states a row's `plotReviewJudged` can hold. */
export type JudgedReviewState = 'success' | 'failure' | 'pending' | 'absent' | 'error';

const JUDGED_STATES: readonly string[] = ['success', 'failure', 'pending', 'absent', 'error'];

/**
 * The state the PR index keeps for a judged reading.
 *
 * A foreign status newer than the trusted one leaves a trusted `failure`
 * standing and sends every other state back to `absent`, so the review arm
 * starts one run whose own statuses are newer than the foreign one.
 *
 * @param judged - the reading {@link checkedReview} judged.
 * @returns the state to keep; null where the writer was unread, so the row stays unchecked.
 */
export const judgedReviewState = (judged: JudgedReview): JudgedReviewState | null => {
  if (judged.writer === 'unread') return null;
  if (judged.foreign !== null) return judged.state === 'failure' ? 'failure' : 'absent';
  return JUDGED_STATES.includes(judged.state) ? (judged.state as JudgedReviewState) : 'absent';
};
