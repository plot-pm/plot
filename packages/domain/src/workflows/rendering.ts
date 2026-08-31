import type { Decision, Write } from './decision.js';

/**
 * The encoding half of a decision: how one `Write` reaches a plan file, and
 * which paths it touches.
 *
 * A `Write` carries values and no formatting — `{ field: 'Approved', value }`
 * rather than a rendered `- **Approved:** ...` line — so that a decision stays
 * comparable across the two spellings a plan file allows. Something still has
 * to choose an encoding, and this is where that choice lives: pure, so every
 * branch is reachable from a plain call, and separate from the performer, so
 * the performer's only remaining job is the disk.
 */

/**
 * Renders one `## Status` record as the line a plan file carries.
 *
 * @param field - the record's field name, as the file spells it.
 * @param value - the record's value, without its prefix.
 * @returns the full list line, without a trailing newline.
 */
export const renderRecordLine = (field: string, value: string): string =>
  `- **${field}:** ${value}`;

/** Matches a `## Status` heading, tolerating the whitespace a file may carry. */
const STATUS_HEADING = /^##[ \t]*[Ss]tatus[ \t]*$/;

/** Matches any `## ` heading, which is where the Status section ends. */
const ANY_HEADING = /^##[ \t]/;

/** Matches any list item inside the section. */
const LIST_ITEM = /^[ \t]*[-*][ \t]/;

/**
 * Builds the matcher for a field's empty placeholder.
 *
 * The template ships `- **Delivered:** <!-- YYYY-MM-DD -->` and a bare
 * `- **Approved:**` both occur, so both count as a slot to fill. Anything with
 * a real value after the marker does not.
 *
 * @param field - the record's field name.
 * @returns a matcher for that field's unfilled line.
 */
const placeholderFor = (field: string): RegExp =>
  new RegExp(`^[ \\t]*[-*][ \\t]*\\*\\*${field}:\\*\\*[ \\t]*(<!--.*)?$`);

/**
 * Writes one `## Status` record into a plan's text.
 *
 * Fills the field's empty placeholder where the file ships one, and otherwise
 * appends after the section's last list item. That order is not a preference:
 * `plot-dispatch.sh:423` appended below `- **Delivered:**` instead of filling
 * the placeholder until 2026-08-17, and the parser still read it — so nothing
 * failed loudly while two plans listed a start after a delivery.
 *
 * A file with no `## Status` heading is left untouched and reported as such.
 * The parser reads these records out of that section, so a line written below
 * it parses as nothing at all — a record that exists on disk and not in the
 * data is worse than no record, because it looks written.
 *
 * @param text - the plan file's contents.
 * @param field - the record's field name, as the file spells it.
 * @param value - the record's value, without its prefix.
 * @returns the new contents, and whether a `## Status` section was found.
 */
export const withRecord = (
  text: string,
  field: string,
  value: string,
): { text: string; wrote: boolean } => {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => STATUS_HEADING.test(line));
  if (start === -1) return { text, wrote: false };

  const placeholder = placeholderFor(field);
  let slot = -1;
  let insert = start;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (ANY_HEADING.test(line)) break;
    if (placeholder.test(line)) {
      slot = i;
      break;
    }
    if (LIST_ITEM.test(line)) insert = i;
  }

  const rendered = renderRecordLine(field, value);
  const next = [...lines];
  if (slot === -1) next.splice(insert + 1, 0, rendered);
  else next[slot] = rendered;
  return { text: next.join('\n'), wrote: true };
};

/** Matches a `**Phase:**` line, in any of the emphases a plan file uses. */
const PHASE_LINE = /^[ \t]*[-*]?[ \t]*\**[Pp]hase[:*]/;

/**
 * Sets a plan's phase, inside its `## Status` section only.
 *
 * Scoped to that section because a plan that QUOTES a status block in its prose
 * — this repository has several, documenting the format — would otherwise have
 * its illustration rewritten too, silently corrupting the very files that
 * specify the format.
 *
 * @param text - the plan file's contents.
 * @param phase - the phase to write, capitalised as the file spells it.
 * @returns the new contents, and whether a phase line was found to change.
 */
export const withPhase = (text: string, phase: string): { text: string; wrote: boolean } => {
  const lines = text.split('\n');
  let inStatus = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (ANY_HEADING.test(line)) {
      inStatus = STATUS_HEADING.test(line);
      continue;
    }
    if (!inStatus || !PHASE_LINE.test(line)) continue;
    const next = [...lines];
    next[i] = line.replace(/(\*\*[Pp]hase:\*\*[ \t]*)\S+/, `$1${phase}`);
    if (next[i] === line) return { text, wrote: false };
    return { text: next.join('\n'), wrote: true };
  }
  return { text, wrote: false };
};

/**
 * Removes one branch's `.plot/hold` entry, leaving every other entry.
 *
 * String equality on the first field, exactly as `plot-phase-gate.sh:121`
 * reads it. A pattern here would release gates the plan never named, and
 * approving one piece of work must not open someone else's.
 *
 * @param text - the hold file's contents.
 * @param branch - the branch whose entry goes.
 * @returns the new contents, and whether an entry was removed.
 */
export const withoutHold = (
  text: string,
  branch: string,
): { text: string; wrote: boolean } => {
  const lines = text.split('\n');
  const kept = lines.filter((line) => line.split(/[ \t]/)[0] !== branch);
  if (kept.length === lines.length) return { text, wrote: false };
  return { text: kept.join('\n'), wrote: true };
};

/**
 * Rewrites one sprint item's `<!-- pr:, status:, branch: -->` annotation.
 *
 * `/plot-sprint` READS these keys and the lifecycle commands write them, so a
 * transition that skips this makes `/plot-sprint status` wrong rather than
 * merely incomplete. An item with no annotation gains one; an item with one
 * keeps every key this write does not name.
 *
 * @param text - the sprint file's contents.
 * @param plan - the plan slug whose item line carries the annotation.
 * @param status - the status to record.
 * @param pr - the PR number to record, or null to leave any existing one.
 * @param branch - the branch to record, or `''` to leave any existing one.
 * @returns the new contents, and whether the file changed.
 */
export const withSprintAnnotation = (
  text: string,
  plan: string,
  status: string,
  pr: number | null,
  branch: string,
): { text: string; wrote: boolean } => {
  const marker = `[${plan}]`;
  const lines = text.split('\n').map((line) => {
    if (!line.includes(marker)) return line;
    let next = status === 'delivered' ? line.replace('[ ]', '[x]') : line;
    next = next.includes('<!--')
      ? annotateExisting(next, status, pr, branch)
      : `${next} <!--${annotationBody(status, pr, branch)} -->`;
    return next;
  });
  const joined = lines.join('\n');
  return { text: joined, wrote: joined !== text };
};

/**
 * Builds the annotation body for an item that carries none.
 *
 * @param status - the status to record.
 * @param pr - the PR number, or null to omit it.
 * @param branch - the branch, or `''` to omit it.
 * @returns the body, each key prefixed by a space and separated by commas.
 */
const annotationBody = (status: string, pr: number | null, branch: string): string => {
  const parts: string[] = [];
  if (pr !== null) parts.push(`pr: #${pr}`);
  parts.push(`status: ${status}`);
  if (branch !== '') parts.push(`branch: ${branch}`);
  return ` ${parts.join(', ')}`;
};

/**
 * Rewrites the keys this write names inside an existing annotation.
 *
 * @param line - the item line, which carries an annotation.
 * @param status - the status to record.
 * @param pr - the PR number, or null to leave the existing one.
 * @param branch - the branch, or `''` to leave the existing one.
 * @returns the rewritten line.
 */
const annotateExisting = (
  line: string,
  status: string,
  pr: number | null,
  branch: string,
): string => {
  let next = /status:[ \t]*[a-z-]+/.test(line)
    ? line.replace(/status:[ \t]*[a-z-]+/, `status: ${status}`)
    : line.replace('-->', `, status: ${status} -->`);
  if (pr !== null) {
    next = /pr:[ \t]*#?[0-9a-z]+/.test(next)
      ? next.replace(/pr:[ \t]*#?[0-9a-z]+/, `pr: #${pr}`)
      : next.replace('<!--', `<!-- pr: #${pr},`);
  }
  if (branch !== '') {
    next = /branch:[ \t]*[^,>]+/.test(next)
      ? next.replace(/branch:[ \t]*[^,>]*[^,> \t]/, `branch: ${branch}`)
      : next.replace('-->', `, branch: ${branch} -->`);
  }
  return next;
};

/**
 * The repository paths one write touches.
 *
 * THIS IS WHAT THE SANDBOX TIER DIFFS THE FILESYSTEM AGAINST, and it is why
 * the enumeration is derived from the write rather than listed by an author:
 * the failure mode is a write somebody forgot, and an author who forgot it
 * while writing the code forgets it again while reviewing.
 *
 * A write that touches no path — merging a PR, starting a worker, signalling
 * one — reports none. Those reach the host or the process table, which the
 * filesystem cannot see and must not be asked to account for.
 *
 * @param write - the write to enumerate.
 * @returns every repository-relative path it would change, in no order.
 */
export const pathsOf = (write: Write): readonly string[] => {
  switch (write.kind) {
    case 'plan-phase':
    case 'plan-record':
    case 'plan-annotation':
      return [write.file];
    case 'hold-clear':
      return [HOLD_FILE];
    case 'sprint-annotation':
    case 'sprint-note':
      return [write.file];
    case 'index-move':
      return [write.from, write.to];
    case 'brief':
      return [write.file];
    case 'commit':
      return write.paths;
    default:
      return [];
  }
};

/** Where the phase gate keeps its per-branch entries. */
export const HOLD_FILE = '.plot/hold';

/**
 * Every repository path a decision would change, deduplicated and sorted.
 *
 * The `commit` write's own path list is included, which makes this the union
 * of what the decision says it stages and what its other writes touch. A
 * decision whose commit forgets a path it wrote is therefore visible here as
 * the two disagreeing, rather than as a file quietly left unstaged.
 *
 * @param decision - the decision to enumerate.
 * @returns the paths, `LC_ALL=C`-ordered so two runs compare directly.
 */
export const pathsNamedBy = (decision: Decision<unknown>): readonly string[] =>
  [...new Set(decision.writes.flatMap((write) => pathsOf(write)))].sort();
