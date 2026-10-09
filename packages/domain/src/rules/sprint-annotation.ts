/**
 * A sprint file's content, with the item line naming `slug` annotated with
 * the plan's PR number and first branch.
 *
 * `/plot-sprint status` reads `pr` and `branch` back out of the HTML comment
 * this writes; `/plot-approve` is the only writer. `status:` is never
 * written — `a-withdrawn-item-is-not-open` found it dead in both directions,
 * so the field is gone and must not be reintroduced here.
 *
 * The item line is found by the literal substring `[<slug>]`, never by a
 * sprint file's name: a sprint's filename carries an ISO week prefix in
 * whatever case the week was produced, and the `Sprint:` field a plan carries
 * is only the slug.
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
  const needle = `[${slug}]`;
  const lines = content.split('\n');
  let found = false;
  let changed = false;

  const next = lines.map((line) => {
    if (!line.includes(needle)) return line;
    found = true;

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

  if (!found) return { content, outcome: 'missing' };
  if (!changed) return { content, outcome: 'already' };
  return { content: next.join('\n'), outcome: 'updated' };
};
