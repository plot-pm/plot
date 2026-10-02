import type { AgentState } from '../entities/agent.js';

/**
 * Whether the worker a desk's pid record names still works at that desk.
 *
 * One worker process runs at one desk. A worker loop that finishes a slice and
 * takes the next one moves to a new desk, and the old desk keeps its
 * `.plot-worker.pid`, which still names the live loop. A manifest records the
 * desk the worker runs at now, together with its pid. When that pid is the one
 * the desk records and the manifest names a different desk, the worker has
 * left this desk.
 *
 * It is string work and reaches no filesystem: the caller reads the desk's pid
 * record, resolves the realpaths and reads the manifests, and hands them in.
 *
 * @concept desk-worker
 */

/** What the caller read of one manifest. */
export interface ManifestWorkerReading {
  /** The manifest's `worktree` field, verbatim; empty when it carries none. */
  readonly worktree: string;
  /** The `worktree` field through `realpath`, when the caller could resolve it. */
  readonly worktreeReal?: string;
  /** The worker pid the manifest records; empty when it records none. */
  readonly pid: string;
}

/** What the caller read of the desk it is asking about. */
export interface DeskWorkerReading {
  /** The desk's path as the caller was handed it. */
  readonly desk: string;
  /** The same desk through `realpath`; the caller passes `desk` when it could not resolve it. */
  readonly deskReal: string;
  /** The pid the desk's `.plot-worker.pid` records, trimmed; empty when there is no record. */
  readonly deskPid: string;
  /** Every manifest the caller could read, in any order. */
  readonly manifests: readonly ManifestWorkerReading[];
}

/** The desk's pid record names a worker that is still at this desk, or that no manifest places elsewhere. */
export interface WorkerHere {
  readonly kind: 'here';
}

/** The desk's pid record names a worker that a manifest places at another desk. */
export interface WorkerLeft {
  readonly kind: 'left';
  /** The `worktree` field of the first manifest that places the worker elsewhere. */
  readonly worktree: string;
}

/** Where the worker a desk's pid record names runs. */
export type DeskWorker = WorkerHere | WorkerLeft;

/**
 * Where the worker named by a desk's pid record runs.
 *
 * Answers `left` when a manifest records the desk's pid and names a different
 * desk, and no manifest that names this desk records the same pid. A manifest
 * names a desk when either form of its `worktree` equals either form of the
 * desk's path.
 *
 * Answers `here` in every other case: an empty pid record, a pid no manifest
 * records (a free loop with no manifest keeps its desk), and a pid the desk's
 * own manifest records.
 *
 * @param reading - the desk, its realpath, its pid record and the manifests that were read.
 * @returns `left` with the other desk's path, or `here`.
 */
export const deskWorker = (reading: DeskWorkerReading): DeskWorker => {
  if (reading.deskPid === '') return { kind: 'here' };
  const desk = new Set([reading.desk, reading.deskReal].filter((p) => p !== ''));
  let elsewhere = '';
  for (const manifest of reading.manifests) {
    if (manifest.pid !== reading.deskPid || manifest.worktree === '') continue;
    const forms = [manifest.worktree, manifest.worktreeReal ?? ''].filter((p) => p !== '');
    if (forms.some((form) => desk.has(form))) return { kind: 'here' };
    if (elsewhere === '') elsewhere = manifest.worktree;
  }
  return elsewhere === '' ? { kind: 'here' } : { kind: 'left', worktree: elsewhere };
};

/**
 * The process state a desk shows, given its state reading and where its worker runs.
 *
 * A `running` desk whose worker has left reads `ended`: the process the pid
 * record names runs at another desk, so no process runs at this one. Every
 * other state is returned unchanged, because only `running` is read from the
 * pid.
 *
 * @param state - the state the desk's readings produced.
 * @param worker - the answer of {@link deskWorker} for the same desk.
 * @returns the state the desk shows.
 */
export const deskProcessState = (state: AgentState, worker: DeskWorker): AgentState =>
  state === 'running' && worker.kind === 'left' ? 'ended' : state;
