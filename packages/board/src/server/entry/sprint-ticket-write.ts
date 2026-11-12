import path from 'node:path';
import type { PlanStore } from '@plot-pm/domain';
import type { SprintFile } from '@plot-pm/domain/rules/sprint-membership';
import { activeSprintOf, recordOpenedTicket } from '@plot-pm/domain/rules/sprint-ticket-record';

/** What {@link writeTicketRecords} did with the tickets it was handed. */
export interface TicketRecordReport {
  /** The sprint file written, relative to the tree root; `''` where nothing changed. */
  file: string;
  /** One line per ticket not recorded, naming the ticket and why. Empty where every ticket is recorded. */
  notes: string[];
}

/**
 * Records, in the one active sprint that lists the plan, each ticket that
 * sprint work opened.
 *
 * Reads every sprint file under `sprintDir`, resolves the sprint with
 * {@link activeSprintOf}, and writes the sprint file through
 * {@link recordOpenedTicket}. It writes nothing else: no tracker call, no
 * issue index field. A ticket already recorded for the same slice adds no
 * line. Where no active sprint holds the plan, or two do, nothing is written
 * and `notes` names each ticket and the reason. A failed write is reported in
 * `notes` and never thrown, because the tickets exist and the caller must not
 * open them again.
 *
 * @param planStore - reads and writes the files under `root`.
 * @param root - the tree the sprint files sit in.
 * @param sprintDir - the sprint directory relative to `root`, as `Sprint directory` names it.
 * @param slug - the plan's slug.
 * @param branch - the branch of the slice that opened the tickets.
 * @param tickets - the new tickets' tracker identifiers.
 * @param date - the opening date, `YYYY-MM-DD`.
 * @returns the file to stage and the notes for the caller to print.
 */
export const writeTicketRecords = async (
  planStore: PlanStore,
  root: string,
  sprintDir: string,
  slug: string,
  branch: string,
  tickets: readonly string[],
  date: string,
): Promise<TicketRecordReport> => {
  if (tickets.length === 0) return { file: '', notes: [] };
  const dir = path.join(root, sprintDir.replace(/^\//, ''));
  const listed = await planStore.listDir(dir);
  const sprints: SprintFile[] = [];
  for (const name of (listed.ok ? listed.value : []).filter((n) => n.endsWith('.md'))) {
    const file = path.join(dir, name);
    const read = await planStore.readText(file);
    if (read.ok && read.value !== null) sprints.push({ file, content: read.value });
  }

  const found = activeSprintOf(slug, sprints);
  if (found.outcome === 'none') {
    return { file: '', notes: tickets.map((t) => `${t}: no active sprint lists '${slug}'; no record written`) };
  }
  if (found.outcome === 'ambiguous') {
    const names = found.files.map((f) => path.relative(root, f)).join(' and ');
    return { file: '', notes: tickets.map((t) => `${t}: ${names} are both active and list '${slug}'; no record written until a person names one`) };
  }

  let content = sprints.find((s) => s.file === found.file)!.content;
  const notes: string[] = [];
  let changed = false;
  for (const ticket of tickets) {
    const next = recordOpenedTicket(content, date, ticket, branch);
    if (next.outcome === 'no-notes') notes.push(`${ticket}: ${path.relative(root, found.file)} has no '## Notes' section; no record written`);
    if (next.outcome === 'updated') changed = true;
    content = next.content;
  }
  if (!changed) return { file: '', notes };
  const written = await planStore.writeText(found.file, content);
  if (!written.ok) {
    return { file: '', notes: [...notes, ...tickets.map((t) => `${t}: could not write ${path.relative(root, found.file)}; the ticket exists and has no record`)] };
  }
  return { file: path.relative(root, found.file), notes };
};
