import type { PlanPrFound, PlanPrRefusal } from './plan-pr.js';

/** What a reader of a Draft or Design plan has read about where the plan is. */
export interface PlanSourceReadings {
  /** The plan's slug. */
  slug: string;
  /** Whether the checkout holds the plan file. */
  inCheckout: boolean;
  /** The plan file on the default branch as fetched, or `''` where the default branch does not hold it. */
  onMainFile: string;
  /** The default branch's name, such as `main`. */
  main: string;
  /** What `planPrOf` answered: the plan PR, its own refusal, or `undefined` for no plan PR. */
  pr: PlanPrFound | PlanPrRefusal | undefined;
  /** The plan file's blob at the plan PR's head; `''` where it was not read at a head. */
  blob: string;
  /** The other open PRs that change the plan file, each with the plan file's blob at its head. */
  rivals: readonly { number: number; blob: string }[];
}

/** Where the plan is read from. */
export type PlanSource =
  /** The head of the open plan PR that carries it. */
  | { at: 'pr-head'; number: number; branch: string; sha: string; file: string }
  /** The checkout. */
  | { at: 'checkout' }
  /** The default branch as fetched. */
  | { at: 'default'; branch: string; file: string };

/** Why no source could be chosen. Each value names a different repair. */
export type PlanSourceRefusal =
  /** No source holds the plan. */
  | 'plan-not-found'
  /** Git does not hold the head of the plan PR. */
  | 'pr-head-unheld'
  /** The plan PR's head changes no plan file the slug names. */
  | 'pr-carries-no-plan'
  /** Two open PRs carry differing copies of the plan file. */
  | 'pr-copies-differ';

/** The answer of {@link planSourceOf}. */
export type PlanSourceAnswer =
  | { outcome: 'found'; source: PlanSource }
  | { outcome: 'refused'; reason: PlanSourceRefusal; detail: string };

/**
 * Chooses where a Draft or Design plan is read from, for a reader that writes
 * a commit onto the plan rather than merging its PR.
 *
 * The order:
 *
 * 1. A refusal of `planPrOf` passes through: `pr-head-unheld` or
 *    `pr-carries-no-plan`.
 * 2. A plan PR read at its own head is the source. An open rival whose copy of
 *    the plan file differs refuses `pr-copies-differ`; an identical copy does
 *    not. The head wins over the checkout, so a commit onto the plan lands on
 *    the branch that carries it.
 * 3. The checkout, where it holds the plan file.
 * 4. The default branch as fetched, where it holds the plan file.
 * 5. Otherwise `plan-not-found`.
 *
 * @param readings - where the plan was looked for, and what was found.
 * @returns the source, or a refusal naming its reason and a detail sentence.
 */
export const planSourceOf = (readings: PlanSourceReadings): PlanSourceAnswer => {
  const { slug, pr } = readings;
  const no = (reason: PlanSourceRefusal, detail: string): PlanSourceAnswer => ({ outcome: 'refused', reason, detail });
  if (pr !== undefined && pr.outcome === 'refused') {
    return pr.reason === 'pr-head-unheld'
      ? no('pr-head-unheld', `git does not hold the head of the plan PR for '${slug}' (#${pr.number}) — the next fleet scan fetches it`)
      : no('pr-carries-no-plan', `the plan PR for '${slug}' (#${pr.number}) does not change the plan file`);
  }
  if (pr !== undefined && pr.read.at === 'head') {
    const differing = readings.rivals.filter((rival) => rival.blob !== readings.blob);
    if (differing.length > 0) {
      const names = differing.map((rival) => `#${rival.number}`).join(', ');
      return no(
        'pr-copies-differ',
        `the plan file of '${slug}' differs between the plan PR (#${pr.number}) and ${names} — close the PR that should not carry the plan`,
      );
    }
    return { outcome: 'found', source: { at: 'pr-head', number: pr.number, branch: pr.branch, sha: pr.read.sha, file: pr.read.file } };
  }
  if (readings.inCheckout) return { outcome: 'found', source: { at: 'checkout' } };
  if (readings.onMainFile !== '') {
    return { outcome: 'found', source: { at: 'default', branch: readings.main, file: readings.onMainFile } };
  }
  return no(
    'plan-not-found',
    `no plan found for '${slug}' — looked in the checkout, on origin/${readings.main}, and on the heads of the open PRs`,
  );
};
