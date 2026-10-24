/**
 * Appends a slice's PR number to its own bulleted line in a plan file.
 *
 * ONE PURE TEXT TRANSFORM over the file's lines, matching the line that
 * carries the branch name inside backticks — `- \`<branch>\` — <description>`
 * — under `## Slices` or `## Branches`. Appends ` → #<number>` to the end of
 * that line, or reports why it could not: no such line exists, or the line
 * already carries a PR annotation (`→ #N` or `→ owner/repo#N`), which would
 * otherwise double up into `→ #N → #M` — a shape `plot-plan-meta.sh`'s
 * `malformed_prs` flags only after the fact.
 *
 * @concept slice-pr-annotation
 */

/** Why {@link annotateSlicePr} could not append the PR number. */
export type SlicePrAnnotationRefusal =
  /** No line in the file carries the branch name in backticks. */
  | 'branch-unaddressed'
  /** The branch's line already carries a `→ #N` or `→ owner/repo#N` annotation. */
  | 'already-annotated';

/** The result of attempting to annotate a slice's line with its PR number. */
export type SlicePrAnnotationResult =
  | { readonly outcome: 'annotated'; readonly content: string }
  | { readonly outcome: 'refused'; readonly reason: SlicePrAnnotationRefusal };

const PR_ANNOTATION = /→\s*([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)?#[0-9]+/;

/**
 * Appends ` → #{pr}` to the plan line that names `branch` in backticks.
 *
 * @param content - the whole plan file.
 * @param branch - the branch whose bulleted line should carry the PR number.
 * @param pr - the PR number to record, as a string of digits.
 * @returns the edited content, or which refusal applies.
 */
export const annotateSlicePr = (content: string, branch: string, pr: string): SlicePrAnnotationResult => {
  const lines = content.split('\n');
  const needle = `\`${branch}\``;
  const hit = lines.findIndex((line) => line.includes(needle));
  if (hit === -1) return { outcome: 'refused', reason: 'branch-unaddressed' };
  if (PR_ANNOTATION.test(lines[hit])) return { outcome: 'refused', reason: 'already-annotated' };

  const out = [...lines];
  out[hit] = out[hit].replace(/\s*$/, '') + ` → #${pr}`;
  return { outcome: 'annotated', content: out.join('\n') };
};
