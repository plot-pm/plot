import type { AgentStateReadings } from './agent-state.js';

/** What was measured of a slice's desk: the readings `agentState` takes, or a failed read. */
export type DeskDeadReadings = ({ read: 'desk' } & AgentStateReadings) | { read: 'unread' };

/** Why a desk is not dead. */
export type DeskLife = 'live' | 'waiting' | 'elsewhere' | 'unread';

/** Whether a slice's desk is dead, and if not, why. */
export type DeskDeadAnswer = { dead: true } | { dead: false; why: DeskLife };

/**
 * Whether a slice's desk is dead.
 *
 * Reads the values {@link agentState} reads and answers a narrower question:
 * can the desk's agent still be trusted to act. In order:
 *
 * 1. A failed read is `unread`, which holds.
 * 2. No worktree on this machine is `elsewhere`; the agent may run on another.
 * 3. A `PLOT-BLOCKED` marker is `waiting` for a person.
 * 4. A live pid is `live`.
 * 5. Everything else is dead: a stale, orphaned, dead or unrecorded pid.
 *
 * @param readings - what was measured of the desk.
 * @returns `{ dead: true }`, or `{ dead: false, why }`.
 */
export const deskDead = (readings: DeskDeadReadings): DeskDeadAnswer => {
  if (readings.read === 'unread') return { dead: false, why: 'unread' };
  if (!readings.worktreeHere) return { dead: false, why: 'elsewhere' };
  if (readings.task.blocked) return { dead: false, why: 'waiting' };
  if (readings.pidRecorded && readings.liveness === 'live') return { dead: false, why: 'live' };
  return { dead: true };
};
