/**
 * Edits a plan file's `## Status` section: flips its `State:`/`Phase:` value,
 * and inserts a dated transition record.
 *
 * TWO PURE TEXT TRANSFORMS, over the file's lines, matching the awk
 * `plot-deliver.sh` ran before this slice byte for byte — including the bug
 * history behind each shape:
 *
 * - {@link flipStatusValue} changes the WORD on whichever `State:`/`Phase:`
 *   line names the FROM value, inside `## Status` only, and reports whether it
 *   changed anything.
 * - {@link insertStatusRecord} inserts one `- **Field:** record` line. It
 *   STOPS AT AN HTML COMMENT, because the plan template ends `## Status` with
 *   a block of `<!-- ... -->`-fenced `- **Started:**` lines that look like
 *   ordinary list items to a scan that does not watch for the comment —
 *   measured 2026-09-01, a record appended INSIDE that block was written but
 *   invisible to the parser. It fills an empty `- **Field:**` placeholder
 *   first, and otherwise appends after the last list item before the comment
 *   (or before the next `## ` heading, or at the section's end).
 * - {@link flipFrontMatterPhase} changes the value on a leading front-matter
 *   block's `status:` and/or `phase:` lines — whichever are present — to keep
 *   a plan carrying both formats from reading two different phases after a
 *   transition. It writes only a key the file already has; it never adds one
 *   (#2439).
 *
 * ALL RUN AGAINST THE WHOLE FILE AND RETURN A NEW ONE; none writes anything.
 * The caller decides whether the write took effect — by re-parsing the
 * result, never by trusting that a line changed — because a `## Status`
 * section split across front matter and a block is a shape where "the regex
 * matched" and "the parser will read this" can disagree (#924, #933).
 *
 * @concept plan-record-edit
 */

/** Whether a transform changed the file, and its new content. */
export interface EditResult {
  /** Whether anything changed. */
  readonly changed: boolean;
  /** The file's content after the transform; identical to the input when `changed` is false. */
  readonly content: string;
}

/** Whether a line is a `## Status` heading. */
const isStatusHeading = (line: string): boolean => /^##\s*Status\s*$/i.test(line);

/** Whether a line opens another `## ` section. */
const isOtherHeading = (line: string): boolean => /^##\s/.test(line) && !isStatusHeading(line);

/** Whether a line is, or opens, an HTML comment. */
const isComment = (line: string): boolean => line.includes('<!--');

/** Whether a line is a `- **State:**`/`- **Phase:**` field, case-insensitively. */
const isStateField = (line: string): boolean => /^[ \t]*[-*]?[ \t]*\**(state|phase)[:*]/i.test(line);

/** Whether a line is a bare, empty `- **Field:**` placeholder. */
const isEmptyPlaceholder = (line: string, field: string): boolean =>
  new RegExp(`^[ \\t]*[-*][ \\t]*\\*\\*${field}:\\*\\*[ \\t]*$`).test(line);

/** Whether a line is a `- ` / `* ` list item. */
const isListItem = (line: string): boolean => /^[ \t]*[-*][ \t]/.test(line);

/**
 * Flips the value on the `## Status` section's `State:`/`Phase:` line, where
 * it currently names `from` (case-insensitively), to `to`.
 *
 * Reads `State:` and `Phase:` alike — a plan written before the 2026-09-07
 * rename still delivers. Only the FIRST such line inside `## Status` is
 * touched; the section ends at the next `## ` heading.
 *
 * @param content - the whole plan file.
 * @param from - the value to look for, matched case-insensitively as a substring.
 * @param to - the replacement word.
 * @returns the edited content, and whether a line was changed.
 */
export const flipStatusValue = (content: string, from: string, to: string): EditResult => {
  const lines = content.split('\n');
  let inStatus = false;
  let done = false;
  let changed = false;
  const fromRe = new RegExp(from, 'i');

  const out = lines.map((line) => {
    if (/^##\s/.test(line)) {
      inStatus = isStatusHeading(line);
      return line;
    }
    if (inStatus && !done && isStateField(line) && fromRe.test(line)) {
      done = true;
      changed = true;
      return line.replace(fromRe, to);
    }
    return line;
  });

  return { changed, content: changed ? out.join('\n') : content };
};

/** Whether a line opens a leading front-matter block (the file's first line only). */
const isFrontMatterFence = (line: string): boolean => /^---[ \t]*$/.test(line);

/** Whether a line is a `status:` or `phase:` key in front matter. */
const frontMatterKeyOf = (line: string): 'status' | 'phase' | null => {
  if (/^status:/i.test(line)) return 'status';
  if (/^phase:/i.test(line)) return 'phase';
  return null;
};

/**
 * Flips the value on a leading front-matter block's `status:` and/or
 * `phase:` lines, where either currently names `from` (case-insensitively),
 * to `to`.
 *
 * Writes only a key the file already carries — a plan with a `## Status`
 * block and no front matter is untouched, matching "absent is not false".
 * Where both `status:` and `phase:` are present, only the FIRST occurrence of
 * each is touched, matching how {@link frontMatterPhaseOf} in `phase-gate.ts`
 * reads them back; a key naming a different value than `from` (already
 * flipped, or never matching) is left alone.
 *
 * @param content - the whole plan file.
 * @param from - the value to look for, matched case-insensitively as a substring.
 * @param to - the replacement word.
 * @returns the edited content, and whether a line was changed.
 */
export const flipFrontMatterPhase = (content: string, from: string, to: string): EditResult => {
  if (!isFrontMatterFence(content.split('\n')[0])) return { changed: false, content };

  const lines = content.split('\n');
  const fromRe = new RegExp(from, 'i');
  const done = { status: false, phase: false };
  let changed = false;
  let closed = false;

  const out = lines.map((line, i) => {
    if (i === 0) return line;
    if (closed) return line;
    if (isFrontMatterFence(line)) {
      closed = true;
      return line;
    }
    const key = frontMatterKeyOf(line);
    if (key && !done[key] && fromRe.test(line)) {
      done[key] = true;
      changed = true;
      return line.replace(fromRe, to);
    }
    return line;
  });

  return { changed, content: changed ? out.join('\n') : content };
};

/**
 * Inserts `- **{field}:** {record}` into the plan's `## Status` section.
 *
 * Fills an empty `- **{field}:**` placeholder first; otherwise inserts after
 * the last list item seen before the stop condition (another `## ` heading,
 * or an HTML comment — checked BEFORE the placeholder test, so a
 * commented-out placeholder line is never mistaken for the slot to fill).
 *
 * @param content - the whole plan file.
 * @param field - the record's field name, such as `Delivered` or `Released`.
 * @param record - the text to record, such as a date.
 * @returns the edited content with the line inserted; `changed: false` only
 *   where the file holds no `## Status` heading at all — the one case that
 *   leaves the file untouched, matching the shell's refusal to write a record
 *   with nowhere to put it.
 */
export const insertStatusRecord = (content: string, field: string, record: string): EditResult => {
  const lines = content.split('\n');
  const line = `- **${field}:** ${record}`;

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isStatusHeading(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return { changed: false, content };

  let insertAt = start;
  let slot = -1;
  for (let i = start + 1; i < lines.length; i++) {
    const current = lines[i];
    if (isOtherHeading(current)) break;
    if (isComment(current)) break;
    if (isEmptyPlaceholder(current, field)) {
      slot = i;
      break;
    }
    if (isListItem(current)) insertAt = i;
  }

  const out = [...lines];
  if (slot !== -1) {
    out[slot] = line;
  } else {
    out.splice(insertAt + 1, 0, line);
  }
  return { changed: true, content: out.join('\n') };
};

/** Whether a line is `## Status` or a heading that starts with it. */
const isStatusSection = (line: string): boolean => /^## Status/.test(line);

/** Whether a line is a `- **State:**`-style field, matched the way the undeliver write matches it. */
const isStateBullet = (line: string): boolean => /^[ \t]*[-*][ \t]*\**state[:*]/i.test(line);

/** Whether a line is a `- **Rejected:**` field. */
const isRejectedBullet = (line: string): boolean => /^[ \t]*[-*][ \t]*\**rejected[:*]/i.test(line);

/**
 * Writes the reversal of a delivery into a plan file: the front-matter keys,
 * the `## Status` state, and the `Rejected:` record.
 *
 * Front matter: the first `status:` and the first `phase:` key naming
 * `delivered` take `state`, quotes kept. Status section: the first state bullet
 * takes `state`; every `Rejected:` bullet is replaced by `record`. Where the
 * file holds no `Rejected:` bullet, `record` goes on a new line directly after
 * the state bullet.
 *
 * @param content - the whole plan file.
 * @param state - the state to write, capitalised as the estate spells it.
 * @param record - the text after `Rejected:`.
 * @returns the edited file, or `null` where `## Status` holds no state bullet.
 */
export const reverseDelivery = (content: string, state: string, record: string): string | null => {
  const lines = content.split('\n');
  const out: string[] = [];
  let inFront = isFrontMatterFence(lines[0]);
  const flipped = { status: false, phase: false };
  let inStatus = false;
  let stateSeen = false;
  let rejectedSeen = false;
  let stateAt = -1;

  lines.forEach((line, i) => {
    if (i === 0) {
      out.push(line);
      return;
    }
    if (inFront && isFrontMatterFence(line)) {
      inFront = false;
      out.push(line);
      return;
    }
    const key = inFront ? frontMatterKeyOf(line) : null;
    const at = line.toLowerCase().indexOf('delivered');
    if (key && !flipped[key] && at >= 0) {
      flipped[key] = true;
      out.push(line.slice(0, at) + state + line.slice(at + 'delivered'.length));
      return;
    }
    if (/^## /.test(line)) inStatus = isStatusSection(line);
    if (inStatus && !stateSeen && isStateBullet(line)) {
      stateSeen = true;
      stateAt = out.length;
      out.push(line.replace(/State:\*\*[ \t]*.*$/, `State:** ${state}`));
      return;
    }
    if (inStatus && isRejectedBullet(line)) {
      rejectedSeen = true;
      out.push(`- **Rejected:** ${record}`);
      return;
    }
    if (/^[ \t]*[-*][ \t]*\*\*Rejected:/i.test(line)) rejectedSeen = true;
    out.push(line);
  });

  if (!stateSeen) return null;
  if (!rejectedSeen) out.splice(stateAt + 1, 0, `- **Rejected:** ${record}`);
  return out.join('\n');
};
