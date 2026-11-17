import type { FleetGroup } from './delivery-placement.js';

/** What the fleet is doing, read from its agents' groups. */
export type FleetCardState = 'idle' | 'working' | 'blocked';

/** The Delivery tab's fleet card: the state and one count per agent group. */
export interface FleetCard {
  state: FleetCardState;
  free: number;
  working: number;
  blocked: number;
}

/**
 * Reads the fleet card from the placed agents.
 *
 * The state is `blocked` when any agent is blocked, else `working` when any is
 * working, else `idle`. A fleet with no agents is `idle` with three zeros. An
 * agent the placement rule could not place (an unread process) is not in
 * `agents`, so it is counted in no group and does not make the fleet idle.
 *
 * @param agents The placed agents; only `group` is read.
 */
export const fleetCard = (agents: readonly { group: FleetGroup }[]): FleetCard => {
  const count = (group: FleetGroup): number => agents.filter((a) => a.group === group).length;
  const free = count('free');
  const working = count('working');
  const blocked = count('blocked');
  const state: FleetCardState = blocked > 0 ? 'blocked' : working > 0 ? 'working' : 'idle';
  return { state, free, working, blocked };
};
