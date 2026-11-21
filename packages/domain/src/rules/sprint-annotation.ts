import { memberLineIndex } from './sprint-membership.js';
import { withSprintAnnotation } from '../workflows/rendering.js';

/**
 * A sprint file's content, with the item line naming `slug` annotated with
 * the plan's PR number and first branch.
 *
 * `/plot-sprint status` reads `pr` and `branch` back out of the HTML comment
 * this writes; `/plot-approve` is the only writer. The comment carries
 * no `status:` field.
 *
 * The item line is found by {@link memberLineIndex}, never by a sprint file's
 * name or a bare substring search: a plan slug can also appear on a
 * `### Deferred` or `### Scope Changes` line, which is never the member line
 * meant here. The line is edited by {@link withSprintAnnotation}, which leaves
 * the checkbox as it is.
 *
 * @param content - the sprint file's current content.
 * @param slug - the plan's slug, matched as the literal `[slug]`.
 * @param pr - the PR number to record, or null where no plan PR was read:
 *   that writes `pr: none` on a line with no `pr` key or with `pr: #0`, and
 *   keeps a key that names a real PR.
 * @param branch - the first branch the plan names, or `''` to leave the
 *   `branch` field untouched.
 * @returns the file's content with the matching line annotated, and whether
 *   a line was found and, if found, changed.
 */
export const annotateSprintItem = (
  content: string,
  slug: string,
  pr: number | null,
  branch: string,
): { content: string; outcome: 'updated' | 'already' | 'missing' } => {
  if (memberLineIndex(content, slug) === -1) return { content, outcome: 'missing' };
  const annotated = withSprintAnnotation(content, slug, false, pr ?? 'none', branch);
  return annotated.wrote
    ? { content: annotated.text, outcome: 'updated' }
    : { content, outcome: 'already' };
};
