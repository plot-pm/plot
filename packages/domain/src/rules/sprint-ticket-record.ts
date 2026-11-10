import { memberLineIndex, sprintsListing, type SprintFile } from './sprint-membership.js';

/** The subsection of `## Notes` that holds the records. */
export const OPENED_TICKETS_HEADING = '### Opened tickets';

/** The wording of the mark a ticket row shows where the sprint opened the ticket. */
export const OPENED_BY_SPRINT_MARK = 'opened by sprint';

const NOTES_HEADING = /^## Notes\s*$/;
const OPENED_HEADING = /^### Opened tickets\s*$/;
const ANY_HEADING = /^#{1,3} /;
const TOP_HEADING = /^#{1,2} /;
const RECORD = /^- (\d{4}-\d{2}-\d{2}): Opened ticket (\S+) from slice (\S+)$/;

/** What the sprint file says about one ticket. */
export type TicketRecord =
  | { readonly kind: 'opened-by-sprint'; readonly slice: string; readonly date: string }
  | { readonly kind: 'no-record' };

/** Which sprint file a slice's plan resolves to. */
export type ActiveSprintOf =
  | { readonly outcome: 'sprint'; readonly file: string }
  | { readonly outcome: 'none' }
  | { readonly outcome: 'ambiguous'; readonly files: readonly string[] };

/** What {@link recordOpenedTicket} did. */
export type RecordOutcome = 'updated' | 'already' | 'no-notes';

/**
 * A tracker identifier in the one spelling a record carries.
 *
 * A bare number (`3301`) becomes `#3301`; a `#3301` stays; a key such as
 * `QKP-123` stays. Both the writer and the reader pass identifiers through
 * this function, so a record compares by whole identifier and `#33` never
 * matches `#330`.
 *
 * @param ticket - the identifier as the tracker or the issue index spells it.
 * @returns the identifier as a record spells it.
 */
export const ticketRef = (ticket: string): string => {
  const trimmed = ticket.trim();
  return /^\d+$/.test(trimmed) ? `#${trimmed}` : trimmed;
};

/**
 * The line that records one opened ticket.
 *
 * @param date - the opening date, `YYYY-MM-DD`.
 * @param ticket - the new ticket's tracker identifier.
 * @param branch - the branch of the slice that opened it.
 * @returns one `- <date>: Opened ticket <ref> from slice <branch>` line.
 */
export const ticketRecordLine = (date: string, ticket: string, branch: string): string =>
  `- ${date}: Opened ticket ${ticketRef(ticket)} from slice ${branch}`;

/**
 * The lines of a sprint file's `### Opened tickets` subsection, with their
 * zero-based indexes. Lines under `### Scope Changes`, `### Deferred` or any
 * other heading are not part of it.
 */
const openedLines = (lines: readonly string[]): { index: number; text: string }[] => {
  const found: { index: number; text: string }[] = [];
  let inNotes = false;
  let inOpened = false;
  lines.forEach((text, index) => {
    if (ANY_HEADING.test(text)) {
      inNotes = inNotes ? !TOP_HEADING.test(text) : NOTES_HEADING.test(text);
      inOpened = inNotes && OPENED_HEADING.test(text);
      return;
    }
    if (inOpened) found.push({ index, text });
  });
  return found;
};

/**
 * What a sprint file records about a ticket.
 *
 * Reads only `- <date>: Opened ticket <ref> from slice <branch>` lines under
 * `### Opened tickets` inside `## Notes`. A ticket with no such line answers
 * `no-record`, which is not a statement that someone else opened it: every
 * ticket opened before the record existed has none.
 *
 * @param content - the whole sprint file.
 * @param ticket - the ticket's tracker identifier.
 * @returns the first matching record, or `no-record`.
 */
export const ticketRecordOf = (content: string, ticket: string): TicketRecord => {
  const wanted = ticketRef(ticket);
  for (const { text } of openedLines(content.split('\n'))) {
    const m = RECORD.exec(text);
    if (m !== null && m[2] === wanted) return { kind: 'opened-by-sprint', date: m[1]!, slice: m[3]! };
  }
  return { kind: 'no-record' };
};

/**
 * The mark text a ticket row shows for a record.
 *
 * @param record - the answer of {@link ticketRecordOf}.
 * @returns the mark wording, or `null` where the row shows no mark.
 */
export const ticketMarkOf = (record: TicketRecord): string | null =>
  record.kind === 'opened-by-sprint' ? OPENED_BY_SPRINT_MARK : null;

/**
 * Adds the record of one opened ticket to a sprint file's content.
 *
 * Writes `### Opened tickets` at the end of `## Notes` when the subsection is
 * absent, and appends the line below the subsection's last line otherwise.
 * The same ticket and slice written twice answers `already` and adds no line.
 *
 * @param content - the sprint file's current content.
 * @param date - the opening date, `YYYY-MM-DD`.
 * @param ticket - the new ticket's tracker identifier.
 * @param branch - the branch of the slice that opened it.
 * @returns the new content and the outcome; `no-notes` where the file has no `## Notes`.
 */
export const recordOpenedTicket = (
  content: string,
  date: string,
  ticket: string,
  branch: string,
): { content: string; outcome: RecordOutcome } => {
  const lines = content.split('\n');
  const wanted = ticketRef(ticket);
  const inSection = openedLines(lines);
  const same = inSection.some(({ text }) => {
    const m = RECORD.exec(text);
    return m !== null && m[2] === wanted && m[3] === branch;
  });
  if (same) return { content, outcome: 'already' };

  const line = ticketRecordLine(date, ticket, branch);
  if (inSection.length > 0) {
    const lastNonBlank = [...inSection].reverse().find(({ text }) => text.trim() !== '');
    const at = (lastNonBlank ?? inSection[0]!).index + 1;
    return { content: [...lines.slice(0, at), line, ...lines.slice(at)].join('\n'), outcome: 'updated' };
  }

  const notes = lines.findIndex((text) => NOTES_HEADING.test(text));
  if (notes === -1) return { content, outcome: 'no-notes' };
  const next = lines.findIndex((text, i) => i > notes && TOP_HEADING.test(text));
  const end = next === -1 ? lines.length : next;
  let tail = end;
  while (tail > notes + 1 && lines[tail - 1]!.trim() === '') tail -= 1;
  const block = ['', OPENED_TICKETS_HEADING, '', line];
  const rest = lines.slice(end);
  const spacer = rest.length > 0 ? [''] : [];
  return { content: [...lines.slice(0, tail), ...block, ...spacer, ...rest].join('\n'), outcome: 'updated' };
};

/**
 * The active sprint file that lists the plan of the slice that opened a ticket.
 *
 * A sprint counts when its `State:` is `Active` and {@link memberLineIndex}
 * finds the plan's Must/Should/Could line, so a slug that appears only under
 * `### Deferred` or `### Scope Changes` does not count.
 *
 * @param slug - the plan's slug.
 * @param sprints - every dated sprint file.
 * @returns the one file, `none` where no active sprint holds the plan, or
 *   `ambiguous` naming every active sprint that does.
 */
export const activeSprintOf = (slug: string, sprints: readonly SprintFile[]): ActiveSprintOf => {
  const byFile = new Map(sprints.map((s) => [s.file, s.content]));
  const files = sprintsListing(slug, sprints)
    .filter((entry) => entry.state === 'Active')
    .map((entry) => entry.file)
    .filter((file) => memberLineIndex(byFile.get(file) ?? '', slug) !== -1);
  if (files.length === 0) return { outcome: 'none' };
  if (files.length === 1) return { outcome: 'sprint', file: files[0]! };
  return { outcome: 'ambiguous', files };
};
