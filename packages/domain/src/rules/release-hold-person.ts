import type { PrIndexRow } from '../entities/pr-index.js';
import type { ReleaseHoldPersonRecord } from '../entities/release-hold-person.js';
import { RELEASE_BRANCH } from './release-branch.js';
import type { ReleaseHeadReading } from './release-head.js';
import { releaseHoldable, type ReleaseHoldable, type ReleaseStage } from './release-prepare.js';

/** The release stages that end a person hold. */
export const RELEASE_HOLD_ENDING_STAGES: readonly ReleaseStage[] = ['merged', 'publishing', 'released', 'failed', 'release-head-foreign'];

/** Why a person hold holds nothing now. */
export type ReleaseHoldNone =
  | 'no-record'
  | 'lifted'
  | 'no-release-row'
  | 'not-open'
  | 'not-into-default-branch'
  | 'unparseable-at'
  | 'bound-passed'
  | 'stage-ended';

/** Whether a person hold holds merges now: the release PR, when it started and when it ends, or why it holds nothing. */
export type ReleasePersonHold =
  | { readonly holds: true; readonly pr: number; readonly head: string; readonly since: number; readonly end: number }
  | { readonly holds: false; readonly reason: ReleaseHoldNone };

/**
 * The release PR a person hold may name: the OPEN `changeset-release/` row into the default branch.
 *
 * @param rows - the PR index rows.
 * @param defaultBranchName - the default branch's name; an unread name answers no row.
 * @returns the row with the highest number among those, or `null` where none is.
 */
export const releaseRowOf = (
  rows: readonly PrIndexRow[],
  defaultBranchName: string | 'unaskable' | undefined,
): PrIndexRow | null => {
  if (defaultBranchName === undefined || defaultBranchName === 'unaskable' || defaultBranchName === '') return null;
  const open = rows.filter((r) => r.state === 'OPEN' && RELEASE_BRANCH.test(r.head) && r.base === defaultBranchName);
  return open.reduce<PrIndexRow | null>((best, r) => (best === null || r.number > best.number ? r : best), null);
};

/**
 * Whether a person's hold holds merges into the default branch now.
 *
 * Reads the record, then the index row of the PR the record names, then the
 * bound. The hold holds from `at` until `at + boundMs`, exclusive, across new
 * heads of the same PR: a new head does not move `at`. A lift, a missing
 * record, a missing or non-OPEN row, a row into another base, an unparseable
 * `at` and a stage in {@link RELEASE_HOLD_ENDING_STAGES} hold nothing.
 *
 * @param rows - the PR index rows; the row whose number the record names is read.
 * @param record - the person hold file's record, or `null` where there is none.
 * @param defaultBranchName - the default branch's name; an unread name holds nothing.
 * @param now - epoch milliseconds.
 * @param boundMs - the hold's length, `Checks wait`.
 * @param stage - the release stage where the caller read one; the merge arm passes none.
 * @returns the hold, or the reason it holds nothing.
 */
export const releasePersonHold = (
  rows: readonly PrIndexRow[],
  record: ReleaseHoldPersonRecord | null,
  defaultBranchName: string | 'unaskable' | undefined,
  now: number,
  boundMs: number,
  stage?: ReleaseStage | null,
): ReleasePersonHold => {
  if (record === null) return { holds: false, reason: 'no-record' };
  if (record.act === 'lift') return { holds: false, reason: 'lifted' };
  const row = rows.find((r) => r.number === record.pr && RELEASE_BRANCH.test(r.head));
  if (row === undefined) return { holds: false, reason: 'no-release-row' };
  if (row.state !== 'OPEN') return { holds: false, reason: 'not-open' };
  if (defaultBranchName === undefined || defaultBranchName === 'unaskable' || defaultBranchName === '' || row.base !== defaultBranchName) {
    return { holds: false, reason: 'not-into-default-branch' };
  }
  const since = Date.parse(record.at);
  if (!Number.isFinite(since)) return { holds: false, reason: 'unparseable-at' };
  const end = since + boundMs;
  if (!(now < end)) return { holds: false, reason: 'bound-passed' };
  if (stage !== undefined && stage !== null && RELEASE_HOLD_ENDING_STAGES.includes(stage)) {
    return { holds: false, reason: 'stage-ended' };
  }
  return { holds: true, pr: record.pr, head: record.head, since, end };
};

/**
 * A time as the hold's texts show it.
 *
 * @param epochMs - epoch milliseconds.
 * @returns `HH:MM UTC`.
 */
export const holdClock = (epochMs: number): string => `${new Date(epochMs).toISOString().slice(11, 16)} UTC`;

/**
 * The *Waiting on you* line of a hold that holds.
 *
 * @param hold - the hold.
 * @returns `release #<n> holds merges until <end>`, or `null` where the hold holds nothing.
 */
export const releaseHoldWaitingLine = (hold: ReleasePersonHold): string | null =>
  hold.holds ? `release #${hold.pr} holds merges until ${holdClock(hold.end)}` : null;

/**
 * The release row's line for a hold that holds.
 *
 * @param hold - the hold.
 * @returns `holds merges since <since> · ends <end>`, or `null` where the hold holds nothing.
 */
export const releaseHoldRowLine = (hold: ReleasePersonHold): string | null =>
  hold.holds ? `holds merges since ${holdClock(hold.since)} · ends ${holdClock(hold.end)}` : null;

/** The origin the board's passkey verifies: `http://localhost:<port>`. */
const LOCALHOST_ORIGIN = /^http:\/\/localhost:(\d+)$/;

/**
 * Why a passkey action cannot complete on the board's origin.
 *
 * @param origin - the origin the board page runs on, as `location.origin` reads it.
 * @returns `null` on `http://localhost:<port>`, else the reason, which names the local board as the route.
 */
export const passkeyOriginReason = (origin: string): string | null => {
  if (LOCALHOST_ORIGIN.test(origin)) return null;
  const port = /:(\d+)$/.exec(origin)?.[1] ?? '<port>';
  return `the passkey works only on http://localhost:${port}: open the local board at http://localhost:${port}`;
};

/** A hold button's state: enabled, or disabled with the reason. */
export interface HoldButton {
  readonly state: 'enabled' | 'disabled';
  readonly reason: string;
}

const HOLDABLE_REASON: Readonly<Record<Exclude<ReleaseHoldable, 'holdable'>, string>> = {
  'not-open': 'the release PR is not open',
  'not-release-branch': 'the PR is not a release PR',
  'not-into-default-branch': 'the release PR is not into the default branch',
  'no-head': 'the release PR has no head commit yet',
  'checks-not-counted': 'CI has not passed on the release head',
  'review-failed': 'the review failed on the release head',
  'review-writer-unchecked': 'the review on the release head is not yet checked',
  'release-head-foreign': 'the release head changes more than the version step writes',
};

/** What the hold buttons read. */
export interface HoldButtonReadings {
  /** The board page's origin. */
  readonly origin: string;
  /** The release row {@link releaseRowOf} picks, or `null`. */
  readonly row: PrIndexRow | null;
  /** The release head's changes; `null` where unread. */
  readonly headChanges: ReleaseHeadReading | null;
  /** The default branch's name. */
  readonly defaultBranchName: string | 'unaskable' | undefined;
  /** The hold {@link releasePersonHold} answers. */
  readonly hold: ReleasePersonHold;
}

/**
 * The state of "Hold merges, I am approving now".
 *
 * Reads, in order: the origin, the release row, whether a hold already holds,
 * and {@link releaseHoldable}.
 *
 * @param readings - what the button reads.
 * @returns enabled, or disabled with the first unmet criterion's reason.
 */
export const releaseHoldButton = (readings: HoldButtonReadings): HoldButton => {
  const origin = passkeyOriginReason(readings.origin);
  if (origin !== null) return { state: 'disabled', reason: origin };
  if (readings.row === null) return { state: 'disabled', reason: 'no open release PR into the default branch' };
  if (readings.hold.holds) return { state: 'disabled', reason: `merges are held until ${holdClock(readings.hold.end)}` };
  const holdable = releaseHoldable(readings.row, readings.headChanges, readings.defaultBranchName);
  if (holdable !== 'holdable') return { state: 'disabled', reason: HOLDABLE_REASON[holdable] };
  return { state: 'enabled', reason: 'holds every merge into the default branch while you approve' };
};

/**
 * The state of "Lift the hold".
 *
 * @param hold - the hold {@link releasePersonHold} answers.
 * @returns enabled where a hold holds, else disabled with the reason.
 */
export const releaseLiftButton = (hold: ReleasePersonHold): HoldButton =>
  hold.holds
    ? { state: 'enabled', reason: `ends the hold of release #${hold.pr} now` }
    : { state: 'disabled', reason: 'no hold holds merges' };
