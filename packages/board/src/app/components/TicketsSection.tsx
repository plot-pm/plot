import { linkIconKind, planItReason, ticketsSection, TICKETS_ANCHOR } from '@plot-pm/domain';
import type { DispatchInfo, IssueAnswer, IssueRow } from '../../contract/schema.js';
import { tupleAgeText } from '../lib/tuple-row.js';
import { CreatePlanButton } from './CreatePlanButton.js';
import { LinkIcon } from './LinkIcon.js';
import { headerControl, SectionHead } from './SectionHead.js';
import { ticketAnchor } from '../lib/agent-rows/delivery-view.js';

/** The button class of a fold control: a link-looking button that stays in the tab order. */
const FOLD_CLASS = 'delivery-text-link';

/** The four tracks of a ticket row from 640 px; below that the cells stack. */
const ROW_COLUMNS = 'grid grid-cols-[4.5rem_minmax(0,1fr)_auto_4.5rem] max-sm:grid-cols-1';

export interface TicketsSectionViewProps {
  issueAnswer: IssueAnswer | null | undefined;
  /** The open, unplanned tickets assigned to the reader, newest first. */
  assigned: readonly IssueRow[];
  /** The open, unplanned tickets of nobody or of someone else, newest first. */
  others: readonly IssueRow[];
  /** `waiting.unassigned`; `null` where the read carries none. */
  unassigned: number | null;
  /** `waiting.hidden`; `0` where the read holds nothing back. */
  hidden: number;
  showAll: boolean;
  onToggleShowAll: () => void;
  /** The host's hidden-ticket sentence and the reader-match notice, where `waitingView` reports them. */
  hiddenSentence: string | null;
  notice: string | null;
  /** The sentence naming why the tracker gave no tickets; `''` where it answered. */
  absence: string;
  idea: DispatchInfo;
  /** Whether the section is folded to its header line. */
  folded: boolean;
  onToggleFold: () => void;
  /** Whether the rows behind `… n more · show` show; the Delivery tab holds it, so a jump can open it. */
  foldOpen: boolean;
  onToggleFoldOpen: () => void;
}

/**
 * The Delivery tab's Tickets section: the tickets no plan names, with *Plan it ›* in Do.
 *
 * Every count, fold and refusal is the domain's (`ticketsSection`, `planItReason`);
 * this component renders them. The section carries the `tickets` anchor that the
 * Delivery tab's triage links scroll to.
 */
export function TicketsSectionView(props: TicketsSectionViewProps) {
  const { idea, issueAnswer = null, foldOpen } = props;
  const section = ticketsSection<IssueRow>({
    answer: issueAnswer,
    assigned: props.assigned,
    others: props.others,
    unassigned: props.unassigned,
    hidden: props.hidden,
    showAll: props.showAll,
    foldOpen,
  });
  const reason = planItReason(issueAnswer, idea.available);
  return (
    <section id={TICKETS_ANCHOR} data-section="tickets" data-tickets-state={section.state} className="delivery-card space-y-2">
      <SectionHead
        section="tickets"
        label="Tickets"
        folded={props.folded}
        onToggle={props.onToggleFold}
        summary={props.folded && section.state === 'rows' && section.rows.length === 0 ? <span data-section-empty className="delivery-text-muted">— none</span> : null}
      >
        <h2 data-delivery-section="tickets" className="delivery-title flex items-baseline gap-1">
          Tickets
        </h2>
        {section.state === 'rows' && (
          <p data-tickets-header className="delivery-counts gap-x-1">
            <span>{section.header}</span>
            {section.showAllControl && (
              <>
                <span aria-hidden>·</span>
                <button
                  type="button"
                  {...headerControl}
                  data-tickets-show-all
                  aria-expanded={props.showAll}
                  onClick={(e) => { e.stopPropagation(); props.onToggleShowAll(); }}
                  className={FOLD_CLASS}
                >
                  show all
                </button>
              </>
            )}
          </p>
        )}
      </SectionHead>
      {props.folded ? null : section.state !== 'rows' ? (
        <p data-tickets-absent={section.state} data-issue-error={section.state === 'failed' ? '' : undefined} data-issue-absence={section.state === 'unsupported' ? '' : undefined} className="delivery-text-muted px-3 text-[13px]">
          {props.absence !== '' ? props.absence : section.state === 'unasked' ? 'the tracker has not been read yet' : 'the tracker gave no answer'}
        </p>
      ) : (
        <>
          {props.notice !== null && <p data-waiting-notice className="delivery-text-muted px-3 text-xs">{props.notice}</p>}
          {props.hiddenSentence !== null && <p data-waiting-hidden-text className="delivery-text-muted px-3 text-xs">{props.hiddenSentence}</p>}
          <ul role="grid" aria-label="Tickets" className="delivery-grid">
            <li role="row" className="hidden sm:grid grid-cols-[4.5rem_minmax(0,1fr)_auto_4.5rem] gap-x-3 px-3 delivery-thead">
              <span role="columnheader">Kind</span>
              <span role="columnheader">Ticket</span>
              <span role="columnheader">Do</span>
              <span role="columnheader">Age</span>
            </li>
            {section.rows.map((issue) => (
              <li
                key={issue.number}
                id={ticketAnchor(issue.number)}
                role="row"
                data-issue-row={issue.number}
                className={`${ROW_COLUMNS} delivery-row delivery-row-ruled items-baseline gap-x-3 px-3`}
              >
                <span role="gridcell" className="delivery-kind">Ticket</span>
                <span role="gridcell" className="flex min-w-0 items-baseline" title={`${issue.number}: ${issue.title}`}>
                  <LinkIcon kind={linkIconKind('ticket')} />
                  {issue.url !== '' ? (
                    <a href={issue.url} target="_blank" rel="noreferrer" data-issue-link className="delivery-text-link inline-block min-h-6 min-w-0 max-w-full truncate align-middle leading-6">
                      <span data-issue-number>{issue.number}</span>: {issue.title}
                    </a>
                  ) : (
                    <span className="delivery-truncate"><span data-issue-number>{issue.number}</span>: {issue.title}</span>
                  )}
                </span>
                <span role="gridcell" data-tickets-do data-plan-it-reason={reason ?? undefined} className="delivery-text-link inline-flex items-baseline">
                  <LinkIcon kind={linkIconKind('plan')} />
                  <CreatePlanButton issue={issue} idea={idea} issueAnswer={issueAnswer} label="Plan it ›" />
                </span>
                <span role="gridcell" className="delivery-text-muted sm:text-right">
                  {issue.ageMinutes === null ? '' : tupleAgeText(issue.ageMinutes)}
                </span>
              </li>
            ))}
            {section.foldLabel !== null && (
              <li role="row" className="delivery-row delivery-row-ruled delivery-text-muted px-3">
                <span role="gridcell">
                  <button
                    type="button"
                    data-tickets-fold
                    aria-expanded={foldOpen}
                    onClick={props.onToggleFoldOpen}
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
