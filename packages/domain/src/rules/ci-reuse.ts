/**
 * Which CI jobs a pull request run may skip because an earlier run of the same
 * pull request passed them on the same base.
 *
 * A job is reused only while the earlier run's recorded base equals this run's
 * `HEAD^1`, the job ended `success` there, its recorded selection equals this
 * run's, and the job map of the reuse diff names it `false`. A push, a
 * dispatch, a re-run and the release pull request reuse nothing.
 */

import { z } from 'zod';

/** The reusable jobs, by their selection key, in the order they are answered. */
export const REUSE_KEYS = ['corpus', 'macos', 'contracts', 'board', 'census'] as const;

/** A reusable job's selection key. */
export type ReuseKey = (typeof REUSE_KEYS)[number];

/** The job whose conclusion decides each key. The census is reused as one unit on `census-compare`. */
export const REUSE_JOB: Readonly<Record<ReuseKey, string>> = {
  corpus: 'corpus',
  macos: 'macos-shell-contract',
  contracts: 'helper-contracts',
  board: 'board-integration',
  census: 'census-compare',
};

/** The test-selection output that must also match for a key, beside its flag. */
const TESTS_OF: Readonly<Partial<Record<ReuseKey, string>>> = {
  contracts: 'contracts_tests',
  corpus: 'corpus_tests',
};

/** A 40-hex commit SHA. */
const SHA = /^[0-9a-f]{40}$/;

/** The only reuse output form a job may skip on. */
const REUSE_VALUE = /^reused:[0-9a-f]{40}$/;

/** Why a job is not reused. */
export type ReuseReason =
  | 'base moved'
  | 'input changed'
  | 'selection changed'
  | 'no record'
  | 'not green'
  | 'read failed'
  | 'other pull request'
  | 'not selected'
  | 'not a pull request'
  | 'release pull request'
  | 're-run';

/** The job map of a reuse diff: `true` where the diff selects the job. */
export type JobMap = Readonly<Record<string, unknown>>;

const RecordShape = z.object({
  base: z.string(),
  head: z.string(),
  selection: z.record(z.string(), z.string()),
});

const EarlierRunShape = z.object({
  id: z.number(),
  pullRequests: z.array(z.number()),
  headSha: z.string(),
  conclusion: z.string(),
  record: RecordShape.nullable(),
  jobs: z.record(z.string(), z.string()).nullable(),
  jobMap: z.record(z.string(), z.unknown()).nullable(),
});

const ReadingsShape = z.object({
  event: z.string(),
  headRef: z.string(),
  runAttempt: z.number(),
  pullRequest: z.number(),
  base: z.string(),
  head: z.string(),
  selection: z.record(z.string(), z.string()),
  runs: z.array(EarlierRunShape),
});

/** One earlier completed run of the pull request, newest first in {@link CiReuseReadings.runs}. */
export type EarlierRun = z.infer<typeof EarlierRunShape>;

/** What the read step learnt: this run's facts and the earlier runs it read. */
export type CiReuseReadings = z.infer<typeof ReadingsShape>;

/** The answer for one reusable job. */
export type JobReuse =
  | {
      readonly key: ReuseKey;
      readonly job: string;
      readonly reused: true;
      readonly value: string;
      readonly runId: number;
      readonly headSha: string;
      readonly base: string;
      readonly conclusion: string;
    }
  | { readonly key: ReuseKey; readonly job: string; readonly reused: false; readonly reason: ReuseReason };

/**
 * Parses the readings file the read step writes.
 *
 * @param text - the file's JSON text.
 * @returns the readings.
 * @throws when the text is no JSON or does not hold the readings' shape.
 */
export const parseCiReuseReadings = (text: string): CiReuseReadings => ReadingsShape.parse(JSON.parse(text));

/**
 * The paths whose text can differ between two merges on one base: the head
 * diff joined with the symmetric difference of the two runs' changed paths.
 *
 * @param headDiff - `git diff --name-only <earlier head> <this head>`.
 * @param earlierChanged - the earlier run's changed paths, its merge against its base.
 * @param changed - this run's changed paths.
 * @returns the paths, sorted and unique, with no empty entry.
 */
export const reuseDiff = (
  headDiff: readonly string[],
  earlierChanged: readonly string[],
  changed: readonly string[],
): string[] => {
  const earlier = new Set(earlierChanged);
  const now = new Set(changed);
  const paths = [
    ...headDiff,
    ...earlierChanged.filter((p) => !now.has(p)),
    ...changed.filter((p) => !earlier.has(p)),
  ].filter((p) => p !== '');
  return [...new Set(paths)].sort();
};

/**
 * A reuse output value as a job may read it.
 *
 * @param value - a candidate value.
 * @returns the value when it reads `reused:<40 hex>`, else the empty string.
 */
export const reuseOutput = (value: string): string => (REUSE_VALUE.test(value) ? value : '');

/** Why no run is read at all, or `null` when this run may reuse. */
const runBar = (r: CiReuseReadings): ReuseReason | null => {
  if (r.event !== 'pull_request') return 'not a pull request';
  if (r.headRef.startsWith('changeset-release/')) return 'release pull request';
  if (r.runAttempt > 1) return 're-run';
  return null;
};

/** Whether the earlier run's selection for `key` equals this run's. */
const sameSelection = (key: ReuseKey, earlier: Readonly<Record<string, string>>, now: Readonly<Record<string, string>>): boolean => {
  const tests = TESTS_OF[key];
  return earlier[key] === now[key] && (tests === undefined || earlier[tests] === now[tests]);
};

/** The reason `run` is no source for `key`, or `null` when it is one. */
const runReason = (r: CiReuseReadings, run: EarlierRun, key: ReuseKey): ReuseReason | null => {
  if (run.record === null) return 'no record';
  if (run.record.base !== r.base) return 'base moved';
  if (run.record.head !== run.headSha || !run.pullRequests.includes(r.pullRequest)) return 'other pull request';
  if (!SHA.test(run.headSha) || run.jobs === null || run.jobMap === null) return 'read failed';
  if (run.jobs[REUSE_JOB[key]] !== 'success') return 'not green';
  if (!sameSelection(key, run.record.selection, r.selection)) return 'selection changed';
  if (run.jobMap[key] !== false) return 'input changed';
  return null;
};

/** The answer for one key over the runs, newest first. */
const answerFor = (r: CiReuseReadings, key: ReuseKey): JobReuse => {
  const job = REUSE_JOB[key];
  const barred = runBar(r) ?? (r.selection[key] === 'false' ? 'not selected' : null);
  if (barred !== null) return { key, job, reused: false, reason: barred };
  let first: ReuseReason | null = null;
  for (const run of r.runs) {
    const reason = runReason(r, run, key);
    if (reason === null) {
      return {
        key,
        job,
        reused: true,
        value: `reused:${run.headSha}`,
        runId: run.id,
        headSha: run.headSha,
        base: r.base,
        conclusion: run.conclusion,
      };
    }
    first ??= reason;
    if (reason === 'base moved') break;
  }
  return { key, job, reused: false, reason: first ?? 'no record' };
};

/**
 * Which reusable jobs this run skips, and why each other one runs.
 *
 * @param readings - this run's facts and the earlier runs the read step read, newest first.
 * @returns one answer per key of {@link REUSE_KEYS}, in that order. A reused
 *   answer names the source run, its head and conclusion; any other names the
 *   newest run's reason, or `no record` where no run was read.
 */
export const ciReuse = (readings: CiReuseReadings): JobReuse[] => REUSE_KEYS.map((key) => answerFor(readings, key));
