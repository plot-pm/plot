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
    className="grid grid-cols-[minmax(0,1.2fr)_5rem_minmax(0,1.5fr)_minmax(0,2fr)_4rem_5rem] items-baseline gap-x-3 px-3 py-1 text-sm max-sm:grid-cols-1"
  >
    <span role="gridcell" data-agent-cell="agent" title={cells.agentTitle ?? undefined} className="min-w-0 truncate font-mono text-xs">
      <RowCell cell={cells.agent} handlers={handlers} />
    </span>
    <span role="gridcell" data-agent-cell="role"><RowCell cell={cells.role} handlers={handlers} /></span>
    <span role="gridcell" data-agent-cell="actingOn" className="min-w-0 truncate">
      <RowCell cell={cells.actingOn} handlers={handlers} />
      {cells.branch !== null && (
        <span data-agent-branch className="block truncate font-mono text-xs text-slate-500 dark:text-slate-400">
          <RowCell cell={cells.branch} handlers={handlers} />
        </span>
      )}
    </span>
    <span role="gridcell" data-agent-cell="doing" data-doing-label={cells.doingLabel} className="min-w-0 truncate">
      <RowCell cell={cells.doing} handlers={handlers} />
      {cells.doingDetail !== null && (
        <span data-agent-detail className="block truncate text-xs text-slate-500 dark:text-slate-400">{cells.doingDetail}</span>
      )}
    </span>
    <span role="gridcell" data-agent-cell="tokens" title={cells.tokensTitle ?? undefined} className="text-slate-400">
      {cells.tokens === null ? DASH : cells.tokens.value}
    </span>
    <span role="gridcell" data-agent-cell="timeLeft" className="text-slate-400">
      {cells.timeLeft === null ? DASH : cells.timeLeft.value}
      {cells.timeLeftBar !== null && (
        <span
          data-time-left-bar
          data-time-left-red={cells.timeLeftBar.red ? 'true' : 'false'}
          role="presentation"
          className="mt-0.5 block h-1 rounded bg-slate-200 dark:bg-slate-700"
        >
          <span
            className={`block h-1 rounded ${cells.timeLeftBar.red ? 'bg-red-500' : 'bg-emerald-500'}`}
            style={{ width: `${Math.round(cells.timeLeftBar.fraction * 100)}%` }}
          />
        </span>
      )}
    </span>
  </li>
);
