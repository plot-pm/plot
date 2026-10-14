/**
 * `docs/releases/vnext-checklist.md`: the running release checklist the verify
 * workflow keeps current, one `- [ ]` item per verified plan, shaped as
 * `/plot-release rc` shapes its own items.
 */

import type { PlanState } from '../transitions/plan.js';
import { changelogOf } from './claims.js';
import { fencedLines } from './fences.js';

/** The plan types the checklist lists. A docs or infra plan is live on merge. */
const LISTED_TYPES: readonly string[] = ['feature', 'bug'];

/**
 * Whether a plan gets an item in the release checklist.
 *
 * @param type - the plan's `Type:` value, such as `feature` or `docs`.
 * @param state - the plan's state.
 * @returns true for a `delivered` plan of type `feature` or `bug`, compared
 *   case-insensitively; false for every other type, an empty type, and every
 *   other state, `released` included.
 */
export const listsOnChecklist = (type: string, state: PlanState): boolean =>
  state === 'delivered' && LISTED_TYPES.includes(type.trim().toLowerCase());

/** Matches the `RC:` line that marks an in-progress RC round. */
const RC_LINE = /^RC:[ \t]+\S/m;

/** Matches a `## ` heading and captures its title. */
const HEADING = /^##[ \t]+(.*?)[ \t]*$/;

/** Matches one plan's checklist item and captures its slug. */
const ITEM = /^-[ \t]+\[([ xX])\][ \t]+(\S+)[ \t]+—/;

/**
 * Renders a plan's one-line checklist summary from its `## Changelog`.
 *
 * @param text - the plan file's contents.
 * @returns the entries joined with `; `, or `''` where the section is absent.
 */
export const checklistSummary = (text: string): string => changelogOf(text).join('; ');

/**
 * Whether a checklist file carries an `RC:` line.
 *
 * The guard the verify workflow and `/plot-release rc` both read before
 * touching `vnext-checklist.md`: present, the file is an open RC round and is
 * left strictly alone by the verify workflow's writer.
 *
 * @param text - the checklist file's contents.
 * @returns true where a line starting `RC:` exists outside a fenced block.
 */
export const hasRcLine = (text: string): boolean => {
  const lines = text.split('\n');
  const fenced = fencedLines(lines);
  return lines.some((line, i) => !fenced[i] && RC_LINE.test(line));
};

/** One plan's line in the checklist, before it is placed under a heading. */
export interface ChecklistEntry {
  /** The plan's branch slug. */
  readonly slug: string;
  /** The plan's `## Changelog` summary, one line. */
  readonly summary: string;
  /** `refuted` places the entry under `## Refuted`; `verified` keeps it under `## Verification`. */
  readonly state: 'verified' | 'refuted';
  /** `<supported>/<total>` claims, shown only for `verified`. */
  readonly tally: string;
  /** The refuted claim's issue reference, such as `#1712`; shown only for `refuted`. */
  readonly issue: string | null;
}

/**
 * Renders one plan's checklist line.
 *
 * @param entry - the plan's entry.
 * @returns the `- [ ]` line, without a trailing newline.
 */
export const renderChecklistEntry = (entry: ChecklistEntry): string => {
  const tail = entry.state === 'verified' ? `verified ${entry.tally}` : `refuted${entry.issue === null ? '' : ` — ${entry.issue}`}`;
  return `- [ ] ${entry.slug} — ${entry.summary} — ${tail}`;
};

/** The checklist's fixed section order and non-plan bodies. */
const AUTOMATED_TESTS = '## Automated Tests\n\n- [ ] CI passes on RC tag\n';
const SIGN_OFF = '## Sign-off\n\n- [ ] All items verified by: ___\n- [ ] Final release approved by: ___\n';

/**
 * Builds a fresh `vnext-checklist.md`, carrying no `RC:` line.
 *
 * @param entries - the plans to list, in the order they verified.
 * @returns the file's contents.
 */
export const freshChecklist = (entries: readonly ChecklistEntry[]): string => {
  const verified = entries.filter((e) => e.state === 'verified');
  const refuted = entries.filter((e) => e.state === 'refuted');
  const sections = [
    '# Release Checklist\n',
    `## Verification\n\n${verified.map((e) => `${renderChecklistEntry(e)}\n`).join('')}`,
  ];
  if (refuted.length > 0) sections.push(`## Refuted\n\n${refuted.map((e) => `${renderChecklistEntry(e)}\n`).join('')}`);
  sections.push(AUTOMATED_TESTS, SIGN_OFF);
  return `${sections.join('\n')}`;
};

/**
 * Reads one section's body lines, outside fenced blocks.
 *
 * @param lines - the file, split at `\n`.
 * @param fenced - {@link fencedLines} of the same split.
 * @param title - the heading text, compared case-insensitively.
 * @returns the start and end line indices (end exclusive), or null where the
 *   heading is absent.
 */
const sectionRange = (
  lines: readonly string[],
  fenced: readonly boolean[],
  title: string,
): { start: number; end: number } | null => {
  const start = lines.findIndex((line, i) => {
    if (fenced[i]) return false;
    const heading = HEADING.exec(line);
    return heading !== null && heading[1]!.toLowerCase() === title.toLowerCase();
  });
  if (start === -1) return null;
  let end = lines.findIndex((line, i) => i > start && !fenced[i] && HEADING.test(line));
  if (end === -1) end = lines.length;
  return { start, end };
};

/**
 * Updates or inserts one plan's item in a `vnext-checklist.md` body, moving it
 * between `## Verification` and `## Refuted` as its state requires.
 *
 * Caller's responsibility: check {@link hasRcLine} first. Once a file carries
 * an `RC:` line it is an open RC round, and this function does not re-check
 * that guard — it edits whatever text it is given.
 *
 * @param text - the checklist file's contents.
 * @param entry - the plan's entry.
 * @returns the new contents.
 */
export const withChecklistEntry = (text: string, entry: ChecklistEntry): string => {
  const lines = text.split('\n');
  const fenced = fencedLines(lines);
  const rendered = renderChecklistEntry(entry);

  let next = lines.filter((line, i) => {
    if (fenced[i]) return true;
    const item = ITEM.exec(line);
    return item === null || item[2] !== entry.slug;
  });
  const nextFenced = fencedLines(next);

  const heading = entry.state === 'refuted' ? 'Refuted' : 'Verification';
  const range = sectionRange(next, nextFenced, heading);
  if (range !== null) {
    let insertAt = range.start + 1;
    for (let i = range.start + 1; i < range.end; i += 1) {
      if (ITEM.test(next[i] as string)) insertAt = i + 1;
    }
    next = [...next.slice(0, insertAt), rendered, ...next.slice(insertAt)];
  } else {
    // No `## Refuted` heading yet: insert it right after `## Verification`, or
    // at the top where even that is absent.
    const verification = sectionRange(next, nextFenced, 'Verification');
    const at = verification !== null ? verification.end : 0;
    next = [...next.slice(0, at), `## ${heading}`, '', rendered, '', ...next.slice(at)];
  }
  return next.join('\n');
};
