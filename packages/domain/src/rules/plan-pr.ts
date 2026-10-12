/**
 * What the host answered for the PR of `idea/<slug>`.
 */
export interface NamedPr {
  /** The PR's number. */
  number: number;
  /** The state as the host reports it. */
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  /** Whether it is still a draft. */
  draft: boolean;
  /** The head commit the host reported, where it named one. */
  headSha?: string;
}

/**
 * An open PR the host listed, with the files its head changes.
 */
export interface OpenPr {
  /** The PR's number. */
  number: number;
  /** The branch the PR belongs to. */
  head: string;
  /** Whether it is still a draft. */
  draft: boolean;
  /** The head commit the host reported. */
  headSha: string;
  /**
   * The paths the head changes against its merge base with the default
   * branch: what merging the PR would bring, not how it differs from the
   * default branch's tip.
   */
  changed: readonly string[];
}

/**
 * The commit on the default branch's first-parent line that added the plan
 * file.
 */
export interface PlanAddition {
  /** The commit's sha; `''` where no commit on that line added the file. */
  sha: string;
  /** The commit's second parent; `''` for a commit that is not a merge. */
  secondParent: string;
}

/** A merged PR the host listed. */
export interface MergedPr {
  /** The PR's number. */
  number: number;
  /** The head commit the host reported for it; `''` where it named none. */
  headSha: string;
}

/** What the host answered when asked for one merged PR by number. */
export interface MergeConfirmation {
  /** The state as the host reports it. */
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  /** The merge commit the host names; `''` where it names none. */
  mergeCommit: string;
}

/**
 * What has been read about the plan PR so far. An absent field has not been
 * read; {@link planPrOf} names the next one it needs.
 */
export interface PlanPrReadings {
  /** The plan's slug. */
  slug: string;
  /** The plan directory, as the configuration spells it, such as `docs/plans/`. */
  planDir: string;
  /** Whether the default branch, as fetched, holds the plan file. */
  onMain: boolean;
  /** The PR of `idea/<slug>`; null where the host holds none. */
  named?: NamedPr | null;
  /** The open PRs, each with the paths its head changes. */
  open?: readonly OpenPr[];
  /** The commit that brought the plan file onto the default branch. */
  addition?: PlanAddition;
  /** The merged PRs, newest first. */
  merged?: readonly MergedPr[];
  /** The host's answer for the merged PR the listing matched; null where it holds none. */
  confirmed?: MergeConfirmation | null;
}

/** The plan PR, as approval reads it. */
export interface PlanPrFound {
  outcome: 'found';
  /** The PR's number. */
  number: number;
  /** The state as the host reports it. */
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  /** Whether it is still a draft. */
  draft: boolean;
  /** The head commit a merge is pinned to; `''` where the host named none. */
  headSha: string;
  /** The PR's branch; `''` where the answer did not name it. */
  branch: string;
  /** The other open PRs that also change the plan file. */
  rivals: readonly number[];
  /** The other plan files the PR changes, which its merge lands unapproved. */
  carried: readonly string[];
}

/** The reading {@link planPrOf} needs next. */
export type PlanPrAsk =
  | { outcome: 'ask'; ask: 'named' | 'open' | 'addition' | 'merged' }
  | { outcome: 'ask'; ask: 'confirm'; number: number };

/** The answer of {@link planPrOf}. */
export type PlanPrAnswer = PlanPrFound | PlanPrAsk | { outcome: 'none' };

/** One open PR that changes the plan a slug names. */
export interface PlanPrMatch {
  /** The PR, as the caller listed it. */
  pr: OpenPr;
  /** The plan file the slug names. */
  file: string;
  /** Every other plan file the PR changes, in path order. */
  carried: readonly string[];
}

/**
 * The slug a plan file's name carries: the name without `.md` and without a
 * leading `YYYY-MM-DD-` date.
 *
 * @param file - a path, relative to the repository root.
 * @returns the slug.
 */
export const planSlugOf = (file: string): string =>
  file
    .slice(file.lastIndexOf('/') + 1)
    .replace(/\.md$/, '')
    .replace(/^\d{4}-\d{2}-\d{2}-/, '');

/**
 * Whether a plan file's name is the one a slug names: `<slug>.md`, or a
 * date-prefixed `YYYY-MM-DD-<slug>.md`.
 *
 * A bare suffix match is not enough: slug `declared` would otherwise name
 * `2026-10-12-the-phases-are-declared.md`.
 *
 * @param slug - the plan's slug.
 * @param file - a path, relative to the repository root.
 * @returns true where the file's name is the slug's.
 */
export const namesPlan = (slug: string, file: string): boolean => planSlugOf(file) === slug;

/**
 * Whether a path is a plan file: a `.md` file directly in the plan directory,
 * not an index entry beneath it.
 *
 * @param planDir - the plan directory, such as `docs/plans/`.
 * @param file - a path, relative to the repository root.
 * @returns true for a plan file.
 */
export const isPlanFile = (planDir: string, file: string): boolean => {
  const dir = planDir.endsWith('/') ? planDir : `${planDir}/`;
  return file.startsWith(dir) && file.endsWith('.md') && !file.slice(dir.length).includes('/');
};

/**
 * The open PRs that change the plan a slug names, against their merge base
 * with the default branch.
 *
 * The branch name plays no part, so a batch PR on `idea/batch-<first-slug>`
 * carries every plan it adds. A PR that only branched after the default
 * branch changed a plan does not change that plan.
 *
 * @param slug - the plan's slug.
 * @param planDir - the plan directory.
 * @param open - the open PRs, each with the paths its head changes.
 * @returns one match per PR that changes the plan file, in the order given.
 */
export const planPrsCarrying = (
  slug: string,
  planDir: string,
  open: readonly OpenPr[],
): PlanPrMatch[] =>
  open.flatMap((pr) => {
    const plans = pr.changed.filter((path) => isPlanFile(planDir, path)).sort();
    const file = plans.find((path) => namesPlan(slug, path));
    return file === undefined ? [] : [{ pr, file, carried: plans.filter((path) => path !== file) }];
  });

/**
 * Finds the plan PR: the PR that adds or changes the plan file.
 *
 * The order is the reading order, and the answer names the next reading where
 * it needs one:
 *
 * 1. The PR of `idea/<slug>`, the single-plan shape, wins where the host holds
 *    one, in any state.
 * 2. Where the default branch does not hold the plan file, the open PRs that
 *    change it against their merge base: the first is the plan PR, the others
 *    are rivals.
 * 3. Where the default branch holds it, an open PR is never the plan PR. The
 *    plan PR is the merged PR whose head is the second parent of the merge
 *    that added the file, and the host confirms it MERGED at that merge
 *    commit. A file that arrived by squash or by a direct push has no such
 *    merge.
 *
 * @param readings - what has been read so far.
 * @returns the plan PR, the reading needed next, or `none`.
 */
export const planPrOf = (readings: PlanPrReadings): PlanPrAnswer => {
  const { named } = readings;
  if (named === undefined) return { outcome: 'ask', ask: 'named' };
  if (named !== null) {
    return {
      outcome: 'found',
      number: named.number,
      state: named.state,
      draft: named.draft,
      headSha: named.headSha ?? '',
      branch: '',
      rivals: [],
      carried: [],
    };
  }

  if (!readings.onMain) {
    if (readings.open === undefined) return { outcome: 'ask', ask: 'open' };
    const [first, ...others] = planPrsCarrying(readings.slug, readings.planDir, readings.open);
    if (first === undefined) return { outcome: 'none' };
    return {
      outcome: 'found',
      number: first.pr.number,
      state: 'OPEN',
      draft: first.pr.draft,
      headSha: first.pr.headSha,
      branch: first.pr.head,
      rivals: others.map((match) => match.pr.number),
      carried: first.carried,
    };
  }

  const { addition } = readings;
  if (addition === undefined) return { outcome: 'ask', ask: 'addition' };
  if (addition.sha === '' || addition.secondParent === '') return { outcome: 'none' };
  if (readings.merged === undefined) return { outcome: 'ask', ask: 'merged' };
  const candidate = readings.merged.find((pr) => pr.headSha === addition.secondParent);
  if (candidate === undefined) return { outcome: 'none' };
  const { confirmed } = readings;
  if (confirmed === undefined) return { outcome: 'ask', ask: 'confirm', number: candidate.number };
  if (confirmed === null || confirmed.state !== 'MERGED') return { outcome: 'none' };
  if (confirmed.mergeCommit !== '' && confirmed.mergeCommit !== addition.sha) return { outcome: 'none' };
  return {
    outcome: 'found',
    number: candidate.number,
    state: 'MERGED',
    draft: false,
    headSha: candidate.headSha,
    branch: '',
    rivals: [],
    carried: [],
  };
};
