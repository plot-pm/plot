import type { WorkflowShaRun } from '../entities/build.js';
import type { RepairAttempt, RepairRecord } from '../entities/repair-record.js';
import { declaredRuns, foldRuns } from './default-branch.js';
import { type RedMainStepAnswer, repairBoundReached } from './repair.js';

/**
 * How long after the re-run was asked a reading of the first red SHA's runs
 * may settle the episode.
 *
 * GitHub keeps the failed conclusion on a run for a short time after a re-run
 * is accepted. A reading inside this window reports the old failure as the
 * answer.
 */
export const RERUN_GRACE_MS = 60 * 1000;

/** Why a re-run of the first red SHA reads `pending`. */
export type RerunWaitReason = 'rerun-unanswered' | 'rerun-unmatched' | 'rerun-unconcluded' | 'rerun-grace';

/**
 * What {@link rerunSettledOf} answers: a settled reading, `overdue` where the
 * wait passed `Checks wait`, or `pending` with its reason.
 */
export type RerunReading =
  | { settled: 'none' | 'green' | 'red' | 'overdue' }
  | { settled: 'pending'; reason: RerunWaitReason };

/**
 * Reads the first red SHA's re-run as `redMainStep`'s `rerunSettled` input.
 *
 * @param record - the repair record.
 * @param runs - every workflow run of `record.firstRedSha`, or null where the CI system did not answer.
 * @param checks - the declared workflow names, from `checkNamesOf`.
 * @param now - the current time, as epoch milliseconds.
 * @param checksWaitMs - the `Checks wait` bound, in milliseconds.
 * @returns `none` while no re-run is asked; `red` or `green` as the declared runs fold
 *   once they conclude; `overdue` where the answer would be `pending` and `now` is at
 *   or past the wait's start plus `checksWaitMs`; otherwise `pending` with its reason:
 *   `rerun-grace` inside {@link RERUN_GRACE_MS} of the ask or where `record.at` does
 *   not parse, `rerun-unanswered` where CI did not answer, `rerun-unconcluded` while a
 *   declared run is still going and none failed, and `rerun-unmatched` where the
 *   declared runs fold to `unknown` (no run matched a declared check). The wait starts
 *   at `record.at`, else at `record.redSince`; where neither parses, every `pending`
 *   answer is `overdue`.
 */
export const rerunSettledOf = (
  record: RepairRecord,
  runs: readonly WorkflowShaRun[] | null,
  checks: readonly string[],
  now: number,
  checksWaitMs: number,
): RerunReading => {
  if (record.rerun === 'none') return { settled: 'none' };
  const askedAt = Date.parse(record.at);
  const pending = (reason: RerunWaitReason): RerunReading =>
    rerunWaitOverdue(record, now, checksWaitMs) ? { settled: 'overdue' } : { settled: 'pending', reason };
  if (Number.isNaN(askedAt) || now - askedAt < RERUN_GRACE_MS) return pending('rerun-grace');
  if (runs === null) return pending('rerun-unanswered');
  const state = foldRuns(declaredRuns(runs, checks));
  if (state === 'red' || state === 'green') return { settled: state };
  return pending(state === 'pending' ? 'rerun-unconcluded' : 'rerun-unmatched');
};

/**
 * Whether the wait for the first red SHA's re-run passed `Checks wait`.
 *
 * @param record - the repair record.
 * @param now - the current time, as epoch milliseconds.
 * @param checksWaitMs - the `Checks wait` bound, in milliseconds.
 * @returns true at or after `record.at + checksWaitMs`, measured from
 *   `record.redSince` where `record.at` does not parse; true where neither parses.
 */
export const rerunWaitOverdue = (record: RepairRecord, now: number, checksWaitMs: number): boolean => {
  const askedAt = Date.parse(record.at);
  const start = Number.isNaN(askedAt) ? Date.parse(record.redSince) : askedAt;
  return Number.isNaN(start) || now >= start + checksWaitMs;
};

/** What {@link repairStartAction} answers. */
export type RepairStartAction =
  | { action: 'ask-rerun' }
  | { action: 'awaiting-rerun'; rerun: RerunReading }
  | { action: 'start-repair' }
  | { action: 'record-pr'; pr: number }
  | { action: 'awaiting-repair' }
  | { action: 'none' };

/** What {@link repairStartAction} reads. */
export interface RepairStartActionInput {
  /** `redMainStep`'s answer for this pass. */
  step: RedMainStepAnswer;
  /** The repair record. */
  record: RepairRecord;
  /** Whether a default-branch reading exists. */
  hasReading: boolean;
  /** The number of the open PR for the attempt's branch, or null where none is open or no attempt is recorded. */
  openPr: number | null;
  /** The first red SHA's re-run, as {@link rerunSettledOf} reads it. */
  rerun: RerunReading;
}

/**
 * The repair-start pass's next action, from `redMainStep`'s answer.
 *
 * - `await-rerun`: `ask-rerun` where no re-run is recorded and a reading exists
 *   to name the branch; otherwise `awaiting-rerun` with the re-run reading.
 * - `start-repair`: `start-repair`.
 * - `await-repair`: `record-pr` where a PR is open for the attempt's branch, this
 *   machine did not lose the claim, and the record does not already name that PR;
 *   otherwise `awaiting-repair`.
 * - Every other step: `none`.
 *
 * @param input - the step, the record and the readings.
 * @returns the action.
 */
export const repairStartAction = (input: RepairStartActionInput): RepairStartAction => {
  const { step, record } = input;
  if (step === 'await-rerun') {
    if (record.rerun !== 'none' || !input.hasReading) return { action: 'awaiting-rerun', rerun: input.rerun };
    return { action: 'ask-rerun' };
  }
  if (step === 'start-repair') return { action: 'start-repair' };
  if (step === 'await-repair') {
    const pr = input.openPr;
    if (pr === null || record.attempt?.outcome === 'lost' || record.repairPr === pr) return { action: 'awaiting-repair' };
    return { action: 'record-pr', pr };
  }
  return { action: 'none' };
};

/**
 * Reads the last green SHA's pre-revert re-run as `redMainStep`'s
 * `lastGreenRerunSettled` input.
 *
 * Reads only the new attempt. The last green SHA's own runs concluded before
 * the episode opened, so a declared run whose `startedAt` is not after
 * `record.redSince` is the old attempt, and the answer stays `pending` until
 * every declared run reports a newer start.
 *
 * @param record - the repair record.
 * @param runs - every workflow run of `record.lastGreenSha`, or null where the CI system did not answer.
 * @param checks - the declared workflow names, from `checkNamesOf`.
 * @param now - the current time, as epoch milliseconds.
 * @returns `none` while no re-run is asked; `pending` inside {@link RERUN_GRACE_MS} of
 *   the ask, with no answer from CI, while any declared run is the old attempt, or
 *   while any run is unconcluded; `red` or `green` as the new attempt's runs fold.
 */
export const lastGreenRerunSettledOf = (
  record: RepairRecord,
  runs: readonly WorkflowShaRun[] | null,
  checks: readonly string[],
  now: number,
): 'pending' | 'green' | 'red' | 'none' => {
  if (record.preRevertRerun === 'none') return 'none';
  const askedAt = Date.parse(record.at);
  if (Number.isNaN(askedAt) || now - askedAt < RERUN_GRACE_MS || runs === null) return 'pending';
  const since = Date.parse(record.redSince);
  const declared = declaredRuns(runs, checks);
  if (declared.some((run) => !(Date.parse(run.startedAt) > since))) return 'pending';
  const state = foldRuns(declared);
  return state === 'red' || state === 'green' ? state : 'pending';
};

/**
 * Whether the pre-revert re-run of the last green SHA is past its bound.
 *
 * The re-run has `Checks wait` from the moment the repair bound passes to be
 * asked and to settle. Past that, the episode ends at `exhausted`: a re-run
 * that matched no run, a CI system that cannot re-run, or runs that left the
 * CI listing would otherwise hold the episode with no end.
 *
 * @param record - the repair record.
 * @param now - the current time, as epoch milliseconds.
 * @param mainRepairBoundMs - the `Main repair bound`, in milliseconds.
 * @param checksWaitMs - the `Checks wait` bound, in milliseconds.
 * @returns true at or after the repair bound's start plus `mainRepairBoundMs +
 *   checksWaitMs`, as {@link repairBoundReached} measures it; false before it, or
 *   where the bound's start does not parse.
 */
export const lastGreenRerunOverdue = (
  record: RepairRecord,
  now: number,
  mainRepairBoundMs: number,
  checksWaitMs: number,
): boolean => repairBoundReached(record, now, mainRepairBoundMs + checksWaitMs);

/**
 * The `main-repair` role's run for the attempt's branch on this machine.
 *
 * `none` where no run of the branch started in this episode; `alive` while its
 * pid answers; `ended` where the run wrote its ending record; `crashed` where
 * the pid is gone and no ending record exists; `start-failed` where the ending
 * record names a CLI refusal, so no agent ran.
 */
export type RoleRunReading = 'none' | 'alive' | 'ended' | 'crashed' | 'start-failed';

/** What the `start-repair` step does with the episode's one attempt. */
export type RepairAttemptStep =
  | 'claim'
  | 'start'
  | 'resume'
  | 'wait'
  | 'record-ended'
  | 'record-start-failed'
  | 'ended'
  | 'held'
  | 'lost';

/**
 * The next action on the episode's one repair attempt, once `redMainStep`
 * answers `start-repair`.
 *
 * One attempt per episode. A finished run ends the attempt; only a run that
 * crashed with no ending record resumes, and at most once.
 *
 * - No attempt recorded: `claim`.
 * - `outcome: 'lost'`: `lost`. `outcome: 'ended'`: `ended`. Neither starts anything.
 * - Run `alive`: `wait`.
 * - Run `ended`: `record-ended`; the caller writes `outcome: 'ended'`.
 * - Run `start-failed`: `record-start-failed` where the attempt does not yet say
 *   so; then `resume` once, which starts the role again; then `held`. A failed
 *   start spends no attempt, and a second one holds the episode.
 * - Run `crashed`: `resume` where `resumed` is unset, else `record-ended`.
 * - Run `none`: `start` where this machine holds the desk, else `claim`.
 *
 * @param attempt - the record's attempt, or undefined where none is recorded.
 * @param desk - whether this machine holds a desk for the attempt's branch.
 * @param run - the role run's reading for the attempt's branch.
 * @returns the action.
 */
export const repairAttemptStep = (
  attempt: RepairAttempt | undefined,
  desk: boolean,
  run: RoleRunReading,
): RepairAttemptStep => {
  if (attempt === undefined) return 'claim';
  if (attempt.outcome === 'lost') return 'lost';
  if (attempt.outcome === 'ended') return 'ended';
  if (run === 'alive') return 'wait';
  if (run === 'ended') return 'record-ended';
  if (run === 'start-failed') {
    if (attempt.outcome !== 'start-failed') return 'record-start-failed';
    return attempt.resumed === true ? 'held' : 'resume';
  }
  if (run === 'crashed') return attempt.resumed === true ? 'record-ended' : 'resume';
  return desk ? 'start' : 'claim';
};
