import type { AgentState } from '../entities/agent.js';
import { pill, type StatusPill } from './status-pill.js';

/**
 * The states a Fleet agent row reads: the domain's eight, and the registry's `unknown`, which means nobody could
 * ask the process.
 */
export type FleetAgentState = AgentState | 'unknown';

/** The one pill of each agent state, in whole words. */
export const AGENT_STATE_PILLS: Readonly<Record<FleetAgentState, StatusPill>> = {
  running: pill('running', 'green'),
  waiting: pill('asks a question', 'amber'),
  stalled: pill('stalled', 'red'),
  finished: pill('finished', 'blue'),
  failed: pill('failed', 'red'),
  ended: pill('ended', 'grey'),
  none: pill('no worker', 'grey'),
  elsewhere: pill('on another machine', 'quiet'),
  unknown: pill('not read', 'quiet'),
};

/**
 * The status pills of a Fleet agent row.
 *
 * @param state - the agent's state word.
 * @returns one pill for the state; a word outside {@link FleetAgentState} reads as `unknown`.
 */
export const agentPills = (state: string): StatusPill[] =>
  [AGENT_STATE_PILLS[(Object.hasOwn(AGENT_STATE_PILLS, state) ? state : 'unknown') as FleetAgentState]];

/** The supervisor states the board reads: `up`, `down`, `died`, and `unknown` where nobody could ask. */
export type FleetSupervisorState = 'up' | 'down' | 'died' | 'unknown';

/** The Fleet switch row: whether it shows, and the fleet state it shows for. */
export interface FleetSwitchRow {
  shows: boolean;
  /** `running` for an `up` supervisor, `stopped` for `down` or `died`, `unread` for `unknown` or no reading. */
  fleet: 'running' | 'stopped' | 'unread';
}

/**
 * The switch row at the top of the open Fleet section.
 *
 * The switches set what the fleet does when it runs, so the row shows for a running, a stopped and an unread fleet.
 *
 * @param fleet - the supervisor reading; `null` where the payload carries none.
 * @returns the row, with the fleet state it shows for.
 */
export const fleetSwitchRow = (fleet: { state: FleetSupervisorState } | null): FleetSwitchRow => {
  if (fleet === null || fleet.state === 'unknown') return { shows: true, fleet: 'unread' };
  return { shows: true, fleet: fleet.state === 'up' ? 'running' : 'stopped' };
};
