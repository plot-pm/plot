/**
 * What `--brief-only` books on `origin/<default>`: the brief file itself, and
 * the plan's `Started:` record — both decided here, written by a caller
 * through the `Trees` port in one disposable worktree.
 *
 * Matches `append_started_line` (`plot-dispatch.sh`) for the line's shape and
 * its placement, and `write_started_record`'s idempotency check: a branch
 * already named in a `Started:` line, in backticks, is not recorded twice.
 *
 * @concept brief-booking
 */

/** One `- **Started:** <date>, <who>, \`<branch>\`` line, exactly as `append_started_line` writes it. */
export const startedLine = (date: string, who: string, branch: string): string =>
  `- **Started:** ${date}, ${who}, \`${branch}\``;

/** Whether `content` already carries a `Started:` line naming `branch` in backticks. */
export const hasStartedLine = (content: string, branch: string): boolean =>
  content.includes(`\`${branch}\``) &&
  new RegExp(`^[ \\t]*[-*][ \\t]*\\*\\*Started:\\*\\*.*\`${branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\``, 'm').test(content);

/** Why {@link insertStartedLine} could not place the line. */
export type StartedLineRefusal = 'no-status-section';

/** The result of attempting to insert a `Started:` line into a plan. */
export type StartedLineResult =
  | { readonly outcome: 'inserted'; readonly content: string }
  | { readonly outcome: 'unchanged'; readonly content: string }
  | { readonly outcome: 'refused'; readonly reason: StartedLineRefusal };

/**
 * Inserts `branch`'s `Started:` line into the plan's `## Status` section, or
 * reports why it could not.
 *
 * `unchanged` where `content` already carries the line for `branch` — a
 * second dispatch or a second `--brief-only` run of the same branch books
 * nothing further. Otherwise the line fills the section's empty
 * `- **Started:**` placeholder where one exists, or is appended after the
 * section's last bulleted line, or — a plan with no `## Status` heading at
 * all — `refused`.
 *
 * @param content - the whole plan file.
 * @param date - `YYYY-MM-DD`, the caller's local date.
 * @param who - the name to record as having started the branch.
 * @param branch - the branch to record, matched in backticks.
 * @returns the edited content, the content unchanged, or a refusal.
 */
export const insertStartedLine = (content: string, date: string, who: string, branch: string): StartedLineResult => {
  if (hasStartedLine(content, branch)) return { outcome: 'unchanged', content };

  const lines = content.split('\n');
  const statusAt = lines.findIndex((line) => /^##[ \t]*[Ss]tatus[ \t]*$/.test(line));
  if (statusAt === -1) return { outcome: 'refused', reason: 'no-status-section' };

  const line = startedLine(date, who, branch);
  let slot = -1;
  let insertAfter = statusAt;
  for (let i = statusAt + 1; i < lines.length; i += 1) {
    if (/^##[ \t]/.test(lines[i])) break;
    if (lines[i].includes('<!--')) break;
    if (/^[ \t]*[-*][ \t]*\*\*Started:\*\*[ \t]*$/.test(lines[i])) {
      slot = i;
      break;
    }
    if (/^[ \t]*[-*][ \t]/.test(lines[i])) insertAfter = i;
  }

  const out: string[] = [];
  if (slot !== -1) {
    lines.forEach((l, i) => out.push(i === slot ? line : l));
  } else {
    lines.forEach((l, i) => {
      out.push(l);
      if (i === insertAfter) out.push(line);
    });
  }
  return { outcome: 'inserted', content: out.join('\n') };
};

/** What `origin/<default>` already holds, read in the booking worktree. */
export interface BriefBookingReadings {
  /** The brief file's content where it exists on the fetched ref, `null` otherwise. */
  briefOnRef: string | null;
  /** The brief text this run was asked to book. */
  briefText: string;
}

/** Whether the brief itself needs writing: absent, or present with different bytes. */
export const briefNeedsWrite = (readings: BriefBookingReadings): boolean => readings.briefOnRef !== readings.briefText;
