import { hostShell } from '@plot-pm/domain/adapters/host/host-shell';
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import { stateSyncFile } from '@plot-pm/domain/adapters/state-sync-record/state-sync-file';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import { readerLockFile } from '@plot-pm/domain/adapters/reader-lock/reader-lock-file';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';
import type { Host } from '@plot-pm/domain/ports/host';
import type { ReaderLock } from '@plot-pm/domain/ports/reader-lock';
import type { Refs } from '@plot-pm/domain/ports/refs';
import type { StateSyncRecord } from '@plot-pm/domain/ports/state-sync-record';
import type { Trees } from '@plot-pm/domain/ports/trees';
import type { StateWriteTarget } from '@plot-pm/domain/rules/write-target';
import { NO_STATE_BRANCH } from '@plot-pm/domain/rules/write-target';
import type { SyncCaller } from '@plot-pm/domain/rules/state-sync';
import { fleetLiveAt, forwardSyncAt, syncPrAt, type StateSyncSource } from '@plot-pm/domain/workflows/state-sync';
import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pushUnderLock, Refused, stateTargetOf, type LadderContext, type Printer } from './ladder.js';

/**
 * Syncs the state ref and the default branch, in both directions.
 *
 * ```
 * plot-state-sync.mjs --forward
 * # one JSON line: {"done":"merged"|"idle"|"wait"|"refused"|"failed", ...}
 * # exit 0 — the tick was decided and acted on, including a wait and a recorded conflict
 * # exit 1 — a port failed, the push was refused, or a conflict could not be recorded; the reason is on stderr
 * # exit 4 — no `State branch` key is declared; nothing was done
 *
 * plot-state-sync.mjs --pr [--caller fleetd|command]
 * # one JSON line: {"done":"opened"|"refreshed"|"none"|"unknown"|"failed", ...}
 * # exit 0 — opened, refreshed or nothing to do
 * # exit 1 — an ask failed (unknown) or the host refused the write
 * # exit 4 — no `State branch` key is declared; nothing was done
 * ```
 *
 * `--forward` merges `origin/<default>` into the state ref, in a disposable
 * detached worktree cut at the state tip, and pushes through
 * `plot-push-main.sh`, which takes the push lock. A tick that finds the lock
 * held merges and pushes nothing. A conflict names its files, is recorded
 * against the two tips it met, and stands until either tip moves.
 *
 * `--pr` opens the sync pull request from the state branch to the default
 * branch where a plan reached Delivered on the state ref, or refreshes the open
 * one. The `command` caller (the default) yields to a live fleetd heartbeat.
 * A state ref that is not a branch gets no pull request.
 */

const USAGE = 'usage: plot-state-sync.mjs --forward | --pr [--caller fleetd|command]';

/** The ports one run reaches the world through. */
export interface StateSyncDeps {
  readonly repoRoot: string;
  readonly ctx: LadderContext;
  readonly trees: Trees;
  readonly refs: Refs;
  readonly host: Pick<Host, 'prListing' | 'prState' | 'prCreate' | 'prComment' | 'backend'>;
  readonly record: StateSyncRecord;
  readonly lock: Pick<ReaderLock, 'heartbeats'>;
  readonly now: () => number;
  /** A path that does not exist yet, for one disposable worktree. */
  readonly tmpWorktree: () => string;
  /** Pushes `HEAD` of a worktree at the state ref, under the push lock. */
  readonly pushFrom: (tree: string, pushRef: string) => Promise<{ code: number; stdout: string; stderr: string }>;
  /** Reads one `## Plot Config` key. */
  readonly config: (key: string, fallback: string) => Promise<string>;
}

type Json = Record<string, unknown>;

const sourceOf = async (deps: StateSyncDeps, target: StateWriteTarget, main: string): Promise<StateSyncSource> => {
  const planDir = await deps.config('Plan directory', 'docs/plans/');
  return { target, defaultBranch: main, planDir: planDir.endsWith('/') ? planDir : `${planDir}/` };
};

/** Fetches the state ref and the default branch into their tracking refs. `null` where an ask failed. */
const fetchBoth = async (deps: StateSyncDeps, target: StateWriteTarget, main: string): Promise<{ stateExists: boolean } | null> => {
  const state = await deps.trees.fetchRef(deps.repoRoot, target.pushRef, target.trackRef);
  const defaults = await deps.trees.fetchRef(deps.repoRoot, `refs/heads/${main}`, target.defaultRef);
  return state.ok && defaults.ok ? { stateExists: state.value } : null;
};

const mainOf = async (deps: StateSyncDeps): Promise<string> => {
  const head = await deps.trees.originHead(deps.repoRoot);
  return head.ok && head.value.trim() !== '' ? head.value.trim() : 'main';
};

/**
 * One forward-sync tick.
 *
 * @param deps - the ports.
 * @returns the report and the exit code. `null` where no key is declared.
 */
export const forwardOnce = async (deps: StateSyncDeps): Promise<{ report: Json; code: number } | null> => {
  const main = await mainOf(deps);
  const target = await stateTargetOf(deps.ctx, main);
  if (target === null) return null;
  const fetched = await fetchBoth(deps, target, main);
  if (fetched === null) return { report: { done: 'failed', why: 'the origin could not be asked' }, code: 1 };
  if (!fetched.stateExists) return { report: { done: 'idle', reason: 'no-state-ref' }, code: 0 };

  const [lockHeld, known] = await Promise.all([deps.record.lockHeld(deps.now()), deps.record.refusal()]);
  if (!known.ok) return { report: { done: 'failed', why: 'the recorded conflict could not be read' }, code: 1 };
  const { decision, defaultTip, stateTip } = await forwardSyncAt(deps.refs, target, { lockHeld, refused: known.value });
  if (decision.kind === 'idle') {
    if (decision.reason === 'in-sync') await deps.record.clear();
    return { report: { done: 'idle', reason: decision.reason }, code: 0 };
  }
  if (decision.kind === 'wait') return { report: { done: 'wait', reason: decision.reason }, code: 0 };
  if (decision.kind === 'refused') return { report: { done: 'refused', files: decision.files, defaultTip, stateTip }, code: 0 };

  const tree = deps.tmpWorktree();
  const added = await deps.trees.add(tree, target.trackRef);
  if (!added.ok) return { report: { done: 'failed', why: `could not cut a worktree at ${stateTip}` }, code: 1 };
  try {
    const merged = await deps.trees.mergeIn(tree, target.defaultRef, 'plot');
    if (!merged.ok) return { report: { done: 'failed', why: `git refused merging ${target.defaultRef}` }, code: 1 };
    if (merged.value.length > 0) {
      const recorded = await deps.record.refuse({ defaultTip, stateTip, files: merged.value });
      // An unrecorded conflict would be merged again on the next tick, so the tick reports it as failed.
      if (!recorded.ok) {
        return { report: { done: 'failed', why: `the conflict in ${merged.value.join(', ')} could not be recorded`, files: merged.value, defaultTip, stateTip }, code: 1 };
      }
      return { report: { done: 'refused', files: merged.value, defaultTip, stateTip }, code: 0 };
    }
    const pushed = await deps.pushFrom(tree, target.pushRef);
    if (pushed.code !== 0) return { report: { done: 'failed', why: `the push was refused (exit ${pushed.code})`, detail: pushed.stderr.trim() }, code: 1 };
    await deps.record.clear();
    return { report: { done: 'merged', defaultTip, stateTip }, code: 0 };
  } finally {
    await deps.trees.removeOnly(tree);
    await deps.trees.prune();
  }
};

/**
 * One sync-pull-request pass.
 *
 * @param deps - the ports.
 * @param caller - fleetd, or the command that wrote Delivered.
 * @returns the report and the exit code. `null` where no key is declared.
 */
export const prOnce = async (deps: StateSyncDeps, caller: SyncCaller): Promise<{ report: Json; code: number } | null> => {
  const main = await mainOf(deps);
  const target = await stateTargetOf(deps.ctx, main);
  if (target === null) return null;
  if (!target.isBranch) return { report: { done: 'none', reason: 'no-branch' }, code: 0 };
  const fetched = await fetchBoth(deps, target, main);
  if (fetched === null) return { report: { done: 'unknown', reason: 'origin-unread' }, code: 1 };
  if (!fetched.stateExists) return { report: { done: 'none', reason: 'no-state-ref' }, code: 0 };
  let fleetLive: boolean | 'unknown' = 'unknown';
  if (caller === 'command') {
    const backend = await deps.host.backend();
    fleetLive = backend.ok ? await fleetLiveAt(deps.lock, backend.value, deps.now()) : 'unknown';
  }
  const done = await syncPrAt({ host: deps.host, refs: deps.refs, record: deps.record }, await sourceOf(deps, target, main), caller, fleetLive);
  return { report: { ...done }, code: done.done === 'unknown' || done.done === 'failed' ? 1 : 0 };
};

const realDeps = (repoRoot: string, scriptDir: string): StateSyncDeps => {
  const context = { repoRoot, scriptDir };
  const scripts = scriptsShell(context);
  const trees = treesGit(context);
  return {
    repoRoot,
    ctx: { repoRoot, scripts, trees },
    trees,
    refs: refsGit(context),
    host: hostShell(context),
    record: stateSyncFile({ cwd: repoRoot }),
    lock: readerLockFile({ cwd: repoRoot }),
    now: Date.now,
    tmpWorktree: () => path.join(os.tmpdir(), `plot-state-sync-${process.pid}-${Date.now()}`),
    pushFrom: (tree, pushRef) => pushUnderLock({ repoRoot: tree, scripts: scriptsShell({ repoRoot: tree, scriptDir }), trees }, 'HEAD', pushRef),
    config: async (key, fallback) => {
      const read = await scripts.config(key, fallback);
      return read.ok ? read.value.trim() : fallback;
    },
  };
};

/**
 * Runs one mode and prints its report.
 *
 * @param argv - the arguments after the program name.
 * @param cwd - a directory inside the repository.
 * @param scriptDir - the directory holding `plot-*.sh`.
 * @param write - where the report goes.
 * @param warn - where refusals go.
 * @param deps - the ports; the real ones where absent.
 * @returns the process exit code.
 */
export const run = async (
  argv: readonly string[],
  cwd: string,
  scriptDir: string,
  write: Printer = (s) => process.stdout.write(s),
  warn: Printer = (s) => process.stderr.write(s),
  deps?: StateSyncDeps,
): Promise<number> => {
  const mode = argv[0];
  const callerArg = argv[1] === '--caller' ? argv[2] : undefined;
  if ((mode !== '--forward' && mode !== '--pr') || (callerArg !== undefined && callerArg !== 'fleetd' && callerArg !== 'command')) {
    warn(`${USAGE}\n`);
    return 2;
  }
  let used = deps;
  if (used === undefined) {
    const probe = await refsGit({ repoRoot: cwd, scriptDir }).repoRoot();
    if (!probe.ok) {
      warn('plot-state-sync: not a git repository\n');
      return 1;
    }
    used = realDeps(probe.value, scriptDir);
  }
  try {
    const result = mode === '--forward' ? await forwardOnce(used) : await prOnce(used, callerArg === 'fleetd' ? 'fleetd' : 'command');
    if (result === null) return NO_STATE_BRANCH;
    write(`${JSON.stringify(result.report)}\n`);
    if (result.code !== 0) warn(`plot-state-sync: ${String(result.report.why ?? result.report.reason ?? 'the pass did not finish')}\n`);
    return result.code;
  } catch (err) {
    if (err instanceof Refused) {
      warn(`plot-state-sync: ${err.message}\n`);
      return 1;
    }
    throw err;
  }
};

// Runs only when launched as a program; a test imports `run` without starting it.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const scriptDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  void endEntry(await run(process.argv.slice(2), process.cwd(), scriptDir));
}
