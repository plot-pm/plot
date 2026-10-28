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
const REFERENCE = /(?:→ |\bPR:\s*)(?:([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+))?#([0-9]+)/g;

/**
 * Every branch a plan's slice sections claim, one row per PR its claim lines name.
 *
 * A branch whose lines name several PRs — one per repository it is claimed in,
 * or several in one repository — gets one row per PR. A branch whose lines name
 * none gets one row with `reference: null`. A PR named twice for one branch is
 * one row. List-item claims are top-level `- ` items with a backticked branch
 * of `[A-Za-z0-9_./-]` characters, so an indented item or a backticked prose
 * term is not a claim.
 *
 * @param content - the whole plan file.
 * @returns the rows, branches in the order they first appear and each branch's PRs in line order.
 */
export const branchClaims = (content: string): readonly BranchClaim[] => {
  const found = new Map<string, Map<string, SliceReference>>();
  let inSection = false;
  let inFence = false;
  for (const line of content.split('\n')) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line.startsWith('## ')) {
      inSection = SECTION.test(line);
      continue;
    }
    if (!inSection) continue;
    const branch = LIST_CLAIM.exec(line)?.[1] ?? HEADING_CLAIM.exec(line)?.[1];
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
