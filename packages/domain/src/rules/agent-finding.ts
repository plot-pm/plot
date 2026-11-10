import type { WorkerState } from '../entities/fleet.js';
import type { Finding } from '../entities/finding.js';

/** The four findings the AgentMonitor reports about a desk. */
export type AgentFindingName = 'owes an answer' | 'holds unlanded work' | 'owes a review' | 'owes a gate';

/** Whether the branch has a pull request: one exists, none exists, or the answer is not licensed. */
export type PrAnswer = 'has' | 'none' | 'unaskable';

/** What {@link agentFinding} reads about one desk. */
export interface AgentFindingReadings {
  /** The desk's absolute path, which the evidence names. */
  readonly worktree: string;
  /** The `PLOT-BLOCKED*` filenames at the desk's root. */
  readonly markers: readonly string[];
  /** The uncommitted paths, or `'unknown'` where they could not be read. */
  readonly dirty: readonly string[] | 'unknown';
  /** The commits on the desk's `HEAD` that no remote holds, or `'unknown'`. */
  readonly unpushed: readonly string[] | 'unknown';
  /** The branch's commits ahead of the default branch, empty claim commits excluded, or `'unknown'`. */
  readonly commitsAhead: number | 'unknown';
  /** Whether the branch has a pull request. */
  readonly pr: PrAnswer;
  /** Whether the branch adds a `.changeset/*.md` file. */
  readonly changeset: 'has' | 'none' | 'unknown';
}

/** One finding and the measurement behind it. */
export interface AgentFindingAnswer {
  readonly finding: AgentFindingName;
  readonly evidence: string;
}

/**
 * The finding a desk holds, in the AgentMonitor's order: marker, dirty tree,
 * unpushed commits, no commits, no PR, no changeset.
 *
 * A reading the next arm needs that is unknown answers `unknown`, which
 * keeps the finding the desk already holds.
 *
 * @param readings - the desk's readings.
 * @returns the first finding that holds; `null` where the desk owes nothing;
 *   `unknown` where a reading the answer needs is unknown.
 */
export const agentFinding = (readings: AgentFindingReadings): AgentFindingAnswer | null | 'unknown' => {
  const { worktree, markers, dirty, unpushed, commitsAhead, pr, changeset } = readings;
  if (markers.length > 0) {
    return {
      finding: 'owes an answer',
      evidence: `a ${markers[0]} marker is in the tree at ${worktree}; the agent stopped and a person has not answered`,
    };
  }
  if (dirty === 'unknown') return 'unknown';
  if (dirty.length > 0) {
    return {
      finding: 'holds unlanded work',
      evidence: `${dirty.length} uncommitted file(s) at ${worktree}, the first being ${dirty[0]}; the work exists only on this desk`,
    };
  }
  if (unpushed === 'unknown') return 'unknown';
  if (unpushed.length > 0) {
    return {
      finding: 'holds unlanded work',
      evidence: 'the branch carries commits its upstream does not have; the work exists only on this machine',
    };
  }
  if (commitsAhead === 'unknown') return 'unknown';
  if (commitsAhead === 0) return null;
  if (pr === 'unaskable') return 'unknown';
  if (pr === 'none') {
    return {
      finding: 'owes a review',
      evidence: 'the branch carries commits, the tree is clean and no PR exists; finished work is invisible',
    };
  }
  if (changeset === 'unknown') return 'unknown';
  if (changeset === 'none') {
    return {
      finding: 'owes a gate',
      evidence: 'the branch has a PR but adds no .changeset/*.md; it would land red on the changeset gate',
    };
  }
  return null;
};

/**
 * Whether the finding depends on the PR answer: no marker, a clean and pushed
 * tree, and commits ahead.
 *
 * @param readings - the desk's readings; `pr` is not read.
 * @returns true where only the PR answer and the changeset decide the finding.
 */
export const needsPrAnswer = (readings: Omit<AgentFindingReadings, 'pr'>): boolean =>
  readings.markers.length === 0 &&
  readings.dirty !== 'unknown' &&
  readings.dirty.length === 0 &&
  readings.unpushed !== 'unknown' &&
  readings.unpushed.length === 0 &&
  readings.commitsAhead !== 'unknown' &&
  readings.commitsAhead > 0;

/**
 * The PR answer of a per-pass branch reading.
 *
 * @param pr - the branch stage's PR reading; it reads `none` only from a whole listing.
 * @returns `has` for a listed PR in any state, `none` for a licensed `none`, `unaskable` otherwise.
 */
export const passPrAnswer = (pr: string): PrAnswer => {
  if (pr === 'OPEN' || pr === 'MERGED' || pr === 'CLOSED') return 'has';
  return pr === 'none' ? 'none' : 'unaskable';
};

/**
 * The PR answer of one host lookup for the branch.
 *
 * @param answer - the host's answer: a PR, `null` for none, or a failure.
 * @returns `has`, `none`, or `unaskable` for a refused or failed lookup.
 */
export const lookupPrAnswer = (answer: { readonly ok: true; readonly value: unknown } | { readonly ok: false }): PrAnswer => {
  if (!answer.ok) return 'unaskable';
  return answer.value === null ? 'none' : 'has';
};

/** A changeset file: a markdown file directly under `.changeset/`. */
const CHANGESET_FILE = /^\.changeset\/[^/]+\.md$/;

/**
 * Whether a branch's changed paths add a changeset.
 *
 * @param changedPaths - the paths the branch changed against the default branch.
 * @param cap - the most paths the reader lists; a list that reached it is not whole.
 * @returns `has`; `none` for a whole list with no changeset; `unknown` for a capped list with none.
 */
export const changesetReading = (changedPaths: readonly string[], cap: number): 'has' | 'none' | 'unknown' => {
  if (changedPaths.some((path) => CHANGESET_FILE.test(path))) return 'has';
  return changedPaths.length >= cap ? 'unknown' : 'none';
};

/** What {@link agentFindingLine} compares. */
export interface AgentFindingChange {
  /** The AgentMonitor finding the desk's file currently holds for the branch, or `null`. */
  readonly held: Finding | null;
  /** The finding this pass reads, `null` for none, or `unknown`. */
  readonly next: AgentFindingAnswer | null | 'unknown';
  /** The branch the line names. */
  readonly branch: string;
  /** The desk the line names. */
  readonly worktree: string;
  /** The reading's time, as `monitorTime` prints it. */
  readonly at: string;
}

/**
 * The AgentMonitor line to append, written only when the finding changes.
 *
 * @param change - the held finding, the new one, and the line's subject.
 * @returns a new finding; `clear` naming the finding that stopped holding;
 *   or `null` where the finding name is unchanged or the new reading is `unknown`.
 */
export const agentFindingLine = (change: AgentFindingChange): Finding | null => {
  const { held, next, branch, worktree, at } = change;
  if (next === 'unknown') return null;
  const heldName = held === null || held.finding === 'clear' ? null : held.finding;
  if ((next?.finding ?? null) === heldName) return null;
  const base = { monitor: 'AgentMonitor' as const, branch, worktree };
  if (next !== null) return { ...base, finding: next.finding, since: at, evidence: next.evidence, measuredAt: at };
  return {
    ...base,
    finding: 'clear',
    since: at,
    evidence: `the ${heldName} finding no longer holds; this desk owes nothing measurable`,
    measuredAt: at,
  };
};

/** The worker states that follow an agent's end. */
const ENDED: ReadonlySet<WorkerState> = new Set<WorkerState>(['finished', 'failed', 'ended', 'waiting', 'stalled']);

/**
 * Whether the final pass is due for a desk: its worker ended since the last
 * reading, or the desk is first read ended.
 *
 * @param previous - the state the previous pass read; `undefined` where no pass read the desk.
 * @param current - the state this pass reads.
 * @returns true once per agent end.
 */
export const finalPassDue = (previous: WorkerState | undefined, current: WorkerState): boolean =>
  ENDED.has(current) && (previous === undefined || previous === 'running');
