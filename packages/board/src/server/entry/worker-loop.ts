import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { readFileSync, realpathSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { constants, homedir, tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import {
  agentRunSdk,
  claudeOnPath,
  DEFAULT_READ_ONLY_DENY,
  settingsFilesOf,
  spawnAttached,
} from '@plot-pm/domain/adapters/agent-run/agent-run-sdk';

import {
  agentsFs,
  boundedRunProcess,
  buildShell,
  budgetFile,
  deskFs,
  hostShell,
  processExec,
  processesShell,
  refsGit,
  refsRemoteGit,
  sliceSpendFile,
  transcriptFs,
  treesGit,
  type ShellContext,
} from '@plot-pm/domain/adapters';
import { checksFromRuns, type RemoteTipReading } from '@plot-pm/domain/rules/checks-verdict';
import { HARNESS_LIMIT_LINES } from '@plot-pm/domain/adapters/harness/limit-lines';
import { promptExit } from '@plot-pm/domain/rules/prompt-exit';
import { backgroundGateEnv } from '@plot-pm/domain/rules/agent-run-env';
import { restartAnswer, type LoopRestartReadings } from '@plot-pm/domain/rules/loop-restart';
import { DEFAULT_SLICE_MAX_RUNS } from '@plot-pm/domain/rules/run-limit';
import { DEFAULT_AGENT_CONTEXT_WINDOW, DEFAULT_AGENT_MAX_TURNS, agentRunSettings } from '@plot-pm/domain/rules/agent-models';
import { failedCheck, printedCommands } from '@plot-pm/domain/rules/local-checks-run';
import { runnerChoice } from '@plot-pm/domain/rules/runner-choice';
import { parsePromptFile, promptCandidates, renderPrompt } from '@plot-pm/domain/rules/worker-prompt-text';
import { idleNow, type DeskReading } from '@plot-pm/domain/rules/sample';
import { loopRegistration, type LoopRegistration } from '@plot-pm/domain/rules/desk-manifest';
import {
  agentLoop,
  type AgentLoopReadings,
  type LocalChecksReading,
  type TakeUpRefusal,
} from '@plot-pm/domain/workflows/agent-loop';
import { claimAnswer, type ClaimHolderAnswer } from '@plot-pm/domain/rules/claim';
import { readSliceSpend, recordSliceRun, recordSliceSpend, type RunWriteRefusal } from '@plot-pm/domain/workflows/slice-spend';
import { recordRunLimits } from '@plot-pm/domain/workflows/run-limits';
import type { ResetRefusal } from '@plot-pm/domain/rules/reapable';
import type { Agents, BoundedRun, Desk, Processes, Refs, Trees, Write } from '@plot-pm/domain';
import type { AgentHandBack, AgentRun, AgentRunRequest, AgentRunResult } from '@plot-pm/domain/ports/agent-run';
import type { BuildPort } from '@plot-pm/domain/ports/build';
import type { Host } from '@plot-pm/domain/ports/host';
import type { RemoteHeadAnswer } from '@plot-pm/domain/ports/refs';
import type { Reexec } from '@plot-pm/domain/ports/reexec';
import type { Scripts } from '@plot-pm/domain/ports/scripts';

import { answer as promptAnswer, read as readAgentCharter } from './prompt.js';
import { performLoopWrites, type AppliedWrite, type LoopWritePorts, type LoopWrite } from './loop-writes.js';

/**
 * `plot-worker-loop.mjs` — the JS loop, one process for an agent's whole life.
 *
 * ```
 * node skills/plot/scripts/board/plot-worker-loop.mjs
 * ```
 *
 * **IT DECIDES NOTHING.** Every branch below is either a reading taken through
 * a port, a call to {@link agentLoop}, or {@link performLoopWrites} carrying
 * out the answer. The loop's own waits — a free wait, the usage-limit wait, a
 * CI poll — are this entry's sleeps between passes; the bound is the decision's
 * answer, never a timer this file owns.
 *
 * **IT CARRIES NO STATE BETWEEN PASSES.** Every reading is re-derived from the
 * manifest, the desk and the host on every pass, which is what makes `kill -9`
 * between two passes cost exactly one pass. A correction count is the
 * manifest's `correctionAttempts`; a start retry is the manifest's `attempts`.
 *
 * **ONE EXCEPTION, NAMED RATHER THAN HIDDEN.** The moment the current free (or
 * checks) wait began is kept in a module-level field so slice 4's restart
 * cannot extend it — the plan's own requirement — but the wait's EXISTENCE is
 * still re-read every pass from the manifest's assignment. The checks wait
 * also holds the PR number it read on entry, because the host is asked once
 * per wait.
 *
 * **THE PROMPT RUNS THROUGH `boundedRun` OR `agentRun`, NEVER DETACHED.**
 * `agentLoop` emits `prompt-run`/`agent-resume` as RECORDS — `performLoopWrites`
 * does not invoke anything for them — and this entry is the caller that runs
 * the prompt, in the process group it inherited, so the dispatch wrapper's
 * group stop still reaches it. `Agent runner: command` runs the prompt file
 * through `boundedRun`; `Agent runner: sdk` runs one turn through the SDK
 * connector, and on a `checks` hand-back this entry runs the local checks
 * through `boundedRun` and resumes the session with the result, with no model
 * turn between.
 */

/** How long one pass sleeps before the next, in milliseconds — matches `WAIT_POLL_SECONDS`'s shell default. */
export const PASS_INTERVAL_MS = 60_000;

/** The idle window `idleNow` judges a transcript's silence against — the shipped default. */
export const IDLE_WINDOW_SECONDS = 900;

/** The CURRENT wait (free, or checks): its start, and what the checks wait read on entry. */
interface WaitClock {
  /** The wait's start, epoch ms; `null` outside one. */
  since: number | null;
  /**
   * The open PR's number, read once on entry to the checks wait. The host is
   * not asked again inside the wait, as the shell asks `pr_is_open` once per
   * finished prompt.
   */
  pr: number | null;
}

/** Every port this entry reads or writes through, composed once at start. */
export interface WorkerLoopPorts extends LoopWritePorts {
  readonly build: BuildPort;
  readonly host: Pick<Host, 'prState'>;
  readonly transcriptQuietSeconds: (worktree: string) => Promise<number | 'unavailable'>;
  /**
   * Appends a sealed slice's spend to the checkout's slice-spend record — the
   * `slice-spend` write `performLoopWrites` leaves to its caller. Best effort:
   * a refusal leaves the seal as it is, as `record_slice_spend` does.
   */
  readonly recordSpend: (worktree: string, branch: string, at: string) => Promise<void>;
  /**
   * Appends one SDK run's line to the checkout's slice-spend record, right
   * after the run that produced it ends.
   *
   * @returns `null` where the line was written, else why it was not.
   */
  readonly recordRun: (
    worktree: string,
    branch: string,
    role: string,
    at: string,
    result: AgentRunResult,
  ) => Promise<RunWriteRefusal | null>;
  /**
   * Appends one budget entry per `rate_limit_event` the run observed, to this
   * computer's budget record.
   *
   * @returns how many entries could not be appended.
   */
  readonly recordLimits: (result: AgentRunResult, at: number) => Promise<number>;
  /** What the slice-spend record reads for this branch, for `Slice max spend`. */
  readonly sliceCostUsd: (worktree: string, branch: string) => Promise<number | null>;
  /** Replaces this process's own image — {@link runWorkerLoop}'s one path to a self-restart. */
  readonly reexec: Reexec;
}

/**
 * Builds the real ports this loop runs against.
 *
 * @param context - the repository root and where its helper scripts live.
 * @param manifestDir - the registry directory holding this agent's manifest, when the launcher named one; absent, it is read from `## Plot Config`.
 * @returns the ports a pass reads and writes through.
 */
export const workerLoopPorts = async (
  context: ShellContext,
  manifestDir?: string,
): Promise<WorkerLoopPorts> => {
  const processes: Processes = processesShell(context);
  const trees: Trees = treesGit(context);
  const refs: Refs = { ...refsGit(context), ...refsRemoteGit(context) };
  const agents: Agents = agentsFs(context, { manifestDir });
  const desk: Desk = deskFs(trees);
  const boundedRun: BoundedRun = boundedRunProcess(processes);
  const transcript = transcriptFs();
  const build = await buildShell(context);
  const host = hostShell(context);

  return {
    trees,
    agents,
    desk,
    refs,
    processes,
    boundedRun,
    build,
    host,
    transcriptQuietSeconds: async (worktree: string) => quietReading(await transcript.quietSeconds(worktree)),
    recordSpend: async (worktree: string, branch: string, at: string) => {
      await recordSliceSpend(sliceSpendFile({ cwd: worktree }), { worktree, branch, at });
    },
    recordRun: async (worktree: string, branch: string, role: string, at: string, result: AgentRunResult) => {
      const written = await recordSliceRun(sliceSpendFile({ cwd: worktree }), { branch, role, at }, result);
      return written.ok ? null : written.refusal;
    },
    recordLimits: async (result: AgentRunResult, at: number) => (await recordRunLimits(budgetFile(), result, at)).failed,
    sliceCostUsd: async (worktree: string, branch: string) => {
      const read = await readSliceSpend(sliceSpendFile({ cwd: worktree }), branch);
      return read.costUsd;
    },
    reexec: processExec(),
  };
};

/** The bundle's path relative to a checkout's root, as `plot-worker-loop.sh` names it beside itself. */
export const BUNDLE_RELATIVE_PATH = join('skills', 'plot', 'scripts', 'board', 'plot-worker-loop.mjs');

/**
 * The script paths of a checkout. A restarted loop runs the main checkout's
 * bundle and its helper scripts, so a changed or untracked path under this
 * directory blocks a restart onto the main checkout.
 */
export const SCRIPT_DIRECTORY = 'skills/plot/scripts/';

/** How long a candidate bundle's `--self-check` may run, in seconds. */
export const SELF_CHECK_BOUND_SECONDS = 10;

/** How many failed `--self-check` runs, on separate passes, reject a candidate's content. */
export const SELF_CHECK_ATTEMPTS = 2;

/** The main checkout as this process found it at start. */
export interface PinnedCheckout {
  /** The main checkout's root, as `trees.list()` names it. */
  readonly checkout: string;
  /** The absolute path of the main checkout's bundle. */
  readonly bundlePath: string;
  /** Refs read in the main checkout. */
  readonly refs: Refs;
}

/**
 * Pins the main checkout: the entry `trees.list()` marks as main.
 *
 * @param trees - the worktree listing of the loop's repository.
 * @param scriptDir - this process's `scriptDir`, for the main checkout's {@link Refs}.
 * @returns the pinned checkout; `null` where the listing fails or names no main checkout.
 */
export const pinMainCheckout = async (trees: Trees, scriptDir: string): Promise<PinnedCheckout | null> => {
  const list = await trees.list();
  if (!list.ok) return null;
  const main = list.value.find((tree) => tree.isMain);
  if (main === undefined) return null;
  return {
    checkout: main.path,
    bundlePath: join(main.path, BUNDLE_RELATIVE_PATH),
    refs: refsGit({ repoRoot: main.path, scriptDir }),
  };
};

/** What a restart carries into the new process. */
export interface RestartCarry {
  /** The free wait's start, epoch ms; `null` outside a free wait. Carried as `PLOT_WAIT_STARTED`. */
  readonly waitStartedAt: number | null;
  /** The branch a pending hop comes from; `''` for none. Carried as `PLOT_HOP_FROM`. */
  readonly hopFrom: string;
}

/** Everything {@link checkRestart} reads beyond the loop's ports. */
export interface RestartDeps {
  readonly pinned: PinnedCheckout;
  /** The absolute path of the bundle this process runs. */
  readonly runningBundle: string;
  /** The content hash of {@link runningBundle} at start. */
  readonly loadedHash: string;
  /** The newest commit that changed the running bundle, in its own checkout; `''` where it could not be read. */
  readonly runningCommit: string;
  /** This process's resident memory, in bytes. */
  readonly residentBytes: () => number;
  /** Whether `process.execve` exists on this Node. */
  readonly execveAvailable: boolean;
  /** The Node binary, its options before the bundle, and the arguments after it, for the restarted process. */
  readonly exec: { readonly path: string; readonly options: readonly string[]; readonly args: readonly string[] };
  /** Failed `--self-check` runs per candidate content hash in this process. */
  readonly selfCheckFailures: Map<string, number>;
  /** Logs a line once per process; a repeated line is dropped. */
  readonly logOnce: (line: string) => void;
  readonly log: (line: string) => void;
  readonly env: NodeJS.ProcessEnv;
}

/**
 * Reads the checkout side of {@link LoopRestartReadings}.
 *
 * A reading that fails reads as the side that blocks a restart onto the main
 * checkout: not the default branch, dirty, `unknown` ancestry, or an empty
 * hash.
 *
 * @param trees - the worktree port.
 * @param deps - the pinned checkout and the running bundle.
 * @returns the main checkout's readings and the running bundle's hash now.
 */
export const mainCheckoutReading = async (
  trees: Trees,
  deps: Pick<RestartDeps, 'pinned' | 'runningBundle' | 'runningCommit'>,
): Promise<
  Pick<LoopRestartReadings, 'onDefaultBranch' | 'scriptPathsClean' | 'headContainsRunning' | 'pinnedHash' | 'runningHashNow'>
> => {
  const { pinned } = deps;
  const [list, changed, defaultBranch, headContainsRunning] = await Promise.all([
    trees.list(),
    trees.changedUnder(pinned.checkout, [SCRIPT_DIRECTORY]),
    pinned.refs.defaultBranch(),
    containsRunning(deps),
  ]);
  const branch = list.ok ? list.value.find((tree) => tree.path === pinned.checkout)?.branch ?? '' : '';
  const hashed = pinned.refs.hashFilesSync([BUNDLE_RELATIVE_PATH]);
  const running = pinned.refs.hashFilesSync([deps.runningBundle]);
  return {
    onDefaultBranch: defaultBranch.ok && defaultBranch.value !== '' && defaultBranch.value === branch,
    scriptPathsClean: changed.ok && changed.value.length === 0,
    headContainsRunning,
    pinnedHash: (hashed.ok && hashed.value.get(BUNDLE_RELATIVE_PATH)) || '',
    runningHashNow: (running.ok && running.value.get(deps.runningBundle)) || '',
  };
};

const containsRunning = async (deps: Pick<RestartDeps, 'pinned' | 'runningCommit'>): Promise<'yes' | 'no' | 'unknown'> => {
  if (deps.runningCommit === '') return 'unknown';
  const head = await deps.pinned.refs.resolve('HEAD');
  if (!head.ok) return 'unknown';
  // plot-ancestry: evidence — handed to `restartAnswer` as a reading, which
  //                restarts on `yes` only. A wrong `no` or `unknown` keeps old
  //                code one more pass; nothing is merged, delivered or removed.
  const contains = await deps.pinned.refs.contains(deps.runningCommit, head.value);
  return contains.ok ? contains.value : 'unknown';
};

const selfCheckFailure = (check: Awaited<ReturnType<BoundedRun['run']>>): string =>
  !check.ok ? `could not run (${check.why})` : check.value.timedOut ? `ran past ${SELF_CHECK_BOUND_SECONDS}s` : `exited ${check.value.status}`;

/**
 * Asks {@link restartAnswer} whether to replace this process, and carries the
 * answer out.
 *
 * A `stay-and-log` answer is logged once per reason. Before a restart, the
 * candidate bundle runs `--self-check` through `boundedRun`, bounded to
 * {@link SELF_CHECK_BOUND_SECONDS}. A candidate whose content failed
 * {@link SELF_CHECK_ATTEMPTS} times, or whose replace failed, is not tried
 * again, and the rejection is logged once. A restart replaces the process
 * through `reexec` with the same arguments, the candidate bundle,
 * `PLOT_WAIT_STARTED` and `PLOT_HOP_FROM`.
 *
 * @param ports - the loop's `trees`, `boundedRun` and `reexec`.
 * @param deps - the pinned checkout, the running bundle and the platform readings.
 * @param phase - `first` before the first pass; `later` between passes.
 * @param carry - the free wait's start (`null` outside a free wait) and the pending hop.
 * @returns when this process stays. On a restart it does not return.
 */
export const checkRestart = async (
  ports: Pick<WorkerLoopPorts, 'trees' | 'boundedRun' | 'reexec'>,
  deps: RestartDeps,
  phase: 'first' | 'later',
  carry: RestartCarry,
): Promise<void> => {
  const readings: LoopRestartReadings = {
    phase,
    inFreeWait: carry.waitStartedAt !== null,
    ...(await mainCheckoutReading(ports.trees, deps)),
    loadedHash: deps.loadedHash,
    residentBytes: deps.residentBytes(),
    execveAvailable: deps.execveAvailable,
  };
  const verdict = restartAnswer(readings);
  if (verdict.verdict === 'stay') return;
  if (verdict.verdict === 'stay-and-log') {
    deps.logOnce(`plot-worker-loop: staying on the running bundle — ${verdict.reason}`);
    return;
  }
  const [bundle, hash] =
    verdict.bundle === 'pinned' ? [deps.pinned.bundlePath, readings.pinnedHash] : [deps.runningBundle, readings.runningHashNow];
  const failures = deps.selfCheckFailures.get(hash) ?? 0;
  if (failures >= SELF_CHECK_ATTEMPTS) return;
  const outFile = join(tmpdir(), `plot-worker-loop-self-check-${process.pid}.out`);
  const check = await ports.boundedRun.run(deps.exec.path, [bundle, '--self-check'], {
    cwd: dirname(bundle),
    boundSeconds: SELF_CHECK_BOUND_SECONDS,
    outFile,
  });
  await rm(outFile, { force: true });
  if (!check.ok || check.value.timedOut || check.value.status !== 0) {
    deps.selfCheckFailures.set(hash, failures + 1);
    if (failures + 1 >= SELF_CHECK_ATTEMPTS) {
      deps.log(`plot-worker-loop: ${bundle} failed its --self-check on ${SELF_CHECK_ATTEMPTS} passes (last: ${selfCheckFailure(check)}); staying on the running bundle`);
    }
    return;
  }
  deps.log(`plot-worker-loop: restarting on ${bundle} — ${verdict.reason}`);
  const replaced = await ports.reexec.replace(
    deps.exec.path,
    [deps.exec.path, ...deps.exec.options, bundle, ...deps.exec.args],
    {
      ...deps.env,
      PLOT_WAIT_STARTED: carry.waitStartedAt === null ? '' : String(carry.waitStartedAt),
      PLOT_HOP_FROM: carry.hopFrom,
    },
  );
  if (!replaced.ok) {
    deps.selfCheckFailures.set(hash, SELF_CHECK_ATTEMPTS);
    deps.logOnce(`plot-worker-loop: the restart did not happen (${replaced.why}); staying on the running bundle`);
  }
};

/** The manifest fields this loop reads, at the shapes the dispatcher and the supervisor write them. */
export interface ManifestFields {
  session: string;
  worktree: string;
  branch: string;
  attempts: number;
  correctionAttempts: number;
  resumeId: string;
  /** The runs this slice has started, keyed to `branch`: `0` where the manifest counts runs for another branch. */
  sliceRuns: number;
}

/** The empty manifest reading — a hand-started loop, or a manifest this parse could not read. */
const EMPTY_MANIFEST: ManifestFields = {
  session: '',
  worktree: '',
  branch: '',
  attempts: 0,
  correctionAttempts: 0,
  resumeId: '',
  sliceRuns: 0,
};

/**
 * Reads the manifest's `sliceRuns` record for the assigned branch.
 *
 * The record names the branch it counts, so a record naming another branch
 * reads `0` and a hop starts the count again without a write.
 * `correctionAttempts` reaches the same answer by a reset in {@link writeHop}.
 *
 * @param raw - the manifest's `sliceRuns` value, `{ branch, runs }`.
 * @param branch - the assigned branch.
 * @returns the runs started on `branch`; `0` where the record is absent, malformed or for another branch.
 */
export const sliceRunsOf = (raw: unknown, branch: string): number => {
  if (typeof raw !== 'object' || raw === null || branch === '') return 0;
  const record = raw as { branch?: unknown; runs?: unknown };
  return record.branch === branch && typeof record.runs === 'number' && Number.isInteger(record.runs) ? record.runs : 0;
};

/**
 * Records one more run on the assigned branch.
 *
 * NOT BEST-EFFORT, unlike the other manifest writers here: `Slice max runs`
 * reads this count, so a count that cannot be written would let a
 * `checks` → resume cycle run without a limit. The caller starts no run
 * where this answers `null`.
 *
 * @param manifestFile - the manifest's own path; `''` for a hand-started loop, which counts nothing.
 * @returns the new count; `0` for a hand-started loop; `null` where the manifest could not be read or written.
 */
export const raiseSliceRuns = async (manifestFile: string): Promise<number | null> => {
  if (manifestFile === '') return 0;
  try {
    const parsed: unknown = JSON.parse(await readFile(manifestFile, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const was = parsed as Record<string, unknown>;
    const branch = typeof was.branch === 'string' ? was.branch : '';
    const runs = sliceRunsOf(was.sliceRuns, branch) + 1;
    const tmp = `${manifestFile}.plot-runs-tmp`;
    await writeFile(tmp, `${JSON.stringify({ ...was, sliceRuns: { branch, runs } }, null, 2)}\n`, 'utf8');
    await rename(tmp, manifestFile);
    return runs;
  } catch {
    return null;
  }
};

/**
 * Reads a manifest file's fields this loop needs.
 *
 * @param manifestFile - the manifest's own path; `''` for a hand-started loop.
 * @returns every field, each at its empty value where the file is absent,
 *   unreadable, or not an object.
 */
export const readManifestFields = async (manifestFile: string): Promise<ManifestFields> => {
  if (manifestFile === '') return EMPTY_MANIFEST;
  try {
    const raw: unknown = JSON.parse(await readFile(manifestFile, 'utf8'));
    if (typeof raw !== 'object' || raw === null) return EMPTY_MANIFEST;
    const o = raw as Record<string, unknown>;
    return {
      session: typeof o.session === 'string' ? o.session : '',
      worktree: typeof o.worktree === 'string' ? o.worktree : '',
      branch: typeof o.branch === 'string' ? o.branch : '',
      attempts: typeof o.attempts === 'number' && Number.isInteger(o.attempts) ? o.attempts : 0,
      correctionAttempts:
        typeof o.correctionAttempts === 'number' && Number.isInteger(o.correctionAttempts)
          ? o.correctionAttempts
          : 0,
      resumeId: typeof o.resumeId === 'string' ? o.resumeId : '',
      sliceRuns: sliceRunsOf(o.sliceRuns, typeof o.branch === 'string' ? o.branch : ''),
    };
  } catch {
    return EMPTY_MANIFEST;
  }
};

/**
 * Stamps `loop: js` into the manifest, best-effort — the field slice 5 counts
 * slices by.
 *
 * @param manifestFile - the manifest's own path; a no-op when empty or unreadable.
 */
export const stampManifestLoopJs = async (manifestFile: string): Promise<void> => {
  if (manifestFile === '') return;
  try {
    const parsed: unknown = JSON.parse(await readFile(manifestFile, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return;
    const next = { ...(parsed as Record<string, unknown>), loop: 'js' };
    const tmp = `${manifestFile}.plot-loop-tmp`;
    await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    await rename(tmp, manifestFile);
  } catch {
    /* best-effort, matching every other manifest writer (`plot-agent-manifest.sh`) */
  }
};

/**
 * Records a hop in the manifest, best-effort, as `update_manifest_on_hop`
 * does: `wavesCount` goes up by one, a non-empty `handle` replaces
 * `resumeId` — one conversation per slice — and `correctionAttempts` resets
 * to 0 when the hop comes from another branch, because the count belongs to
 * the branch (`plot-worker-loop.sh:337`).
 *
 * @param manifestFile - the manifest's own path; a no-op when empty or unreadable.
 * @param handle - the new handle; `''` leaves `resumeId` as it is.
 * @param from - the branch the agent held before the hop; absent leaves `correctionAttempts` as it is.
 */
export const writeHop = async (manifestFile: string, handle: string, from?: string): Promise<void> => {
  if (manifestFile === '') return;
  try {
    const parsed: unknown = JSON.parse(await readFile(manifestFile, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return;
    const tmp = `${manifestFile}.plot-hop-tmp`;
    const was = parsed as Record<string, unknown>;
    const waves = typeof was.wavesCount === 'number' && was.wavesCount > 0 ? was.wavesCount : 1;
    const next = {
      ...was,
      wavesCount: waves + 1,
      ...(handle !== '' ? { resumeId: handle } : {}),
      ...(from !== undefined && from !== was.branch ? { correctionAttempts: 0 } : {}),
    };
    await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    await rename(tmp, manifestFile);
  } catch {
    /* best-effort, matching every other manifest writer */
  }
};

/**
 * Whether this loop's own manifest still names it.
 *
 * @param manifestFile - the path the loop was launched with; `''` for a
 *   hand-started loop.
 * @returns `registered`, `unset`, or `gone`.
 */
export const registrationOf = async (manifestFile: string): Promise<LoopRegistration> => {
  if (manifestFile === '') return loopRegistration({ manifestFile: '', exists: false });
  try {
    await readFile(manifestFile, 'utf8');
    return loopRegistration({ manifestFile, exists: true });
  } catch {
    return loopRegistration({ manifestFile, exists: false });
  }
};

/**
 * Every reason a desk may not be reset, matching `desk_reset_refusal`'s own
 * three reasons and their order: a blocked marker, uncommitted changes, then
 * unpushed commits.
 *
 * @param ports - where the three readings come from.
 * @param worktree - the desk to read.
 * @returns the refusals that hold; empty where none do.
 */
export const readResetRefusals = async (
  ports: Pick<WorkerLoopPorts, 'trees'>,
  worktree: string,
): Promise<ResetRefusal[]> => {
  const out: ResetRefusal[] = [];
  const markers = await ports.trees.markers(worktree, 'PLOT-BLOCKED');
  if (markers.ok && markers.value.length > 0) out.push('blocked-marker');
  const dirty = await ports.trees.dirtyPaths(worktree);
  if (dirty.ok && dirty.value.length > 0) out.push('uncommitted-changes');
  // AGAINST THE CONFIGURED UPSTREAM, as `desk_reset_refusal` counts it. A
  // rejected claim push leaves its claim commit on a branch with no upstream,
  // and no upstream reads as nothing to refuse.
  const ahead = await ports.trees.aheadOfUpstream(worktree);
  if (ahead.ok && ahead.value > 0) out.push('unpushed-commits');
  return out;
};

/**
 * The first line of the worktree's `PLOT-BLOCKED.md`, or `''` where there is none.
 *
 * @param worktree - the desk to read.
 * @returns the marker's first line.
 */
export const readMarkerText = async (worktree: string): Promise<string> => {
  try {
    const text = await readFile(join(worktree, 'PLOT-BLOCKED.md'), 'utf8');
    return text.split('\n', 1).join('');
  } catch {
    return '';
  }
};

/** What `boundedRun`'s caller has already measured about this pass's prompt, if any is running or just exited. */
export interface PromptState {
  /** What the idle watch found this pass, or `null` once the prompt has exited or before any has run. */
  readonly running: { readonly verdict: 'gone' | 'idle' | 'silent'; readonly transcriptReadable: boolean } | null;
  /** The prompt's last exit, once it is no longer running; `null` otherwise. */
  readonly exit: AgentLoopReadings['exit'];
  /**
   * The commit pushed for this pass's claim, once the desk has pushed —
   * `''` before a push has happened this slice. The caller holds this because
   * it is the one that MADE the push (`Write`'s own `push` kind, applied by
   * `performLoopWrites`); the desk's `HEAD` the moment it pushed is the fact,
   * and no port today answers "this worktree's own HEAD sha" to re-derive it.
   */
  readonly pushedSha: string;
  /** The SDK run's hand-back, read where `exit` is `ran`; `null` on the `command` runner. */
  readonly handBack?: AgentHandBack | null;
  /** The session the last SDK run ran under, which a `checks` resume continues. */
  readonly sessionId?: string;
  /** What the local checks answered for a `checks` hand-back; `null` while they have not run. */
  readonly localChecks?: LocalChecksReading | null;
  /** The branch the loop already resumed once after a turn that dropped its background work; `''` for none. */
  readonly droppedOn?: string;
}

/** What one pass is told about the repository's config, read once at start. */
export interface PassConfig {
  readonly boundSeconds: number;
  /** How long a free or checks wait may run — `Worker bound` unless a test seam shortens it. */
  readonly waitBudgetSeconds: number;
  /** Milliseconds one pass sleeps before the next. */
  readonly passIntervalMs: number;
  /** Milliseconds a pass sleeps while it waits on a pushed slice's checks; the shell's `PLOT_CHECKS_POLL_SECONDS`. */
  readonly checksPollMs: number;
  readonly maxStartRetries: number;
  readonly checksWaitSeconds: number;
  readonly correctionBudget: number;
  /** `Slice max runs`; {@link DEFAULT_SLICE_MAX_RUNS} where the key is absent. */
  readonly sliceMaxRuns: number;
  /** `Slice max spend`, in dollars; `null` where the key is absent — no default stands in for it. */
  readonly sliceMaxSpendUsd: number | null;
  readonly base: string;
}

/**
 * Builds this pass's {@link AgentLoopReadings}, in the table's own order —
 * `agentLoop`'s own doc comment names the order and the reason: a reading for
 * a place the pass is not in is never asked of the world, because asking costs
 * a host or git call this pass does not need.
 *
 * @param ports - where every reading comes from.
 * @param manifestFile - this loop's manifest path; `''` for a hand-started loop.
 * @param prompt - what the caller already knows about this pass's prompt.
 * @param config - the repository's config, read once at start.
 * @param clock - the free/checks wait's own start time, held across passes.
 * @returns the readings {@link agentLoop} decides from.
 */
export const readPass = async (
  ports: WorkerLoopPorts,
  manifestFile: string,
  prompt: PromptState,
  config: PassConfig,
  clock: WaitClock,
): Promise<AgentLoopReadings> => {
  const manifest = await readManifestFields(manifestFile);
  const passAt = new Date().toISOString();
  // ASKED ONLY WHEN A BRANCH IS ASSIGNED — a reading for a place the pass is
  // not in is never asked of the world, `readPass`'s own doc comment.
  const sliceCostUsd = manifest.branch === '' ? null : await ports.sliceCostUsd(manifest.worktree, manifest.branch);

  const base: AgentLoopReadings = {
    assignedBranch: manifest.branch,
    waitedSeconds: 0,
    boundSeconds: config.waitBudgetSeconds,
    registration: 'registered',
    claim: null,
    takeUpRefused: null,
    base: config.base,
    running: prompt.running,
    exit: prompt.exit,
    startRetries: manifest.attempts,
    maxStartRetries: config.maxStartRetries,
    markerWritten: false,
    markerText: '',
    // A `command` runner hands back nothing, so its hand-back reads `null`.
    handBack: prompt.handBack?.next ?? null,
    checksResumeId: prompt.sessionId ?? '',
    handBackSummary: prompt.handBack?.summary ?? '',
    localChecks: prompt.localChecks ?? null,
    sliceRuns: manifest.sliceRuns,
    backgroundDropResumed: manifest.branch !== '' && prompt.droppedOn === manifest.branch,
    sliceMaxRuns: config.sliceMaxRuns,
    sliceCostUsd,
    sliceMaxSpendUsd: config.sliceMaxSpendUsd,
    resetRefusals: [],
    pushed: false,
    prOpen: false,
    checks: null,
    checksPassed: null,
    tip: 'unknown',
    correctionAttempts: manifest.correctionAttempts,
    correctionBudget: config.correctionBudget,
    pr: null,
    correctionText: '',
    resumeId: manifest.resumeId,
    passAt,
    worktree: manifest.worktree,
    session: manifest.session,
  };

  // ROWS 1-3 — no assignment: the loop is free. Only here is the manifest's
  // own registration worth asking, matching `AgentLoopReadings.registration`'s
  // own doc comment.
  if (manifest.branch === '') {
    if (clock.since === null) clock.since = Date.now();
    return {
      ...base,
      registration: await registrationOf(manifestFile),
      waitedSeconds: Math.floor((Date.now() - clock.since) / 1000),
    };
  }
  // THE CHECKS WAIT KEEPS ITS START ACROSS PASSES: only a pass outside it, or a
  // prompt that ran again (the caller resets the clock), starts it afresh.
  if (prompt.exit?.answer !== 'ran') clock.since = null;

  const worktree = manifest.worktree;
  const branch = manifest.branch;

  const exit = prompt.exit;
  if (exit === null) {
    // ROWS 5-6 — a prompt is running this pass; its idle reading is already in
    // `prompt.running`, so nothing further is read.
    if (prompt.running !== null) return base;
    // ROW 4 — an assignment was just read, no prompt has run on it yet.
    const refusals = await readResetRefusals(ports, worktree);
    const markerText = refusals.includes('blocked-marker') ? await readMarkerText(worktree) : '';
    return { ...base, resetRefusals: refusals, markerText };
  }

  // ROWS 7-9 — the prompt exited `unstarted`, `wait` or `end-limited`. None of
  // these reads anything about the desk or the host.
  if (exit.answer !== 'ran' && exit.answer !== 'dropped') return base;

  // ROW 10 — the agent may have written its own marker.
  const markerText = await readMarkerText(worktree);
  if (markerText !== '') return { ...base, markerWritten: true, markerText };
  // ROW 10c — a dropped turn reads nothing further.
  if (exit.answer === 'dropped') return base;

  // ROW 11 — unlanded work with no marker.
  const refusals = await readResetRefusals(ports, worktree);
  if (refusals.length > 0) return { ...base, resetRefusals: refusals };

  // ROW 12a — before the wait starts: is the head pushed, and is a PR open?
  // ASKED ONCE PER WAIT. Inside the wait the answers read on entry hold, so a
  // host that fails one poll cannot seal the slice as if its PR had closed.
  if (clock.since === null) {
    const [pushedAnswer, prAnswer] = await Promise.all([
      ports.refs.remoteHead(branch),
      ports.host.prState(branch),
    ]);
    const pushed = pushedAnswer.ok && pushedAnswer.value === 'present';
    const pr = prAnswer.ok ? prAnswer.value : null;
    const prOpen = pr !== null && pr.state === 'OPEN';
    const prNumber = pr !== null ? pr.number : null;
    // ON ENTRY, A HOST THAT CANNOT BE ASKED READS AS NO PR, as the shell's
    // `pr_is_open` reads it: no CI answer can be waited for without one.
    if (!pushed || !prOpen) {
      return { ...base, pushed, prOpen, pr: prNumber };
    }
    clock.since = Date.now();
    clock.pr = prNumber;
  }

  // ROWS 12-18 — work is pushed and a PR is open: the CI wait.
  const pushed = true;
  const prOpen = true;
  const prNumber = clock.pr;
  const waitedSeconds = Math.floor((Date.now() - clock.since) / 1000);

  if (config.checksWaitSeconds <= 0) {
    return { ...base, pushed, prOpen, pr: prNumber, checks: 'none', waitedSeconds };
  }

  const pushedSha = prompt.pushedSha;

  const [tipAnswer, runAnswer] = await Promise.all([
    ports.refs.remoteTip(branch, pushedSha),
    ports.build.runForSha(branch, pushedSha),
  ]);
  const tip: RemoteTipReading = tipAnswer.ok ? tipAnswer.value : 'unknown';
  const run = runAnswer.ok ? runAnswer.value : null;

  const checks = checksFromRuns({ pushedSha, run, tip, waitedSeconds, boundSeconds: config.checksWaitSeconds });
  const checksPassed = checks === 'settled' && run !== null ? run.conclusion === 'success' : null;

  return {
    ...base,
    pushed,
    prOpen,
    pr: prNumber,
    tip,
    checks,
    checksPassed,
    correctionText: checksPassed === false && run !== null ? runEvidence(run, pushedSha) : '',
    waitedSeconds,
  };
};

/**
 * The agents other than `session` that hold `branch` with a live worker, as
 * `live_holders_of_branch` (`plot-agent-manifest.sh`) answers them.
 *
 * A holder is a declared agent whose manifest names the branch, whose desk
 * exists, and whose recorded pid answers alive or whose desk holds a
 * `PLOT-BLOCKED` marker — the shell's `running` and `waiting`.
 *
 * @param ports - where the registry, the desks and the processes are read.
 * @param branch - the branch the claim push was refused for.
 * @param session - this agent's own session, which never counts.
 * @returns the holders' sessions; empty where the registry cannot be read.
 */
export const liveHolders = async (
  ports: Pick<WorkerLoopPorts, 'agents' | 'processes'>,
  branch: string,
  session: string,
): Promise<string[]> => {
  const declared = await ports.agents.declared();
  if (!declared.ok) return [];
  const holders: string[] = [];
  for (const agent of declared.value) {
    if (agent.branch !== branch || agent.session === session || agent.worktree === '') continue;
    const desk = await ports.agents.desk(agent.worktree);
    if (!desk.ok) continue;
    const pid = Number(desk.value.pid || agent.pid);
    const alive = Number.isInteger(pid) && pid > 0 ? await ports.processes.isAlive(pid) : null;
    if ((alive !== null && alive.ok && alive.value) || desk.value.markers.length > 0) holders.push(agent.session);
  }
  return holders;
};

/**
 * What origin and the registry say about a branch whose claim push was
 * rejected, through {@link claimAnswer}.
 *
 * @param ports - where the ref, its commits and the holders are read.
 * @param branch - the branch the claim push was refused for.
 * @param base - the ref the branch's commits are counted from, such as `origin/main`.
 * @param session - this agent's own session, excluded from the holders.
 * @returns one of `claimAnswer`'s five answers.
 */
export const readClaimAnswer = async (
  ports: Pick<WorkerLoopPorts, 'refs' | 'agents' | 'processes'>,
  branch: string,
  base: string,
  session: string,
): Promise<ClaimHolderAnswer> => {
  const fetched = await ports.refs.fetchRemoteHead(branch);
  const ref: RemoteHeadAnswer = fetched.ok ? fetched.value : 'unknown';
  const commits =
    ref === 'present'
      ? await ports.refs.commitSubjects(`${base}..origin/${branch}`)
      : ({ ok: false, why: 'unaskable' } as const);
  return claimAnswer({ ref, commits, holders: await liveHolders(ports, branch, session) });
};

/**
 * The operator's line for each write that did not land.
 *
 * @param applied - what `performLoopWrites` answered.
 * @returns one line per failed write, naming its kind and the applier's
 *   reason where it gave one.
 */
export const failureLines = (applied: readonly AppliedWrite[]): string[] =>
  applied
    .filter((a) => !a.result.ok)
    .map((a) => [`plot-worker-loop: ${a.write.kind} failed`, a.reason].filter(Boolean).join(' — '));

/**
 * The take-up write a pass's applied writes stopped on, if any.
 *
 * @param applied - what `performLoopWrites` answered; it stops on the first
 *   refused take-up write, so that write is the last entry.
 * @returns the refused write's kind, or `null` where none was refused.
 */
export const takeUpRefusalOf = (applied: readonly AppliedWrite[]): TakeUpRefusal | null => {
  const last = applied.at(-1);
  if (last === undefined || last.result.ok) return null;
  const kind = last.write.kind;
  return kind === 'desk-reset' || kind === 'commit' || kind === 'push' ? kind : null;
};

/**
 * The operator's line for a refused take-up write, in the shell's words where
 * the shell has them (`plot-worker-loop.sh`, the claim push's `case`).
 *
 * @param refused - the refused write.
 * @param claim - what `claimAnswer` said; read for a refused push only.
 * @param branch - the branch the take-up was for.
 * @param worktree - the desk.
 * @returns one line.
 */
export const takeUpLine = (
  refused: TakeUpRefusal,
  claim: ClaimHolderAnswer | null,
  branch: string,
  worktree: string,
): string => {
  const free = 'the assignment is cleared and the agent goes free';
  if (refused === 'desk-reset') return `plot-worker-loop: could not reset the desk at ${worktree} onto ${branch}; ${free}`;
  if (refused === 'commit') return `plot-worker-loop: could not commit the claim for ${branch} at ${worktree}; ${free}`;
  switch (claim) {
    case 'held-by-agent':
      return `plot-worker-loop: REGISTRY LOCK VIOLATION — the claim push for ${branch} was rejected, so another agent already holds a slice this agent was handed. The registry is the assignment lock and this push is only its backstop; a rejection here means two agents were given one branch. Going free, but the estate needs the double assignment found.`;
    case 'stale-claim':
      return `plot-worker-loop: origin/${branch} holds only an empty claim and no live agent names it; release it with plot-dispatch.sh --release ${branch}`;
    case 'work-on-ref':
      return `plot-worker-loop: origin/${branch} carries work that no live agent holds; a person decides`;
    default:
      return `plot-worker-loop: the claim push for ${branch} was rejected and origin has no such branch; ${free}`;
  }
};

/**
 * The sentence a correction hands the agent about a run, in the BuildMonitor's
 * own words: *"the run at <url> for <sha> concluded <conclusion>"*.
 * `evidenceSha` (`rules/checks-verdict.ts`) reads the sha back out of it.
 *
 * @param run - the run `BuildPort.runForSha` answered for the pushed commit.
 * @param sha - the pushed commit.
 * @returns the sentence; the url reads `an unknown url` where the run has none.
 */
export const runEvidence = (run: { readonly url: string; readonly conclusion: string | null }, sha: string): string =>
  `the run at ${run.url || 'an unknown url'} for ${sha} concluded ${run.conclusion ?? 'nothing yet'}`;

/** What a `.plot-worker.limited` record says, first field: the reset instant in epoch seconds; `null` where absent or unreadable. */
export const readLimitedReset = async (worktree: string): Promise<number | null> => {
  try {
    const first = (await readFile(join(worktree, '.plot-worker.limited'), 'utf8')).split(/[\t\n]/, 1).join('');
    const epoch = Number(first);
    return Number.isFinite(epoch) && first !== '' ? epoch : null;
  } catch {
    return null;
  }
};

/** What the idle watch needs beyond {@link WorkerLoopPorts}. */
export interface IdleDeps {
  readonly selfPid: number;
  readonly windowSeconds: number;
  readonly intervalMs: number;
  readonly transcript: { spoken(worktree: string, handle: string): Promise<{ ok: boolean; value?: boolean }> };
}

/**
 * One idle-watch reading of the running prompt, judged by {@link idleNow}.
 *
 * The prompt is this process's direct child, so its pid is read from the
 * process table rather than held. Silence is clamped by the reset instant of a
 * usage-limit wait and by how long the prompt has run, matching
 * `plot_worker_idle_watch_pass`. A reading that cannot be taken withholds
 * `idle`.
 *
 * @param ports - where the readings come from.
 * @param idle - the watch's own settings.
 * @param worktree - the desk the prompt runs in.
 * @param handle - the session handle the prompt writes its conversation under.
 * @param ranSeconds - how long the prompt has run.
 * @param nowSeconds - now, epoch seconds.
 * @returns `idle`, or the verdict `idleNow` gave for any other case.
 */
export const idleVerdict = async (
  ports: WorkerLoopPorts,
  idle: IdleDeps,
  worktree: string,
  handle: string,
  ranSeconds: number,
  nowSeconds: number,
): Promise<ReturnType<typeof idleNow>> => {
  const children = await ports.processes.childrenOf(idle.selfPid);
  const pid = children.ok ? children.value[0] : undefined;
  const alive = pid === undefined ? null : await ports.processes.isAlive(pid);
  const quiet = await ports.transcriptQuietSeconds(worktree);
  const reset = await readLimitedReset(worktree);
  let silence = quiet === 'unavailable' ? 0 : quiet;
  if (reset !== null) silence = Math.min(silence, Math.max(0, nowSeconds - reset));
  silence = Math.min(silence, ranSeconds);
  const spoken = await idle.transcript.spoken(worktree, handle);
  const activity = pid === undefined ? null : await ports.processes.activity(pid);
  const treeQuiet = await ports.trees.quietSeconds(worktree);
  const commits = await ports.trees.hasCommits(worktree);
  const reading: DeskReading = {
    pid: pid !== undefined && alive !== null && alive.ok && alive.value ? 'alive' : 'dead',
    spoken: spoken.ok && spoken.value === true,
    silenceSeconds: silence,
    childOnCore: activity !== null && activity.ok && activity.value === 'working',
    treeQuietSeconds: treeQuiet.ok && treeQuiet.value !== null ? treeQuiet.value : 0,
    commits: commits.ok ? commits.value : 'unanswerable',
  };
  return idleNow(reading, idle.windowSeconds);
};

/** Everything {@link runWorkerLoop} needs, injected so a test drives it without a process. */
export interface LoopDeps {
  readonly ports: WorkerLoopPorts;
  readonly idle: IdleDeps;
  readonly manifestFile: string;
  /** The repository root the prompt resolves under. */
  readonly repoRoot: string;
  /** The desk, used where the manifest names none. */
  readonly worktree: string;
  readonly agent: string;
  readonly harness: string;
  readonly config: PassConfig;
  /** Seconds past a usage-limit reset to wait before the next prompt. */
  readonly limitMarginSeconds: number;
  /** Whether the idle watch may end the prompt (`PLOT_MONITOR_ENDS_WORKER`). */
  readonly monitorEndsWorker: boolean;
  /** Where a prompt's output is appended. */
  readonly outFile: string;
  /** The prompt's session handle where the manifest names none. */
  readonly sessionId: string;
  /** The agent's slug, for the operator's lines; `''` where the launcher gave none. */
  readonly slug?: string;
  /** Mints the handle a hop writes; defaults to a random UUID. */
  readonly mintHandle?: () => string;
  /** Epoch milliseconds. */
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly log: (line: string) => void;
  /** Resolves which prompt file runs: `<resolution>\t<prompt>\t<detail>`. */
  readonly resolvePrompt?: (repoRoot: string, agent: string) => string;
  /**
   * The settings file every prompt receives as `PLOT_AGENT_SETTINGS`; `''` or
   * absent runs the prompt with the variable unset, as the shell does.
   */
  readonly agentSettings?: string;
  /** What {@link checkRestart} reads; absent, the loop never restarts itself. */
  readonly restart?: RestartDeps;
  /** The free wait's start carried over a restart in `PLOT_WAIT_STARTED`, epoch ms. */
  readonly waitStartedAt?: number;
  /** The branch of a pending hop carried over a restart in `PLOT_HOP_FROM`. */
  readonly hopFrom?: string;
  /** `Agent runner` as {@link runnerChoice} answered it; absent reads `command`. */
  readonly runner?: 'command' | 'sdk';
  /** What the SDK runner needs; read only where {@link runner} is `sdk`. */
  readonly sdk?: SdkRunDeps;
}

/** What one SDK run's context tells the connector about the usage-limit wait it follows. */
export interface SdkRunContext {
  readonly afterWait: boolean;
  /** Commits the desk gained since that wait began, read when the run ends. */
  readonly commitsSinceWait: () => number;
}

/** What the SDK runner needs beyond {@link LoopDeps}, resolved once per agent start. */
export interface SdkRunDeps {
  /** The connector for one run. */
  readonly agentRun: (context: SdkRunContext) => AgentRun;
  /** The fresh prompt for a branch, with the placeholders filled. */
  readonly prompt: (branch: string) => string;
  readonly model: string;
  readonly effort: string;
  /** `Agent max turns`. */
  readonly maxTurns: number;
  /** `Agent max spend`, in dollars; `0` where the key is absent, which the port reads as no limit. */
  readonly maxSpendUsd: number;
  /** `Agent context window`, capped by the charter. */
  readonly contextWindow: number;
  /** The charter's capabilities. */
  readonly capabilities: readonly string[];
  /** Runs the commands `plot-local-checks.mjs` prints for a `checks` hand-back. */
  readonly runChecks: (worktree: string) => Promise<LocalChecksReading>;
}

/**
 * A decision's writes as the {@link LoopWrite}s {@link performLoopWrites} applies.
 *
 * `checks` is not a port write: this entry runs the local checks itself,
 * through `boundedRun`, and reads the answer into the next pass. Only an SDK
 * run hands back `checks`, so a `checks` write without the SDK runner is a
 * defect and throws rather than being dropped.
 *
 * @param writes - the decision's writes.
 * @param runsChecks - whether this loop has the SDK runner, which runs the checks.
 * @returns the writes other than `checks`, typed as {@link LoopWrite}s.
 * @throws Error where a write is `checks` and `runsChecks` is false.
 */
export const loopWritesOf = (writes: readonly Write[], runsChecks = false): readonly LoopWrite[] => {
  const checks = writes.find((w) => w.kind === 'checks');
  if (checks !== undefined && !runsChecks) {
    throw new Error(`plot-worker-loop: a checks write on ${checks.branch} without the SDK runner, which alone runs the checks`);
  }
  return writes.filter((w) => w.kind !== 'checks') as readonly LoopWrite[];
};

/**
 * Runs the local checks a `checks` hand-back asks for: the commands
 * `plot-local-checks.mjs` prints, each through `boundedRun`, in order, until
 * one fails.
 *
 * Only the lister's standard output names commands: its standard error goes
 * to a file of its own, so a warning is never read as a command. That file
 * joins the output a failed lister hands back.
 *
 * `PLOT_REPO_ROOT`, `PLOT_UNATTENDED`, `PLOT_MANIFEST_FILE` and
 * `PLOT_WRAPPER_PID_FILE` are unset for the lister and each command, because a
 * test that builds a sandbox reads `PLOT_REPO_ROOT` as its root.
 *
 * @param boundedRun - the port each command runs through.
 * @param scriptDir - where the helper scripts live.
 * @param boundSeconds - the bound of each command.
 * @param outFile - where one command's output is written; emptied before each.
 *   The lister's standard error goes to `<outFile>.err`.
 * @returns a pass, or the first failing command and the tail of its output.
 */
export const localChecksRunner =
  (boundedRun: BoundedRun, scriptDir: string, boundSeconds: number, outFile: string) =>
  async (worktree: string): Promise<LocalChecksReading> => {
    const scrubbed = ['-u', 'PLOT_REPO_ROOT', '-u', 'PLOT_UNATTENDED', '-u', 'PLOT_MANIFEST_FILE', '-u', 'PLOT_WRAPPER_PID_FILE'];
    const read = (path: string): Promise<string> => readFile(path, 'utf8').catch(() => '');
    const runOne = async (args: readonly string[]): Promise<{ passed: boolean; output: string }> => {
      await writeFile(outFile, '', 'utf8');
      const run = await boundedRun.run('env', [...scrubbed, ...args], { cwd: worktree, boundSeconds, outFile });
      return { passed: run.ok && run.value.status === 0, output: await read(outFile) };
    };
    const lister = join(scriptDir, 'board', 'plot-local-checks.mjs');
    const errFile = `${outFile}.err`;
    const listed = await runOne(['bash', '-c', 'exec node "$1" 2>"$2"', '_', lister, errFile]);
    const listerErr = await read(errFile);
    await rm(errFile, { force: true });
    if (!listed.passed) return failedCheck(`node ${lister}`, `${listed.output}${listerErr}`);
    for (const command of printedCommands(listed.output)) {
      const ran = await runOne(['bash', '-c', command]);
      if (!ran.passed) return failedCheck(command, ran.output);
    }
    return { passed: true };
  };

/** What the loop holds across passes: the prompt's own state, and the wait it came back from. */
interface Held {
  exit: AgentLoopReadings['exit'];
  pushedSha: string;
  afterWait: boolean;
  aheadAtWait: number;
  /** The last prompt's own exit status, for the operator's line about a prompt that never started. */
  status: number;
  /** The last SDK run's hand-back; `null` on the `command` runner. */
  handBack: AgentHandBack | null;
  /** The session the last SDK run ran under. */
  sessionId: string;
  /** What the local checks answered for the last `checks` hand-back; `null` before they ran. */
  localChecks: LocalChecksReading | null;
  /** The branch already resumed once after a turn that dropped its background work; `''` for none. */
  droppedOn: string;
}

const FRESH: Held = {
  exit: null,
  pushedSha: '',
  afterWait: false,
  aheadAtWait: 0,
  status: 0,
  handBack: null,
  sessionId: '',
  localChecks: null,
  droppedOn: '',
};

/** How one run ended, for {@link runWorkerLoop}. */
type RunOutcome =
  | { ended: 'idle' }
  | { ended: 'bound' }
  | {
      ended: 'exit';
      status: number;
      exit: NonNullable<AgentLoopReadings['exit']>;
      handBack: AgentHandBack | null;
      sessionId: string;
    };

/** The line a usage-limit record holds for an SDK run, which prints no limit line. */
const SDK_LIMIT_LINE = 'rate_limit_event: rejected';

/**
 * Reads an SDK run's end as the loop's exit.
 *
 * @param end - what the connector answered.
 * @returns the exit {@link agentLoop} reads, or `bound` where the run met its bound.
 */
export const sdkOutcome = (
  end: Extract<Awaited<ReturnType<AgentRun['run']>>, { ok: true }>['value']['end'],
): { exit: NonNullable<AgentLoopReadings['exit']>; handBack: AgentHandBack | null } | 'bound' => {
  switch (end.answer) {
    case 'bound':
      return 'bound';
    case 'ran': {
      // THE WORKER LOOP RUNS ONLY `role: 'worker'`, so a hand-back here is
      // always the worker's `{ next, summary }` shape; a board role's
      // `{ written, ... }` / `{ outcome, ... }` never reaches this loop.
      const handBack = end.handBack !== null && 'next' in end.handBack ? end.handBack : null;
      return { exit: { answer: 'ran' }, handBack };
    }
    case 'wait':
      return {
        exit: { answer: 'wait', reset: { epoch: end.resetEpoch, iso: new Date(end.resetEpoch * 1000).toISOString() }, line: SDK_LIMIT_LINE },
        handBack: null,
      };
    case 'end-limited':
      return { exit: { answer: 'end-limited', cause: end.cause, line: SDK_LIMIT_LINE }, handBack: null };
    case 'unstarted':
      return { exit: { answer: 'unstarted' }, handBack: null };
    default:
      return { exit: end, handBack: null };
  }
};

/**
 * Runs one prompt, with the idle watch beside it: through `agentRun` on the
 * SDK runner, through `boundedRun` otherwise.
 *
 * @param resume - the session and the text an `agent-resume` write names;
 *   `null` for a fresh prompt. Read on the SDK runner only: the `command`
 *   runner's prompt file resumes by its own session flag.
 * @returns the prompt's exit as {@link promptExit} or the SDK connector
 *   classifies it, or `'idle'` where the watch ended the worker.
 */
const runPrompt = async (
  deps: LoopDeps,
  worktree: string,
  held: Held,
  hopFrom: string,
  resume: { readonly resumeId: string; readonly text: string } | null,
): Promise<RunOutcome> => {
  const sdk = deps.runner === 'sdk' ? deps.sdk : undefined;
  const resolved = (deps.resolvePrompt ?? promptAnswer)(deps.repoRoot, deps.agent).split('\t');
  const [verb, named, why] = resolved;
  const file = verb === 'refused' || !named ? '' : join(deps.repoRoot, named);
  // A REFUSED CHARTER REFUSES ON EITHER RUNNER; only the `command` runner
  // needs the prompt file the resolution names.
  if (verb === 'refused' || (file === '' && sdk === undefined)) {
    deps.log(`plot-worker-loop: refusing to launch — ${why ?? 'no prompt'}`);
    return { ended: 'exit', status: 1, exit: { answer: 'unstarted' }, handBack: null, sessionId: '' };
  }

  const manifest = await readManifestFields(deps.manifestFile);
  // A HOP TO ANOTHER BRANCH MINTS A HANDLE: one conversation per slice, so the
  // first prompt on the new slice runs `--session-id` and loads nothing.
  if (hopFrom !== '') {
    const minted = hopFrom === manifest.branch ? '' : (deps.mintHandle ?? randomUUID)().toLowerCase();
    await writeHop(deps.manifestFile, minted, hopFrom);
    if (minted !== '') manifest.resumeId = minted;
  }
  const handle = manifest.resumeId !== '' ? manifest.resumeId : deps.sessionId;
  // A RUN THE MANIFEST CANNOT COUNT IS NOT STARTED: it ends `unstarted`, so
  // the start-retry budget bounds it instead of nothing.
  if ((await raiseSliceRuns(deps.manifestFile)) === null) {
    deps.log(`plot-worker-loop: could not count this run in ${deps.manifestFile}; Slice max runs cannot hold, so no run starts`);
    return { ended: 'exit', status: 1, exit: { answer: 'unstarted' }, handBack: null, sessionId: handle };
  }
  const spoken = await deps.idle.transcript.spoken(worktree, handle);
  const env: Record<string, string> = {
    PLOT_BRANCH: manifest.branch,
    PLOT_WORKTREE: worktree,
    PLOT_SESSION_FLAG: spoken.ok && spoken.value === true ? '--resume' : '--session-id',
    PLOT_SESSION_ID: handle,
    PLOT_CORRECTION_FILE: join(worktree, 'PLOT-CORRECTION.md'),
    ...backgroundGateEnv(),
  };

  // A FRESH OUTPUT FILE PER PROMPT, as the shell's `rm -f` before each run: the
  // run appends, so a limit line from the last prompt would be read again.
  await writeFile(deps.outFile, '', 'utf8');
  const startedAt = deps.now();
  let ended = false;
  // RESOLVES ONLY WHEN THE WORKER IS IDLE: a watcher whose prompt already ended
  // never answers, so the race below has exactly two outcomes.
  const watcher = (async (): Promise<'idle'> => {
    while (!ended) {
      await deps.sleep(deps.idle.intervalMs);
      const seconds = Math.floor((deps.now() - startedAt) / 1000);
      const verdict = await idleVerdict(deps.ports, deps.idle, worktree, handle, seconds, Math.floor(deps.now() / 1000));
      if (verdict === 'idle' && deps.monitorEndsWorker) return 'idle';
    }
    return new Promise<never>(() => undefined);
  })();

  const commitsSinceWait = (): number => {
    const ahead = deps.ports.refs.countAheadSync(manifest.branch);
    return held.afterWait && ahead.ok ? Math.max(0, ahead.value - held.aheadAtWait) : 0;
  };

  // THE SETTINGS FILE, OR THE VARIABLE UNSET: an inherited value must not
  // reach a prompt this loop resolved no settings file for.
  const settings = deps.agentSettings ?? '';
  if (settings !== '') env.PLOT_AGENT_SETTINGS = settings;

  if (sdk !== undefined) {
    const request: AgentRunRequest = {
      worktree,
      prompt: resume !== null ? resume.text : sdk.prompt(manifest.branch),
      resumeId: resume !== null && resume.resumeId !== '' ? resume.resumeId : spoken.ok && spoken.value === true ? handle : '',
      sessionId: handle,
      role: 'worker',
      harness: 'claude',
      model: sdk.model,
      effort: sdk.effort,
      maxTurns: sdk.maxTurns,
      maxSpendUsd: sdk.maxSpendUsd,
      boundSeconds: deps.config.boundSeconds,
      contextWindow: sdk.contextWindow,
      capabilities: sdk.capabilities,
      env,
      logFile: deps.outFile,
    };
    const sdkRun = sdk.agentRun({ afterWait: held.afterWait, commitsSinceWait }).run(request);
    const raced = await Promise.race([sdkRun.then((r) => ({ run: r })), watcher.then(() => ({ idle: true }))]);
    if ('idle' in raced) return { ended: 'idle' };
    ended = true;
    if (!raced.run.ok) return { ended: 'exit', status: 1, exit: { answer: 'unstarted' }, handBack: null, sessionId: handle };
    const result = raced.run.value;
    await recordRunRecords(deps, worktree, manifest.branch, result);
    const end = result.end;
    if (end.answer === 'unstarted') deps.log(`plot-worker-loop: the SDK run did not start on ${manifest.branch} — ${end.detail}`);
    const outcome = sdkOutcome(end);
    if (outcome === 'bound') return { ended: 'bound' };
    return {
      ended: 'exit',
      status: outcome.exit.answer === 'unstarted' ? 1 : 0,
      exit: outcome.exit,
      handBack: outcome.handBack,
      sessionId: result.sessionId || handle,
    };
  }

  const unset = settings === '' ? ['-u', 'PLOT_REPO_ROOT', '-u', 'PLOT_AGENT_SETTINGS'] : ['-u', 'PLOT_REPO_ROOT'];
  const run = deps.ports.boundedRun.run('env', [...unset, 'bash', '-c', '. "$1"', '_', file], {
    cwd: worktree,
    env,
    boundSeconds: deps.config.boundSeconds,
    outFile: deps.outFile,
  });

  const first = await Promise.race([run.then((r) => ({ run: r })), watcher.then(() => ({ idle: true }))]);
  if ('idle' in first) return { ended: 'idle' };
  const result = first.run;
  ended = true;
  // THE BOUND KILLED THE PROMPT: `agentLoop` row 6 names it, so it is not read as a prompt that never started.
  if (result.ok && result.value.timedOut) return { ended: 'bound' };

  let output = '';
  try {
    output = (await readFile(deps.outFile, 'utf8')).split('\n').slice(-200).join('\n');
  } catch {
    /* an unreadable output is an exit with no limit line */
  }
  const status = result.ok ? (result.value.status ?? 124) : 1;
  const ranSeconds = result.ok ? result.value.ranSeconds : 0;
  return {
    ended: 'exit',
    status,
    handBack: null,
    sessionId: handle,
    exit: promptExit(
      {
        status,
        output,
        now: Math.floor(deps.now() / 1000),
        boundSeconds: deps.config.boundSeconds,
        ranSeconds,
        afterWait: held.afterWait,
        commitsSinceWait: commitsSinceWait(),
      },
      HARNESS_LIMIT_LINES[deps.harness],
    ),
  };
};

/**
 * Runs the loop for one agent's whole life.
 *
 * Each pass reads, decides through {@link agentLoop}, applies the writes
 * through {@link performLoopWrites}, and then does the one thing a write
 * only records: run the prompt. A prompt that was ended by the idle watch
 * answers through `agentLoop` with `idle`, and the loop exits 124 so the
 * process group stop reaches the prompt.
 *
 * @param deps - the injected ports, clock and configuration.
 * @returns the process exit code the decision named.
 */
export const runWorkerLoop = async (deps: LoopDeps): Promise<number> => {
  const clock: WaitClock = { since: deps.waitStartedAt ?? null, pr: null };
  let held: Held = { ...FRESH };
  // A carried hop names the branch the last prompt ran on, so it seeds
  // `previousBranch` too: a clear before the next prompt keeps the hop.
  let previousBranch = deps.hopFrom ?? '';
  let hopFrom = deps.hopFrom ?? '';
  let announcedFree = false;
  if (deps.restart !== undefined) await checkRestart(deps.ports, deps.restart, 'first', { waitStartedAt: clock.since, hopFrom });
  for (;;) {
    const prompt: PromptState = {
      running: null,
      exit: held.exit,
      pushedSha: held.pushedSha,
      handBack: held.handBack,
      sessionId: held.sessionId,
      localChecks: held.localChecks,
      droppedOn: held.droppedOn,
    };
    const readings = await readPass(deps.ports, deps.manifestFile, prompt, deps.config, clock);
    const decision = agentLoop(readings);
    // THE WAIT, NAMED ONCE. A wait an operator cannot see is the stall it avoids
    // being. The shell also names the branches whose landing would open a slice,
    // which needs the fleet scan's `--why-nothing`; this loop never asks it.
    if (readings.assignedBranch !== '') announcedFree = false;
    else if (!announcedFree) {
      announcedFree = true;
      deps.log(`plot-worker-loop: free on ${deps.slug || '?'} — nothing handed over yet. Waiting to be handed work: reading the manifest every ${deps.config.passIntervalMs / 1000}s, for up to ${deps.config.waitBudgetSeconds}s; stop it with /plot-fleet --stop`);
    }
    const worktree = readings.worktree || deps.worktree;
    const applied = await performLoopWrites(loopWritesOf(decision.writes, deps.sdk !== undefined), deps.ports, worktree);
    for (const line of failureLines(applied)) deps.log(line);
    const spend = decision.writes.find((w) => w.kind === 'slice-spend');
    if (spend !== undefined && spend.kind === 'slice-spend') await deps.ports.recordSpend(spend.worktree, spend.branch, readings.passAt);
    // THE OPERATOR'S LINES ABOUT A PROMPT THAT NEVER RAN, as the shell prints them.
    const attempt = decision.writes.find((w) => w.kind === 'agent-attempt');
    if (attempt !== undefined && attempt.kind === 'agent-attempt') {
      deps.log(`plot-worker-loop: the prompt failed to run on ${readings.assignedBranch} — the command exited ${held.status} without the agent doing any work. The slice stays claimed; retrying (${attempt.attempts} of ${deps.config.maxStartRetries}).`);
    }
    const ending = decision.writes.find((w) => w.kind === 'loop-end');
    if (ending !== undefined && ending.kind === 'loop-end' && ending.reason === 'unstarted') {
      deps.log(`plot-worker-loop: the prompt never started on ${readings.assignedBranch} — the command exited ${held.status} on each of ${deps.config.maxStartRetries} attempts. The slice stays claimed and a person is asked; ending worker.`);
    }
    if (decision.detail.exitCode === 124 && readings.assignedBranch === '' && readings.waitedSeconds >= readings.boundSeconds) {
      deps.log(`plot-worker-loop: the wait ran out on ${deps.slug || '?'} — free for ${readings.waitedSeconds}s with no slice offered, past the ${deps.config.waitBudgetSeconds}s wait bound; ending worker. Nothing was cut short: no prompt was running, the agent holds no branch, and its work is pushed.`);
    }
    if (decision.detail.exitCode !== null) return decision.detail.exitCode;
    // A REFUSED TAKE-UP gives the assignment back, read again through
    // `agentLoop` with the refusal and, for a push, what origin holds.
    const refused = takeUpRefusalOf(applied);
    if (refused !== null) {
      const branch = readings.assignedBranch;
      const claim = refused === 'push' ? await readClaimAnswer(deps.ports, branch, deps.config.base, readings.session) : null;
      deps.log(takeUpLine(refused, claim, branch, worktree));
      const cleared = agentLoop({ ...readings, takeUpRefused: refused, claim });
      await performLoopWrites(loopWritesOf(cleared.writes, deps.sdk !== undefined), deps.ports, worktree);
    }

    const kinds = new Set(decision.writes.map((w) => w.kind));
    if (refused !== null || kinds.has('assignment-clear')) {
      held = { ...FRESH };
      hopFrom = previousBranch;
      continue;
    }

    // A `checks` HAND-BACK: the loop runs the local checks, with no model turn,
    // and the next pass resumes the session with the answer.
    const checks = decision.writes.find((w) => w.kind === 'checks');
    if (checks !== undefined && checks.kind === 'checks') {
      deps.log(`plot-worker-loop: ${checks.branch} handed back checks; running the local checks`);
      const answer = await deps.sdk!.runChecks(checks.worktree);
      deps.log(answer.passed ? `plot-worker-loop: local checks passed on ${checks.branch}` : `plot-worker-loop: local check failed on ${checks.branch}: ${answer.command}`);
      held = { ...held, localChecks: answer };
      continue;
    }

    const resume = decision.writes.find((w) => w.kind === 'agent-resume');
    // A DROPPED TURN'S CORRECTION IS WRITTEN AS THE DOMAIN BUILT IT, and the
    // branch is held so the next drop on it ends the slice.
    if (resume !== undefined && resume.kind === 'agent-resume' && readings.exit?.answer === 'dropped') {
      await deps.ports.desk.appendCorrection(resume.worktree, resume.correction);
      held = { ...held, droppedOn: resume.branch };
      deps.log(`plot-worker-loop: the turn on ${resume.branch} ended with its background work dropped; resuming the session once`);
    }
    // A CI CORRECTION IS WRITTEN TO THE DESK; a `checks` resume carries its
    // answer in the resumed turn alone.
    else if (resume !== undefined && resume.kind === 'agent-resume' && readings.handBack !== 'checks') {
      await deps.ports.desk.writeCorrection(
        resume.worktree,
        resume.branch,
        resume.correction,
        readings.correctionAttempts + 1,
        readings.correctionBudget,
      );
    }

    if (readings.exit?.answer === 'wait') {
      const exit = readings.exit;
      await deps.ports.desk.writeLimitedRecord(worktree, exit.reset.epoch, exit.reset.iso, exit.line);
      const ahead = deps.ports.refs.countAheadSync(readings.assignedBranch);
      held = { ...held, afterWait: true, aheadAtWait: ahead.ok ? ahead.value : 0 };
      deps.log(`plot-worker-loop: usage limit on ${readings.assignedBranch} until ${exit.reset.iso}; waiting`);
      const until = (exit.reset.epoch + deps.limitMarginSeconds) * 1000;
      await deps.sleep(Math.max(0, until - deps.now()));
      await deps.ports.desk.clearLimitedRecord(worktree);
    } else if (!kinds.has('prompt-run') && !kinds.has('agent-attempt') && resume === undefined) {
      const onChecks = readings.assignedBranch !== '' && readings.exit?.answer === 'ran';
      if (readings.assignedBranch === '' && deps.restart !== undefined) {
        await checkRestart(deps.ports, deps.restart, 'later', { waitStartedAt: clock.since, hopFrom });
      }
      await deps.sleep(onChecks ? deps.config.checksPollMs : deps.config.passIntervalMs);
      continue;
    }

    const ran = await runPrompt(
      deps,
      worktree,
      held,
      hopFrom,
      resume !== undefined && resume.kind === 'agent-resume' ? { resumeId: resume.resumeId, text: resume.correction } : null,
    );
    previousBranch = readings.assignedBranch;
    hopFrom = '';
    clock.since = null;
    if (ran.ended === 'idle') {
      const idleReadings = { ...readings, running: { verdict: 'idle' as const, transcriptReadable: true }, exit: null };
      const idleDecision = agentLoop(idleReadings);
      await performLoopWrites(idleDecision.writes as readonly LoopWrite[], deps.ports, worktree);
      return 124;
    }
    if (ran.ended === 'bound') {
      const transcriptReadable = (await deps.ports.transcriptQuietSeconds(worktree)) !== 'unavailable';
      const boundReadings = {
        ...readings,
        running: { verdict: 'silent' as const, transcriptReadable },
        exit: null,
        boundSeconds: deps.config.boundSeconds,
        waitedSeconds: deps.config.boundSeconds,
      };
      const boundDecision = agentLoop(boundReadings);
      await performLoopWrites(boundDecision.writes as readonly LoopWrite[], deps.ports, worktree);
      deps.log(
        transcriptReadable
          ? `plot-worker-loop: the bound expired on ${readings.assignedBranch} — the prompt exceeded the ${deps.config.boundSeconds}s bound with the agent's transcript readable, and no monitor finding said why; ending worker without hopping`
          : `plot-worker-loop: nobody could tell on ${readings.assignedBranch} — no transcript could be read for this worktree, so no reading distinguishes a thinking agent from a stopped one; the prompt exceeded the ${deps.config.boundSeconds}s bound and that is an absence of a reading, not a measurement; ending worker without hopping`,
      );
      return 124;
    }
    const head = await deps.ports.refs.resolve('HEAD');
    held = {
      ...held,
      exit: ran.exit,
      status: ran.status,
      pushedSha: head.ok ? head.value : held.pushedSha,
      handBack: ran.handBack,
      sessionId: ran.sessionId,
      localChecks: null,
    };
    if (ran.exit.answer !== 'wait') held = { ...held, afterWait: false };
  }
};

/** What {@link onStop} needs of the process: its signal hooks and its exit. */
export interface StopTarget {
  once(signal: NodeJS.Signals, listener: () => void): unknown;
  exit(code: number): unknown;
}

/**
 * Cleans up and exits on `SIGTERM`, `SIGINT` and `SIGHUP`, as the shell's exit
 * trap does for `plot-dispatch.sh --stop`: a stopped agent leaves the registry
 * at once rather than waiting for a sweep.
 *
 * `cleanupNow` runs before the listener returns. A stop during a prompt also
 * reaches `boundedRun`'s own listener, which exits the process synchronously,
 * so only what `cleanupNow` removes is certain to be gone.
 *
 * @param target - the process; a fake in tests.
 * @param cleanupNow - what a leaving agent removes before anything else runs.
 * @param cleanup - what it removes afterwards, before the exit.
 */
export const onStop = (target: StopTarget, cleanupNow: () => void, cleanup: () => Promise<void>): void => {
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    target.once(signal, () => {
      cleanupNow();
      void cleanup().finally(() => target.exit(128 + constants.signals[signal]));
    });
  }
};

/**
 * A whole number of zero or more, as the shell's `case … (*[!0-9]*|'')` reads
 * one: anything else is the fallback.
 */
export const count = (raw: string | undefined, fallback: number): number =>
  raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : fallback;

/** A whole number above zero, as the shell's `case … (*[!0-9]*|''|0)` reads one. */
export const positive = (raw: string | undefined, fallback: number): number => {
  const n = count(raw, 0);
  return n > 0 ? n : fallback;
};

/** A whole number of either sign, as the shell's arithmetic reads an offset. */
export const integer = (raw: string | undefined, fallback: number): number =>
  raw !== undefined && /^-?\d+$/.test(raw) ? Number(raw) : fallback;

/**
 * A positive amount in dollars, or `null` where the key is absent — unlike
 * {@link count}/{@link positive}/{@link integer}, this takes no fallback:
 * `Slice max spend` and `Agent max spend` have none, an absent key means no
 * limit rather than a limit of `0`.
 */
export const dollarsOrUnset = (raw: string | undefined): number | null => {
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * The ref a desk reset cuts a new branch from: `origin/<default branch>`, the
 * default read from `origin/HEAD` as the shell reads `main_branch`.
 *
 * @param refs - where the default branch is read.
 * @returns `origin/<name>`; `origin/main` where `origin/HEAD` names none.
 */
export const defaultBase = async (refs: Pick<Refs, 'defaultBranch'>): Promise<string> => {
  const name = await refs.defaultBranch();
  return `origin/${name.ok && name.value !== '' ? name.value : 'main'}`;
};

/**
 * The settings file the loop's prompts receive, resolved once per agent start
 * through `plot-agent-settings.sh`, as the shell loop resolves it.
 *
 * @param scripts - the scripts adapter that runs the resolver.
 * @param log - where a refusal's reason goes.
 * @returns the absolute path; `''` where the key is absent or the file is refused.
 */
export const resolveAgentSettings = async (
  scripts: Pick<Scripts, 'agentSettings'>,
  log: (line: string) => void,
): Promise<string> => {
  const { stdout, stderr, code } = await scripts.agentSettings();
  if (code === 0) return stdout.trim();
  for (const line of stderr.split('\n').filter((l) => l !== '')) log(`plot-worker-loop: ${line}`);
  return '';
};

/** Waits on the real clock — the loop's `sleep` when run as a process. */
export const systemSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Writes one line to stderr — the loop's `log` when run as a process. */
export const stderrLog = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

/**
 * Reads a transcript-quiet answer as the idle watch's reading.
 *
 * @param answer - the transcript port's answer.
 * @returns the quiet seconds, or `unavailable` where the port failed or has no transcript.
 */
export const quietReading = (
  answer: Awaited<ReturnType<ReturnType<typeof transcriptFs>['quietSeconds']>>,
): number | 'unavailable' => {
  if (!answer.ok) return 'unavailable';
  return answer.value.quiet === 'unavailable' ? 'unavailable' : answer.value.seconds;
};

/** Reads one `## Plot Config` key of the repository at `repoRoot`; `undefined` when it cannot be read. */
export type ConfigReader = (repoRoot: string, key: string) => string | undefined;

/**
 * The config reader backed by `plot-config.sh` beside this bundle, through the
 * scripts adapter — the entry spawns nothing itself.
 *
 * @param scriptDir - where the helper scripts live.
 * @returns a reader answering the key's value, or `undefined` when the script cannot answer.
 */
export const shippedConfig = (scriptDir: string): ConfigReader => (repoRoot, key) => {
  const read = scriptsShell({ repoRoot, scriptDir }).configSync(key, '');
  const value = read.ok ? read.value.trim() : '';
  return value === '' ? undefined : value;
};

/** What {@link runnerDeps} reads to choose the runner and build the SDK runner. */
export interface RunnerInput {
  readonly env: NodeJS.ProcessEnv;
  readonly scriptDir: string;
  readonly repoRoot: string;
  readonly worktree: string;
  readonly agent: string;
  readonly configKey: ConfigReader;
  readonly ports: Pick<WorkerLoopPorts, 'processes' | 'boundedRun'>;
  readonly boundSeconds: number;
  /** The `Agent settings` file `resolveAgentSettings` answered; `''` for none. */
  readonly agentSettings: string;
  /** Where one local check's output is written. */
  readonly checksOutFile: string;
  readonly now: () => number;
  readonly log: (line: string) => void;
}

/**
 * Chooses the runner through {@link runnerChoice} and, for `sdk`, builds what
 * the SDK runner needs: the charter's model, effort, capabilities and window
 * through {@link agentRunSettings}, the prompt text, the connector and the
 * local-checks runner. It logs the choice once.
 *
 * The SDK runner reads its prompt from the first of {@link promptCandidates}
 * that exists, else from Plot's shipped `templates/worker-prompt.md`. Where
 * neither can be read, the agent runs on `command`.
 *
 * @param input - the environment, the config reader and the ports.
 * @returns the runner, and the SDK runner's deps where it is `sdk`.
 */
export const runnerDeps = async (input: RunnerInput): Promise<{ runner: 'command' | 'sdk'; sdk?: SdkRunDeps }> => {
  const cfg = (key: string): string => input.configKey(input.worktree, key) ?? '';
  const reading = readAgentCharter(input.repoRoot, input.agent);
  const charter = reading.read === 'declared' ? reading.charter : null;
  const runner = cfg('Agent runner');
  const choice = runnerChoice({
    agentRunner: runner === 'sdk' || runner === 'command' ? runner : '',
    isWorker: true,
    workerLoop: 'js',
    fragment: cfg('Worker command'),
    charterHarness: charter?.harness ?? '',
    defaultsToSdkWhenNamed: false,
  });
  if (choice.runner !== 'sdk') {
    if (runner !== '') input.log(`plot-worker-loop: the prompt runs on the command runner — ${choice.reason}`);
    return { runner: 'command' };
  }

  const shipped = join(input.scriptDir, '..', 'templates', 'worker-prompt.md');
  const files = [...promptCandidates(charter?.prompt ?? '').map((p) => join(input.repoRoot, p)), shipped];
  const found = files.map((path) => ({ path, text: readOrNull(path) })).find((f) => f.text !== null);
  if (found === undefined) {
    input.log(`plot-worker-loop: no worker prompt could be read (${files.join(', ')}); the prompt runs on the command runner`);
    return { runner: 'command' };
  }
  if (found.path === shipped) input.log(`plot-worker-loop: the project has no ${files[files.length - 2]}; the SDK runner reads Plot's shipped ${shipped}`);
  const promptFile = parsePromptFile(found.text!);

  const settings = agentRunSettings({
    charterModel: charter?.model ?? '',
    charterEffort: charter?.effort ?? '',
    charterContextWindow: charter?.bounds.contextWindow ?? 0,
    agentModels: cfg('Agent models'),
    workerCommand: cfg('Worker command'),
    agentContextWindow: count(cfg('Agent context window'), DEFAULT_AGENT_CONTEXT_WINDOW),
  });
  input.log(`plot-worker-loop: the prompt runs on the SDK runner — ${choice.reason}; model ${settings.model || 'the CLI default'} (${settings.modelSource})`);

  const settingsText = input.agentSettings === '' ? null : readOrNull(input.agentSettings);
  const agentSettings: unknown = settingsText === null ? undefined : parseOrUndefined(settingsText);
  const inheritedEnv = Object.fromEntries(
    Object.entries(input.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== 'PLOT_REPO_ROOT'),
  );
  const pathToClaudeCodeExecutable = await claudeOnPath(input.env.PATH ?? '');
  const scripts = input.env.PLOT_SCRIPT_DIR || input.scriptDir;
  return {
    runner: 'sdk',
    sdk: {
      agentRun: (context) =>
        agentRunSdk({
          inheritedEnv,
          readSettingsFiles: settingsFilesOf(input.env.HOME || homedir()),
          agentSettings,
          agentSettingsPath: input.agentSettings,
          pathToClaudeCodeExecutable,
          spawnClaudeCodeProcess: spawnAttached,
          processes: input.ports.processes,
          now: () => Math.floor(input.now() / 1000),
          afterWait: context.afterWait,
          commitsSinceWait: context.commitsSinceWait,
          readOnlyDeny: promptFile.readOnlyDeny ?? DEFAULT_READ_ONLY_DENY,
        }),
      prompt: (branch) => renderPrompt(promptFile.body, branch, scripts),
      model: settings.model,
      effort: settings.effort,
      maxTurns: positive(cfg('Agent max turns'), DEFAULT_AGENT_MAX_TURNS),
      maxSpendUsd: dollarsOrUnset(cfg('Agent max spend')) ?? 0,
      contextWindow: settings.contextWindow,
      capabilities: charter?.capabilities ?? [],
      runChecks: localChecksRunner(input.ports.boundedRun, input.scriptDir, input.boundSeconds, input.checksOutFile),
    },
  };
};

/** A thrown value's message, or its text where it is not an `Error`. */
const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Writes one SDK run's run line and its budget entries, and logs what could
 * not be written. A record that cannot be written costs a reading, never the
 * run: neither a refusal nor a throw reaches the caller. A `no-cost` refusal is
 * the `command` runner's answer and is not logged.
 *
 * @param deps - the loop's ports and log.
 * @param worktree - the desk the run worked in.
 * @param branch - the branch the run worked on.
 * @param result - what the run produced.
 */
const recordRunRecords = async (deps: LoopDeps, worktree: string, branch: string, result: AgentRunResult): Promise<void> => {
  try {
    const refusal = await deps.ports.recordRun(worktree, branch, 'worker', new Date(deps.now()).toISOString(), result);
    if (refusal !== null && refusal !== 'no-cost') {
      deps.log(`plot-worker-loop: no run line for ${branch} (${refusal})`);
    }
  } catch (error) {
    deps.log(`plot-worker-loop: no run line for ${branch} (${reasonOf(error)})`);
  }
  try {
    const failed = await deps.ports.recordLimits(result, deps.now());
    if (failed > 0) deps.log(`plot-worker-loop: ${failed} usage-limit reading(s) not recorded`);
  } catch (error) {
    deps.log(`plot-worker-loop: usage-limit readings not recorded (${reasonOf(error)})`);
  }
};

/** A file's text, or `null` where it cannot be read. */
const readOrNull = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

/** Parsed JSON, or `undefined` where the text does not parse. */
const parseOrUndefined = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

/** The harness a launch names; an empty `PLOT_HARNESS` (a launch with no charter exports one) means `claude`. */
export const harnessName = (env: NodeJS.ProcessEnv): string => env.PLOT_HARNESS || 'claude';

/** The wall clock in ms, moved by `PLOT_CLOCK_OFFSET_SECONDS` as the shell's `clock_now` is. */
export const offsetClock = (env: NodeJS.ProcessEnv): (() => number) =>
  () => Date.now() + integer(env.PLOT_CLOCK_OFFSET_SECONDS, 0) * 1000;

/** `PLOT_WAIT_STARTED` as epoch ms; `undefined` where it is empty or absent. */
const waitStartedFromEnv = (raw: string | undefined): number | undefined =>
  raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : undefined;

/** The parts of `process` {@link restartDeps} reads. */
export interface RestartPlatform {
  readonly execPath: string;
  readonly execArgv: readonly string[];
  readonly argv: readonly string[];
  readonly execve?: unknown;
  readonly memoryUsage: () => { rss: number };
}

/**
 * Builds this process's {@link RestartDeps}: pins the main checkout, hashes
 * the running bundle `<scriptDir>/board/plot-worker-loop.mjs`, and reads the
 * newest commit that changed it in its own checkout.
 *
 * @param trees - the worktree port of the loop's repository.
 * @param scriptDir - this process's `scriptDir`.
 * @param env - the environment the restarted process inherits.
 * @param log - where the restart's lines go.
 * @param platform - the running process.
 * @returns the restart's dependencies; `undefined`, with a logged line, where
 *   no main checkout is pinned or the running bundle cannot be hashed, and the
 *   loop never restarts.
 */
export const restartDeps = async (
  trees: Trees,
  scriptDir: string,
  env: NodeJS.ProcessEnv,
  log: (line: string) => void,
  platform: RestartPlatform = process,
): Promise<RestartDeps | undefined> => {
  const pinned = await pinMainCheckout(trees, scriptDir);
  if (pinned === null) {
    log('plot-worker-loop: no main checkout is listed for this repository; this loop does not restart itself on new code');
    return undefined;
  }
  const runningBundle = join(scriptDir, 'board', 'plot-worker-loop.mjs');
  const hashed = pinned.refs.hashFilesSync([runningBundle]);
  const loadedHash = hashed.ok ? hashed.value.get(runningBundle) : undefined;
  if (loadedHash === undefined) {
    log(`plot-worker-loop: ${runningBundle} cannot be hashed; this loop does not restart itself on new code`);
    return undefined;
  }
  const own = await refsGit({ repoRoot: resolve(scriptDir, '..', '..', '..'), scriptDir }).lastCommitTouching(BUNDLE_RELATIVE_PATH);
  const logged = new Set<string>();
  return {
    pinned,
    runningBundle,
    loadedHash,
    runningCommit: own.ok ? own.value : '',
    residentBytes: () => platform.memoryUsage().rss,
    execveAvailable: typeof platform.execve === 'function',
    exec: { path: platform.execPath, options: platform.execArgv, args: platform.argv.slice(2) },
    selfCheckFailures: new Map<string, number>(),
    logOnce: (line: string) => {
      if (logged.has(line)) return;
      logged.add(line);
      log(line);
    },
    log,
    env,
  };
};

/** The `## Plot Config` keys the loop reads at start; {@link selfCheck} reads each. */
const LOOP_CONFIG_KEYS = ['Worker bound', 'Checks wait', 'Correction budget', 'Slice max runs', 'Agent runner', 'Worker command'];

/**
 * A candidate bundle's proof that it starts: builds the loop's ports and reads
 * its configuration, writing nothing.
 *
 * @param env - the environment the candidate would start with.
 * @param scriptDir - the candidate's `scriptDir`.
 * @param configKey - how a `## Plot Config` key is read.
 * @returns 0 where both succeed; 1 where either throws.
 */
export const selfCheck = async (
  env: NodeJS.ProcessEnv,
  scriptDir: string,
  configKey: ConfigReader = shippedConfig(scriptDir),
): Promise<number> => {
  try {
    const worktree = env.PLOT_WORKTREE ?? process.cwd();
    await workerLoopPorts({ repoRoot: worktree, scriptDir });
    for (const key of LOOP_CONFIG_KEYS) configKey(worktree, key);
    return 0;
  } catch {
    return 1;
  }
};

/**
 * Starts the loop from its environment, as `plot-worker-loop.sh` hands it over.
 *
 * @param env - the process environment.
 * @param scriptDir - where the helper scripts live, one level above this bundle.
 * @returns the process exit code.
 */
export const main = async (
  env: NodeJS.ProcessEnv,
  scriptDir: string,
  configKey: ConfigReader = shippedConfig(scriptDir),
  target: StopTarget = process,
): Promise<number> => {
  const worktree = env.PLOT_WORKTREE ?? process.cwd();
  const repoRoot = env.PLOT_REPO_ROOT ?? worktree;
  const boundSeconds = count(env.PLOT_WORKER_BOUND, count(configKey(worktree, 'Worker bound'), 28800));
  const manifestFile = env.PLOT_MANIFEST_FILE ?? '';
  const ports = await workerLoopPorts(
    { repoRoot: worktree, scriptDir },
    manifestFile === '' ? undefined : dirname(manifestFile),
  );
  const transcript = transcriptFs();
  const outFile = join(tmpdir(), `plot-worker-loop-${process.pid}.out`);
  const checksOutFile = join(tmpdir(), `plot-worker-checks-${process.pid}.out`);
  const leaveNow = (): void => {
    if (manifestFile !== '') rmSync(manifestFile, { force: true });
    rmSync(outFile, { force: true });
    rmSync(checksOutFile, { force: true });
  };
  const leave = async (): Promise<void> => {
    if (manifestFile !== '') await rm(manifestFile, { force: true });
    await rm(outFile, { force: true });
    await rm(checksOutFile, { force: true });
    await ports.desk.clearLimitedRecord(worktree);
  };
  onStop(target, leaveNow, leave);
  await stampManifestLoopJs(manifestFile);
  const agentSettings = await resolveAgentSettings(scriptsShell({ repoRoot: worktree, scriptDir }), stderrLog);
  const base = env.PLOT_BASE ?? (await defaultBase(ports.refs));
  const waitStartedAt = waitStartedFromEnv(env.PLOT_WAIT_STARTED);
  const hopFrom = env.PLOT_HOP_FROM ?? '';
  if (env.PLOT_WAIT_STARTED !== undefined) {
    const wait = waitStartedAt === undefined ? 'no free wait' : `the free wait from ${new Date(waitStartedAt).toISOString()}`;
    const hop = hopFrom === '' ? '' : ` and the hop from ${hopFrom}`;
    stderrLog(`plot-worker-loop: restarted as pid ${process.pid} on ${join(scriptDir, 'board', 'plot-worker-loop.mjs')}, keeping ${wait}${hop}`);
  }
  // The carried state reaches no prompt and no check this process starts.
  delete env.PLOT_WAIT_STARTED;
  delete env.PLOT_HOP_FROM;
  const restart = await restartDeps(ports.trees, scriptDir, env, stderrLog);
  const now = offsetClock(env);
  const runner = await runnerDeps({
    env,
    scriptDir,
    repoRoot,
    worktree,
    agent: env.PLOT_AGENT ?? '',
    configKey,
    ports,
    boundSeconds,
    agentSettings,
    checksOutFile,
    now,
    log: stderrLog,
  });
  const code = await runWorkerLoop({
    ...runner,
    ports,
    restart,
    waitStartedAt,
    hopFrom,
    idle: {
      selfPid: process.pid,
      windowSeconds: count(env.PLOT_MONITOR_QUIET_SECONDS, IDLE_WINDOW_SECONDS),
      intervalMs: positive(env.PLOT_MONITOR_INTERVAL, 30) * 1000,
      transcript,
    },
    manifestFile,
    repoRoot,
    worktree,
    agent: env.PLOT_AGENT ?? '',
    harness: harnessName(env),
    config: {
      boundSeconds,
      waitBudgetSeconds: count(env.PLOT_WAIT_BUDGET_SECONDS, boundSeconds),
      passIntervalMs: positive(env.PLOT_WAIT_POLL_SECONDS, PASS_INTERVAL_MS / 1000) * 1000,
      checksPollMs: positive(env.PLOT_CHECKS_POLL_SECONDS, PASS_INTERVAL_MS / 1000) * 1000,
      maxStartRetries: count(env.PLOT_START_ATTEMPT_BUDGET, 3),
      checksWaitSeconds: count(env.PLOT_CHECKS_WAIT_SECONDS, count(configKey(worktree, 'Checks wait'), 1800)),
      correctionBudget: count(env.PLOT_CORRECTION_BUDGET, count(configKey(worktree, 'Correction budget'), 2)),
      sliceMaxRuns: positive(configKey(worktree, 'Slice max runs'), DEFAULT_SLICE_MAX_RUNS),
      sliceMaxSpendUsd: dollarsOrUnset(configKey(worktree, 'Slice max spend')),
      base,
    },
    limitMarginSeconds: integer(env.PLOT_LIMIT_MARGIN_SECONDS, 60),
    monitorEndsWorker: (env.PLOT_MONITOR_ENDS_WORKER ?? '1') === '1',
    outFile,
    sessionId: env.PLOT_SESSION_ID ?? '',
    slug: env.PLOT_SLUG ?? '',
    agentSettings,
    now,
    sleep: systemSleep,
    log: stderrLog,
  });
  await leave();
  return code;
};

// Only when RUN, never when imported — see `prompt-exit.ts` for why the
// comparison goes through `realpathSync`. Executing the entry is what `main`'s
// tests cannot do without starting a process, and the entry spawns none itself.
/* v8 ignore start */
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  // `--self-check` runs `selfCheck` and starts no loop.
  // The bundle sits in `scripts/board/`; the helper scripts are one level up.
  const scriptDir = dirname(new URL('.', import.meta.url).pathname.replace(/\/$/, ''));
  process.exit(process.argv.includes('--self-check') ? await selfCheck(process.env, scriptDir) : await main(process.env, scriptDir));
}
/* v8 ignore stop */

export { agentLoop, performLoopWrites, promptExit };
