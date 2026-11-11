/**
 * Which branch a slice is cut from, and where its plan and brief are read.
 *
 * A plan on the default branch has the default branch as its base. A plan
 * that only a sprint integration branch (`sprint/<slug>`) holds has that
 * sprint branch as its base: its slices are cut from it, its brief is booked
 * on it, and its slice PRs target it.
 *
 * @concept slice-base
 */

import type { PlanRecord } from '../ports/plan-store.js';

/** The prefix of a sprint integration branch, as `local-checks-base.ts` names it. */
export const SPRINT_BRANCH_PREFIX = 'sprint/';

/** One sprint branch's plan files, as its tree lists them. */
export interface SprintPlanListing {
  /** The branch name without `origin/`, such as `sprint/triggers-and-connectors`. */
  readonly branch: string;
  /** The plan paths the branch's tree holds. */
  readonly files: readonly string[];
  /**
   * Whether `origin/<default>` already contains the branch's tip. A merged
   * sprint branch that was not deleted holds no plan the default branch has
   * not seen, and its plan files may be ones the default branch since
   * renamed or removed.
   */
  readonly inDefault: boolean;
}

/** The plan files to read from one sprint branch. */
export interface SprintPlanRead {
  /** The branch name without `origin/`. */
  readonly branch: string;
  /** The plan paths that branch holds and the default branch does not. */
  readonly files: readonly string[];
}

/** A plan record beside the branch it was read from. */
export interface BasedPlan {
  /** The plan, as the plan store parsed it. */
  readonly record: PlanRecord;
  /** The base branch without `origin/`; `''` for the default branch. */
  readonly base: string;
}

/**
 * The plan files each sprint branch holds that the default branch does not.
 *
 * A file the default branch holds is read there and never from a sprint
 * branch, so a default-branch plan keeps its base. A listing that names no
 * sprint branch, names a branch the default branch already contains, or
 * names no file off the default branch, reads nothing.
 *
 * @param mainFiles - the plan paths the default branch holds.
 * @param sprints - each sprint branch's plan paths, in ref order.
 * @returns the reads, in the order of `sprints`, without empty entries.
 */
export const sprintPlanReads = (
  mainFiles: readonly string[],
  sprints: readonly SprintPlanListing[],
): readonly SprintPlanRead[] => {
  const onMain = new Set(mainFiles);
  return sprints.flatMap((sprint) => {
    if (!sprint.branch.startsWith(SPRINT_BRANCH_PREFIX) || sprint.inDefault) return [];
    const files = sprint.files.filter((file) => !onMain.has(file));
    return files.length === 0 ? [] : [{ branch: sprint.branch, files }];
  });
};

/** What {@link planBaseOf} decides from. */
export interface PlanBaseReadings {
  /** Whether `origin/<default>` holds the plan file. */
  readonly onDefault: boolean;
  /** The plan's `Sprint:` slug, or `''`. */
  readonly sprint: string;
  /**
   * The sprint branches that hold the plan file off the default branch, in
   * ref order, as {@link sprintPlanReads} selects them.
   */
  readonly carriers: readonly string[];
}

/**
 * The branch a plan's slices are cut from and their PRs target.
 *
 * The default branch where it holds the plan file. Otherwise the sprint
 * branch the plan's `Sprint:` field names (`sprint/<slug>`) where it is a
 * carrier, else the first carrier in ref order. With no carrier, the default
 * branch.
 *
 * @param readings - where the plan file is held and what its `Sprint:` says.
 * @returns the base branch without `origin/`; `''` for the default branch.
 */
export const planBaseOf = (readings: PlanBaseReadings): string => {
  if (readings.onDefault) return '';
  const slug = readings.sprint.trim();
  const named = `${SPRINT_BRANCH_PREFIX}${slug}`;
  if (slug !== '' && readings.carriers.includes(named)) return named;
  return readings.carriers[0] ?? '';
};

/**
 * One plan per file from the sprint-branch reads, each with its base.
 *
 * The base is {@link planBaseOf} over the branches that hold the file, read
 * with the `Sprint:` field of the first record. A record that carries a
 * parse error is dropped.
 *
 * @param candidates - every record read from a sprint branch, in ref order,
 *   with `base` set to the branch it was read from.
 * @returns one plan per file, in first-seen order.
 */
export const chooseSprintPlans = (candidates: readonly BasedPlan[]): readonly BasedPlan[] => {
  const byFile = new Map<string, BasedPlan[]>();
  for (const candidate of candidates) {
    if (candidate.record.error !== undefined) continue;
    const held = byFile.get(candidate.record.file);
    if (held === undefined) byFile.set(candidate.record.file, [candidate]);
    else held.push(candidate);
  }
  return [...byFile.values()].map((held) => {
    const base = planBaseOf({ onDefault: false, sprint: held[0]!.record.sprint, carriers: held.map((each) => each.base) });
    return held.find((candidate) => candidate.base === base)!;
  });
};

/**
 * The ref a slice is cut from and its brief is read on.
 *
 * @param base - the slice's base branch without `origin/`; `''` for the
 *   default branch.
 * @param defaultRef - the default branch's ref, such as `origin/main`.
 * @returns `origin/<base>`, or `defaultRef` where `base` is empty.
 */
export const sliceBaseRef = (base: string, defaultRef: string): string =>
  base.trim() === '' ? defaultRef : `origin/${base.trim()}`;
