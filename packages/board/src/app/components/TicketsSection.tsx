import { useState } from 'react';
import { planItReason, ticketsSection, TICKETS_ANCHOR } from '@plot-pm/domain';
import type { DispatchInfo, IssueAnswer, IssueRow } from '../../contract/schema.js';
import { tupleAgeText } from '../lib/tuple-row.js';
import { CreatePlanButton } from './CreatePlanButton.js';

/** The button class of a fold control: a link-looking button that stays in the tab order. */
const FOLD_CLASS = 'text-blue-600 hover:underline dark:text-blue-400';

export interface TicketsSectionViewProps {
  issueAnswer: IssueAnswer | null | undefined;
  /** The open, unplanned tickets assigned to the reader, newest first. */
  assigned: readonly IssueRow[];
  /** The open, unplanned tickets of nobody or of someone else, newest first. */
  others: readonly IssueRow[];
  /** `waiting.unassigned`; `null` where the read carries none. */
  unassigned: number | null;
  showAll: boolean;
  onToggleShowAll: () => void;
  /** The host's hidden-ticket sentence and the reader-match notice, where `waitingView` reports them. */
  hiddenSentence: string | null;
  notice: string | null;
  /** The sentence naming why the tracker gave no tickets; `''` where it answered. */
  absence: string;
  idea: DispatchInfo;
}

/**
 * The Delivery tab's Tickets section: the tickets no plan names, with *Plan it ›* in Do.
 *
 * Every count, fold and refusal is the domain's (`ticketsSection`, `planItReason`);
 * this component renders them. The section carries the `tickets` anchor that the
 * Delivery tab's triage links scroll to.
 */
export function TicketsSectionView(props: TicketsSectionViewProps) {
  const { idea, issueAnswer = null } = props;
  const [foldOpen, setFoldOpen] = useState(false);
  const section = ticketsSection<IssueRow>({
    answer: issueAnswer,
    assigned: props.assigned,
    others: props.others,
    unassigned: props.unassigned,
    showAll: props.showAll,
    foldOpen,
  });
  const reason = planItReason(issueAnswer, idea.available);
  return (
    <section id={TICKETS_ANCHOR} data-section="tickets" data-tickets-state={section.state} className="space-y-2">
      <h2 data-delivery-section="tickets" className="flex items-baseline gap-1 text-base font-semibold text-slate-800 dark:text-slate-100">
        Tickets
      </h2>
      {section.state !== 'rows' ? (
        <p data-tickets-absent={section.state} data-issue-error={section.state === 'failed' ? '' : undefined} data-issue-absence={section.state === 'unsupported' ? '' : undefined} className="px-3 text-sm text-slate-500 dark:text-slate-400">
          {props.absence !== '' ? props.absence : section.state === 'unasked' ? 'the tracker has not been read yet' : 'the tracker gave no answer'}
        </p>
      ) : (
        <>
          <p data-tickets-header className="flex flex-wrap items-baseline gap-x-1 px-3 text-sm text-slate-600 dark:text-slate-300">
            <span>{section.header}</span>
            {section.showAllControl && (
              <>
                <span aria-hidden>·</span>
                <button
                  type="button"
                  data-tickets-show-all
                  aria-expanded={props.showAll}
                  onClick={props.onToggleShowAll}
                  className={FOLD_CLASS}
                >
                  show all
                </button>
              </>
            )}
          </p>
          {props.notice !== null && <p data-waiting-notice className="px-3 text-xs text-slate-500 dark:text-slate-400">{props.notice}</p>}
          {props.hiddenSentence !== null && <p data-waiting-hidden-text className="px-3 text-xs text-slate-500 dark:text-slate-400">{props.hiddenSentence}</p>}
          <ul role="grid" aria-label="Tickets" className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40">
            <li role="row" className="sr-only max-sm:hidden">
              <span role="columnheader">Kind</span>
              <span role="columnheader">Ticket</span>
              <span role="columnheader">Do</span>
              <span role="columnheader">Age</span>
            </li>
            {section.rows.map((issue) => (
              <li
                key={issue.number}
                role="row"
                data-issue-row={issue.number}
                className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto_4.5rem] items-baseline gap-x-3 border-t border-slate-100 px-3 py-2 text-sm first:border-t-0 dark:border-slate-800"
              >
                <span role="gridcell" className="text-xs text-slate-500 dark:text-slate-400">Ticket</span>
                <span role="gridcell" className="min-w-0 truncate">
                  {issue.url !== '' ? (
                    <a href={issue.url} target="_blank" rel="noreferrer" data-issue-link className="text-blue-600 hover:underline dark:text-blue-400">
                      <span data-issue-number>{issue.number}</span>: {issue.title}
                    </a>
                  ) : (
                    <span><span data-issue-number>{issue.number}</span>: {issue.title}</span>
                  )}
                </span>
                <span role="gridcell" data-plan-it-reason={reason ?? undefined}>
                  <CreatePlanButton issue={issue} idea={idea} issueAnswer={issueAnswer} label="Plan it ›" />
                </span>
                <span role="gridcell" className="text-right text-xs text-slate-500 dark:text-slate-400">
                  {issue.ageMinutes === null ? '' : tupleAgeText(issue.ageMinutes)}
                </span>
              </li>
            ))}
            {section.foldLabel !== null && (
              <li role="row" className="border-t border-slate-100 px-3 py-2 text-xs dark:border-slate-800">
                <span role="gridcell">
                  <button
                    type="button"
                    data-tickets-fold
                    aria-expanded={foldOpen}
                    onClick={() => setFoldOpen((open) => !open)}
                    className={FOLD_CLASS}
                  >
                    {section.foldLabel}
                  </button>
                </span>
              </li>
            )}
          </ul>
        </>
      )}
    </section>
  );
}
