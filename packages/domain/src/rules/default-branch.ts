import type { WorkflowShaRun } from '../entities/build.js';
import type {
  DefaultBranchReading,
  FailingRun,
  RunsState,
  SettledReading,
} from '../entities/default-branch.js';
import { reading as stamped, readingAge } from '../entities/identity.js';

const RED_CONCLUSIONS: ReadonlySet<string> = new Set(['failure', 'timed_out', 'startup_failure']);
const PENDING_CONCLUSIONS: ReadonlySet<string> = new Set(['queued', 'in_progress', 'action_required', 'waiting', 'requested', 'pending']);
const GREEN_CONCLUSIONS: ReadonlySet<string> = new Set(['success', 'neutral', 'skipped']);

/** The word a run counts as: its conclusion once it has one, otherwise its status. */
const wordOf = (run: WorkflowShaRun): string => run.conclusion ?? run.status;

/**
 * Reads the `Default branch checks` config value as a list of workflow names.
 *
 * @param value - the comma-separated value; empty where the key is absent.
 * @returns the trimmed, non-empty names, in the order given.
 */
export const checkNamesOf = (value: string): string[] =>
  value
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');

/**
 * Keeps the runs of the workflows a project declares as its checks.
 *
 * The default-branch fold reads only these, so a workflow outside the list —
 * one that publishes or releases rather than tests — cannot turn the branch
 * red or green. An empty list keeps every run.
 *
 * @param runs - every workflow run of one commit.
 * @param checks - the declared workflow names, from {@link checkNamesOf}.
 * @returns the runs whose `workflow` is declared, or every run for an empty list.
 */
export const declaredRuns = (
  runs: readonly WorkflowShaRun[],
  checks: readonly string[],
): WorkflowShaRun[] =>
  checks.length === 0 ? [...runs] : runs.filter((run) => checks.includes(run.workflow));

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
 * Whether the newest settled commit of a reading is red, whatever the reading's age.
 *
 * Reads only the settled part. A pending head never lifts the hold and never
 * raises one; no reading, no settled commit and an unknown state are not red.
 * Callers that hold work back use {@link defaultBranchRed}, which also ages
 * the reading.
 *
 * @param reading - the default-branch reading, or null where there is none.
 * @returns true when the newest settled commit is red.
 */
export const settledRed = (reading: DefaultBranchReading | null): boolean =>
  reading?.settled?.state === 'red';

/**
 * Whether the default branch is red for queueing purposes.
 *
 * A reading older than `checksWaitMs`, or whose `askedAt` does not parse, counts
 * as no reading and holds nothing: the file is written only while fleetd runs,
 * so an old red reading is not evidence about the branch now. Otherwise reads
 * only the settled part, as {@link settledRed} does.
 *
 * @param reading - the default-branch reading, or null where there is none.
 * @param now - the current time, as epoch milliseconds.
 * @param checksWaitMs - the `Checks wait` bound, in milliseconds.
 * @returns true when the newest settled commit is red and the reading is within the bound.
 */
export const defaultBranchRed = (
  reading: DefaultBranchReading | null,
  now: number,
  checksWaitMs: number,
): boolean => {
  if (reading === null || !settledRed(reading)) return false;
  const askedAt = Date.parse(reading.askedAt);
  if (Number.isNaN(askedAt)) return false;
  return readingAge(stamped(reading, askedAt), now) <= checksWaitMs;
};

/**
 * One thing a board has to report, independent of which panel renders it.
 *
 * Declared here rather than in `StatusPanel.tsx` because the domain cannot
 * import board code, and this is the one shape both a domain rule and a board
 * component must agree on. `StatusPanel.tsx` reuses this definition.
 */
export interface BoardStatus {
  /** Stable identity across pulses — what arrival and paging are keyed on. */
  key: string;
  /** How loud this is. Higher sorts first. */
  severity: number;
  /** The sentence the reader reads. */
  text: string;
  /** `rose` for the whole view being gone, `amber` for a lesser state. */
  tone: 'rose' | 'amber';
}

/**
 * How long ago a reading was taken, in words.
 *
 * Under a minute reads `under a minute ago`; under an hour, whole minutes
 * (`3 min ago`); under a day, whole hours (`5 h ago`); otherwise whole days
 * (`3 d ago`). A timestamp in the future reads as under a minute.
 *
 * @param at - when the reading was taken, ISO-8601.
 * @param now - the current time, ISO-8601.
 * @returns the age in words, or null when either timestamp does not parse.
 */
export const ageInWords = (at: string, now: string): string | null => {
  const elapsed = Date.parse(now) - Date.parse(at);
  if (Number.isNaN(elapsed)) return null;
  const minutes = Math.max(0, Math.floor(elapsed / 60000));
  if (minutes === 0) return 'under a minute ago';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
  return `${Math.floor(minutes / (24 * 60))} d ago`;
};

/** The distinct, non-empty workflow names of the failing runs, joined for a reader. */
const failingNames = (runs: readonly FailingRun[]): string =>
  [...new Set(runs.map((failing) => failing.workflow).filter((name) => name !== ''))].join(', ');

/**
 * The status panel entry for a red default branch, or null where it is not red.
 *
 * Reads only `settledRed(reading)` — never `reading.head` — so a pending
 * head after a red settled commit still holds: the status line and the queue's
 * `default-branch-red` hold must agree on the same reading.
 *
 * The text names the branch, the short settled SHA, the failing workflows in
 * parentheses where `failingRuns` names any, and the age of `askedAt`
 * (`main is red on 5d82dc3 (CI), read 4 min ago.`). A stale reading is still
 * shown with its age. An `askedAt` that does not parse gives
 * `the reading's age is unknown` and no number.
 *
 * @param reading - the default-branch reading, or null where there is none.
 * @param now - the current time, ISO-8601. Defaults to the actual time.
 * @returns the entry while the branch is red; null otherwise.
 */
export const defaultBranchStatus = (
  reading: DefaultBranchReading | null,
  now: string = new Date().toISOString(),
): BoardStatus | null => {
  if (!settledRed(reading) || reading === null || reading.settled === undefined) return null;
  const age = ageInWords(reading.askedAt, now);
  const names = failingNames(reading.failingRuns);
  const which = names === '' ? '' : ` (${names})`;
  const when = age === null ? "the reading's age is unknown" : `read ${age}`;
  return {
    key: 'default-branch-red',
    severity: 25,
    tone: 'amber',
    text: `${reading.branch} is red on ${reading.settled.sha.slice(0, 7)}${which}, ${when}.`,
  };
};
