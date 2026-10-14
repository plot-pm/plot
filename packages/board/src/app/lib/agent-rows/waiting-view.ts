import { hiddenSentence, shownSentence } from '@plot-pm/domain';
import { type FleetWaiting, type IssueRow } from '../../../contract/schema.js';

/** The label of the control that switches *Waiting on you* to every ticket. */
export const SHOW_EVERY_TICKET_LABEL = 'show every ticket';

/** What the *Waiting on you* ticket block renders, every text already written. */
export interface WaitingView {
  /** The tickets to render, after the reader's narrowing. */
  readonly tickets: IssueRow[];
  /** The hidden-count sentence, or `null` where nothing is hidden or the view lists every ticket. */
  readonly hidden: string | null;
  /** The sentence naming why the reader is unmatched, or `null`. */
  readonly notice: string | null;
  /** The control's label, or `null` where there is nothing to switch. */
  readonly control: string | null;
  /** The *Showing N of M* sentence, or `null` unless the control is on. */
  readonly showing: string | null;
}

/** The tickets of `issues` followed by the tickets of `extra` that `issues` lacks. */
const unionByNumber = (issues: readonly IssueRow[], extra: readonly IssueRow[]): IssueRow[] => {
  const seen = new Set(issues.map((issue) => issue.number));
  return [...issues, ...extra.filter((issue) => !seen.has(issue.number))];
};

/**
 * Decides what the *Waiting on you* ticket block renders.
 *
 * A payload with no `waiting` renders `issues` with no sentence and no
 * control. With `waiting`, the default renders `waiting.tickets` and, where
 * `waiting.hidden` is above zero, the hidden-count sentence and the control.
 * With `showEvery` on, the view renders `issues` plus any ticket of
 * `waiting.tickets` that `issues` lacks, and the *Showing N of M* sentence
 * counts the rendered tickets against `shown` plus `hidden`.
 *
 * @param waiting - the payload's `waiting`, or `null` or `undefined` where the server sent none.
 * @param issues - the payload's `issues`.
 * @param showEvery - whether the *show every ticket* control is on.
 * @param narrow - the reader's *Only my work* narrowing, applied last.
 * @returns the tickets and every text and control state the block shows.
 */
export const waitingView = (
  waiting: FleetWaiting | null | undefined,
  issues: IssueRow[],
  showEvery: boolean,
  narrow: (tickets: IssueRow[]) => IssueRow[],
): WaitingView => {
  if (waiting === null || waiting === undefined) {
    return { tickets: narrow(issues), hidden: null, notice: null, control: null, showing: null };
  }
  const control = waiting.hidden > 0 || showEvery ? SHOW_EVERY_TICKET_LABEL : null;
  if (!showEvery) {
    return {
      tickets: narrow(waiting.tickets),
      hidden: waiting.hidden > 0 ? hiddenSentence(waiting.hidden, waiting.complete) : null,
      notice: waiting.notice,
      control,
      showing: null,
    };
  }
  const tickets = narrow(unionByNumber(issues, waiting.tickets));
  return {
    tickets,
    hidden: null,
    notice: waiting.notice,
    control,
    showing: shownSentence(tickets.length, waiting.shown + waiting.hidden, waiting.complete),
  };
};
