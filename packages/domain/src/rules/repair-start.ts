import type { WorkflowShaRun } from '../entities/build.js';
import type { RepairRecord } from '../entities/repair-record.js';
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
