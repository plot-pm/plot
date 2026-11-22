import type { ReactNode } from 'react';
import { AGENT_COLUMN_LABELS, type AgentRole, type AgentRowCells, type RoleRun } from '@plot-pm/domain';
import type { FleetRowFacts } from '../lib/agent-rows/working-agents.js';
import { ActivitySlot } from '../lib/agent-rows/marks.js';
import { RoleChip } from './RoleChip.js';
import { RowCell, type LinkHandlers } from './DeliveryRows.js';

/** The column header of a Fleet group's agent rows; `doing` reads `Waits on` in Blocked. */
export const FleetAgentHeader = ({ blocked }: { blocked: boolean }) => (
  <li role="row" data-fleet-agent-header className="hidden sm:grid grid-cols-[minmax(0,1.2fr)_5rem_minmax(0,1.5fr)_minmax(0,2fr)_4rem_6rem_1rem_var(--delivery-menu-track)] gap-x-3 px-3 delivery-thead">
    <span role="columnheader">{AGENT_COLUMN_LABELS.agent}</span>
    <span role="columnheader">{AGENT_COLUMN_LABELS.role}</span>
    <span role="columnheader">{AGENT_COLUMN_LABELS.actingOn}</span>
    <span role="columnheader">{blocked ? 'Waits on' : AGENT_COLUMN_LABELS.doing}</span>
    <span role="columnheader">{AGENT_COLUMN_LABELS.tokens}</span>
    <span role="columnheader">{AGENT_COLUMN_LABELS.timeLeft}</span>
    <span role="columnheader"><span className="sr-only">Details</span></span>
    <span role="columnheader"><span className="sr-only">Actions</span></span>
  </li>
);

const DASH = '—';

/**
 * The six cells of one Fleet agent: Agent · Role · Acting on · Doing now (Waits
 * on in Blocked) · Tokens · Time left, with the idle time beneath Time left,
 * the details popover, and the row's `⋯` menu in the last track, whose width
 * is `--delivery-menu-track`. Every value comes from `agentRowCells`; this
 * component decides nothing. It is the agent's one row.
 *
 * @param id - the agent's placement id.
 * @param cells - the domain's cells for the agent.
 * @param handlers - what a click on a link does.
 * @param role - the agent's role, for its chip.
 * @param facts - the row's anchor, availability, identity and note (`fleetRowFacts`).
 * @param run - the state-file run the row stands for, where the registry holds none.
 * @param highlighted - the row is the one an agent panel just revealed.
 * @param menu - the row's actions, or nothing where the agent offers none.
 * @param details - the details popover's lines: pid, manifest counts and the like.
 */
export const FleetAgentRow = ({ id, cells, handlers, role, facts, run = null, highlighted = false, menu = null, details = [] }: {
  id: string;
  cells: AgentRowCells;
  handlers: LinkHandlers;
  role: AgentRole;
  facts: FleetRowFacts;
  run?: RoleRun | null;
  highlighted?: boolean;
  menu?: ReactNode;
  details?: readonly string[];
}) => (
  <li
    role="row"
    data-fleet-agent-row={id}
    data-agent-row=""
    id={facts.anchorId ?? undefined}
    data-highlighted={highlighted ? 'true' : undefined}
    {...(facts.availability !== '' ? { 'data-agent-availability': facts.availability } : {})}
    {...(facts.undeclared ? { 'data-agent-undeclared': '' } : {})}
    {...(run !== null ? { 'data-role-run': run.role } : {})}
    className="delivery-row grid grid-cols-[minmax(0,1.2fr)_5rem_minmax(0,1.5fr)_minmax(0,2fr)_4rem_6rem_1rem_var(--delivery-menu-track)] items-baseline gap-x-3 px-3 max-sm:grid-cols-1"
  >
    <span role="gridcell" data-agent-cell="agent" title={cells.agentTitle ?? undefined} className="delivery-truncate">
      <span aria-hidden="true" data-agent-dot className="delivery-dot" />
      <RowCell cell={cells.agent} handlers={handlers} />
    </span>
    <span role="gridcell" data-agent-cell="role"><RoleChip role={role} /></span>
    <span role="gridcell" data-agent-cell="actingOn" className="delivery-truncate">
      <RowCell cell={cells.actingOn} handlers={handlers} />
      {cells.branch !== null && (
        <span data-agent-branch={cells.branch.value} className="delivery-truncate delivery-text-muted block">
          <RowCell cell={cells.branch} handlers={handlers} />
        </span>
      )}
    </span>
    <span role="gridcell" data-agent-cell="doing" data-doing-label={cells.doingLabel} className="delivery-truncate">
      {/* The slot is reserved while the agent is idle, so the Doing now text keeps its place when the spinner comes. */}
      <span className="mr-1 inline-block"><ActivitySlot pace={cells.doingPace} /></span>
      <RowCell cell={cells.doing} handlers={handlers} />
      {cells.doingDetail !== null && (
        <span data-agent-detail className="delivery-truncate delivery-text-muted block" title={cells.doingDetail}>{cells.doingDetail}</span>
      )}
      {facts.note !== '' && (
        <span data-row-note className="delivery-truncate delivery-text-muted block" title={facts.note}>{facts.note}</span>
      )}
      {run?.stopped !== undefined && run.stopped !== null && (
        <span className="delivery-text-muted block">
          <span data-plan-level-reason className="block delivery-truncate">{run.stopped.reason}</span>
          <span data-plan-level-restart className="block delivery-truncate font-mono">{run.stopped.restart}</span>
          <span data-plan-level-log className="block delivery-truncate font-mono">{run.stopped.log}</span>
        </span>
      )}
    </span>
    <span role="gridcell" data-agent-cell="tokens" title={cells.tokensTitle ?? undefined} className="delivery-text-muted">
      {cells.tokens === null ? DASH : cells.tokens.value}
    </span>
    <span role="gridcell" data-agent-cell="timeLeft" className="delivery-text-muted">
      {cells.timeLeft === null ? DASH : cells.timeLeft.value}
      {cells.idle !== null && <span data-agent-idle className="block">{cells.idle}</span>}
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
    <span role="gridcell" data-agent-cell="details" className="relative flex shrink-0 items-center justify-end">
      {details.length > 0 && (
        <details data-row-details className="relative shrink-0">
          <summary aria-label="Details" className="cursor-pointer select-none list-none text-xs">ⓘ</summary>
          <ul className="absolute right-0 z-10 mt-1 w-max max-w-[80vw] rounded border border-slate-200 bg-white p-2 font-mono text-xs shadow-sm dark:border-slate-700 dark:bg-slate-900">
            {details.map((line) => <li key={line} className="break-all">{line}</li>)}
          </ul>
        </details>
      )}
    </span>
    <span role="gridcell" data-row-cell="do" className="relative flex w-5 shrink-0 items-center justify-end">
      {menu}
    </span>
  </li>
);
