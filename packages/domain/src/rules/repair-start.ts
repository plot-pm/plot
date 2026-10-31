import type { WorkflowShaRun } from '../entities/build.js';
import type { RepairAttempt, RepairRecord } from '../entities/repair-record.js';
import { declaredRuns, foldRuns } from './default-branch.js';

/**
 * How long after the re-run was asked a reading of the first red SHA's runs
 * may settle the episode.
 *
 * GitHub keeps the failed conclusion on a run for a short time after a re-run
 * is accepted. A reading inside this window reports the old failure as the
 * answer.
 */
export const RERUN_GRACE_MS = 60 * 1000;

/**
 * Reads the first red SHA's re-run as `redMainStep`'s `rerunSettled` input.
 *
 * @param record - the repair record.
 * @param runs - every workflow run of `record.firstRedSha`, or null where the CI system did not answer.
 * @param checks - the declared workflow names, from `checkNamesOf`.
 * @param now - the current time, as epoch milliseconds.
 * @returns `none` while no re-run is asked; `pending` inside {@link RERUN_GRACE_MS} of
 *   the ask, with no answer from CI, or while any run is unconcluded; `red` or `green`
 *   as the declared runs fold once they conclude.
 */
export const rerunSettledOf = (
  record: RepairRecord,
  runs: readonly WorkflowShaRun[] | null,
  checks: readonly string[],
  now: number,
): 'pending' | 'green' | 'red' | 'none' => {
  if (record.rerun === 'none') return 'none';
  const askedAt = Date.parse(record.at);
  if (Number.isNaN(askedAt) || now - askedAt < RERUN_GRACE_MS || runs === null) return 'pending';
  const state = foldRuns(declaredRuns(runs, checks));
  return state === 'red' || state === 'green' ? state : 'pending';
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
 * The `main-repair` role's run for the attempt's branch on this machine.
 *
 * `none` where no run of the branch started in this episode; `alive` while its
 * pid answers; `ended` where the run wrote its ending record; `crashed` where
 * the pid is gone and no ending record exists.
 */
export type RoleRunReading = 'none' | 'alive' | 'ended' | 'crashed';

/** What the `start-repair` step does with the episode's one attempt. */
export type RepairAttemptStep =
  | 'claim'
  | 'start'
  | 'resume'
  | 'wait'
  | 'record-ended'
  | 'ended'
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
  if (run === 'crashed') return attempt.resumed === true ? 'record-ended' : 'resume';
  return desk ? 'start' : 'claim';
};
