/**
 * Which branch a change is read against for the local checks.
 *
 * @concept local-checks-base
 */

import { SPRINT_BRANCH_PREFIX } from './slice-base.js';

/** One branch the change may have been cut from, with how far HEAD sits past it. */
export interface BaseCandidate {
  /** The branch name without `origin/`, such as `main` or `sprint/triggers-and-connectors`. */
  readonly branch: string;
  /**
   * The commits HEAD holds that `origin/<branch>` does not
   * (`git rev-list --count <merge base>..HEAD`); `null` where the count
   * could not be read.
   */
  readonly ahead: number | null;
}

/** What the base is resolved from. */
export interface LocalChecksBaseReadings {
  /** The `--base` argument, or `null` when none was given. */
  readonly flag: string | null;
  /** The `base` field of the desk manifest whose worktree is this checkout; `''` or `null` where none records one. */
  readonly manifestBase: string | null;
  /** The default branch's name, such as `main`. */
  readonly defaultBranch: string;
  /** The branches `origin` holds, without the `origin/` prefix. */
  readonly remoteBranches: readonly string[];
  /** The default branch and every `sprint/*` branch `origin` holds, each with its count. */
  readonly candidates: readonly BaseCandidate[];
}

/** Why a base was chosen. */
export type LocalChecksBaseReason = 'flag' | 'manifest' | 'nearest' | 'unread';

/** The chosen base. */
export interface LocalChecksBase {
  /** The branch name without `origin/`, or the object id `--base` named. */
  readonly base: string;
  /** Which reading decided. */
  readonly reason: LocalChecksBaseReason;
  /** The commits HEAD holds past the base, where a count decided; otherwise `null`. */
  readonly ahead: number | null;
}

/**
 * The candidates the nearest-base step compares: the default branch and every
 * `sprint/*` branch in `remoteBranches`, the default branch first.
 *
 * @param defaultBranch - the default branch's name.
 * @param remoteBranches - the branches `origin` holds, without `origin/`.
 * @returns the branch names to count HEAD against.
 */
export const baseCandidateBranches = (defaultBranch: string, remoteBranches: readonly string[]): readonly string[] => [
  defaultBranch,
  ...remoteBranches.filter((branch) => branch.startsWith(SPRINT_BRANCH_PREFIX) && branch !== defaultBranch).sort(),
];

/**
 * The base branch for the changed-file reading, in this order. Asks no host.
 *
 * 1. The `--base` argument, as given.
 * 2. The desk manifest's `base`, where `origin` still holds that branch.
 * 3. The candidate HEAD sits the fewest commits past. A tie goes to the
 *    default branch, then to the first sprint branch in name order.
 * 4. The default branch, with reason `unread`, where no candidate count was read.
 *
 * @param readings - the argument, the manifest's base, the branches `origin`
 *   holds and the count against each candidate.
 * @returns the base, the reason and the count that decided.
 */
export const localChecksBase = (readings: LocalChecksBaseReadings): LocalChecksBase => {
  const flag = readings.flag?.trim() ?? '';
  if (flag !== '') return { base: flag, reason: 'flag', ahead: null };
  const recorded = readings.manifestBase?.trim() ?? '';
  if (recorded !== '' && readings.remoteBranches.includes(recorded)) return { base: recorded, reason: 'manifest', ahead: null };
  let best: { readonly branch: string; readonly ahead: number } | null = null;
  for (const candidate of readings.candidates) {
    if (candidate.ahead === null) continue;
    const better =
      best === null ||
      candidate.ahead < best.ahead ||
      (candidate.ahead === best.ahead && candidate.branch === readings.defaultBranch && best.branch !== readings.defaultBranch) ||
      (candidate.ahead === best.ahead && best.branch !== readings.defaultBranch && candidate.branch < best.branch);
    if (better) best = { branch: candidate.branch, ahead: candidate.ahead };
  }
  return best === null
    ? { base: readings.defaultBranch, reason: 'unread', ahead: null }
    : { base: best.branch, reason: 'nearest', ahead: best.ahead };
};

/**
 * The line that names the chosen base, printed first so a person sees which
 * diff the checks came from.
 *
 * @param chosen - what {@link localChecksBase} answered.
 * @param candidates - the counts it compared, for the `nearest` reason.
 * @returns one `#` line.
 */
export const baseLine = (chosen: LocalChecksBase, candidates: readonly BaseCandidate[]): string => {
  const ref = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(chosen.base) ? chosen.base : `origin/${chosen.base}`;
  switch (chosen.reason) {
    case 'flag':
      return `# base: ${ref} (the --base argument)`;
    case 'manifest':
      return `# base: ${ref} (the desk manifest records it)`;
    case 'unread':
      return `# base: ${ref} (no candidate count was read; the default branch)`;
    case 'nearest': {
      const others = candidates
        .filter((candidate) => candidate.branch !== chosen.base)
        .map((candidate) => `${candidate.branch} ${candidate.ahead === null ? 'unread' : candidate.ahead}`);
      return `# base: ${ref} (nearest: HEAD is ${chosen.ahead} commit${chosen.ahead === 1 ? '' : 's'} past it${others.length === 0 ? '' : `; ${others.join(', ')}`})`;
    }
  }
};
