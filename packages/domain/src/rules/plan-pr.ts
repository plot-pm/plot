/**
 * One plan file at one revision, as a tree listing reports it.
 */
export interface PlanBlob {
  /** The file's path, relative to the repository root. */
  path: string;
  /** The blob's object name; equal shas mean equal content. */
  sha: string;
}

/**
 * An open PR the host listed, with the plan files its head holds.
 */
export interface PlanPrCandidate {
  /** The PR's number. */
  number: number;
  /** The branch the PR belongs to. */
  head: string;
  /** Whether it is still a draft. */
  draft: boolean;
  /** The head commit the host reported; `''` where it named none. */
  headSha: string;
  /** The plan files at the PR's head. */
  plans: readonly PlanBlob[];
}

/**
 * One PR that adds or changes the plan a slug names.
 */
export interface PlanPrMatch {
  /** The PR, as the caller listed it. */
  pr: PlanPrCandidate;
  /** The plan file the slug names, at the PR's head. */
  file: string;
  /** Every other plan file the PR adds or changes, in path order. */
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
 * The plan files a head adds or changes against the default branch.
 *
 * @param head - the plan files at the PR's head.
 * @param main - the plan files on the default branch.
 * @returns the paths whose blob differs from the default branch's, or that the
 *   default branch does not hold, in path order.
 */
export const plansChanged = (head: readonly PlanBlob[], main: readonly PlanBlob[]): string[] => {
  const onMain = new Map(main.map((blob) => [blob.path, blob.sha]));
  return head
    .filter((blob) => onMain.get(blob.path) !== blob.sha)
    .map((blob) => blob.path)
    .sort();
};

/**
 * The open PRs that add or change the plan a slug names.
 *
 * A PR carries a plan when its head holds the plan's file with content the
 * default branch does not hold. The branch name plays no part, so a batch PR
 * on `idea/batch-<first-slug>` carries every plan it adds.
 *
 * @param slug - the plan's slug.
 * @param main - the plan files on the default branch.
 * @param candidates - the open PRs, each with the plan files at its head.
 * @returns one match per carrying PR, in the order given; empty where none
 *   carries the plan. More than one match is ambiguous, and the caller decides
 *   what that means.
 */
export const planPrsCarrying = (
  slug: string,
  main: readonly PlanBlob[],
  candidates: readonly PlanPrCandidate[],
): PlanPrMatch[] =>
  candidates.flatMap((pr) => {
    const changed = plansChanged(pr.plans, main);
    const file = changed.find((path) => namesPlan(slug, path));
    return file === undefined
      ? []
      : [{ pr, file, carried: changed.filter((path) => path !== file) }];
  });

/**
 * The PR number a merge commit's subject names.
 *
 * Both hosts' merge subjects carry `#<number>`: `Merge pull request #N from
 * <owner>/<branch>` and `Merged in <branch> (pull request #N)`. The number is
 * a candidate only; the host confirms it.
 *
 * @param subject - the merge commit's subject line.
 * @returns the first `#<number>` in the subject, or null where it names none.
 */
export const prNumberInSubject = (subject: string): number | null => {
  const hit = /#(\d+)\b/.exec(subject);
  return hit === null ? null : Number(hit[1]);
};
