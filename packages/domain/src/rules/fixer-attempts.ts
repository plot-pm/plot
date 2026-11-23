import type { FixerAttemptsRecord, FixerFinding, FixerRerunAnswer } from '../entities/fixer-attempts.js';
import type { FixerReading } from './slice-pr-next.js';

/** How many fixer attempts a PR may spend before the HIGH goes to a ticket instead. */
export const FIXER_ATTEMPTS_BUDGET = 2;

/** How many seconds one fixer run may take before the process runner ends it. */
export const FIXER_BOUND_SECONDS = 3600;

/** The three findings a fixer attempt answers, each with its own budget. */
export type FixerKind = FixerFinding['kind'];

type AttemptsReading = FixerAttemptsRecord | 'none' | 'unreadable';

/**
 * How many attempts a PR has spent on one kind of finding, for the budget check.
 *
 * An attempt with `start: 'failed'` spent nothing: the CLI refused the run
 * before any agent started. HIGH, CI-red and conflict attempts count apart, so
 * two attempts on red CI leave the HIGH and conflict budgets whole.
 *
 * **A MISSING OR UNREADABLE RECORD READS AS ZERO.** Zero is the SAFE
 * direction for a budget: reading "no record" as "budget exhausted" would
 * refuse every fixer forever on a filesystem hiccup, while reading it as zero
 * costs at most one extra attempt before the record exists to say otherwise.
 * This is the opposite direction from {@link fixerInFlight}, deliberately —
 * see that function's own contract for why the two must not share a reading.
 *
 * @param record - the decoded record, or `'none'`/`'unreadable'` from
 *   {@link decodeFixerAttempts}.
 * @param kind - the finding kind to count.
 * @returns the number of attempts spent; `0` where there is nothing to count.
 */
export const fixerAttemptsSpent = (record: AttemptsReading, kind: FixerKind): number =>
  record === 'none' || record === 'unreadable'
    ? 0
    : record.attempts.filter((attempt) => attempt.start !== 'failed' && attempt.finding.kind === kind).length;

/**
 * Whether a PR has spent its whole fixer budget for one kind of finding.
 *
 * @param record - the decoded record, or `'none'`/`'unreadable'`.
 * @param kind - the finding kind to check.
 * @returns true once {@link fixerAttemptsSpent} reaches {@link FIXER_ATTEMPTS_BUDGET}.
 */
export const fixerAttemptsExhausted = (record: AttemptsReading, kind: FixerKind): boolean =>
  fixerAttemptsSpent(record, kind) >= FIXER_ATTEMPTS_BUDGET;

/**
 * Whether the record proves the fixer pushed a head.
 *
 * True where an attempt's `pushedSha` is `head`. A record that is missing,
 * unreadable or silent about the head answers false.
 *
 * @param record - the decoded record, or `'none'`/`'unreadable'`.
 * @param head - the PR's current head SHA.
 * @returns whether an ended attempt recorded `head` as its pushed head.
 */
export const fixerPushedHead = (record: AttemptsReading, head: string): boolean =>
  record !== 'none' && record !== 'unreadable' && record.attempts.some((attempt) => attempt.pushedSha === head);

/**
 * Whether the record holds a conflict attempt on this head and this base tip.
 *
 * An attempt with `start: 'failed'` does not count: it spent nothing, and the
 * fixer tick holds a failed start on the same head and base tip by its own reason.
 *
 * @param record - the decoded record, or `'none'`/`'unreadable'`.
 * @param head - the PR's current head SHA.
 * @param baseTip - the base branch's tip SHA.
 * @returns whether a `conflict` attempt names both; false for a missing or
 *   unreadable record, or an empty `head` or `baseTip`.
 */
export const fixerConflictTried = (record: AttemptsReading, head: string, baseTip: string): boolean =>
  record !== 'none' &&
  record !== 'unreadable' &&
  head !== '' &&
  baseTip !== '' &&
  record.attempts.some(
    (attempt) =>
      attempt.start !== 'failed' &&
      attempt.finding.kind === 'conflict' &&
      attempt.finding.head === head &&
      attempt.finding.baseTip === baseTip,
  );

/**
 * Whether a fixer is currently running on this PR, for the "no second fixer"
 * check.
 *
 * **AN UNREADABLE RECORD HOLDS.** This is the opposite default from
 * {@link fixerAttemptsSpent}, and the plan states why: reading an unreadable
 * in-flight mark as "nothing is running" is exactly what starts the second
 * fixer this record exists to prevent. A missing record (`'none'`) is not the
 * same fact — no record at all means no attempt was ever written, which is a
 * genuine "nothing running" rather than a mark this build could not parse —
 * so only `'none'` answers false here; `'unreadable'` answers true, the hold.
 *
 * @param record - the decoded record, or `'none'`/`'unreadable'`.
 * @returns true where a fixer should be treated as in flight — including the
 *   unreadable case, which holds rather than starting a second one.
 */
export const fixerInFlight = (record: FixerAttemptsRecord | 'none' | 'unreadable'): boolean => {
  if (record === 'none') return false;
  if (record === 'unreadable') return true;
  return record.attempts.some((attempt) => attempt.inFlight !== undefined);
};

/** Where a head's CI re-run stands, as `ciRerunArm` reads it. */
export type RerunOnHead = 'none' | 'running' | 'done' | 'unseen';

/** The clock {@link rerunOnHead} reads: the tick's time and `Checks wait`, both in milliseconds. */
export interface RerunClock {
  readonly now: number;
  readonly checksWaitMs: number;
}

/**
 * What the record holds for the re-run of one head's failed CI jobs.
 *
 * @param record - the decoded record, or `'none'`/`'unreadable'`.
 * @param head - the PR's current head SHA.
 * @returns the entry's answer; `'none'` where no entry names `head`, `head` is
 *   empty, or the record is missing or unreadable.
 */
export const fixerRerunAnswer = (record: AttemptsReading, head: string): FixerRerunAnswer | 'none' => {
  if (record === 'none' || record === 'unreadable' || head === '') return 'none';
  return record.reruns?.find((entry) => entry.headSha === head)?.answer ?? 'none';
};

/**
 * Where the re-run of one head's failed CI jobs stands.
 *
 * @param record - the decoded record, or `'none'`/`'unreadable'`.
 * @param head - the PR's current head SHA.
 * @param clock - the tick's time and `Checks wait`.
 * @returns `none` where no entry names `head`; `done` where the entry is
 *   cleared or answered `failed` or `unaskable`; `unseen` where it answered
 *   `asked`, is not cleared, and `Checks wait` has passed since its `at` or
 *   `at` does not parse; `running` otherwise.
 */
export const rerunOnHead = (record: AttemptsReading, head: string, clock: RerunClock): RerunOnHead => {
  if (record === 'none' || record === 'unreadable' || head === '') return 'none';
  const entry = record.reruns?.find((rerun) => rerun.headSha === head);
  if (entry === undefined) return 'none';
  if (entry.cleared !== undefined || entry.answer !== 'asked') return 'done';
  const at = Date.parse(entry.at);
  return Number.isNaN(at) || clock.now - at > clock.checksWaitMs ? 'unseen' : 'running';
};

/**
 * Reads a PR's attempts record down to the {@link FixerReading} the arms take.
 *
 * @param record - the decoded record, or `'none'`/`'unreadable'`.
 * @param head - the PR's current head SHA; `''` where the row carries none.
 * @param baseTip - the base branch's tip SHA; `''` where it was not read.
 * @param clock - the clock {@link rerunOnHead} reads; absent, the reading carries no `rerun`.
 * @returns `unread` for an unreadable record, otherwise the in-flight answer,
 *   the three exhaustion answers, whether a conflict attempt exists on `head`
 *   and `baseTip`, whether the record proves the fixer pushed `head`, and,
 *   with a clock, where the re-run of `head` stands.
 */
export const fixerReadingOf = (record: AttemptsReading, head: string, baseTip = '', clock?: RerunClock): FixerReading =>
  record === 'unreadable'
    ? { read: 'unread' }
    : {
        read: 'record',
        inFlight: fixerInFlight(record),
        highExhausted: fixerAttemptsExhausted(record, 'high'),
        ciExhausted: fixerAttemptsExhausted(record, 'ci'),
        conflictExhausted: fixerAttemptsExhausted(record, 'conflict'),
        conflictTried: fixerConflictTried(record, head, baseTip),
        pushedHead: head !== '' && fixerPushedHead(record, head),
        ...(clock === undefined ? {} : { rerun: rerunOnHead(record, head, clock) }),
      };
