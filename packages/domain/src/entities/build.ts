import { z } from 'zod';

/**
 * What a build run is doing, or how it ended.
 *
 * A state rather than a conclusion: a build that has not finished has no
 * conclusion, and a field that must hold `in_progress` is not describing an
 * outcome. The CI system's own word is kept verbatim; normalizing it is lossy.
 */
// plot-state: lifecycle build — queued, then running, then one of four ends,
//                               and the CI system's word is kept verbatim.
//                               NO RULE YET: counted as debt by
//                               scripts/check-state-declarations.sh.
export const BuildStateSchema = z.enum([
  'queued',
  'in_progress',
  'success',
  'failure',
  'cancelled',
  'timed_out',
]);
export type BuildState = z.infer<typeof BuildStateSchema>;

/**
 * The thing that runs, stable across runs.
 *
 * Identity: a natural key — its name, scoped to the repo.
 */
export interface BuildPipeline {
  /** The workflow's name, e.g. `CI` — the identity, stable across runs. */
  name: string;
  /**
   * Its address on the CI system; `''` when unknown.
   *
   * The CI system, not the git host. On a repository where GitHub runs the
   * builds the two are one address and the distinction costs nothing; on a
   * Bitbucket + Jenkins team the pipeline lives on Jenkins and the host is
   * somewhere else entirely.
   */
  url: string;
}

/**
 * One result of one run of a pipeline.
 *
 * Identity: a natural key — its run URL. Two builds of one pipeline minutes
 * apart are different objects: the pipeline is what a reader recognises, the
 * build is what they open. State: foreign, so askability is carried apart from
 * the answer.
 */
export interface Build {
  /** The run's own address — the identity. */
  url: string;
  /** The name of the pipeline that ran. */
  pipeline: string;
  /** The branch or ref it ran against. */
  head: string;
  /** What it is doing, or how it ended, verbatim from the CI system. */
  state: BuildState;
  /** When it started, ISO-8601. */
  startedAt: string;
  /** How long it took in milliseconds; null while it is still running. */
  durationMs: number | null;
}

/**
 * Whether a build is still running.
 *
 * @param build - the build to test.
 * @returns true when the run has not reached an outcome.
 */
export const buildIsRunning = (build: Build): boolean =>
  build.state === 'queued' || build.state === 'in_progress';

/**
 * Whether a build reached an outcome, and what kind.
 *
 * A running build has no conclusion, which is why this may answer null.
 *
 * @param build - the build to read.
 * @returns true when it passed, false when it did not, null while running.
 */
export const buildConclusion = (build: Build): boolean | null =>
  buildIsRunning(build) ? null : build.state === 'success';

/**
 * Whether a build failed, for any of the three reasons it can.
 *
 * @param build - the build to test.
 * @returns true when the run finished without passing.
 */
export const buildFailed = (build: Build): boolean => buildConclusion(build) === false;

/**
 * One entry in a branch's run history, as the CI system lists it.
 *
 * A SECOND SHAPE beside {@link Build}, and the difference is what the CI
 * system answers rather than a preference. `Build` describes one run of one
 * pipeline against one sha and carries a closed {@link BuildState}; a branch's
 * history is asked for as evidence, and its `conclusion` is whatever word the
 * CI system printed — `success`, `failure`, `cancelled`, `in_progress`,
 * `action_required`, and whatever GitHub names next.
 *
 * The word stays verbatim. Narrowing it to an enum would map every unrecognised
 * outcome onto a known one, and a history exists to be read rather than
 * classified: what proved a `403` transient on 2026-08-17 was the neighbouring
 * run, not its category.
 *
 * There is no sha. `gh run list --branch` does not report one, which is why a
 * caller asking *did THIS commit pass* must ask a different question — see
 * `plot-host.sh run-for-sha`.
 */
export interface BuildRun {
  /** The workflow's name; `''` where the CI system did not name it. */
  workflow: string;
  /** How it ended, or what it is doing — verbatim from the CI system. */
  conclusion: string;
  /**
   * When it started, ISO-8601 as the CI system reported it; `''` when absent.
   */
  startedAt: string;
  /** The run's address; `''` renders as plain text. */
  url: string;
}

/**
 * The run for ONE commit, as the CI system reports it.
 *
 * A THIRD SHAPE beside {@link Build} and {@link BuildRun}, and the difference
 * is the sha. `BuildRun` is a branch's history and carries no commit at all —
 * `gh run list --branch` does not report one — so a caller asking *did THIS
 * commit pass* cannot read the answer off it. This carries the sha the run is
 * for, which is the whole reason the question is separate.
 *
 * THE SHA MAY NOT BE THE ONE ASKED ABOUT. A branch with no run for the given
 * commit answers with its newest run instead, and this field says which — a
 * run in flight for a commit the branch has moved past would otherwise report
 * identically to no run at all. Whether a differing sha means *superseded* is
 * the caller's rule; this reports what was found.
 *
 * `status` AND `conclusion` STAY APART. A build awaiting a human click reports
 * `action_required`, and one merely running reports a null conclusion; folding
 * them into one word makes the distinction unrecoverable downstream. Both are
 * the CI system's own words, kept verbatim for the reason `BuildRun` keeps its
 * conclusion verbatim.
 */
export interface ShaRun {
  /** The commit this run is for — not necessarily the one asked about. */
  sha: string;
  /** What the run is doing, verbatim; `''` where the system did not say. */
  status: string;
  /** How it ended, verbatim; null while it is still going. */
  conclusion: string | null;
  /** The run's address; `''` renders as plain text. */
  url: string;
  /** When it started, ISO-8601 as the system reported it; `''` when absent. */
  startedAt: string;
}
