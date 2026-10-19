/**
 * The correction the loop hands an agent whose PR cannot be built because it
 * conflicts with the default branch.
 *
 * GitHub starts no `pull_request` run for a merge ref that conflicts, so a
 * desk that entered the CI wait anyway would wait the whole `Checks wait` for
 * a build that was never going to start. This rule's text is handed to the
 * agent instead, before the wait begins.
 */

/** The heading of the correction a conflicting PR writes. */
export const MERGE_CONFLICT_HEADING = '## The pull request conflicts with the default branch';

/**
 * The correction text for a slice whose PR reads `mergeable: conflicting`.
 *
 * Quotes CLAUDE.md's board-artifact procedure rather than inventing new
 * wording, since the restore-from-merge-base step is already settled there.
 *
 * @param branch - the branch the agent holds.
 * @returns the correction as Markdown, without a trailing separator.
 */
export const mergeConflictCorrection = (branch: string): string =>
  `${MERGE_CONFLICT_HEADING}\n\n` +
  `GitHub reports \`${branch}\`'s pull request as conflicting with the default branch, so no build has started and none will until the conflict is resolved. Merge the default branch into \`${branch}\` and push.\n\n` +
  'If the merge conflicts inside a generated board bundle (such as `board-server.mjs`), do not read that diff and do not commit a rebuild: it is generated output marked `-merge` in `.gitattributes`. Restore every conflicting generated path from the merge base against `origin/main` — the command the gate\'s own refusal prints — rather than taking either side. Run `pnpm build:board` only to test the result locally, then restore the generated paths again before you push. Never phrase the resolution as "take ours": *ours* inverts between `git merge` and `git rebase`.\n\n' +
  'Push the merge once your tree is resolved. A second conflicting reading after this correction was already applied ends the slice for a person instead of repeating this correction.';
