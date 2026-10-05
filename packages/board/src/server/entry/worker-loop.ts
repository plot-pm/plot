import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  agentsFs,
  boundedRunProcess,
  buildShell,
  deskFs,
  hostShell,
  processesShell,
  refsGit,
  refsRemoteGit,
  transcriptFs,
  treesGit,
  type ShellContext,
} from '@plot-pm/domain/adapters';
import { checksFromRuns, type RemoteTipReading } from '@plot-pm/domain/rules/checks-verdict';
import { promptExit } from '@plot-pm/domain/rules/prompt-exit';
import { loopRegistration, type LoopRegistration } from '@plot-pm/domain/rules/desk-manifest';
import { agentLoop, type AgentLoopReadings } from '@plot-pm/domain/workflows/agent-loop';
import type { ResetRefusal } from '@plot-pm/domain/rules/reapable';
import type { Agents, BoundedRun, Desk, Processes, Refs, Trees } from '@plot-pm/domain';
import type { BuildPort } from '@plot-pm/domain/ports/build';
import type { Host } from '@plot-pm/domain/ports/host';

import { performLoopWrites, type LoopWritePorts } from './loop-writes.js';

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
 * still re-read every pass from the manifest's assignment; only its start time
 * is held across passes.
 *
 * **THE PROMPT RUNS THROUGH `boundedRun`, NEVER DETACHED.** `agentLoop` emits
 * `prompt-run`/`agent-resume` as RECORDS — `performLoopWrites` does not invoke
 * anything for them — and this entry is the caller that actually runs the
 * prompt, in the process group it inherited, so the dispatch wrapper's group
 * stop still reaches it.
 */

/** How long one pass sleeps before the next, in milliseconds — matches `WAIT_POLL_SECONDS`'s shell default. */
export const PASS_INTERVAL_MS = 60_000;

/** The idle window `idleNow` judges a transcript's silence against — the shipped default. */
export const IDLE_WINDOW_SECONDS = 900;

/** The start of the CURRENT wait (free, or checks), epoch ms; `null` outside one. */
interface WaitClock {
  since: number | null;
}

/** Every port this entry reads or writes through, composed once at start. */
export interface WorkerLoopPorts extends LoopWritePorts {
  readonly build: BuildPort;
  readonly host: Pick<Host, 'prState'>;
  readonly transcriptQuietSeconds: (worktree: string) => Promise<number | 'unavailable'>;
}

/**
 * Builds the real ports this loop runs against.
 *
 * @param context - the repository root and where its helper scripts live.
 * @returns the ports a pass reads and writes through.
 */
export const workerLoopPorts = async (context: ShellContext): Promise<WorkerLoopPorts> => {
  const processes: Processes = processesShell(context);
  const trees: Trees = treesGit(context);
  const refs: Refs = { ...refsGit(context), ...refsRemoteGit(context) };
  const agents: Agents = agentsFs(context);
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
    transcriptQuietSeconds: async (worktree: string) => {
      const answer = await transcript.quietSeconds(worktree);
      if (!answer.ok) return 'unavailable';
      return answer.value.quiet === 'unavailable' ? 'unavailable' : answer.value.seconds;
    },
  };
};

/** The manifest fields this loop reads, at the shapes the dispatcher and the supervisor write them. */
export interface ManifestFields {
  session: string;
  worktree: string;
  branch: string;
  attempts: number;
  correctionAttempts: number;
  resumeId: string;
}

/** The empty manifest reading — a hand-started loop, or a manifest this parse could not read. */
const EMPTY_MANIFEST: ManifestFields = {
  session: '',
  worktree: '',
  branch: '',
  attempts: 0,
  correctionAttempts: 0,
  resumeId: '',
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
  ports: Pick<WorkerLoopPorts, 'trees' | 'refs'>,
  worktree: string,
): Promise<ResetRefusal[]> => {
  const out: ResetRefusal[] = [];
  const markers = await ports.trees.markers(worktree, 'PLOT-BLOCKED');
  if (markers.ok && markers.value.length > 0) out.push('blocked-marker');
  const dirty = await ports.trees.dirtyPaths(worktree);
  if (dirty.ok && dirty.value.length > 0) out.push('uncommitted-changes');
  const branch = await ports.trees.currentBranch(worktree);
  if (branch.ok && branch.value !== '') {
    const ahead = ports.refs.countAheadSync(branch.value);
    if (ahead.ok && ahead.value > 0) out.push('unpushed-commits');
  }
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
    return text.split('\n')[0] ?? '';
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
}

/** What one pass is told about the repository's config, read once at start. */
export interface PassConfig {
  readonly boundSeconds: number;
  readonly maxStartRetries: number;
  readonly checksWaitSeconds: number;
  readonly correctionBudget: number;
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

  const base: AgentLoopReadings = {
    assignedBranch: manifest.branch,
    waitedSeconds: 0,
    boundSeconds: config.boundSeconds,
    registration: 'registered',
    claim: null,
    base: config.base,
    running: prompt.running,
    exit: prompt.exit,
    startRetries: manifest.attempts,
    maxStartRetries: config.maxStartRetries,
    markerWritten: false,
    markerText: '',
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
  clock.since = null;

  const worktree = manifest.worktree;
  const branch = manifest.branch;

  // ROW 4 — an assignment was just read, no prompt has run on it yet.
  if (prompt.running === null && prompt.exit === null) {
    const refusals = await readResetRefusals(ports, worktree);
    const markerText = refusals.includes('blocked-marker') ? await readMarkerText(worktree) : '';
    return { ...base, resetRefusals: refusals, markerText };
  }

  // ROWS 5-6 — a prompt is running this pass; its idle reading is already in
  // `prompt.running`, so nothing further is read.
  if (prompt.running !== null) return base;

  const exit = prompt.exit;
  if (exit === null) return base;

  // ROWS 7-9 — the prompt exited `unstarted`, `wait` or `end-limited`. None of
  // these reads anything about the desk or the host.
  if (exit.answer !== 'ran') return base;

  // ROW 10 — the agent may have written its own marker.
  const markerText = await readMarkerText(worktree);
  if (markerText !== '') return { ...base, markerWritten: true, markerText };

  // ROW 11 — unlanded work with no marker.
  const refusals = await readResetRefusals(ports, worktree);
  if (refusals.length > 0) return { ...base, resetRefusals: refusals };

  // ROW 12a — before the wait starts: is the head pushed, and is a PR open?
  const [pushedAnswer, prAnswer] = await Promise.all([
    ports.refs.remoteHead(branch),
    ports.host.prState(branch),
  ]);
  const pushed = pushedAnswer.ok && pushedAnswer.value === 'present';
  const pr = prAnswer.ok ? prAnswer.value : null;
  const prOpen = pr !== null && pr.state === 'OPEN';
  const prNumber = pr !== null ? pr.number : null;

  if (!pushed || !prOpen) {
    return { ...base, pushed, prOpen, pr: prNumber };
  }

  // ROWS 12-18 — work is pushed and a PR is open: the CI wait.
  if (clock.since === null) clock.since = Date.now();
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
    waitedSeconds,
  };
};

// THE IDLE WATCH ITSELF IS NOT WIRED IN THIS SLICE — SEE PLOT-BLOCKED.md.
// `idleNow` (rules/sample.ts) takes six readings: pid, spoken, transcript
// silence, a CPU-on-core veto over the agent's process subtree, how long the
// desk's TREE has been quiet (file mtimes, not transcript mtimes), and whether
// the branch already carries real commits. This slice's scope gave the entry
// `transcriptFs` for the transcript silence reading alone. The other three —
// a recursive child-process CPU sampler (`plot_worker_activity`), a worktree
// mtime walk (`plot_worker_tree_quiet_seconds`), and a has-real-commits check
// (`plot_worker_has_commits`) — have no domain port today, and inventing one
// under this slice's own time pressure risks shipping an idle detector that is
// wrong in a way nothing here would catch. `readPass` above already takes
// `PromptState.running` as a value its CALLER supplies, so wiring these three
// readings is additive once they exist — it does not reshape anything above.

export { agentLoop, performLoopWrites, promptExit };
