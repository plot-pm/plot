/**
 * Reads the PR references a plan's slice lines name.
 *
 * A claim line is a list item `- \`<branch>\` …` or a heading carrying
 * `(Branch: <branch>`. A reference on a claim line is `→ #N` or
 * `→ owner/repo#N`, or `PR: #N` or `PR: owner/repo#N`; a line may carry
 * several. Only the `## Slices`, `## Branches` and `## Waves` sections are
 * read, and fenced code is skipped. `plot-impl-status.sh` reads these claims
 * through `board/plot-slice-claims.mjs`; `deliverabilityOf` reads the
 * cross-repo ones through {@link crossRepoReferences}.
 */

/** A PR in another repository, as a slice line names it. */
export interface CrossRepoReference {
  /** The repository the PR lives in, `owner/repo`. */
  readonly repo: string;
  /** The PR's number in that repository. */
  readonly number: number;
}

/** A PR a slice line names. */
export interface SliceReference {
  /** `owner/repo` for a PR in another repository; `''` for one in this repository. */
  readonly repo: string;
  /** The PR's number. */
  readonly number: number;
}

/** One branch a plan claims, with one PR its claim lines name. */
export interface BranchClaim {
  /** The branch name. */
  readonly branch: string;
  /** The PR, or `null` where no claim line of the branch names one. */
  readonly reference: SliceReference | null;
}

const SECTION = /^## (Slices|Branches|Waves)\b/;
const FENCE = /^\s*(```|~~~)/;
const LIST_CLAIM = /^-\s+`([A-Za-z0-9_./-]+)`/;
const HEADING_CLAIM = /^#{3,}\s.*\(Branch:\s*([A-Za-z0-9_./-]+)/;
const CROSS_REPO_REFERENCE = /→ [A-Za-z0-9._-]+\/[A-Za-z0-9._-]+#[0-9]+|\bPR:\s*[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+#[0-9]+/;
const REFERENCE = /(?:→ |\bPR:\s*)(?:([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+))?#([0-9]+)/g;

/** The `Branch prefixes` default, without the trailing slash. */
export const DEFAULT_BRANCH_PREFIXES: readonly string[] = ['idea', 'feature', 'bug', 'docs', 'infra'];

/**
 * Reads a `Branch prefixes` config value.
 *
 * @param raw - the comma-separated value, for example `idea/, feature/, bug/`.
 * @returns the entries trimmed and without a trailing slash; empty entries are dropped.
 */
export const parseBranchPrefixes = (raw: string): readonly string[] =>
  raw
    .split(',')
    .map((prefix) => prefix.trim().replace(/\/$/, ''))
    .filter((prefix) => prefix !== '');

/** A line inside a slice section, with its zero-based index in the file. */
export interface SectionLine {
  readonly index: number;
  readonly line: string;
}

/**
 * The lines inside a slice section (`## Slices`, `## Branches` or `## Waves`), outside code fences.
 *
 * A fence delimiter line and a `## ` heading line are not returned. Lines under a
 * `###` heading stay in their `##` section.
 *
 * @param content - the whole plan file.
 * @returns the section lines in file order, each with its zero-based line index; empty where the file has no such section.
 */
export const sectionLines = (content: string): readonly SectionLine[] => {
  const found: SectionLine[] = [];
  let inSection = false;
  let inFence = false;
  content.split('\n').forEach((line, index) => {
    if (FENCE.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    if (line.startsWith('## ')) {
      inSection = SECTION.test(line);
      return;
    }
    if (inSection) found.push({ index, line });
  });
  return found;
};

/**
 * Every branch a plan's slice sections claim, one row per PR its claim lines name.
 *
 * A branch whose lines name several PRs — one per repository it is claimed in,
 * or several in one repository — gets one row per PR. A branch whose lines name
 * none gets one row with `reference: null`. A PR named twice for one branch is
 * one row. List-item claims are top-level `- ` items with a backticked branch
 * of `[A-Za-z0-9_./-]` characters, so an indented item or a backticked prose
 * term is not a claim. A list item is a claim only when its token starts with
 * `<prefix>/` for a prefix in `prefixes`, or when the line names a PR in another
 * repository (`→ owner/repo#N`), whose branch may use a prefix this repository
 * does not declare. A heading claim (`(Branch: <name>)`) needs no prefix.
 *
 * @param content - the whole plan file.
 * @param prefixes - the `Branch prefixes` entries, without the trailing slash; defaults to {@link DEFAULT_BRANCH_PREFIXES}.
 * @returns the rows, branches in the order they first appear and each branch's PRs in line order.
 */
export const branchClaims = (
  content: string,
  prefixes: readonly string[] = DEFAULT_BRANCH_PREFIXES,
): readonly BranchClaim[] => {
  const hasPrefix = (token: string): boolean => prefixes.some((prefix) => token.startsWith(`${prefix}/`));
  const found = new Map<string, Map<string, SliceReference>>();
  for (const { line } of sectionLines(content)) {
    const listed = LIST_CLAIM.exec(line)?.[1];
    const branch =
      listed !== undefined && (hasPrefix(listed) || CROSS_REPO_REFERENCE.test(line))
        ? listed
        : HEADING_CLAIM.exec(line)?.[1];
    if (branch === undefined) continue;
    const refs = found.get(branch) ?? new Map<string, SliceReference>();
    found.set(branch, refs);
    for (const match of line.matchAll(REFERENCE)) {
      const reference = { repo: match[1] ?? '', number: Number(match[2]) };
      refs.set(`${reference.repo}#${reference.number}`, reference);
    }
  }
  return [...found].flatMap(([branch, refs]): BranchClaim[] =>
    refs.size === 0 ? [{ branch, reference: null }] : [...refs.values()].map((reference) => ({ branch, reference })),
  );
};

/**
 * Every cross-repo reference each branch's claim lines name.
 *
 * A branch claimed in several repositories gets one reference per repository.
 * A same-repo `#N` is not a cross-repo reference and is left out.
 *
 * @param content - the whole plan file.
 * @returns every reference per branch name, in line order; a branch whose lines name none is absent.
 */
export const crossRepoReferences = (content: string): ReadonlyMap<string, readonly CrossRepoReference[]> => {
  const found = new Map<string, CrossRepoReference[]>();
  for (const { branch, reference } of branchClaims(content)) {
    if (reference === null || reference.repo === '') continue;
    found.set(branch, [...(found.get(branch) ?? []), reference]);
  }
  return found;
};
