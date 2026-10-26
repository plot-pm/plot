/**
 * Reads the cross-repo PR references a plan's slice lines name.
 *
 * A reference is `→ owner/repo#N` on a line that claims a branch: a list item
 * `- \`<branch>\` …`, or a heading carrying `(Branch: <branch>`. Only the
 * `## Slices`, `## Branches` and `## Waves` sections are read, and fenced code
 * is skipped. A bare `→ #N` names no repository and is not a cross-repo
 * reference.
 */

/** A PR in another repository, as a slice line names it. */
export interface CrossRepoReference {
  /** The repository the PR lives in, `owner/repo`. */
  readonly repo: string;
  /** The PR's number in that repository. */
  readonly number: number;
}

const SECTION = /^## (Slices|Branches|Waves)\b/;
const FENCE = /^\s*(```|~~~)/;
const LIST_CLAIM = /^\s*-\s+`([^`]+)`/;
const HEADING_CLAIM = /^#{3,}\s.*\(Branch:\s*([A-Za-z0-9_./-]+)/;
const REFERENCE = /→ ([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)#([0-9]+)/;

/**
 * The first cross-repo reference each branch's claim lines name.
 *
 * Where a branch is claimed on several lines, the first line that carries a
 * reference wins.
 *
 * @param content - the whole plan file.
 * @returns the reference per branch name; a branch whose lines name none is absent.
 */
export const crossRepoReferences = (content: string): ReadonlyMap<string, CrossRepoReference> => {
  const found = new Map<string, CrossRepoReference>();
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
    const ref = REFERENCE.exec(line);
    if (branch === undefined || ref === null || found.has(branch)) continue;
    found.set(branch, { repo: ref[1] as string, number: Number(ref[2]) });
  }
  return found;
};
