import type { WorkflowShaRun } from '../entities/build.js';
import type {
  DefaultBranchReading,
  FailingRun,
  RunsState,
  SettledReading,
} from '../entities/default-branch.js';

const RED_CONCLUSIONS: ReadonlySet<string> = new Set(['failure', 'timed_out', 'startup_failure']);
const PENDING_CONCLUSIONS: ReadonlySet<string> = new Set(['queued', 'in_progress', 'action_required']);
const GREEN_CONCLUSIONS: ReadonlySet<string> = new Set(['success', 'neutral', 'skipped']);

/** The word a run counts as: its conclusion once it has one, otherwise its status. */
const wordOf = (run: WorkflowShaRun): string => run.conclusion ?? run.status;

/**
 * Adds up the runs of one commit.
 *
 * `red` is tested first: one failure is red whatever else is still running.
 * Then any run queued, in progress or awaiting a person is `pending`. Then at
 * least one run, all of them success, neutral or skipped, is `green`. No runs,
 * a cancelled run with nothing failed, and any word not listed is `unknown`.
 *
 * @param runs - every workflow run of one commit.
 * @returns the commit's state.
 */
export const foldRuns = (runs: readonly WorkflowShaRun[]): RunsState => {
  const words = runs.map(wordOf);
  if (words.some((word) => RED_CONCLUSIONS.has(word))) return 'red';
  if (words.some((word) => PENDING_CONCLUSIONS.has(word))) return 'pending';
  if (words.length > 0 && words.every((word) => GREEN_CONCLUSIONS.has(word))) return 'green';
  return 'unknown';
};

/**
 * Lists the runs that concluded as failures.
 *
 * @param runs - every workflow run of one commit.
 * @returns the red runs, in the order given.
 */
export const failingRunsOf = (runs: readonly WorkflowShaRun[]): FailingRun[] =>
  runs
    .filter((run) => RED_CONCLUSIONS.has(wordOf(run)))
    .map((run) => ({ workflow: run.workflow, conclusion: wordOf(run), url: run.url }));

/**
 * Advances the settled part with one reading of the head.
 *
 * The settled part moves only when the head's runs have all concluded, that is
 * when `head` is `red` or `green`. A `pending` or `unknown` head leaves the
 * previous settled reading untouched, so a red commit keeps holding while its
 * successor is still running.
 *
 * @param settled - the previous settled reading, if any.
 * @param headSha - the commit the runs belong to.
 * @param head - what those runs add up to.
 * @returns the settled reading after this one.
 */
export const advanceSettled = (
  settled: SettledReading | undefined,
  headSha: string,
  head: RunsState,
): SettledReading | undefined =>
  head === 'red' || head === 'green' ? { sha: headSha, state: head } : settled;

/**
 * Whether the default branch is red for queueing purposes.
 *
 * Reads only the settled part. A pending head never lifts the hold and never
 * raises one; no reading, no settled commit and an unknown state hold nothing.
 *
 * @param reading - the default-branch reading, or null where there is none.
 * @returns true when the newest settled commit is red.
 */
export const defaultBranchRed = (reading: DefaultBranchReading | null): boolean =>
  reading?.settled?.state === 'red';
