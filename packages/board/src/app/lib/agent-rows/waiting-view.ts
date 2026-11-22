import { hiddenSentence, shownSentence, type TicketPlacement } from '@plot-pm/domain';
import { ticketItemId } from './delivery-readings.js';
import { type FleetWaiting, type IssueRow } from '../../../contract/schema.js';

/** The label of the control that switches *Waiting on you* to every ticket. */
export const SHOW_EVERY_TICKET_LABEL = 'show every ticket';

/** What the *Waiting on you* ticket block renders, every text already written. */
export interface WaitingView {
  /** The tickets to render, after the reader's narrowing. */
  readonly tickets: IssueRow[];
  /**
   * The sub-header above the tickets, N being `tickets.length`:
   * `Assigned to you · N` where the server matched the reader and the view
   * lists only `waiting.tickets`, and `Open tickets · N` otherwise.
   */
  readonly heading: string;
  /** The hidden-count sentence, or `null` where nothing is hidden or the view lists every ticket. */
  readonly hidden: string | null;
  /** The sentence naming why the reader is unmatched, or `null`. */
  readonly notice: string | null;
  /** The control's label, or `null` where there is nothing to switch. */
  readonly control: string | null;
  /** The *Showing N of M* sentence, or `null` unless the control is on. */
  readonly showing: string | null;
}

/**
 * The tickets of `issues` followed by the tickets of `extra` that `issues`
 * lacks. Where both hold a ticket, `extra`'s copy replaces the `issues` copy
 * in place: `waiting.tickets` carries the owner the server resolved, and the
 * inbox copy carries none.
 */
const unionByNumber = (issues: readonly IssueRow[], extra: readonly IssueRow[]): IssueRow[] => {
  const extraByNumber = new Map(extra.map((issue) => [issue.number, issue]));
  const seen = new Set(issues.map((issue) => issue.number));
  return [
    ...issues.map((issue) => extraByNumber.get(issue.number) ?? issue),
    ...extra.filter((issue) => !seen.has(issue.number)),
  ];
};

/**
 * The sub-header above the tickets.
 *
 * @param n - how many tickets the view renders.
 * @param assigned - whether the server matched the reader and the view lists only `waiting.tickets`.
 * @returns `Assigned to you · N` where `assigned`, `Open tickets · N` otherwise.
 */
export const headingOf = (n: number, assigned: boolean): string =>
  assigned ? `Assigned to you · ${n}` : `Open tickets · ${n}`;

/**
 * Decides what the *Waiting on you* ticket block renders.
 *
 * A payload with no `waiting` renders `issues` with no sentence and no
 * control. With `waiting`, the default renders `waiting.tickets` and, where
 * `waiting.hidden` is above zero, the hidden-count sentence and the control.
 * With `showEvery` on, the view renders `issues` plus any ticket of
 * `waiting.tickets` that `issues` lacks, and the *Showing N of M* sentence
 * counts the rendered tickets against `shown` plus `hidden`. Where both
 * lists hold a ticket, the `waiting.tickets` copy renders.
 *
 * The heading reads `Assigned to you · N` only where `waiting` is present,
 * `waiting.notice` is `null` and `showEvery` is off. In every other case the
 * list holds tickets the server did not match to the reader, and the heading
 * reads `Open tickets · N`.
 *
 * @param waiting - the payload's `waiting`, or `null` or `undefined` where the server sent none.
 * @param issues - the payload's `issues`.
 * @param showEvery - whether the *show every ticket* control is on.
 * @param narrow - the reader's *Only my work* narrowing, applied last.
 * @param counts - the hidden counts without the scope's findings, from `scopeTickets`; `null` or absent reads `waiting`'s own counts.
 * @returns the tickets and every text and control state the block shows.
 */
export const waitingView = (
  waiting: FleetWaiting | null | undefined,
  issues: IssueRow[] | null | undefined,
  showEvery: boolean,
  narrow: (tickets: IssueRow[]) => IssueRow[],
  counts: { readonly unassigned: number; readonly assignedToOthers: number; readonly hidden: number } | null = null,
): WaitingView => {
  const safeIssues = issues ?? [];
  if (waiting === null || waiting === undefined) {
    const tickets = narrow(safeIssues);
    return { tickets, heading: headingOf(tickets.length, false), hidden: null, notice: null, control: null, showing: null };
  }
  const control = waiting.hidden > 0 || showEvery ? SHOW_EVERY_TICKET_LABEL : null;
  if (!showEvery) {
    const hidden = counts ?? waiting;
    const tickets = narrow(waiting.tickets);
    return {
      tickets,
      heading: headingOf(tickets.length, waiting.notice === null),
      hidden: hidden.hidden > 0 ? hiddenSentence(hidden.hidden, waiting.complete, hidden.unassigned, hidden.assignedToOthers) : null,
      notice: waiting.notice,
      control,
      showing: null,
    };
  }
  const tickets = narrow(unionByNumber(safeIssues, waiting.tickets));
  return {
    tickets,
    heading: headingOf(tickets.length, false),
    hidden: null,
    notice: waiting.notice,
    control,
    showing: shownSentence(tickets.length, waiting.shown + waiting.hidden, waiting.complete),
  };
};

/**
 * Splits the tickets the Tickets section may show into the reader's and the rest, newest first.
 *
 * A ticket the placement holds for the reader is the reader's; one it holds
 * with another ownership is an other. A ticket the placement did not see (the
 * ones only `show all` reaches) is an other unless a plan names it or the
 * tracker closed it.
 *
 * @param tickets - the narrowed ticket list `waitingView` returned with `show all` open.
 * @param placed - `DeliveryPlacement.tickets`.
 * @param unplaced - `DeliveryPlacement.unplaced`; a ticket it holds as `filtered` (Mine mode, another reader's) stays out of the others.
 * @param findingKeys - `scopeTickets`' finding keys; a ticket whose key it holds is in neither list, because Found during the sprint shows it.
 * @returns the reader's tickets and the others, each ordered by age ascending.
 */
export const splitTicketRows = (
  tickets: readonly IssueRow[],
  placed: readonly TicketPlacement[],
  unplaced: readonly { id: string; reason: string }[] = [],
  findingKeys: ReadonlySet<string> = new Set(),
): { assigned: IssueRow[]; others: IssueRow[] } => {
  const mine = new Set(placed.filter((t) => t.ownership === 'mine').map((t) => t.id));
  const held = new Set(placed.map((t) => t.id));
  const filtered = new Set(unplaced.filter((u) => u.reason === 'filtered').map((u) => u.id));
  const newest = (a: IssueRow, b: IssueRow): number =>
    (a.ageMinutes ?? Number.POSITIVE_INFINITY) - (b.ageMinutes ?? Number.POSITIVE_INFINITY);
  const open = (t: IssueRow): boolean => held.has(ticketItemId(t.number)) || (t.planned !== true && t.statusCategory !== 'Done');
  const kept = tickets.filter((t) => !findingKeys.has(t.number.replace(/^#/, '')));
  return {
    assigned: kept.filter((t) => mine.has(ticketItemId(t.number))).sort(newest),
    others: kept.filter((t) => !mine.has(ticketItemId(t.number)) && !filtered.has(ticketItemId(t.number)) && open(t)).sort(newest),
  };
};
