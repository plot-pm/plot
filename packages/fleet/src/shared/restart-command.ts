import fs from 'node:fs';
import { pulseBranchReading, type Caller, type FleetReading } from '@plot-pm/domain';
import { hostShell, processesShell } from '@plot-pm/domain/adapters';
import type { ProcessReading } from '@plot-pm/domain/ports/processes';
import { restartWorker, type BranchPrReading } from '@plot-pm/domain/workflows/dispatch-verbs';
import { deskManifestFor } from './manifest-stamp.js';
import { readDeskLoop } from './desk-loop.js';
import { branchFromPulse, refusal } from './continue-command.js';
import {
  continueOnDesk,
  type ContinuationOptions,
  type ContinueRefusal,
  type DeskContinuation,
  type RestartVerdict,
} from './continuation.js';
import type { DeskMonitors } from '@plot-pm/domain';

/** The prompt the restarted worker reads in place of a person's answer. */
export const RESTART_ANSWER =
  'A person restarted this worker with the restart controller. Read the brief, the tree and `git log`, and carry on from where the previous run stopped.';

/** What a restart asks of the world, as values; a test replaces each. */
export interface RestartReaders {
  /** The branch's pull request, or `'unanswerable'` where the host could not say. */
  pr: (branch: string) => Promise<BranchPrReading>;
  /** The desk's worker, or `null` where the process table could not be read. */
  worker: (worktree: string, hasPr: boolean) => Promise<ProcessReading | null>;
}

/** What {@link restartBranch} needs. */
export interface RestartBranchInput {
  opts: ContinuationOptions;
  /** Reads `## Plot Config` keys; the continuation engine's own reader where absent. */
  readCfg?: (opts: ContinuationOptions, key: string, fallback: string) => string;
  /** The fleet reading the branch is looked up in; `null` where there is none. */
  pulse: FleetReading | null;
  /** Whether the scan behind `pulse` finished; absent reads as `true`. */
  pulseComplete?: boolean;
  /** The pulse of the last scan that finished; absent reads as `null`. */
  lastCompletePulse?: FleetReading | null;
  branch: string;
  /** The worktree git reports for the branch; used where the reading names none. */
  worktree?: string;
  /** Who is asking for the restart; an unattended caller restarts nothing. */
  caller: Caller;
  /** Whether the caller promised no network; such a caller's PR question is never put. */
  offline?: boolean;
  /** Starts the desk's monitor; the shell script where absent. */
  monitors?: DeskMonitors;
  /** The readings; the host and process adapters where absent. */
  readers?: RestartReaders;
}

/**
 * The readers over the host and process adapters.
 *
 * `offline` is honoured the way `reached_review()` in `plot-dispatch.sh`
 * honours it: a flag that promised no network skips the host call rather than
 * making one and reading its failure. That is a different reading from a host
 * call that was MADE and failed — `unanswerable`, never silently `false`.
 *
 * @param opts - the repository and its scripts directory.
 * @param offline - whether to skip the host call and answer no PR.
 * @returns readers that map a failed or unaskable host to `'unanswerable'`.
 */
export const adapterReaders = (opts: ContinuationOptions, offline = false): RestartReaders => {
  const context = { repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir };
  return {
    pr: async (branch) => {
      if (offline) return { reachedReview: false, number: 0, state: '' };
      const asked = await hostShell(context).prState(branch);
      if (!asked.ok) return { reachedReview: 'unanswerable', number: 0, state: '' };
      if (asked.value === null) return { reachedReview: false, number: 0, state: '' };
      return { reachedReview: true, number: asked.value.number, state: asked.value.state };
    },
    worker: async (worktree, hasPr) => {
      const asked = await processesShell(context).workerState(worktree, hasPr);
      return asked.ok ? asked.value : null;
    },
  };
};

/** The refusals `restartWorker` can answer for a restart that got past the pulse lookup. */
const RESTART_REASONS: Readonly<Partial<Record<string, ContinueRefusal>>> = {
  unattended: 'unattended',
  'pr-unanswerable': 'pr-unanswerable',
  'reached-review': 'reached-review',
  'loop-alive': 'loop-alive',
  'worker-alive': 'worker-alive',
  'worker-finished': 'worker-finished',
  'blocked-marker': 'blocked-marker',
};

/** The continue refusal for a `restartWorker` reason; an unlisted reason refuses as a live worker, the safe reading. */
const continueReason = (reason: string): ContinueRefusal => RESTART_REASONS[reason] ?? 'worker-alive';

/** The `PLOT-BLOCKED*` file at a worktree's root, or `''`. */
const markerFile = (worktree: string): string => {
  try {
    return fs.readdirSync(worktree).find((name) => name.startsWith('PLOT-BLOCKED')) ?? '';
  } catch {
    return '';
  }
};

/**
 * Restarts the worker of a branch whose worker is dead.
 *
 * Refuses `no-pulse` where there is no fleet reading, `pulse-partial` where an
 * unfinished scan and the last finished one both miss the branch,
 * `unknown-branch` where a finished reading does not list it, and `no-worktree` where it lists no
 * worktree on this machine. A named worktree stands in for the first two. Otherwise
 * {@link continueOnDesk} holds the desk's continue lock, and under it this
 * reads the pull request, the worker and the live loop, asks `restartWorker`,
 * and starts a new worker only on its decision.
 *
 * @param input - the repository, the reading and the branch.
 * @returns what {@link continueOnDesk} answers, or a refusal naming the rule that stopped the restart.
 */
export const restartBranch = async (input: RestartBranchInput): Promise<DeskContinuation> => {
  const reading = pulseBranchReading(
    input.pulse,
    input.pulseComplete ?? true,
    input.lastCompletePulse ?? null,
    input.branch,
  );
  if (reading.kind !== 'listed' && !input.worktree) return refusal(reading.kind);
  const found =
    (reading.kind === 'listed' ? branchFromPulse(reading.pulse, input.branch) : null) ??
    { worktree: '', plan: '', wave: '', worker: 'elsewhere', pid: '' };
  const worktree = found.worktree || input.worktree || '';
  if (!worktree) {
    return { kind: 'refused', status: 404, reason: 'no-worktree', detail: 'this machine holds no worktree for that branch' };
  }
  const { opts, branch } = input;
  const readers = input.readers ?? adapterReaders(opts, input.offline);
  const restart = async (): Promise<RestartVerdict> => {
    const pr = await readers.pr(branch);
    const worker = await readers.worker(worktree, pr.reachedReview === true);
    if (worker === null) {
      return { ok: false, status: 409, reason: 'worker-alive', detail: 'the process table could not be read; the worker is not known to be dead' };
    }
    const { loop } = readDeskLoop(worktree, deskManifestFor(opts.repoRoot, worktree, opts));
    const outcome = restartWorker({
      branch,
      tree: { branch, path: worktree, state: worker.state, pid: worker.pid, blockedMarker: markerFile(worktree), dirty: false },
      pr,
      loop,
      caller: input.caller,
    });
    if (outcome.outcome === 'decided') return { ok: true };
    return { ok: false, status: 409, reason: continueReason(outcome.reason), detail: outcome.detail };
  };
  return continueOnDesk({
    opts,
    readCfg: input.readCfg,
    caller: input.caller,
    branch,
    worktree,
    main: input.pulse?.main ?? '',
    previousPid: found.pid,
    answer: RESTART_ANSWER,
    monitors: input.monitors,
    restart,
  });
};
