import type { DefaultBranchReading } from '../entities/default-branch.js';
import { MergeabilitySchema } from '../entities/pr.js';
import type { PrIndexRow } from '../entities/pr-index.js';
import type { HostBackend } from '../ports/host.js';
import { baseBranchRed, defaultBranchAgeMs, holdsApply } from './default-branch.js';
import { mergeIdentity, type MergerAppReading } from './merge-identity.js';
import { repairMergeVerdict, repairNamesPr, type RepairMergeReading } from './repair-pr.js';
import type { DeskDeadAnswer } from './desk-dead.js';
import { fleetScope, type FleetOwner } from './fleet-scope.js';
import { trustedReview } from './pr-index.js';
import type { ReleaseHoldVerdict } from './release-hold.js';
import { reviewStartAllowed, type ReviewStart } from './review-run.js';
import { settledPast, type UnsettledReading } from './settled-past.js';
import type { SprintScope } from './sprint-scope.js';
import type { TicketReading } from './ticket.js';

/** A sibling plan's record, which that plan types when it builds its arm. */
export type SiblingReading = { read: 'unread' } | { read: 'record' };

/**
 * The word the PR index stores in `mergeable` for a PR whose head conflicts
 * with its base: `MergeabilitySchema`'s own `conflicting`.
 */
export const MERGEABLE_CONFLICTING = MergeabilitySchema.enum.conflicting;

/**
 * The fixer's attempts record, read down to the answers `highArm`,
 * `ciRedArm` and `conflictArm` need from it (#2903): `fixerInFlight`,
 * `fixerAttemptsExhausted` for each finding kind, `fixerConflictTried` and
 * `fixerPushedHead` are computed once, by the caller that holds the raw
 * record, and carried here as plain values — these arms are pure functions
 * and cannot read `FixerAttemptsStore` themselves.
 *
 * `highExhausted`, `ciExhausted` and `conflictExhausted` are the three
 * budgets, counted apart. `conflictTried` is true where a conflict attempt on
 * the row's current head and the read base tip exists. `pushedHead` is true
 * where the record proves the fixer pushed the row's current head.
 *
 * `rerun` is where the re-run of the row's current head stands, from
 * `rerunOnHead`: `none` for no re-run recorded, `running` for one asked and
 * not yet seen, `done` for one seen or answered `failed` or `unaskable`, and
 * `unseen` for one asked longer than `Checks wait` ago and never seen. Absent
 * where the caller read no clock; {@link ciRerunArm} then answers `none`.
 */
export type FixerReading =
  | { read: 'unread' }
  | {
      read: 'record';
      inFlight: boolean;
      highExhausted: boolean;
      ciExhausted: boolean;
      conflictExhausted: boolean;
      conflictTried: boolean;
      pushedHead: boolean;
      rerun?: 'none' | 'running' | 'done' | 'unseen';
    };

/** The tip of a PR's base branch as the fixer tick read it after a fetch. */
export type BaseTipReading = { read: 'tip'; sha: string } | { read: 'unread' };

/** The review verdict file `reviews/<pr>-<headSha>.md` as read through `reviewVerdict`. */
export type VerdictReading =
  | { read: 'verdict'; state: 'success' | 'failure'; description: string }
  | { read: 'absent' }
  | { read: 'unread' };

/** The live review run on a PR, from `review-in-flight.json` through `reviewRunLive`. */
export interface ReviewRunReading {
  readonly head: string;
  readonly pid: number;
  readonly startedAt: number;
  readonly live: boolean;
}

/** The constants and config the rule reads. */
export interface SlicePrConfig {
  /** `Auto-review`. */
  readonly autoReview: boolean;
  /** How long a `pending` review counts as in flight, in milliseconds. */
  readonly reviewBoundMs: number;
  /** The most review starts one head gets. */
  readonly startBudget: number;
  /** `Checks wait`, in milliseconds. */
  readonly checksWaitMs: number;
}

/**
 * Everything {@link slicePrNext} reads about one open PR, as values.
 *
 * `fixer`, `ticket` and `repair` are optional until the plan that owns each
 * arm builds it; an absent field reads as no answer from that arm.
 */
export interface SlicePrNextReadings {
  /** This PR's OPEN row; `null` for a missing or undecodable store. */
  readonly row: PrIndexRow | null;
  /** The newest MERGED row of the index, for #2902's `merge-in-flight` hold. */
  readonly newestMerged: { mergedAt: string } | null;
  /**
   * The first-parent line from the reading's settled commit to its head, read
   * once per tick. Absent reads as `'unread'`, so a head past the settled
   * commit holds as `merge-in-flight`.
   */
  readonly unsettled?: UnsettledReading;
  /** The paths a commit may change and still not unsettle the reading; absent reads as empty. */
  readonly pathSet?: readonly string[];
  readonly scope: SprintScope;
  readonly reviewRun: ReviewRunReading | null;
  readonly reviewStarts: Pick<ReviewStart, 'head' | 'count' | 'lastAt'> | null;
  readonly verdict: VerdictReading;
  readonly defaultBranch: DefaultBranchReading | null;
  /** The default branch's name; absent keeps the default-branch holds on every PR (see {@link holdsApply}). */
  readonly defaultBranchName?: string;
  /** The reading kept for this row's base branch, where that is not the default branch; absent reads as no reading. */
  readonly baseReading?: DefaultBranchReading | null;
  readonly desk: DeskDeadAnswer;
  /**
   * Whether the desk's own ending record currently reads `corrections-spent`
   * with a fresh session already spent on this slice — `endingAction`'s own
   * `priorFreshSessions > 0` test against that one ending reason (#2903).
   *
   * **Why this exists alongside {@link SlicePrNextReadings.desk}.** A desk
   * ended `corrections-spent` and given one fresh session per
   * `FRESH_SESSION_ENDINGS` reads `deskDead` as `{dead:false, why:'waiting'}`
   * the moment that fresh session itself reaches `needs-a-person` and writes
   * its own `PLOT-BLOCKED` marker — `deskDead` cannot tell that `waiting` from
   * any other blocked desk. This field is the one the CI-red arm reads
   * instead, for that one ending reason; `desk` still answers every other
   * aliveness question. `undefined` until the caller that reads the ending
   * record and the fresh-session count builds it.
   */
  readonly correctionsSpentExhausted?: boolean;
  readonly fixer?: FixerReading;
  /** The tip of the row's base branch, for `conflictArm`; absent reads as unread. */
  readonly baseTip?: BaseTipReading;
  readonly ticket?: TicketReading;
  readonly repair?: SiblingReading;
  /**
   * The repair record, its episode and the red commit's re-asked runs, read once
   * per tick (#2904). Absent reads as no record: a settled red holds every PR.
   */
  readonly repairMerge?: RepairMergeReading;
  /**
   * The repair reading of this row's base, read once per tick for a red base
   * whose record names an open row. Absent reads as no record: a red base holds every PR.
   */
  readonly baseRepairMerge?: RepairMergeReading;
  /** The host backend, as `Host.backend()` answers it. {@link mergeIdentity} reads this to decide an identity. */
  readonly backend: HostBackend;
  /**
   * The `Merger app` key, as the adapter reads it. Unconsulted on a non-GitHub
   * backend; absent (or an unread read) holds `merger-app-unread` on GitHub.
   */
  readonly mergerApp?: MergerAppReading;
  /**
   * Whether a waiting release head holds merges into the default branch, as
   * {@link releaseHold} answers it once per tick. Absent holds nothing.
   */
  readonly releaseHold?: ReleaseHoldVerdict;
  readonly config: SlicePrConfig;
  /** Epoch milliseconds of the tick. */
  readonly now: number;
}

/** The readings an arm that does not read the sprint scope takes. */
export type ArmReadings = Omit<SlicePrNextReadings, 'scope'>;

/** Why a hold holds. An open string set: a sibling plan adds its own. */
export type HoldReason =
  | 'review-in-flight'
  | 'review-writer-unchecked'
  | 'fixer-in-flight'
  | 'ci-red-attempts-spent'
  | 'conflict-attempted'
  | 'conflict-attempts-spent'
  | 'rerun-running'
  | 'default-branch-red'
  | 'base-branch-red'
  | 'default-branch-stale'
  | 'default-branch-unread'
  | 'merge-in-flight'
  | 'conflicting'
  | 'merger-app-missing'
  | 'merger-app-invalid'
  | 'merger-app-unread'
  | 'default-branch-unsettled'
  | 'ticket-pending'
  | 'release-waiting'
  | 'unread'
  | (string & {});

/** The one step the fleet takes on an open slice PR. */
export type SlicePrStep =
  /** `leftMs` is the time left of the quiet hour, set with {@link fixerPrNext}'s `person-pushed-recently`. */
  | { step: 'none'; why: string; leftMs?: number }
  | { step: 'review'; head: string }
  | {
      step: 'write-status';
      head: string;
      state: 'success' | 'failure';
      description: string;
      why: 'verdict-unwritten' | 'ticket-accepted';
    }
  | { step: 'merge'; head: string }
  | { step: 'hold'; reason: HoldReason }
  | { step: 'fixer'; head: string; evidence: 'high' | 'ci-red' | 'conflict' }
  | { step: 'rerun'; head: string }
  | { step: 'ticket'; head: string };

const none = (why: string): SlicePrStep => ({ step: 'none', why });
const hold = (reason: HoldReason): SlicePrStep => ({ step: 'hold', reason });
const isNone = (step: SlicePrStep): boolean => step.step === 'none';

/**
 * Arm 1. Whether the PR is one this fleet acts on at all.
 *
 * An open, non-draft PR is in where the sprint scope names its head branch,
 * or where `readings.repairMerge` or `readings.baseRepairMerge` names it through {@link repairNamesPr}: the
 * repair record, not the scope, names a fix PR or a revert PR.
 *
 * @param readings - the PR's readings.
 * @returns `none` with the first reason the PR is out, or `null` where it is in.
 */
export const guardArm = (readings: SlicePrNextReadings): SlicePrStep | null => {
  const { row, scope, repairMerge, baseRepairMerge } = readings;
  if (row === null) return none('no-row');
  if (row.state !== 'OPEN') return none('not-open');
  if (row.draft) return none('draft');
  if (repairMerge !== undefined && repairNamesPr(repairMerge, row)) return null;
  if (baseRepairMerge !== undefined && repairNamesPr(baseRepairMerge, row)) return null;
  if (scope.read === 'none') return none(`scope-${scope.why}`);
  if (!scope.branches.includes(row.head)) return none('out-of-scope');
  return null;
};

/**
 * Arm 2. A live review run on the current head holds the PR.
 *
 * @param readings - the PR's readings.
 * @returns a `review-in-flight` hold, or `none`.
 */
export const reviewRunArm = (readings: ArmReadings): SlicePrStep => {
  const { row, reviewRun } = readings;
  if (reviewRun !== null && reviewRun.live && reviewRun.head === row?.headSha) return hold('review-in-flight');
  return none('no-review-run');
};

/**
 * Arm 5. A verdict file the index does not yet reflect gets its status written.
 *
 * Obeys the review arm's gates: `Auto-review` off, or the head's review start
 * budget spent, answers `none`. Runs after {@link highArm}, so a status that arm
 * accepted is not overwritten by a failing verdict file.
 *
 * A row with no `plotReview` field was never asked, and the index never says
 * no, so that row answers `none`.
 *
 * @param readings - the PR's readings.
 * @returns `write-status`, a hold where the verdict file is unreadable, or `none`.
 */
export const restatusArm = (readings: ArmReadings): SlicePrStep => {
  const { row, verdict, config, reviewStarts, now } = readings;
  if (!config.autoReview) return none('auto-review-off');
  if (row !== null && row.headSha !== undefined && reviewStartAllowed(reviewStarts, row.headSha, config.startBudget, now) === 'budget-spent') {
    return none('budget-spent');
  }
  if (verdict.read === 'unread') return hold('unread');
  if (verdict.read !== 'verdict') return none('no-verdict');
  if (row === null || row.headSha === undefined || row.plotReview === undefined) return none('not-asked');
  const trusted = trustedReview(row);
  if (trusted === 'unchecked') return hold('review-writer-unchecked');
  if (trusted === verdict.state && row.plotReviewSha === row.headSha) return none('status-written');
  return {
    step: 'write-status',
    head: row.headSha,
    state: verdict.state,
    description: verdict.description,
    why: 'verdict-unwritten',
  };
};

/**
 * Arm 3 (#2903). A live fixer makes the head temporary.
 *
 * @param readings - the PR's readings.
 * @returns a `fixer-in-flight` hold, an `unread` hold, or `none`.
 */
export const fixerInFlightArm = (readings: ArmReadings): SlicePrStep => {
  const { fixer } = readings;
  if (fixer === undefined) return none('fixer-not-built');
  if (fixer.read === 'unread') return hold('unread');
  return fixer.inFlight ? hold('fixer-in-flight') : none('no-fixer-run');
};

/**
 * Arm 4 (#2903). A HIGH on the current head starts the fixer, and once the
 * attempts are spent goes to a ticket.
 *
 * A HIGH is `row.plotReview === 'failure'` bound to the row's `headSha` — a
 * failure recorded against an older push does not count. `fixerInFlightArm`
 * already holds a running fixer before this arm runs. With attempts spent the
 * ticket record decides: no ticket, or a ticket not yet carrying this head's
 * findings, answers `ticket`; a `pending` record holds; a ticket carrying this
 * head answers `write-status` with `success`. A head whose `plotReview` is
 * already `success` is no HIGH and answers `none` here.
 *
 * @param readings - the PR's readings.
 * @returns an `unread` hold while the fixer or ticket record is unread, a
 *   `ticket-pending` hold, a `fixer`, `ticket` or `write-status` step, or `none`.
 */
export const highArm = (readings: ArmReadings): SlicePrStep => {
  const { row, fixer, ticket } = readings;
  if (ticket?.read === 'unread') return hold('unread');
  if (fixer === undefined) return none('fixer-not-built');
  if (fixer.read === 'unread') return hold('unread');
  if (row === null || row.headSha === undefined || row.plotReview === undefined) return none('not-asked');
  const trusted = trustedReview(row);
  if (trusted === 'unchecked') return hold('review-writer-unchecked');
  if (trusted !== 'failure' || row.plotReviewSha !== row.headSha) return none('no-high');
  if (!fixer.highExhausted) return { step: 'fixer', head: row.headSha, evidence: 'high' };
  if (ticket === undefined) return none('ticket-not-built');
  if (ticket.ticket === 'pending') return hold('ticket-pending');
  if (ticket.ticket === 'none' || !ticket.coversHead) return { step: 'ticket', head: row.headSha };
  return {
    step: 'write-status',
    head: row.headSha,
    state: 'success',
    description: `ticketed ${ticket.id}`,
    why: 'ticket-accepted',
  };
};

/**
 * Arm 6 (#2903). CI red on the current head starts the fixer once the desk
 * that owned it is gone, or where the fixer itself pushed the head.
 *
 * A head is fixer-pushed where {@link FixerReading.pushedHead} is true: the
 * attempts record names it as the head an ended attempt left, and
 * {@link fixerInFlightArm} has already held a running fixer. A desk that reads
 * `elsewhere` or `live` is not gone by that reading alone.
 *
 * "Desk dead" is arm-specific rather than one uniform read: a desk is dead
 * per {@link DeskDeadAnswer}, OR its ending reads `corrections-spent` with its
 * one fresh session already spent — {@link SlicePrNextReadings.correctionsSpentExhausted},
 * the one case `deskDead` reads as `waiting` (its own fresh session's
 * `PLOT-BLOCKED` marker) rather than `dead`. Every other `waiting` desk — a
 * live, non-exhausted fresh session, or a live desk mid-turn — holds, because
 * neither reading answers true for it.
 *
 * @param readings - the PR's readings.
 * @returns an `unread` hold while the fixer record is unread, a budget-spent
 *   `hold`, a `fixer` step, or `none`.
 */
export const ciRedArm = (readings: ArmReadings): SlicePrStep => {
  const { row, fixer } = readings;
  if (fixer === undefined) return none('fixer-not-built');
  if (fixer.read === 'unread') return hold('unread');
  if (row === null || row.headSha === undefined || row.ciChecks === undefined) return none('not-asked');
  if (row.ciChecks !== 'failing' || row.checksSha !== row.headSha) return none('no-ci-red');
  if (fixer.ciExhausted) return hold('ci-red-attempts-spent');
  if (!deskGone(readings, fixer)) return none('desk-alive');
  return { step: 'fixer', head: row.headSha, evidence: 'ci-red' };
};

/**
 * CI red on the current head re-runs the failed jobs once per head before
 * {@link ciRedArm} starts a fixer on it.
 *
 * Answers, in order: an `unread` hold while the fixer record is unread;
 * `none('rerun-unread')` where the reading carries no `rerun`;
 * `none('no-ci-red')` where the row is not `failing` on its head;
 * `none('rerun-done')` and `none('rerun-unseen')` for those `rerun` readings;
 * `hold('rerun-running')` for a re-run asked and not yet seen, because a
 * `failing` row read then predates the re-run; `none('ci-red-attempts-spent')`
 * where the CI-red budget is spent, which {@link ciRedArm} then holds;
 * `none('desk-alive')` where the desk is not gone; otherwise a `rerun` step.
 *
 * @param readings - the PR's readings.
 * @returns an `unread` or `rerun-running` hold, a `rerun` step, or `none`.
 */
export const ciRerunArm = (readings: ArmReadings): SlicePrStep => {
  const { row, fixer } = readings;
  if (fixer === undefined) return none('fixer-not-built');
  if (fixer.read === 'unread') return hold('unread');
  if (fixer.rerun === undefined) return none('rerun-unread');
  if (row === null || row.headSha === undefined || row.ciChecks !== 'failing' || row.checksSha !== row.headSha) {
    return none('no-ci-red');
  }
  if (fixer.rerun === 'done') return none('rerun-done');
  if (fixer.rerun === 'unseen') return none('rerun-unseen');
  if (fixer.rerun === 'running') return hold('rerun-running');
  if (fixer.ciExhausted) return none('ci-red-attempts-spent');
  if (!deskGone(readings, fixer)) return none('desk-alive');
  return { step: 'rerun', head: row.headSha };
};

/**
 * Whether the desk that owned the PR is gone, as {@link ciRedArm} and
 * {@link conflictArm} read it: dead, ended `corrections-spent` with its fresh
 * session spent, or superseded by a head the fixer itself pushed.
 */
const deskGone = (readings: ArmReadings, fixer: Extract<FixerReading, { read: 'record' }>): boolean =>
  readings.desk.dead || readings.correctionsSpentExhausted === true || fixer.pushedHead;

/**
 * A conflict between the PR's head and its base starts the fixer once the desk
 * that owned it is gone.
 *
 * Answers, in order: `none('no-conflict')` where `row.mergeable` is not
 * {@link MERGEABLE_CONFLICTING}; an `unread` hold where the fixer record or
 * `readings.baseTip` is unread or absent; `conflict-attempted` where an attempt
 * on this head and base tip exists; `conflict-attempts-spent` where the
 * conflict budget is spent; `none('desk-alive')` where the desk is not gone by
 * {@link ciRedArm}'s reading; otherwise a `fixer` step with `evidence: 'conflict'`.
 *
 * @param readings - the PR's readings.
 * @returns an `unread` hold, a conflict hold, a `fixer` step, or `none`.
 */
export const conflictArm = (readings: ArmReadings): SlicePrStep => {
  const { row, fixer, baseTip } = readings;
  if (row === null || row.headSha === undefined || row.mergeable !== MERGEABLE_CONFLICTING) return none('no-conflict');
  if (fixer === undefined) return none('fixer-not-built');
  if (fixer.read === 'unread') return hold('unread');
  if (baseTip === undefined || baseTip.read === 'unread') return hold('unread');
  if (fixer.conflictTried) return hold('conflict-attempted');
  if (fixer.conflictExhausted) return hold('conflict-attempts-spent');
  if (!deskGone(readings, fixer)) return none('desk-alive');
  return { step: 'fixer', head: row.headSha, evidence: 'conflict' };
};

/**
 * Whether a row's trusted `plot/review` reads `pending` on its head for longer than the bound.
 *
 * @param row - the PR's index row.
 * @param now - epoch milliseconds.
 * @param boundMs - the review bound, in milliseconds.
 * @returns `true` where the trusted review is `pending`, `plotReviewSha` is the head and
 *   `now - plotReviewAt` exceeds `boundMs`; `false` where `plotReviewAt` is missing or does not parse.
 */
export const reviewPendingStale = (
  row: Pick<PrIndexRow, 'headSha' | 'plotReview' | 'plotReviewSha' | 'plotReviewAt' | 'plotReviewJudged' | 'plotReviewCheckedSha'>,
  now: number,
  boundMs: number,
): boolean => {
  if (trustedReview(row) !== 'pending' || row.plotReviewSha !== row.headSha) return false;
  const startedAt = row.plotReviewAt === undefined ? Number.NaN : Date.parse(row.plotReviewAt);
  return now - startedAt > boundMs;
};

/**
 * Arm 7. Whether this head gets a review.
 *
 * Answers `review` when all hold, and `none` with the first failed reason
 * otherwise: `auto-review-off`; `not-asked`; `checks-unbound` or
 * `ci-not-green`; `reviewed`; `budget-spent` or `backoff`. A red default
 * branch never holds a review. Arm 5 runs first and already intercepts every
 * `verdict.read` other than `absent` while the review gates hold, so this arm never sees one.
 *
 * @param readings - the PR's readings.
 * @returns `review`, or `none`.
 */
export const reviewArm = (readings: ArmReadings): SlicePrStep => {
  const { row, config, reviewStarts, now } = readings;
  if (!config.autoReview) return none('auto-review-off');
  if (row === null || row.plotReview === undefined || row.headSha === undefined) return none('not-asked');
  if (row.checksSha !== row.headSha || row.ciChecks === undefined) return none('checks-unbound');
  if (row.ciChecks !== 'green') return none('ci-not-green');

  const trusted = trustedReview(row);
  if (trusted === 'unchecked') return hold('review-writer-unchecked');
  const onHead = row.plotReviewSha === row.headSha;
  const needs =
    trusted === 'absent' || trusted === 'error' || !onHead || reviewPendingStale(row, now, config.reviewBoundMs);
  if (!needs) return none('reviewed');

  const allowed = reviewStartAllowed(reviewStarts, row.headSha, config.startBudget, now);
  if (allowed !== 'ok') return none(allowed);
  return { step: 'review', head: row.headSha };
};

/**
 * Arm 8 (#2902, with #2904's repair exception). Whether this head merges.
 *
 * A row whose `plot/review` is not `success` on its head answers `none` (or an
 * `unread` hold on an unread repair record). Otherwise the first failing hold
 * answers: `default-branch-unread` for no reading; `default-branch-stale` for
 * a reading whose `askedAt` is older than `Checks wait` or does not parse, red
 * or green; `default-branch-red`; `default-branch-unsettled` for a settled
 * state that is not green; `merge-in-flight` for a settled commit that is not
 * the head and is not covered by {@link settledPast}, or a merged row newer than the reading; `conflicting`;
 * `merger-app-missing`, `merger-app-invalid` or `merger-app-unread` from
 * {@link mergeIdentity}. On a settled red, `readings.repairMerge` lifts
 * `default-branch-red` for the one PR {@link repairMergeVerdict} admits; the
 * remaining holds then apply to it unchanged. A row whose `base` names a branch
 * other than `readings.defaultBranchName` skips every default-branch hold and
 * holds `base-branch-red` only, from `readings.baseReading`, which
 * `readings.baseRepairMerge` lifts for the one PR {@link repairMergeVerdict}
 * admits; `conflicting` and the merge identity apply to both paths. On the default-branch path,
 * `release-waiting` holds every PR but the release PR itself where `readings.releaseHold` answers
 * `holds`, after the default-branch holds and before `conflicting`; the PR the repair exception
 * admits is not held. A PR the record names and the
 * verdict refuses holds with the verdict's reason. The stale check is this arm's own and never
 * `defaultBranchRed`: a merge cannot be undone, so an old reading holds here
 * where it lifts the queue's hold.
 *
 * @param readings - the PR's readings.
 * @returns `merge`, a hold, or `none`.
 */
export const mergeArm = (readings: SlicePrNextReadings): SlicePrStep => {
  const { row, defaultBranch, newestMerged, config, now } = readings;
  if (readings.repair?.read === 'unread') return hold('unread');
  if (row === null || row.headSha === undefined) return none('not-asked');
  const trusted = trustedReview(row);
  if (trusted === 'unchecked') return hold('review-writer-unchecked');
  if (trusted !== 'success' || row.plotReviewSha !== row.headSha) return none('not-passed');
  const base = row.base ?? '';
  if (!holdsApply(base, readings.defaultBranchName)) {
    if (baseBranchRed(base, readings.baseReading ?? null, now, config.checksWaitMs)) {
      const verdict =
        readings.baseRepairMerge === undefined
          ? null
          : repairMergeVerdict(readings.baseRepairMerge, { number: row.number, head: row.head });
      if (verdict === null || verdict.verdict === 'not-named') return hold('base-branch-red');
      if (verdict.verdict === 'refused') return hold(verdict.reason);
    }
    if (row.mergeable === MERGEABLE_CONFLICTING) return hold('conflicting');
    const own = mergeIdentity(readings.backend, readings.mergerApp);
    if (own.identity === 'hold') return hold(own.reason);
    return { step: 'merge', head: row.headSha };
  }
  if (defaultBranch === null) return hold('default-branch-unread');
  const age = defaultBranchAgeMs(defaultBranch, now);
  if (age === null || age > config.checksWaitMs) return hold('default-branch-stale');
  const { settled } = defaultBranch;
  let repairAdmitted = false;
  if (settled?.state === 'red') {
    const verdict =
      readings.repairMerge === undefined
        ? null
        : repairMergeVerdict(readings.repairMerge, { number: row.number, head: row.head });
    if (verdict === null || verdict.verdict === 'not-named') return hold('default-branch-red');
    if (verdict.verdict === 'refused') return hold(verdict.reason);
    repairAdmitted = true;
  }
  if (settled === undefined || (!repairAdmitted && settled.state !== 'green')) return hold('default-branch-unsettled');
  const mergedAt = newestMerged === null ? Number.NaN : Date.parse(newestMerged.mergedAt);
  const askedAt = Date.parse(defaultBranch.askedAt);
  // A repair merge keeps the strict requirement; a green settled commit may trail the head by Plot's own commits.
  const covered =
    settled.sha === defaultBranch.headSha ||
    (!repairAdmitted &&
      settled.state === 'green' &&
      settledPast(settled, readings.unsettled ?? 'unread', readings.pathSet ?? []) &&
      readings.unsettled !== undefined &&
      readings.unsettled !== 'unread' &&
      readings.unsettled.headSha === defaultBranch.headSha);
  if (!covered || (newestMerged !== null && !(mergedAt <= askedAt))) {
    return hold('merge-in-flight');
  }
  const release = readings.releaseHold;
  if (!repairAdmitted && release?.verdict === 'holds' && release.pr !== row.number) return hold('release-waiting');
  if (row.mergeable === MERGEABLE_CONFLICTING) return hold('conflicting');
  const identity = mergeIdentity(readings.backend, readings.mergerApp);
  if (identity.identity === 'hold') return hold(identity.reason);
  return { step: 'merge', head: row.headSha };
};

/** One open PR and the step {@link slicePrNext} answered for it. */
export interface PrStepAnswer {
  readonly pr: number;
  readonly step: SlicePrStep;
}

/**
 * Picks the one PR to merge in a pass.
 *
 * @param answers - each open PR's step.
 * @returns the lowest-numbered PR whose step is `merge` with its head, or `null` where none is.
 */
export const nextMerge = (answers: readonly PrStepAnswer[]): { pr: number; head: string } | null => {
  let pick: { pr: number; head: string } | null = null;
  for (const { pr, step } of answers) {
    if (step.step === 'merge' && (pick === null || pr < pick.pr)) pick = { pr, head: step.head };
  }
  return pick;
};

/**
 * The next step for one open PR.
 *
 * Calls the arms in a fixed order and returns the first answer that is not
 * `none`: guard, review run, fixer in flight, HIGH, re-status, CI red,
 * review, merge. An arm that writes or holds on the current head comes before
 * an arm that starts new work on it. A guard `none` ends the walk. With no
 * answer, the review arm's `none` is returned, because it names the reason.
 *
 * @param readings - everything read of the PR, as values.
 * @returns the step.
 */
export const slicePrNext = (readings: SlicePrNextReadings): SlicePrStep => {
  const guard = guardArm(readings);
  if (guard !== null) return guard;
  const arms = [reviewRunArm, fixerInFlightArm, highArm, restatusArm, ciRedArm, reviewArm, mergeArm];
  let review: SlicePrStep = none('no-arm-answered');
  for (const arm of arms) {
    const answer = arm(readings);
    if (arm === reviewArm) review = answer;
    if (!isNone(answer)) return answer;
  }
  return review;
};

/**
 * Everything {@link fixerPrNext} reads about one open PR, as values: the
 * readings {@link slicePrNext} takes without the sprint scope, and the owner
 * of the head branch.
 */
export type FixerPrNextReadings = Omit<SlicePrNextReadings, 'scope'> & {
  /** The owner of the head branch, from `fleetOwner`. */
  readonly owner: FleetOwner;
};

/**
 * The fixer's next step for one open PR.
 *
 * Asks `fleetScope` in place of {@link guardArm}: a PR out of scope answers
 * `none` with the scope's reason, and `person-pushed-recently` carries the
 * time left as `leftMs`. A PR in scope then walks {@link reviewRunArm},
 * {@link fixerInFlightArm}, {@link highArm}, {@link conflictArm},
 * {@link ciRerunArm} and {@link ciRedArm}, and the first answer that is not
 * `none` wins; with none, `ciRedArm`'s `none` is returned. `conflictArm` runs
 * before `ciRerunArm` and `ciRedArm` because the host runs no pull-request
 * checks on a conflicting merge ref.
 * For `owner: 'none'` the arms read the desk as `{ dead: true }`; for
 * `owner: 'desk'` they read `readings.desk`.
 *
 * {@link restatusArm}, {@link reviewArm} and {@link mergeArm} are not walked:
 * writing a review status, starting a review and merging belong to the review
 * and merge passes, which keep {@link slicePrNext} and the sprint scope.
 *
 * A fork PR is not told apart from a branch PR: the row carries no head
 * repository.
 *
 * @param readings - everything read of the PR, as values.
 * @returns the step.
 */
export const fixerPrNext = (readings: FixerPrNextReadings): SlicePrStep => {
  const scope = fleetScope({
    row: readings.row,
    defaultBranchName: readings.defaultBranchName,
    owner: readings.owner,
    pushedHead: readings.fixer?.read === 'record' && readings.fixer.pushedHead,
    now: readings.now,
  });
  if (!scope.in) return scope.why === 'person-pushed-recently' ? { step: 'none', why: scope.why, leftMs: scope.leftMs } : none(scope.why);
  const walked: ArmReadings = {
    ...readings,
    desk: scope.owner === 'none' ? { dead: true } : readings.desk,
  };
  let last: SlicePrStep = none('no-arm-answered');
  for (const arm of [reviewRunArm, fixerInFlightArm, highArm, conflictArm, ciRerunArm, ciRedArm]) {
    last = arm(walked);
    if (!isNone(last)) return last;
  }
  return last;
};

/**
 * Whether a repair record names an open, non-draft PR, so the review pass
 * takes it before `fleetScope`.
 *
 * @param readings - the PR's row and the repair readings of the default branch and of its base.
 * @returns `true` where `repairMerge` or `baseRepairMerge` names the row through {@link repairNamesPr}.
 */
export const repairAdmits = (readings: Pick<SlicePrNextReadings, 'row' | 'repairMerge' | 'baseRepairMerge'>): boolean => {
  const { row, repairMerge, baseRepairMerge } = readings;
  if (row === null || row.state !== 'OPEN' || row.draft) return false;
  return (
    (repairMerge !== undefined && repairNamesPr(repairMerge, row)) ||
    (baseRepairMerge !== undefined && repairNamesPr(baseRepairMerge, row))
  );
};

/**
 * Everything {@link reviewPrNext} reads about one open PR, as values: the
 * readings {@link slicePrNext} takes without the sprint scope, and the owner
 * of the head branch.
 */
export type ReviewPrNextReadings = Omit<SlicePrNextReadings, 'scope'> & {
  /** The owner of the head branch, from `fleetOwner`. */
  readonly owner: FleetOwner;
};

/**
 * The review pass's next step for one open PR.
 *
 * A PR that {@link repairAdmits} names is in, as in {@link guardArm}. Every other PR asks
 * `fleetScope` with `readings.owner` and the attempts record's `pushedHead`: a
 * PR out of scope answers `none` with the scope's reason, and
 * `person-pushed-recently` carries the time left as `leftMs`. A PR in scope
 * then walks {@link reviewRunArm}, {@link restatusArm} and {@link reviewArm},
 * and the first answer that is not `none` wins; with none, `reviewArm`'s
 * `none` is returned, because it names the reason.
 *
 * {@link fixerInFlightArm}, {@link highArm}, {@link ciRedArm},
 * {@link conflictArm} and {@link mergeArm} are not walked: HIGH findings and
 * CI belong to the fixer pass ({@link fixerPrNext}), and merging belongs to
 * the merge pass, which keeps {@link slicePrNext} and the sprint scope. The
 * walk reads no desk.
 *
 * A fork PR is not told apart from a branch PR: the row carries no head
 * repository.
 *
 * @param readings - everything read of the PR, as values.
 * @returns the step.
 */
export const reviewPrNext = (readings: ReviewPrNextReadings): SlicePrStep => {
  if (!repairAdmits(readings)) {
    const scope = fleetScope({
      row: readings.row,
      defaultBranchName: readings.defaultBranchName,
      owner: readings.owner,
      pushedHead: readings.fixer?.read === 'record' && readings.fixer.pushedHead,
      now: readings.now,
    });
    if (!scope.in) return scope.why === 'person-pushed-recently' ? { step: 'none', why: scope.why, leftMs: scope.leftMs } : none(scope.why);
  }
  let review: SlicePrStep = none('no-arm-answered');
  for (const arm of [reviewRunArm, restatusArm, reviewArm]) {
    const answer = arm(readings);
    if (arm === reviewArm) review = answer;
    if (!isNone(answer)) return answer;
  }
  return review;
};
