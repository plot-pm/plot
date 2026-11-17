import type { FixerAttemptsRecord } from '../entities/fixer-attempts.js';
import type { AgentRole } from './delivery-placement.js';
import { reviewRunLive, type ReviewRunEntry } from './review-run.js';

/** The roles whose agent the board reads from a state file rather than from the registry. */
export type RunRole = 'reviewer' | 'fixer' | 'design' | 'verify';

/** One agent that a state file shows running, with the facts its reading carries. */
export interface RoleRun {
  /** `agent:<role>:<subject>`; stable while the run lives. */
  id: string;
  role: RunRole;
  /** The PR the run acts on; absent for a design or verify run. */
  pr?: number;
  /** The plan the run acts on; absent for a reviewer or fixer run. */
  plan?: string;
  /** Epoch milliseconds of the start; `null` where the source carries none. */
  startedAt: number | null;
  /** Present on a design or verify run that stopped or failed: what the state file recorded about it. */
  stopped?: StoppedRun;
}

/** What a pass recorded about a run that stopped or failed. */
export interface StoppedRun {
  reason: string;
  /** The command that restarts the run. */
  restart: string;
  /** The log path of the failed run. */
  log: string;
}

/** One live-or-dead review entry and whether its pid answered. */
export interface ReviewRead {
  entry: ReviewRunEntry;
  pidAlive: boolean;
}

/** One PR's fixer-attempts record as read. */
export interface FixerRead {
  pr: number;
  record: FixerAttemptsRecord | 'none' | 'unreadable';
}

/** A pass's status file reduced to the plans it has a run for. */
export interface PlanRunsRead {
  running: readonly string[];
  /** The runs the pass recorded as stopped or failed, by plan. Absent reads as none. */
  stopped?: readonly (StoppedRun & { plan: string })[];
}

/**
 * What each state file said. A source that could not be read is `null` and
 * yields no agent of its role; the other sources are unaffected.
 */
export interface RoleReadings {
  reviews: readonly ReviewRead[] | null;
  fixers: readonly FixerRead[] | null;
  design: PlanRunsRead | null;
  verify: PlanRunsRead | null;
  /** Epoch milliseconds. */
  now: number;
}

const parseTime = (iso: string): number | null => {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : at;
};

/**
 * Reads the reviewer, fixer, design and verify agents from the state files.
 *
 * A review entry counts while {@link reviewRunLive} says so. A fixer counts
 * only where an attempt carries an `inFlight` mark; the attempt record alone is
 * not a run, and an unreadable record shows no agent. A design or verify run
 * carries no start time. A design or verify run that a pass recorded as stopped
 * or failed, and that is not running again, is a run with a `stopped` fact. The approver has no source and never appears.
 *
 * @param readings - what each state file said.
 * @returns one run per live source entry, in the order reviewer, fixer, design, verify.
 */
export const roleRuns = (readings: RoleReadings): RoleRun[] => {
  const runs: RoleRun[] = [];
  for (const { entry, pidAlive } of readings.reviews ?? []) {
    if (!reviewRunLive(entry, pidAlive, readings.now)) continue;
    runs.push({ id: `agent:reviewer:${entry.pr}:${entry.head.slice(0, 7)}`, role: 'reviewer', pr: entry.pr, startedAt: entry.startedAt });
  }
  for (const { pr, record } of readings.fixers ?? []) {
    if (record === 'none' || record === 'unreadable') continue;
    const marks = record.attempts.flatMap((attempt) => (attempt.inFlight === undefined ? [] : [attempt.inFlight]));
    const mark = marks[marks.length - 1];
    if (mark === undefined) continue;
    runs.push({ id: `agent:fixer:${pr}`, role: 'fixer', pr, startedAt: parseTime(mark.startedAt) });
  }
  for (const plan of readings.design?.running ?? []) {
    runs.push({ id: `agent:design:${plan}`, role: 'design', plan, startedAt: null });
  }
  stoppedRuns(runs, 'design', readings.design);
  for (const plan of readings.verify?.running ?? []) {
    runs.push({ id: `agent:verify:${plan}`, role: 'verify', plan, startedAt: null });
  }
  stoppedRuns(runs, 'verify', readings.verify);
  return runs;
};

const stoppedRuns = (runs: RoleRun[], role: 'design' | 'verify', read: PlanRunsRead | null): void => {
  const going = new Set(read?.running ?? []);
  for (const { plan, ...stopped } of read?.stopped ?? []) {
    if (going.has(plan)) continue;
    runs.push({ id: `agent:${role}:${plan}`, role, plan, startedAt: null, stopped });
  }
};

/** The palette keys a chip takes; the component maps each to the board's classes. */
export type ChipColour = 'blue' | 'amber' | 'violet' | 'emerald' | 'sky' | 'teal' | 'rose' | 'orange';

/** One role's chip: the word, the colour key and the accessible name. */
export interface RoleChip {
  label: string;
  colour: ChipColour;
  name: string;
}

const CHIPS: Readonly<Record<AgentRole, RoleChip>> = {
  loop: { label: 'loop', colour: 'blue', name: 'Agent role: loop' },
  fixer: { label: 'fixer', colour: 'amber', name: 'Agent role: fixer' },
  reviewer: { label: 'reviewer', colour: 'violet', name: 'Agent role: reviewer' },
  approver: { label: 'approver', colour: 'emerald', name: 'Agent role: approver' },
  idea: { label: 'idea', colour: 'sky', name: 'Agent role: idea' },
  brief: { label: 'brief', colour: 'teal', name: 'Agent role: brief' },
  design: { label: 'design', colour: 'rose', name: 'Agent role: design' },
  verify: { label: 'verify', colour: 'orange', name: 'Agent role: verify' },
};

/**
 * The chip a role shows.
 *
 * @param role - the agent's role.
 * @returns the label, the colour key and the accessible name.
 */
export const roleChip = (role: AgentRole): RoleChip => CHIPS[role];
