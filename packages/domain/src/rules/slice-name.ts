/**
 * One branch a slice names, as the plan parser reports it.
 *
 * Structurally typed so a caller holding a richer branch record — the parser's
 * `deferred_reason`, `claimed` and `waits_on` — passes it unchanged.
 */
export interface NamedBranchLine {
  /** The branch name. */
  branch: string;
  /** Whether the plan gave this branch up. */
  deferred?: boolean;
}

/**
 * One slice, as the plan parser reports it.
 *
 * The parser's key is `waves[]`; a slice holds exactly one branch by the
 * design spec, and a plan that names several under one heading is the shape
 * `/plot-reslice` repairs. Both are read here, because the question is about
 * the heading rather than about how many branches sit under it.
 */
export interface NamedSlice {
  /** The `###` heading's text, or `''` where the branch sits under none. */
  name: string;
  /** The branches the heading covers, in plan order. */
  branches: readonly NamedBranchLine[];
}

/**
 * The branches a plan names under no slice heading, in plan order.
 *
 * A branch counts when its slice's name is empty or whitespace. A deferred
 * branch counts too: deferring gives a branch up without removing it, and a
 * plan can return it to the queue, so its heading is still owed.
 *
 * A plan that names no branch at all answers an empty list. Emptiness is
 * therefore not evidence that a plan was read — a caller that cannot parse a
 * plan must refuse on the parse, not on this answer.
 *
 * @param slices - the plan's slices, as the parser reported them.
 * @returns every branch sitting under no heading, in plan order, with
 *   duplicates preserved as the plan names them.
 */
export const unnamedBranches = (slices: readonly NamedSlice[]): readonly string[] =>
  slices
    .filter((slice) => (slice.name ?? '').trim() === '')
    .flatMap((slice) => slice.branches.map((line) => line.branch))
    .filter((branch) => branch.trim() !== '');

/**
 * The repair for one branch sitting under no slice heading.
 *
 * @param branch - the branch the plan names.
 * @returns the sentence naming the heading to add.
 */
export const unnamedBranchRepair = (branch: string): string =>
  `add '### <name> (Branch: ${branch})' above it under '## Slices'`;

/**
 * Why an unnamed branch stops the work that reads it, in one sentence.
 *
 * Shared by every caller so the approval, the queue hold and any later gate
 * name the same branches and the same repair.
 *
 * @param slug - the plan the branches belong to.
 * @param branches - the branches sitting under no heading, in plan order.
 * @returns the refusal's detail, naming each branch and its repair.
 */
export const unnamedBranchDetail = (slug: string, branches: readonly string[]): string =>
  `plan '${slug}' names ${branches.length === 1 ? 'a branch' : `${branches.length} branches`} under no slice heading: ${branches
    .map((branch) => `'${branch}'`)
    .join(', ')}. The heading is the slice's name on the board and its PR title, so it must be on the default branch before any agent starts. For each: ${branches
    .map((branch) => unnamedBranchRepair(branch))
    .join('; ')}.`;
