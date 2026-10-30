import type { PlanHighTicket, PlanStateWrite } from '../ports/tracker.js';

/**
 * The marker Plot's one comment on an issue carries, so every later phase finds
 * that comment and edits it in place. It names no plan: the `draft` link is a
 * PR's address and every later one a plan file's, so a marker derived from the
 * link would differ between the two and leave a second comment.
 */
export const PLAN_STATE_MARKER = '<!-- plot:plan-link -->';

/**
 * Renders the phase line: the marker, then one line naming the phase, the plan
 * link and, for `released`, the version.
 *
 * @param write - the plan-state write.
 * @returns the marker and the phase line, joined by one newline.
 */
const phaseLines = (write: PlanStateWrite): string => {
  const release = write.phase === 'released' && write.version ? ` in ${write.version}` : '';
  return `${PLAN_STATE_MARKER}\nPlan ${write.phase}${release}: ${write.planLink}`;
};

/**
 * Renders one HIGH ticket's link line.
 *
 * @param ticket - the ticket's title and URL.
 * @returns a single Markdown link line.
 */
const ticketLine = (ticket: PlanHighTicket): string => `- [${ticket.title}](${ticket.url})`;

/**
 * The plan-state comment's full body.
 *
 * Renders the marker, the phase line, the slice-progress line where
 * `write.sliceProgress` is given, and one link per entry in `write.highTickets`
 * where it is given — in that order, each on its own line. A write naming
 * neither renders a body byte-identical to the two-line body `planStateComment`
 * has always produced, so an issue with no progress and no tickets sees no
 * churn.
 *
 * @param write - the plan-state write, with progress and tickets where known.
 * @returns the comment body, verbatim.
 */
export const planIssueComment = (write: PlanStateWrite): string => {
  const lines = [phaseLines(write)];
  if (write.sliceProgress !== undefined) lines.push(write.sliceProgress);
  if (write.highTickets !== undefined) for (const ticket of write.highTickets) lines.push(ticketLine(ticket));
  return lines.join('\n');
};

/** One ticket line's title and URL, read back from a rendered Markdown link. */
const TICKET_LINE = /^- \[(.*)\]\((.*)\)$/;

/**
 * What a previously-posted body's lines beyond the marker and the phase line
 * held: the progress line verbatim, and every HIGH ticket link, parsed back
 * into its title and URL.
 *
 * Read ONLY where D6's write names no record of its own (see {@link filled}) —
 * this is the one place anything reads the plan comment back, and the port
 * names it as such.
 */
export interface PriorPlanLines {
  /** The progress line verbatim, or null where the prior body held none. */
  sliceProgress: string | null;
  /** The HIGH tickets the prior body linked, parsed in its order. */
  highTickets: readonly PlanHighTicket[];
}

/**
 * Splits a previously-posted body into its progress line and ticket links.
 *
 * The first line (the marker) and the second (the phase line) are always
 * skipped, whatever they say — only the lines after them are read. A ticket
 * line is one matching {@link TICKET_LINE}; the first non-matching line
 * thereafter is read as the progress line, and parsing stops there, because
 * today's renderer never places a ticket link before the progress line.
 *
 * @param body - the comment's previous body, verbatim.
 * @returns the progress line and the ticket links it held.
 */
export const priorPlanLinesOf = (body: string): PriorPlanLines => {
  const lines = body.split('\n').slice(2);
  const highTickets: PlanHighTicket[] = [];
  let sliceProgress: string | null = null;
  for (const line of lines) {
    const match = TICKET_LINE.exec(line);
    if (match) {
      highTickets.push({ title: match[1] as string, url: match[2] as string });
      continue;
    }
    if (sliceProgress === null && line !== '') sliceProgress = line;
  }
  return { sliceProgress, highTickets };
};

/**
 * Fills a write's absent progress or tickets from what a previously-posted
 * body held, so D6's "no record on this machine" never renders as "no
 * progress, no tickets" where a sibling write already posted either.
 *
 * A field the write already names is kept as given — this never overrides a
 * value this machine does know, including an explicit empty list, with one a
 * past write made.
 *
 * @param write - the plan-state write, before the read-back.
 * @param prior - the lines read back from the currently-posted comment, or
 *   null where there was none to read.
 * @returns the write, with its progress and tickets filled from `prior` where
 *   it named neither.
 */
export const filled = (write: PlanStateWrite, prior: PriorPlanLines | null): PlanStateWrite => ({
  ...write,
  ...(write.sliceProgress === undefined && prior?.sliceProgress != null ? { sliceProgress: prior.sliceProgress } : {}),
  ...(write.highTickets === undefined && prior !== null ? { highTickets: prior.highTickets } : {}),
});
