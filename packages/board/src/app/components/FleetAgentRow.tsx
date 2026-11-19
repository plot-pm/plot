import { AGENT_COLUMN_LABELS, type AgentRowCells } from '@plot-pm/domain';
import { RowCell, type LinkHandlers } from './DeliveryRows.js';

/** The column header of a Fleet group's agent rows; `doing` reads `Waits on` in Blocked. */
export const FleetAgentHeader = ({ blocked }: { blocked: boolean }) => (
  <li role="row" data-fleet-agent-header className="hidden sm:grid grid-cols-[minmax(0,1.2fr)_5rem_minmax(0,1.5fr)_minmax(0,2fr)_4rem_5rem] gap-x-3 px-3 delivery-thead">
    <span role="columnheader">{AGENT_COLUMN_LABELS.agent}</span>
    <span role="columnheader">{AGENT_COLUMN_LABELS.role}</span>
    <span role="columnheader">{AGENT_COLUMN_LABELS.actingOn}</span>
    <span role="columnheader">{blocked ? 'Waits on' : AGENT_COLUMN_LABELS.doing}</span>
    <span role="columnheader">{AGENT_COLUMN_LABELS.tokens}</span>
    <span role="columnheader">{AGENT_COLUMN_LABELS.timeLeft}</span>
  </li>
);

const DASH = '—';

/**
 * The six cells of one Fleet agent: Agent · Role · Acting on · Doing now (Waits
 * on in Blocked) · Tokens · Time left. Every value comes from `agentRowCells`;
 * this component decides nothing.
 *
 * @param id - the agent's placement id.
 * @param cells - the domain's cells for the agent.
 * @param handlers - what a click on a link does.
 */
export const FleetAgentRow = ({ id, cells, handlers }: { id: string; cells: AgentRowCells; handlers: LinkHandlers }) => (
  <li
    role="row"
    data-fleet-agent-row={id}
    className="delivery-row grid grid-cols-[minmax(0,1.2fr)_5rem_minmax(0,1.5fr)_minmax(0,2fr)_4rem_5rem] items-baseline gap-x-3 px-3 max-sm:grid-cols-1"
  >
    <span role="gridcell" data-agent-cell="agent" title={cells.agentTitle ?? undefined} className="delivery-truncate">
      <span aria-hidden="true" data-agent-dot className="delivery-dot" />
      <RowCell cell={cells.agent} handlers={handlers} />
    </span>
    <span role="gridcell" data-agent-cell="role"><RowCell cell={cells.role} handlers={handlers} /></span>
    <span role="gridcell" data-agent-cell="actingOn" className="delivery-truncate">
      <RowCell cell={cells.actingOn} handlers={handlers} />
      {cells.branch !== null && (
        <span data-agent-branch className="delivery-truncate delivery-text-muted block">
          <RowCell cell={cells.branch} handlers={handlers} />
        </span>
      )}
    </span>
    <span role="gridcell" data-agent-cell="doing" data-doing-label={cells.doingLabel} className="delivery-truncate">
      <RowCell cell={cells.doing} handlers={handlers} />
      {cells.doingDetail !== null && (
        <span data-agent-detail className="delivery-truncate delivery-text-muted block" title={cells.doingDetail}>{cells.doingDetail}</span>
      )}
    </span>
    <span role="gridcell" data-agent-cell="tokens" title={cells.tokensTitle ?? undefined} className="delivery-text-muted">
      {cells.tokens === null ? DASH : cells.tokens.value}
    </span>
    <span role="gridcell" data-agent-cell="timeLeft" className="delivery-text-muted">
      {cells.timeLeft === null ? DASH : cells.timeLeft.value}
      {cells.timeLeftBar !== null && (
        <span
          data-time-left-bar
          data-time-left-red={cells.timeLeftBar.red ? 'true' : 'false'}
          role="presentation"
        >
          <span
            data-time-left-fill
            style={{ width: `${Math.round(cells.timeLeftBar.fraction * 100)}%` }}
          />
        </span>
      )}
    </span>
  </li>
);
