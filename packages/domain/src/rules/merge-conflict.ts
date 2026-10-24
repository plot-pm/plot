/**
 * The correction the loop hands an agent whose PR cannot be built because it
 * conflicts with the branch it targets.
 *
 * The host starts no CI run for a merge ref that conflicts, so a
 * desk that entered the CI wait anyway would wait the whole `Checks wait` for
 * a build that was never going to start. This rule's text is handed to the
 * agent instead, before the wait begins.
 */

/** The heading of the correction a conflicting PR writes. */
export const MERGE_CONFLICT_HEADING = '## The pull request conflicts with its base branch';

/**
 * The correction text for a slice whose PR reads `mergeable: conflicting`.
 *
 * @param branch - the branch the agent holds.
 * @returns the correction as Markdown, without a trailing separator.
 */
export const mergeConflictCorrection = (branch: string): string =>
  `${MERGE_CONFLICT_HEADING}\n\n` +
  `\`${branch}\`'s pull request conflicts with the branch it targets, so no build has started and none will until the conflict is resolved. Merge that branch into \`${branch}\`, resolve the conflict, and push.\n\n` +
  "Push the merge once your tree is resolved. This correction spends the slice's `Correction budget`, the same budget a failed build spends; a conflicting reading after that budget is spent ends the slice for a person instead of repeating this correction.";
