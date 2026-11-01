import { answered, failed, type PortResult } from '../port-result.js';
import type { AgentDesk, Agents } from '../ports/agents.js';
import type { ProcessReading, Processes } from '../ports/processes.js';
import type { Trees } from '../ports/trees.js';
import type { BranchStageReadings } from './plan-walk-branches.js';

/** One branch with a worktree on this machine, and every reading about who works it. */
export interface DeskReading {
  /** The branch as the plan names it. */
  branch: string;
  /** The worktree's absolute path. */
  worktree: string;
  /** The desk's markers, question, pid and exit record, from {@link Agents.desk}. */
  desk: AgentDesk;
  /** The process table's reading of the desk's worker, from {@link Processes.workerState}. */
  process: ProcessReading;
  /** Whether git holds an index lock on the worktree. */
  locked: boolean;
  /**
   * The commits on the worktree's `HEAD` no remote holds, or `'unknown'` where
   * they could not be counted. Matches `DeskReadings.unpushed`.
   */
  unpushed: readonly string[] | 'unknown';
  /**
   * Seconds since the newest thing in the desk's tree changed, or `null` where
   * there is nothing to read. A raw, wall-clock-dependent value: no rule
   * decides from it here.
   */
  quietSeconds: number | null;
  /**
   * The uncommitted paths {@link Trees.dirtyPaths} lists, or `'unknown'` where
   * they could not be read.
   */
  dirty: readonly string[] | 'unknown';
}

/** What the desk stage reads: one entry per branch that has a worktree. */
export interface DeskStageReadings {
  /** The default branch's commit the stage read at; the branch stage's. */
  mainSha: string;
  /** One entry per distinct branch with a live worktree, in branch-stage order. */
  desks: readonly DeskReading[];
}

/**
 * Reads who, if anyone, works each branch: the walk's third stage.
 *
 * GATHERS AND DECIDES NOTHING. `agentState` and `deskState` take these
 * readings; the rules stay where they are and the caller applies them.
 *
 * ONE LISTING. `Trees.list` names every worktree once; a branch with no
 * listed worktree, a worktree whose directory is gone (`prunable`), the main
 * checkout and a detached worktree carry no desk reading.
 *
 * AN UNREADABLE SNAPSHOT FAILS THE BEAT. A worktree listing, a desk, a
 * process reading or a quiet-time reading that cannot be read answers `failed`:
 * an empty answer would read as "no desk" and free the branch. An unpushed
 * count that git cannot make is not a snapshot failure; it is spelled
 * `'unknown'`, as the reap rule expects. Dirty paths that cannot be read are
 * spelled `'unknown'` too.
 *
 * @param trees - the worktree reader.
 * @param agents - the desk reader.
 * @param processes - the process-table reader.
 * @param branches - the branch stage's answer.
 * @returns the readings, or a failure when any part of the snapshot is unreadable.
 */
export const readDeskReadings = async (
  trees: Trees,
  agents: Agents,
  processes: Processes,
  branches: BranchStageReadings,
): Promise<PortResult<DeskStageReadings>> => {
  const listing = await trees.list();
  if (!listing.ok) return failed<DeskStageReadings>();
  const treeOf = new Map(
    listing.value.filter((t) => !t.isMain && !t.detached && !t.prunable && t.branch !== '').map((t) => [t.branch, t] as const),
  );

  const wanted = new Map<string, { worktree: string; hasPr: boolean }>();
  for (const { branch, readings } of branches.branches) {
    const tree = treeOf.get(branch);
    if (tree === undefined || wanted.has(branch)) continue;
    wanted.set(branch, {
      worktree: tree.path,
      hasPr: readings.pr === 'OPEN' || readings.pr === 'MERGED' || readings.pr === 'CLOSED',
    });
  }

  const read = await Promise.all(
    [...wanted].map(async ([branch, { worktree, hasPr }]): Promise<DeskReading | null> => {
      const [desk, process, locked, unpushed, quiet, dirty] = await Promise.all([
        agents.desk(worktree),
        processes.workerState(worktree, hasPr),
        trees.locked(worktree),
        trees.unpushedCommits(worktree, []),
        trees.quietSeconds(worktree),
        trees.dirtyPaths(worktree),
      ]);
      if (!desk.ok || !process.ok || !locked.ok || !quiet.ok) return null;
      return {
        branch,
        worktree,
        desk: desk.value,
        process: process.value,
        locked: locked.value,
        unpushed: unpushed.ok ? unpushed.value : 'unknown',
        quietSeconds: quiet.value,
        dirty: dirty.ok ? dirty.value : 'unknown',
      };
    }),
  );
  const desks: DeskReading[] = [];
  for (const each of read) {
    if (each === null) return failed<DeskStageReadings>();
    desks.push(each);
  }
  return answered({ mainSha: branches.mainSha, desks });
};
