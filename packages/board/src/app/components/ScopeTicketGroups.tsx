import { useContext } from 'react';
import type { ScopeTicketGroup, ScopeTicketRowView, ScopeTickets } from '@plot-pm/domain/rules/scope-tickets';
import { planRoute } from '@plot-pm/domain/rules/plan-reference';
import type { CardFacts } from '@plot-pm/domain/entities/card-facts';
import type { DispatchInfo, IssueAnswer, PlanTicketRow } from '../../contract/schema.js';
import { artifactTuple } from '../lib/tuple-row.js';
import { ScopeTicketActions } from '../lib/agent-rows/menus.js';
import { LinkTupleView } from './TupleRow.js';
import { TicketHrefContext } from './PlanTicketKeys.js';

/** The four tracks of a scope row from 640 px — Kind, Ticket, State, and the `⋯` last; below that the cells stack. */
const ROW_COLUMNS = 'grid grid-cols-[4.5rem_minmax(0,1fr)_minmax(4.5rem,auto)_var(--delivery-menu-track)] max-sm:grid-cols-1';

/** The button class of a fold control: a link-looking button that stays in the tab order. */
const FOLD_CLASS = 'delivery-text-link';

export interface ScopeTicketGroupsProps {
  scope: ScopeTickets<PlanTicketRow>;
  /** Whether each group is folded, by its fold key. */
  folded: (key: ScopeTicketGroup<PlanTicketRow>['key']) => boolean;
  onToggle: (key: ScopeTicketGroup<PlanTicketRow>['key']) => void;
  /** The plan file of a scope plan's slug; `''` where the board holds no card for it. */
  planFileOf: (slug: string) => string;
  /** The address of a scope PR; `''` where the board holds none. */
  prUrlOf: (pr: number) => string;
  /** `issueNote(fleet)`: why the tracker gave no tickets; Found shows it in place of its review findings while unread. */
  unreadNote: string | null;
  idea: DispatchInfo;
  story: DispatchInfo;
  issueAnswer: IssueAnswer | null;
  facts?: ReadonlyMap<string, CardFacts>;
}

/**
 * The Tickets section's Delivered by the sprint and Found during the sprint groups, each behind its own fold.
 *
 * Every row, word, count and menu arm is `scopeTickets`'; this component renders them.
 */
export const ScopeTicketGroups = (props: ScopeTicketGroupsProps) => (
  <>
    {[props.scope.delivered, props.scope.found].map((group) => (
      <Group key={group.key} group={group} {...props} />
    ))}
  </>
);

const Group = ({ group, ...props }: ScopeTicketGroupsProps & { group: ScopeTicketGroup<PlanTicketRow> }) => {
  const folded = props.folded(group.key);
  return (
    <div data-tickets-group={group.key} data-group-unread={group.unread ? '' : undefined} className="space-y-1">
      <p className="delivery-counts px-3">
        <button
          type="button"
          data-tickets-group-toggle={group.key}
          aria-expanded={!folded}
          onClick={() => props.onToggle(group.key)}
          className={FOLD_CLASS}
        >
          <span aria-hidden="true" className={`inline-block w-4 text-center transition-transform ${folded ? '' : 'rotate-90'}`}>▸</span>
          {group.heading}
        </button>
      </p>
      {!folded && (
        <>
          {group.rows.length === 0 ? (
            <p data-tickets-group-empty className="delivery-text-muted px-3 text-xs">{group.empty}</p>
          ) : (
            <ul role="grid" aria-label={group.label} className="delivery-grid">
              {group.rows.map((row) => <Row key={`${row.key} ${row.plan}`} row={row} {...props} />)}
            </ul>
          )}
          {group.key === 'tickets-found' && group.unread && props.unreadNote !== null && props.unreadNote !== '' && (
            <p data-tickets-group-unread className="delivery-text-muted px-3 text-xs">{props.unreadNote}</p>
          )}
          {group.incomplete !== null && <p data-tickets-group-incomplete className="delivery-text-muted px-3 text-xs">{group.incomplete}</p>}
        </>
      )}
    </div>
  );
};

const Row = ({ row, ...props }: ScopeTicketGroupsProps & { row: ScopeTicketRowView<PlanTicketRow> }) => {
  const ticketHref = useContext(TicketHrefContext);
  const file = props.planFileOf(row.plan);
  const prUrl = row.pr === null ? '' : props.prUrlOf(row.pr);
  return (
    <li
      role="row"
      data-scope-ticket={row.key}
      data-scope-kind={row.kind}
      data-scope-plan={row.plan}
      className={`${ROW_COLUMNS} delivery-row delivery-row-ruled items-baseline gap-x-3 px-3`}
    >
      <span role="gridcell" className="delivery-kind">{row.kindLabel}</span>
      <span role="gridcell" className="flex min-w-0 items-center gap-1.5" title={row.issue === null ? row.key : `${row.key}: ${row.issue.title}`}>
        <LinkTupleView segments={artifactTuple({ what: 'ticket', label: row.key, href: row.menu.openOnHost.href }, () => undefined)} />
        {row.issue !== null && <span className="delivery-truncate">{row.issue.title}</span>}
        {row.pr !== null && <LinkTupleView segments={artifactTuple({ what: 'pr', label: `#${row.pr}`, href: prUrl }, ticketHref)} />}
        <LinkTupleView segments={artifactTuple({ what: 'plan', label: row.plan, href: file === '' ? '' : planRoute(file), internal: true, file }, ticketHref)} />
      </span>
      <span role="gridcell" data-scope-state className="delivery-text-muted sm:text-right">{row.stateText}</span>
      <span role="gridcell" data-row-cell="do" className="relative flex w-5 shrink-0 items-center justify-end">
        <ScopeTicketActions
          ticketKey={row.key}
          issue={row.issue}
          menu={row.menu}
          idea={props.idea}
          story={props.story}
          issueAnswer={props.issueAnswer}
          facts={props.facts?.get(row.key)}
        />
      </span>
    </li>
  );
};
