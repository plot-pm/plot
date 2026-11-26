import type { DefaultBranchReading } from '../entities/default-branch.js';
import { defaultBranchRed, holdsApply } from './default-branch.js';
import { repairMergeVerdict, type RepairMergeReading } from './repair-pr.js';

/** The commit-status context the default-branch hold is written under. */
export const MAIN_HOLD_STATUS_CONTEXT = 'plot/main';

/** How many hex characters of a commit a `plot/main` description names. */
export const MAIN_HOLD_SHA_LENGTH = 9;

/** The `plot/main` status one open PR should carry, or `none` where the rule writes no status. */
export type MainHoldStatus =
  | { readonly state: 'success' | 'failure'; readonly description: string }
  | 'none';

/** The PR {@link mainHoldStatus} decides for. */
export interface MainHoldPr {
  /** The PR's number. */
  readonly number: number;
  /** The PR's head branch. */
  readonly head: string;
  /** The PR's base branch as the host names it, or `''`. */
  readonly base: string;
}

/**
 * Decides the `plot/main` commit status of one open PR.
 *
 * `none` where {@link holdsApply} answers false for the PR's base and
 * `defaultName`, such as a PR into a `sprint/*` branch. `success` where
 * {@link defaultBranchRed} does not hold, which includes an absent reading and
 * one older than `checksWaitMs`. On a red reading, `success` for the PR that
 * {@link repairMergeVerdict} admits, and `failure` for every other PR. Both
 * red descriptions name the first {@link MAIN_HOLD_SHA_LENGTH} hex characters
 * of the settled red commit.
 *
 * @param reading - the default-branch reading, or null where there is none.
 * @param repair - the repair exception's reading for this tick, or undefined where the record names no open PR.
 * @param pr - the PR's number, head branch and base branch.
 * @param now - the current time, as epoch milliseconds.
 * @param checksWaitMs - the `Checks wait` bound, in milliseconds.
 * @param defaultName - the default branch name, `'unaskable'`, or absent.
 * @returns the state and description to write, or `none`.
 */
export const mainHoldStatus = (
  reading: DefaultBranchReading | null,
  repair: RepairMergeReading | undefined,
  pr: MainHoldPr,
  now: number,
  checksWaitMs: number,
  defaultName: string | 'unaskable' | undefined,
): MainHoldStatus => {
  if (!holdsApply(pr.base, defaultName)) return 'none';
  const branch = reading?.branch || (defaultName !== undefined && defaultName !== 'unaskable' && defaultName !== '' ? defaultName : 'main');
  if (reading === null || !defaultBranchRed(reading, now, checksWaitMs) || reading.settled === undefined) {
    return { state: 'success', description: `${branch} is not red` };
  }
  const sha = reading.settled.sha.slice(0, MAIN_HOLD_SHA_LENGTH);
  if (repair !== undefined && repairMergeVerdict(repair, pr).verdict === 'admitted') {
    return { state: 'success', description: `repair PR for ${sha}` };
  }
  return { state: 'failure', description: `${branch} is red on ${sha}; merge the repair PR first` };
};
