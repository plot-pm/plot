/**
 * Which branch a change is read against for the local checks.
 *
 * @concept local-checks-base
 */

/** What the base is resolved from. */
export interface LocalChecksBaseReadings {
  /** The `--base` argument, or `null` when none was given. */
  readonly flag: string | null;
  /** The `Sprint:` slug of the plan that names the current branch, or `null` when no plan does or it names none. */
  readonly sprint: string | null;
  /** The branches `origin` holds, without the `origin/` prefix. */
  readonly remoteBranches: readonly string[];
}

/**
 * The base branch for the changed-file reading, in this order: the `--base`
 * argument; `sprint/<slug>` when the branch's plan names a sprint and `origin`
 * holds that branch; the default branch. Asks no host.
 *
 * @param readings - the argument, the plan's sprint and the branches `origin` holds.
 * @returns the branch name, or `undefined` for the default branch.
 */
export const localChecksBase = (readings: LocalChecksBaseReadings): string | undefined => {
  const flag = readings.flag?.trim() ?? '';
  if (flag !== '') return flag;
  const slug = readings.sprint?.trim() ?? '';
  if (slug === '') return undefined;
  const branch = `sprint/${slug}`;
  return readings.remoteBranches.includes(branch) ? branch : undefined;
};
