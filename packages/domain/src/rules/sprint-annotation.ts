import { memberLineIndex } from './sprint-membership.js';

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
 * meant here.
 *
 * The comment's closing `-->` is split off before any field is touched, and
 * every field is written only in the part before it — a value pattern that
 * has to stop short of `-->` cannot exclude exactly `-` without also breaking
 * branch names that contain one.
 *
 * @param content - the sprint file's current content.
 * @param slug - the plan's slug, matched as the literal `[slug]`.
 * @param pr - the PR number to record.
 * @param branch - the first branch the plan names, or `''` to leave the
 *   `branch` field untouched.
 * @returns the file's content with the matching line annotated, and whether
 *   a line was found and, if found, changed.
 */
export const annotateSprintItem = (
  content: string,
  slug: string,
  pr: number,
  branch: string,
): { content: string; outcome: 'updated' | 'already' | 'missing' } => {
  const index = memberLineIndex(content, slug);
  if (index === -1) return { content, outcome: 'missing' };

  const lines = content.split('\n');
  let changed = false;

  const next = lines.map((line, i) => {
    if (i !== index) return line;

    const commentOpen = line.indexOf('<!--');
    if (commentOpen === -1) {
      changed = true;
      const branchPart = branch !== '' ? `, branch: ${branch}` : '';
      return `${line} <!-- pr: #${pr}${branchPart} -->`;
    }

    const closeMatch = /[ \t]*-->[ \t]*$/.exec(line);
    const tail = closeMatch ? line.slice(closeMatch.index) : '';
    let head = closeMatch ? line.slice(0, closeMatch.index) : line;

    const prPattern = /pr:[ \t]*#?[0-9a-zA-Z]+/;
    if (prPattern.test(head)) {
      head = head.replace(prPattern, `pr: #${pr}`);
    } else {
      head = head.replace('<!--', `<!-- pr: #${pr},`);
    }

    if (branch !== '') {
      const branchPattern = /branch:[ \t]*[^,]*/;
      if (branchPattern.test(head)) {
        head = head.replace(branchPattern, `branch: ${branch}`);
      } else {
        head = `${head}, branch: ${branch}`;
      }
    }

    const rebuilt = head + (tail !== '' ? tail : ' -->');
    if (rebuilt !== line) changed = true;
    return rebuilt;
  });

  if (!changed) return { content, outcome: 'already' };
  return { content: next.join('\n'), outcome: 'updated' };
};
