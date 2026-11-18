import type { AgentRole } from './delivery-placement.js';

/** Below this fraction of its bound left, an agent's Time left bar turns red. */
export const TIME_LEFT_RED_BELOW = 0.2;

/** The run bounds in seconds, by who sets them; `null` where the board could not read one. */
export interface AgentBounds {
  /** The `Worker bound` config key: loop, design and verify agents. */
  worker: number | null;
  /** The reviewer's bound. */
  reviewer: number | null;
  /** The fixer's bound. */
  fixer: number | null;
}

/** What one agent has left of its bound. */
export interface TimeLeft {
  /** Milliseconds left, never below zero. */
  leftMs: number;
  /** The share of the bound left, from 0 to 1. */
  fraction: number;
  /** Whether less than {@link TIME_LEFT_RED_BELOW} of the bound is left. */
  red: boolean;
}

/**
 * The bound that applies to an agent's role.
 *
 * @param role - the agent's role.
 * @param bounds - the bounds the server read.
 * @returns seconds, or `null` for a role with no bound (idea, brief, approver) and for an unread bound.
 */
export const boundSecondsOf = (role: AgentRole, bounds: AgentBounds | undefined): number | null => {
  if (bounds === undefined) return null;
  switch (role) {
    case 'loop':
    case 'design':
    case 'verify':
      return bounds.worker;
    case 'reviewer': return bounds.reviewer;
    case 'fixer': return bounds.fixer;
    case 'idea':
    case 'brief':
    case 'approver':
      return null;
  }
};

/**
 * Time left of a bound: `bound − (now − start)`, with the fraction left.
 *
 * A start later than `now` counts as no time elapsed. A start older than the
 * bound gives zero left and a red bar.
 *
 * @param startedAt - epoch milliseconds of the start, or `null` where none is known.
 * @param boundSeconds - the bound in seconds, or `null` where the role has none.
 * @param now - epoch milliseconds.
 * @returns the reading, or `null` where the start or the bound is absent, or the bound is not a positive number.
 */
export const timeLeft = (startedAt: number | null | undefined, boundSeconds: number | null | undefined, now: number): TimeLeft | null => {
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null;
  if (typeof boundSeconds !== 'number' || !Number.isFinite(boundSeconds) || boundSeconds <= 0) return null;
  const boundMs = boundSeconds * 1000;
  const elapsed = Math.max(0, now - startedAt);
  const leftMs = Math.max(0, boundMs - elapsed);
  return { leftMs, fraction: leftMs / boundMs, red: leftMs < boundMs * TIME_LEFT_RED_BELOW };
};

/**
 * Time left as the cell shows it: `7h 59m`, `42m`, `0m`.
 *
 * @param leftMs - milliseconds left.
 * @returns hours and minutes, or minutes alone under an hour.
 */
export const timeLeftValue = (leftMs: number): string => {
  const minutes = Math.max(0, Math.floor(leftMs / 60_000));
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};
