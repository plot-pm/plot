import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  claimStaleMsOf,
  fleetOwner,
  fixerPrNext,
  fleetScopeRow,
  MERGEABLE_CONFLICTING,
  type BaseTipReading,
  type DefaultBranchReading,
  type SlicePrNextReadings,
  type SlicePrStep,
  type DeskDeadAnswer,
  type FixerReading,
  type FleetOwner,
} from '@plot-pm/domain';
import { roleCommand, type RoleAgentRef } from '@plot-pm/domain/rules/role-command';
import type { PidCheck } from '@plot-pm/domain/rules/role-run-alive';
import { fixerPrompt, endedFixerAttempts, type FixerEvidence } from '@plot-pm/domain/rules/fixer-start';
import type { FixerAttemptsRecord, FixerFinding, FixerInFlight } from '@plot-pm/domain/entities/fixer-attempts';
import type { FixerAttemptsStore } from '@plot-pm/domain/ports/fixer-attempts';
import { fixerReadingOf, fixerRerunAnswer, rerunOnHead, FIXER_BOUND_SECONDS } from '@plot-pm/domain/rules/fixer-attempts';
import type { BuildPort } from '@plot-pm/domain/ports/build';
import { fixerAdmission, fixerRanToBound, runningFixers } from '@plot-pm/domain/rules/fixer-concurrency';
import { askWithHeadroom, type MachineSlot } from './machine-reading.js';
import type { PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import type { FreshAgentRecordStore } from '@plot-pm/domain/ports/fresh-agent-record';
import type { RunLogLine } from '@plot-pm/domain/ports/run-log';
import type { Refs } from '@plot-pm/domain/ports/refs';
import type { Agents } from '@plot-pm/domain/ports/agents';
import type { Trees } from '@plot-pm/domain/ports/trees';
import type { Worktree } from '@plot-pm/domain/entities/worktree';
import type { Host } from '@plot-pm/domain/ports/host';
import type { Processes } from '@plot-pm/domain/ports/processes';
import type { AgentRun } from '@plot-pm/domain/ports/agent-run';
import {
  agentsFs,
  boundedRunProcess,
  buildShell,
  defaultBranchFile,
  fixerAttemptsFile,
  freshAgentRecordFile,
  hostShell,
  prIndexFile,
  processesFiles,
  processesShell,
  treesGit,
} from '@plot-pm/domain/adapters';
import { agentRunCommand } from '@plot-pm/domain/adapters/agent-run/agent-run-command';
import { HARNESS_LIMIT_LINES, HARNESS_START_REFUSALS } from '@plot-pm/domain/adapters/harness/limit-lines';
import { failedStart } from '@plot-pm/domain/rules/failed-start';
import { sameCommit } from '@plot-pm/domain/rules/same-commit';
import type { WorkerState } from '@plot-pm/domain/entities/fleet';
import { readEnding, ENDING_FILENAME } from '@plot-pm/domain/entities/ending';
import { takeContinueLock, releaseContinueLock, continueLockPath } from './continue-lock.js';
import { mainCheckout } from './main-checkout.js';
import { roleFilesAt } from './role-files.js';
import { commonGitDir } from './agent-log.js';
import { hostOf, refsOf, runLogOf, stateHomeOfOpts, type ActOptions } from './action-log.js';
import { readConfigAsync } from './config-reader.js';

/** What the fixer tick reads and acts through; a test replaces each. */
export interface FixerTickWorld {
  readonly trees: (opts: ActOptions) => Pick<Trees, 'forBranch' | 'add' | 'fetch' | 'prune' | 'removeOnly'>;
  readonly host: (opts: ActOptions) => Pick<Host, 'prState'>;
  readonly worker: (opts: ActOptions) => Pick<Processes, 'workerState'>;
  readonly attempts: (
    opts: ActOptions,
  ) => Pick<FixerAttemptsStore, 'read' | 'append' | 'markInFlight' | 'markStart' | 'markPushed' | 'markRerun' | 'markRerunCleared'>;
  /** The CI connector a `rerun` step asks; the repository's declared connector by default. */
  readonly build: (opts: ActOptions) => Pick<BuildPort, 'rerunFailed'>;
  readonly freshAgents: (opts: ActOptions) => Pick<FreshAgentRecordStore, 'rowsFor'>;
  /** Reads a desk worktree's ending file; real `fs` by default, `null` for "no file". */
  readonly readEndingFile: (worktree: string) => string | null;
  /** The ports the role's files and a head branch's claim commits are read through; the git adapter by default. */
  readonly refs: (opts: ActOptions) => Pick<Refs, 'defaultBranch' | 'showFile' | 'commitSubjects' | 'resolve'>;
  /** The registry the owner reading asks for a manifest naming the head branch; the file adapter by default. */
  readonly agents: (opts: ActOptions) => Pick<Agents, 'declared'>;
  /** The path of the agent settings file in the main checkout, or `null` where it is absent. */
  readonly agentSettingsFile: (main: string) => string | null;
  /** Reads a review verdict file; real `fs` by default, `null` for a file that cannot be read. */
  readonly readVerdictFile: (file: string) => string | null;
  /** The fixer run's log for one PR; `null` where it cannot be read. */
  readonly readLogFile: (file: string) => string | null;
  /** Asks the process table about one pid; `kill -0` by default. */
  readonly pidCheck: (pid: string) => PidCheck;
  /** The pid the in-flight mark names until the fixer's own pid is known: this process. */
  readonly starterPid: number;
  /** Starts the role agent; the `command` runner against real adapters by default. */
  readonly agentRun: (opts: ActOptions, fragment: string) => Pick<AgentRun, 'run'>;
}

/** The readings one tick hands {@link fixerTick} besides the PR's own. */
export type FixerTickReadings = Omit<
  SlicePrNextReadings,
  'row' | 'desk' | 'correctionsSpentExhausted' | 'fixer' | 'baseTip' | 'scope'
> & {
  /** `Claim stale after`, in milliseconds; `null` where the key does not parse. */
  readonly claimStaleMs: number | null;
  /** The queue and machine readings a start takes its slot from; `null` reads as `queue-unread`. */
  readonly slot: MachineSlot | null;
};

/** Why a fixer start was refused, beyond a `PortResult`'s own `'failed'`/`'unaskable'`. */
export type FixerStartRefusal =
  | 'role-files-failed'
  | 'role-command-refused'
  | 'findings-unread'
  | 'findings-empty'
  | 'no-branch'
  | 'no-head'
  | 'lock-held'
  | 'pr-not-open'
  | 'head-moved'
  | 'not-conflicting'
  | 'unaskable'
  | 'worktree-leftover'
  | 'worktree-failed'
  | 'append-failed'
  | 'command-exited-unstarted'
  | 'fixer-busy'
  | 'queue-unread'
  | 'no-free-agent'
  | 'starved';

/** What one fixer start answered: a launched process and its pid, or why none started. */
export type FixerStartOutcome = { started: true; pid: number } | { started: false; why: FixerStartRefusal | string };

/** What one tick did for one PR. */
export interface FixerTickResult {
  readonly pr: number;
  readonly step: SlicePrStep;
  /** Set where the step was `fixer` and a start was tried. */
  readonly started?: FixerStartOutcome;
}

/** The worktree a fixer run works in, inside the fleet's own run directory. */
export const fixerRunDir = (repoRoot: string, pr: number): string =>
  path.join(repoRoot, '.plot', 'fixer', String(pr));

/**
 * The directory that holds a PR's fixer start lock, outside {@link fixerRunDir}.
 *
 * `git worktree add` refuses a target path that exists and is not empty, so
 * the lock file must not live in the worktree it serialises the creation of.
 */
export const fixerLockDir = (repoRoot: string, pr: number): string =>
  path.join(repoRoot, '.plot', 'state', 'fixer', `${pr}.lock`);

/** Where the review of one head leaves its verdict: `<common git dir>/plot/state/reviews/<pr>-<sha>.md`. */
export const reviewVerdictPath = (repoRoot: string, pr: number, head: string): string =>
  path.join(commonGitDir(repoRoot) ?? path.join(repoRoot, '.git'), 'plot', 'state', 'reviews', `${pr}-${head}.md`);

/** The name every continue-lock file, guard and scratch file starts with. */
const LOCK_REMNANT_PREFIX = path.basename(continueLockPath('/'));

/**
 * Clears a run directory that holds no worktree, so `git worktree add` can create it.
 *
 * Removes the directory where it is empty or holds only continue-lock files.
 * Removes nothing else.
 *
 * @param dir - the fixer's run directory, absolute.
 * @returns `true` where no directory is at `dir` now, `false` where something
 *   other than lock files is there (a worktree among them) or the removal failed.
 */
const clearRunDirRemnants = (dir: string): boolean => {
  try {
    const entries = fs.readdirSync(dir);
    if (!entries.every((entry) => entry.startsWith(LOCK_REMNANT_PREFIX))) return false;
    for (const entry of entries) fs.rmSync(path.join(dir, entry), { force: true });
    fs.rmdirSync(dir);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT';
  }
};

/** Where this fixer run's log is appended. */
const fixerLogPath = (repoRoot: string, pr: number): string => path.join(repoRoot, '.plot', 'state', 'fixer', `${pr}.log`);

/** Where this fixer run's `agents.json` and `settings.json` are written — outside the run's own tree, as `PLOT_ROLE_GATE` requires, and one directory per PR so concurrent fixers never share a file. */
const fixerRoleDir = (repoRoot: string, pr: number): string => path.join(repoRoot, '.plot', 'state', 'fixer', String(pr));

/** Translates a {@link WorkerState} into the {@link DeskDeadAnswer} `deskDead` would have answered, had the fleet assembled `AgentStateReadings` from scratch. */
export const deskDeadFromWorkerState = (state: WorkerState): DeskDeadAnswer => {
  switch (state) {
    case 'elsewhere':
      return { dead: false, why: 'elsewhere' };
    case 'waiting':
      return { dead: false, why: 'waiting' };
    case 'running':
      return { dead: false, why: 'live' };
    default:
      return { dead: true };
  }
};

/**
 * Whether the slice's own desk already spent its one fresh session on a
 * `corrections-spent` ending — the one case `ciRedArm` reads instead of
 * {@link DeskDeadAnswer}, because `deskDead` reads that fresh session's own
 * `PLOT-BLOCKED` marker as `waiting` rather than `dead`.
 *
 * Reads the desk's `.plot-worker.ending.json` and, only where that ending is
 * `corrections-spent`, `.plot/state/fresh-agents.tsv` for a prior row on this
 * branch, asked with no plan name because the PR index carries none.
 *
 * @param world - the fixer tick's world.
 * @param opts - the repository and scripts directory.
 * @param worktree - the slice's own worktree, or `null` where none is on this machine.
 * @param branch - the slice's branch.
 * @returns whether the desk's one fresh session is already spent on `corrections-spent`.
 */
const correctionsSpentExhausted = async (
  world: FixerTickWorld,
  opts: ActOptions,
  worktree: string | null,
  branch: string,
): Promise<boolean> => {
  if (worktree === null) return false;
  const text = world.readEndingFile(path.join(worktree, ENDING_FILENAME));
  const ending = readEnding(text);
  if (ending.read !== 'ended' || ending.ending.reason !== 'corrections-spent') return false;
  const rows = await world.freshAgents(opts).rowsFor('', branch);
  return rows.ok && rows.value.length > 0;
};

/** Reads one PR's attempts; a read that fails is `'unreadable'`, which holds. */
const readAttempts = async (
  world: FixerTickWorld,
  opts: ActOptions,
  pr: number,
): Promise<FixerAttemptsRecord | 'none' | 'unreadable'> => {
  const asked = await world.attempts(opts).read(pr);
  return asked.ok ? asked.value : 'unreadable';
};

/**
 * Reads the tip of a conflicting row's base branch: fetches the base, then
 * resolves `origin/<base>`. A row that is not conflicting gets no read, since
 * `conflictArm` answers before it reads a tip. A row with no base, a failed
 * fetch, a failed resolve or an empty answer reads `unread`.
 */
const readBaseTip = async (world: FixerTickWorld, opts: ActOptions, row: PrIndexRow): Promise<BaseTipReading | undefined> => {
  if (row.mergeable !== MERGEABLE_CONFLICTING) return undefined;
  if (row.base === undefined || row.base === '') return { read: 'unread' };
  const fetched = await world.trees(opts).fetch(opts.repoRoot, row.base);
  if (!fetched.ok) return { read: 'unread' };
  const tip = await world.refs(opts).resolve(`origin/${row.base}`);
  return tip.ok && tip.value.trim() !== '' ? { read: 'tip', sha: tip.value.trim() } : { read: 'unread' };
};

/**
 * Whether an attempt the CLI refused to start holds this step: one on the same
 * head and, for a conflict step, on the same base tip too.
 */
const failedStartHolds = (
  attempts: FixerAttemptsRecord | 'none',
  step: { readonly head: string; readonly evidence: string },
  baseTip: string,
): boolean =>
  attempts !== 'none' &&
  attempts.attempts.some(
    (attempt) =>
      attempt.start === 'failed' &&
      attempt.headSha === step.head &&
      (step.evidence !== 'conflict' || (attempt.finding.kind === 'conflict' && attempt.finding.baseTip === baseTip)),
  );

/** One run-log line for a PR's fixer step. */
const fixerLine = (row: PrIndexRow, head: string, step: 'fixer-start' | 'ci-rerun' | 'fixer-end', outcome: string, now: number): RunLogLine => ({
  plan: '',
  branch: row.head,
  pr: String(row.number),
  head,
  step,
  outcome,
  at: new Date(now).toISOString(),
});

/**
 * The refusal line of an ended attempt the CLI refused to start, or `null`.
 *
 * Reads the attempt's own `start` mark, which {@link launchFixer} writes when
 * the run's result carries the line, and the log's last line otherwise, so the
 * reap and the result agree whichever comes first. Marks every ended attempt
 * it finds failed, once.
 */
const failedStartOf = async (
  world: FixerTickWorld,
  opts: ActOptions,
  row: PrIndexRow,
  ended: readonly number[],
  record: FixerAttemptsRecord,
): Promise<string | null> => {
  const last = ended[ended.length - 1];
  if (last === undefined) return null;
  const marked = record.attempts[last]?.start === 'failed';
  const log = world.readLogFile(fixerLogPath(opts.repoRoot, row.number));
  const read = failedStart({ status: null, output: log ?? '' }, HARNESS_START_REFUSALS.claude);
  if (!marked && !read.failed) return null;
  if (!marked) await world.attempts(opts).markStart(row.number, last);
  return read.failed ? read.line : 'the CLI refused the run';
};

/**
 * Settles the attempts whose fixer process has ended.
 *
 * Removes the fixer's worktree through {@link Trees.removeOnly} where its run
 * directory exists, clears each ended attempt's in-flight mark, and logs one
 * `fixer-end` line: `moved`, or `failed:` with what did not land. An attempt
 * that ran for at least {@link FIXER_BOUND_SECONDS} adds `bound` as a cause.
 *
 * @param world - the fixer tick's world.
 * @param opts - the repository and scripts directory.
 * @param row - the PR's row.
 * @param ended - the positions of the ended attempts.
 * @param record - the record those positions index.
 * @param now - epoch milliseconds of the tick.
 */
const settleEnded = async (
  world: FixerTickWorld,
  opts: ActOptions,
  row: PrIndexRow,
  ended: readonly number[],
  record: FixerAttemptsRecord,
  now: number,
): Promise<void> => {
  const problems: string[] = [];
  const dir = fixerRunDir(opts.repoRoot, row.number);
  if (fs.existsSync(dir) && !(await world.trees(opts).removeOnly(dir)).ok) problems.push('worktree-not-removed');
  const store = world.attempts(opts);
  for (const index of ended) {
    if (!(await store.markInFlight(row.number, index, null)).ok) problems.push('mark-not-cleared');
  }
  for (const index of ended) {
    const attempt = record.attempts[index];
    if (attempt?.start !== 'failed' && row.headSha !== undefined && attempt !== undefined && row.headSha !== attempt.headSha) {
      if (!(await store.markPushed(row.number, index, row.headSha)).ok) problems.push('pushed-not-recorded');
    }
  }
  const head = record.attempts[ended[ended.length - 1] ?? 0]?.headSha ?? '';
  const boundHit = ended.some((index) => {
    const startedAt = record.attempts[index]?.inFlight?.startedAt;
    return startedAt !== undefined && fixerRanToBound(startedAt, now);
  });
  if (boundHit) problems.push(`bound: the run reached ${FIXER_BOUND_SECONDS}s`);
  const refusal = await failedStartOf(world, opts, row, ended, record);
  const outcome =
    refusal !== null ? `failed-start: ${refusal}` : problems.length === 0 ? 'moved' : `failed: ${[...new Set(problems)].join(', ')}`;
  await runLogOf(opts).append(fixerLine(row, head, 'fixer-end', outcome, now));
};

/**
 * Logs one start: every launch as `moved`, and a refusal as `failed: <why>`
 * once per PR, head and reason for as long as `logged` lives.
 */
const logStart = async (
  opts: ActOptions,
  row: PrIndexRow,
  head: string,
  started: FixerStartOutcome,
  logged: Set<string>,
  now: number,
): Promise<void> => {
  if (!started.started) {
    const key = `${row.number}:${head}:${started.why}`;
    if (logged.has(key)) return;
    logged.add(key);
  }
  const outcome = started.started ? 'moved' : `failed: ${started.why}`;
  await runLogOf(opts).append(fixerLine(row, head, 'fixer-start', outcome, now));
};

/** How many fixers run on pull requests other than `pr`; an unreadable record counts as one. */
const runningElsewhere = async (world: FixerTickWorld, opts: ActOptions, rows: readonly PrIndexRow[], pr: number): Promise<number> => {
  let running = 0;
  for (const other of rows) {
    if (other.number === pr) continue;
    const record = await readAttempts(world, opts, other.number);
    running += runningFixers(record, endedFixerAttempts(record, world.pidCheck));
  }
  return running;
};

/** The ports {@link readHeadOwner} reads through. */
export interface HeadOwnerPorts {
  readonly trees: Pick<Trees, 'forBranch'>;
  readonly agents: Pick<Agents, 'declared'>;
  readonly refs: Pick<Refs, 'commitSubjects'>;
}

/**
 * Reads who owns a PR's head branch, for the fixer and review passes.
 *
 * Asks the worktree listing for the head branch, the registry's manifests, and
 * the claim commits of `origin/<base>..origin/<head>`, and answers through
 * `fleetOwner`. A failed read makes the owner `unread`.
 *
 * @param ports - the worktree listing, the registry and the commit reader.
 * @param row - the PR's OPEN row.
 * @param claimStaleMs - `Claim stale after`, in milliseconds; `null` where the key does not parse.
 * @param now - epoch milliseconds of the tick.
 * @returns the owner, and the worktree on this machine that holds the head branch, or `null`.
 */
export const readHeadOwner = async (
  ports: HeadOwnerPorts,
  row: PrIndexRow,
  claimStaleMs: number | null,
  now: number,
): Promise<{ owner: FleetOwner; deskTree: Worktree | null }> => {
  const found = await ports.trees.forBranch(row.head);
  const deskTree = found.ok ? found.value : null;
  const declared = await ports.agents.declared();
  const claims = await ports.refs.commitSubjects(`origin/${row.base}..origin/${row.head}`);
  const owner = fleetOwner({
    worktree: !found.ok ? 'unread' : deskTree === null ? 'absent' : 'here',
    manifest: declared.ok ? declared.value.some((manifest) => manifest.branch === row.head) : 'unread',
    claims: claims.ok ? claims.value : 'unread',
    claimStaleMs,
    now,
  });
  return { owner, deskTree };
};

/**
 * One tick of the fixer arm over the open rows.
 *
 * For every row, the tick first settles the PR's ended fixers: an attempt whose
 * in-flight mark names a process that `roleRunAlive` reads as not alive gets
 * its worktree removed and its mark cleared. It then reads the slice's own
 * worktree (if any is on this machine), its worker state (translated into a
 * {@link DeskDeadAnswer}), whether its one fresh session is already spent on
 * `corrections-spent`, the attempts record and, for a conflicting row, the
 * base tip after a fetch, and asks {@link fixerPrNext}.
 * A row that `fleetScopeRow` puts out of scope gets its reason and no further
 * read. Otherwise the owner reading asks the worktree listing, the registry's
 * manifests and the claim commits of `origin/<base>..origin/<head>`; a failed
 * read answers `owner-unread` and starts nothing.
 * A `fixer` step goes to {@link startFixer} once `fixerAdmission` finds no other
 * fixer running and a free machine slot; otherwise it holds with that reason
 * and starts on a later pass. Each start, refusal and end is
 * written to the run log; a refusal is written once per PR, head and reason.
 *
 * @param rows - the open rows.
 * @param readings - the readings that do not depend on the row.
 * @param opts - the repository, scripts directory and run log.
 * @param world - the ports the tick reads and acts through; the real adapters where absent.
 * @param logged - the refusals already logged; the caller keeps it across ticks.
 * @returns one result per row.
 */
export const fixerTick = async (
  rows: readonly PrIndexRow[],
  readings: FixerTickReadings,
  opts: ActOptions,
  world: FixerTickWorld = defaultFixerTickWorld,
  logged: Set<string> = new Set(),
): Promise<FixerTickResult[]> => {
  const results: FixerTickResult[] = [];
  for (const row of rows) {
    let attempts = await readAttempts(world, opts, row.number);
    const ended = endedFixerAttempts(attempts, world.pidCheck);
    if (ended.length > 0 && attempts !== 'none' && attempts !== 'unreadable') {
      await settleEnded(world, opts, row, ended, attempts, readings.now);
      attempts = await readAttempts(world, opts, row.number);
    }

    const out = fleetScopeRow(row, readings.defaultBranchName);
    if (out !== null) {
      results.push({ pr: row.number, step: { step: 'none', why: out } });
      continue;
    }

    const { owner, deskTree } = await readHeadOwner(
      { trees: world.trees(opts), agents: world.agents(opts), refs: world.refs(opts) },
      row,
      readings.claimStaleMs,
      readings.now,
    );
    const worker = deskTree === null ? null : await world.worker(opts).workerState(deskTree.path, true);
    const desk: DeskDeadAnswer = worker?.ok ? deskDeadFromWorkerState(worker.value.state) : { dead: false, why: 'elsewhere' };
    const spentExhausted = await correctionsSpentExhausted(world, opts, deskTree?.path ?? null, row.head);
    const baseTip = await readBaseTip(world, opts, row);
    const tip = baseTip?.read === 'tip' ? baseTip.sha : '';
    const clock = { now: readings.now, checksWaitMs: readings.config.checksWaitMs };
    if (await clearSeenRerun(world, opts, row, attempts, clock)) attempts = await readAttempts(world, opts, row.number);
    const fixer: FixerReading = fixerReadingOf(attempts, row.headSha ?? '', tip, clock);

    const step = fixerPrNext({
      ...readings,
      row,
      desk,
      correctionsSpentExhausted: spentExhausted,
      fixer,
      owner,
      ...(baseTip === undefined ? {} : { baseTip }),
    });
    if (step.step === 'rerun' && attempts !== 'unreadable') {
      await rerunFailedJobs(world, opts, row, step.head, readings.now);
      results.push({ pr: row.number, step });
      continue;
    }
    if (step.step !== 'fixer' || attempts === 'unreadable') {
      results.push({ pr: row.number, step });
      continue;
    }
    if (failedStartHolds(attempts, step, tip)) {
      const held: FixerStartOutcome = { started: false, why: 'fixer-start-failed' };
      await logStart(opts, row, step.head, held, logged, readings.now);
      results.push({ pr: row.number, step, started: held });
      continue;
    }
    const index = attempts === 'none' ? 0 : attempts.attempts.length;
    const running = await runningElsewhere(world, opts, rows, row.number);
    const slot = readings.slot;
    const admission =
      slot === null
        ? fixerAdmission({ running, held: null, headroom: 'unmeasured', machineOverride: false })
        : await askWithHeadroom(
            slot,
            (headroom) => fixerAdmission({ running, held: slot.held, headroom, machineOverride: slot.machineOverride }),
            (answer) => answer.admit,
          );
    const started: FixerStartOutcome = admission.admit
      ? await startFixer(world, opts, row, step, tip, index, readings.now, logged)
      : { started: false, why: admission.why };
    await logStart(opts, row, step.head, started, logged, readings.now);
    results.push({ pr: row.number, step, started });
  }
  return results;
};

/**
 * Marks the head's re-run cleared where the row reads `pending` or `green` on
 * that head and the re-run answered `asked` and is not cleared yet.
 *
 * @returns whether a mark was written, so the caller reads the record again.
 */
const clearSeenRerun = async (
  world: FixerTickWorld,
  opts: ActOptions,
  row: PrIndexRow,
  attempts: FixerAttemptsRecord | 'none' | 'unreadable',
  clock: { now: number; checksWaitMs: number },
): Promise<boolean> => {
  const head = row.headSha ?? '';
  if (row.checksSha !== head || (row.ciChecks !== 'pending' && row.ciChecks !== 'green')) return false;
  const state = rerunOnHead(attempts, head, clock);
  if (state !== 'running' && state !== 'unseen') return false;
  const marked = await world.attempts(opts).markRerunCleared(row.number, head, new Date(clock.now).toISOString());
  return marked.ok;
};

/**
 * Carries out a `rerun` step: records the re-run as `asked`, then asks the CI
 * system to re-run the head's failed jobs once.
 *
 * A record that does not land asks nothing, so a crash or a failed write never
 * leads to a second call. An `unaskable` answer rewrites the entry as
 * `unaskable` and a failed call as `failed`. Each re-run is logged with the PR,
 * the head and the answer.
 */
const rerunFailedJobs = async (world: FixerTickWorld, opts: ActOptions, row: PrIndexRow, head: string, now: number): Promise<void> => {
  const at = new Date(now).toISOString();
  const store = world.attempts(opts);
  if (!(await store.markRerun(row.number, { headSha: head, at, answer: 'asked' })).ok) {
    await runLogOf(opts).append(fixerLine(row, head, 'ci-rerun', 'failed: record-not-written', now));
    return;
  }
  const asked = await world.build(opts).rerunFailed(row.head, head);
  const answer = asked.ok ? 'asked' : asked.why === 'unaskable' ? 'unaskable' : 'failed';
  if (answer !== 'asked') await store.markRerun(row.number, { headSha: head, at, answer });
  await runLogOf(opts).append(fixerLine(row, head, 'ci-rerun', answer === 'asked' ? 'moved: asked' : `failed: ${answer}`, now));
};

/**
 * The finding a fixer attempt records: the SHA-256 of the review findings for
 * a HIGH, the head SHA for a CI-red run, since the PR index carries no CI run
 * id, and the head and base tip for a conflict.
 */
const findingFor = (evidence: FixerEvidence, head: string): FixerFinding =>
  evidence.kind === 'high'
    ? { kind: 'high', hash: createHash('sha256').update(evidence.findings).digest('hex') }
    : evidence.kind === 'conflict'
      ? { kind: 'conflict', head, baseTip: evidence.baseTip }
      : { kind: 'ci', runId: head };

/**
 * Carries out a `fixer` step.
 *
 * In order: reads the role file and builds its command; reads the evidence
 * (the review verdict of this head for a HIGH, the row's failing checks for a
 * CI-red run, the row's base and `baseTip` for a conflict) and builds the
 * prompt with `fixerPrompt`; takes the PR's start lock in {@link fixerLockDir};
 * re-asks the host and refuses `pr-not-open`, `head-moved`, or for a conflict
 * `not-conflicting` where the host's answer is not `conflicting`; creates the fixer's worktree at {@link fixerRunDir} DETACHED
 * at the head; appends the attempt with an in-flight mark naming
 * {@link FixerTickWorld.starterPid}; and launches the role. Once the process
 * runs, the mark names the fixer's own pid. Every refusal before the append
 * spends no attempt. A launch that starts no process keeps the attempt spent,
 * clears its mark and removes the worktree.
 *
 * The worktree is detached because the slice's desk worktree can still hold
 * the PR's branch, and git refuses to check one branch out in two worktrees.
 * The prompt tells the fixer to push with `git push origin HEAD:<branch>`.
 *
 * The lock is released once the start returns; it bounds the start, not the
 * run. The in-flight mark holds every later tick while the fixer runs.
 *
 * @param world - the fixer tick's world.
 * @param opts - the repository and scripts directory.
 * @param row - the PR's row.
 * @param step - the `fixer` step `fixerPrNext` answered.
 * @param baseTip - the base tip the tick read; the conflict attempt's finding records it.
 * @param index - the position the appended attempt takes in the record.
 * @param now - epoch milliseconds of the tick.
 * @returns whether a process started, and its pid, or why not.
 */
const startFixer = async (
  world: FixerTickWorld,
  opts: ActOptions,
  row: PrIndexRow,
  step: { readonly head: string; readonly evidence: 'high' | 'ci-red' | 'conflict' },
  baseTip: string,
  index: number,
  now: number,
  logged: Set<string>,
): Promise<FixerStartOutcome> => {
  const main = mainCheckout(opts.repoRoot);
  const trees = world.trees(opts);
  const files = await roleFilesAt(
    { repoRoot: opts.repoRoot, trees, refs: world.refs(opts) },
    { role: 'fixer', outDir: fixerRoleDir(opts.repoRoot, row.number), settings: true },
  );
  if (files.read === 'refused') {
    console.error(`plot-fleetd: the fixer for #${row.number} did not start: ${files.why}`);
    return { started: false, why: 'role-files-failed' };
  }
  const ref: RoleAgentRef = { name: 'fixer', agentsFile: files.agentsFile, settingsFile: files.settingsFile };
  const role = roleCommand(ref, files.maxTurns, files.tools);
  if (role.read !== 'command') return { started: false, why: 'role-command-refused' };
  // A SECOND `--settings` MERGES WITH THE ROLE'S OWN (measured on 2.1.316): the agent settings disable the operator's plugins.
  const agentSettings = world.agentSettingsFile(main);
  if (agentSettings === null && !logged.has('agent-settings-absent')) {
    logged.add('agent-settings-absent');
    console.error('plot-fleetd: .plot/agent-settings.json is absent; the fixer starts with its own settings only');
  }
  const command = { command: agentSettings === null ? role.command : `${role.command} --settings '${agentSettings.replace(/'/g, `'\\''`)}'` };
  let evidence: FixerEvidence;
  if (step.evidence === 'high') {
    const findings = world.readVerdictFile(reviewVerdictPath(opts.repoRoot, row.number, step.head));
    if (findings === null) return { started: false, why: 'findings-unread' };
    evidence = { kind: 'high', findings };
  } else if (step.evidence === 'conflict') {
    evidence = { kind: 'conflict', base: row.base ?? '', baseTip };
  } else {
    const attempts = await readAttempts(world, opts, row.number);
    evidence = { kind: 'ci-red', failingChecks: row.failing_checks ?? [], rerun: fixerRerunAnswer(attempts, step.head) };
  }
  const prompt = fixerPrompt({ pr: row.number, url: row.url, branch: row.head, head: step.head, evidence });
  if (prompt.read !== 'prompt') return { started: false, why: prompt.why };

  const lockDir = fixerLockDir(opts.repoRoot, row.number);
  fs.mkdirSync(lockDir, { recursive: true });
  const lock = takeContinueLock(lockDir);
  if (lock === null) return { started: false, why: 'lock-held' };
  const worktree = fixerRunDir(opts.repoRoot, row.number);
  let added = false;
  let outcome: FixerStartOutcome = { started: false, why: 'unaskable' };
  try {
    const asked = await world.host(opts).prState(row.number, { withChecks: true });
    if (!asked.ok) return (outcome = { started: false, why: 'unaskable' });
    const pr = asked.value;
    if (pr === null || pr.state !== 'OPEN') return (outcome = { started: false, why: 'pr-not-open' });
    if (pr.headSha === undefined || pr.headSha === '') return (outcome = { started: false, why: 'unaskable' });
    if (!sameCommit(pr.headSha, step.head)) return (outcome = { started: false, why: 'head-moved' });
    // GitHub answers `unknown` for a while after a base moves; a start on that answer would spend an attempt on no conflict.
    if (step.evidence === 'conflict' && pr.mergeable !== MERGEABLE_CONFLICTING) {
      return (outcome = { started: false, why: 'not-conflicting' });
    }

    if (!clearRunDirRemnants(worktree)) return (outcome = { started: false, why: 'worktree-leftover' });
    fs.mkdirSync(path.dirname(worktree), { recursive: true });
    // A FAILED FETCH OR PRUNE REFUSES NOTHING: the head may already be local,
    // and `add` below refuses by name where it is not.
    await trees.prune();
    await trees.fetch(opts.repoRoot, row.head);
    const made = await trees.add(worktree, pr.headSha);
    if (!made.ok) {
      clearRunDirRemnants(worktree);
      return (outcome = { started: false, why: 'worktree-failed' });
    }
    added = true;

    const startedAt = new Date(now).toISOString();
    const store = world.attempts(opts);
    const appended = await store.append(row.number, {
      headSha: step.head,
      finding: findingFor(evidence, step.head),
      inFlight: { pid: world.starterPid, startedAt },
    });
    if (!appended.ok) return (outcome = { started: false, why: 'append-failed' });

    let markWritten: () => void = () => undefined;
    const markSettled = new Promise<void>((resolve) => {
      markWritten = resolve;
    });
    outcome = await launchFixer(world, opts, row, worktree, command.command, prompt.text, main, index, markSettled, startedAt);
    const mark: FixerInFlight | null = outcome.started ? { pid: outcome.pid, startedAt } : null;
    const marked = await store.markInFlight(row.number, index, mark);
    markWritten();
    if (!marked.ok) {
      console.error(`plot-fleetd: fixer on PR #${row.number}: could not ${mark === null ? 'clear' : 'record'} the in-flight mark`);
    }
    return outcome;
  } finally {
    if (added && !outcome.started) {
      const removed = await trees.removeOnly(worktree);
      if (!removed.ok) console.error(`plot-fleetd: could not remove the fixer worktree ${worktree} after a failed start`);
    }
    releaseContinueLock(lockDir, lock);
  }
};

/**
 * Records a failed start from the run's result.
 *
 * Sets `start: 'failed'` on the attempt. Where the reap already settled the
 * attempt as ended without that mark, the fixer-end line it wrote said `moved`;
 * this appends the `failed-start` line the reap would have written. Where the
 * attempt already carries the mark, the reap logged it and this appends nothing.
 */
const recordFailedStart = async (
  world: FixerTickWorld,
  opts: ActOptions,
  row: PrIndexRow,
  index: number,
  line: string,
  startedAt: string,
): Promise<void> => {
  const store = world.attempts(opts);
  const before = await store.read(row.number);
  const prior = before.ok && before.value !== 'none' && before.value !== 'unreadable' ? before.value.attempts[index] : undefined;
  if (!(await store.markStart(row.number, index)).ok) return;
  if (prior === undefined || prior.start === 'failed' || prior.inFlight !== undefined) return;
  await runLogOf(opts).append(fixerLine(row, prior.headSha, 'fixer-end', `failed-start: ${line}`, Date.parse(startedAt)));
};

/**
 * Starts the fixer in its worktree with its prompt.
 *
 * Resolves once the process is launched, or once the runner answers that none
 * was; it does not wait for the run to end.
 *
 * @param world - the fixer tick's world.
 * @param opts - the repository and scripts directory.
 * @param row - the PR's row, for its number.
 * @param worktree - the fixer's worktree, absolute; it exists.
 * @param command - the `roleCommand` fragment.
 * @param prompt - the `fixerPrompt` text.
 * @param main - the main checkout, which holds the role gate.
 * @param index - the position of the attempt this run belongs to.
 * @param markSettled - resolves once the caller has written the attempt's in-flight mark; a failed start is recorded after it, never racing it.
 * @param startedAt - the attempt's start time, for the failed-start log line.
 * @returns whether a process started, and its pid, or why not.
 */
const launchFixer = async (
  world: FixerTickWorld,
  opts: ActOptions,
  row: PrIndexRow,
  worktree: string,
  command: string,
  prompt: string,
  main: string,
  index: number,
  markSettled: Promise<void>,
  startedAt: string,
): Promise<FixerStartOutcome> => {
  const logFile = path.join(opts.repoRoot, '.plot', 'state', 'fixer', `${row.number}.log`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  return await new Promise<FixerStartOutcome>((resolve) => {
    let settled = false;
    // NOT AWAITED: the run is the fixer's whole session. `onStarted` resolves
    // this promise once the process runs.
    world
      .agentRun(opts, command)
      .run({
        worktree,
        prompt,
        resumeId: '',
        role: 'fixer',
        harness: '',
        model: '',
        effort: '',
        maxTurns: 0,
        maxSpendUsd: 0,
        boundSeconds: FIXER_BOUND_SECONDS,
        contextWindow: 0,
        capabilities: [],
        env: { PLOT_ROLE_GATE: path.join(main, 'skills', 'plot', 'scripts', 'board', 'plot-gate.mjs'), PLOT_ROLE_BRANCH: row.head },
        logFile,
        onStarted: (pid) => {
          settled = true;
          resolve({ started: true, pid });
        },
      })
      .then(async (result) => {
        // A run the CLI refused records its failed start whichever of this and
        // the reap comes first; the reap writes the log line.
        if (result.ok) {
          const refused = failedStart({ status: null, output: result.value.finalText ?? '' }, HARNESS_START_REFUSALS.claude);
          if (result.value.end.answer === 'unstarted' && refused.failed) {
            await markSettled;
            await recordFailedStart(world, opts, row, index, refused.line, startedAt);
          }
        }
        // The rest is reached only where the process never spawned:
        // `onStarted` settles this promise in every path that does.
        if (settled) return;
        settled = true;
        resolve({ started: false, why: result.ok ? 'command-exited-unstarted' : result.why });
      })
      .catch((err: unknown) => {
        if (settled) return;
        settled = true;
        resolve({ started: false, why: err instanceof Error ? err.message : String(err) });
      });
  });
};

/** What one fixer pass acts on: the open rows and the readings that do not depend on a row. */
export interface FixerPassReading {
  readonly rows: readonly PrIndexRow[];
  readonly readings: FixerTickReadings;
}

/**
 * Reads what one fixer pass acts on: the PR index's open rows, the default
 * branch reading, the default branch's name and `Claim stale after`. A failed
 * name read leaves `defaultBranchName` absent, so every row answers `base-unread`.
 *
 * @param opts - where the fleet acts.
 * @param now - epoch milliseconds.
 * @returns the reading, or `null` where the host, the index, the open rows or the state home give nothing to act on.
 */
export const readFixerPass = async (opts: ActOptions, now: number): Promise<FixerPassReading | null> => {
  const host = hostOf(opts);
  const backend = await host.backend();
  if (!backend.ok) return null;
  const store = await prIndexFile({ cwd: opts.repoRoot }).read(backend.value);
  if (!store.ok || store.value === null) return null;
  const rows = store.value.rows.filter((row) => row.state === 'OPEN');
  if (rows.length === 0) return null;
  const home = stateHomeOfOpts(opts);
  if (home === null) return null;
  const reading = await defaultBranchFile(home).read();
  const defaultBranch: DefaultBranchReading | null = reading.ok ? reading.value : null;
  const name = await refsOf(opts).defaultBranch();
  const claimStaleMs = claimStaleMsOf(await readConfigAsync(opts, 'Claim stale after', '24'));
  return {
    rows,
    readings: {
      newestMerged: null,
      ...(name.ok ? { defaultBranchName: name.value } : {}),
      claimStaleMs,
      reviewRun: null,
      reviewStarts: null,
      verdict: { read: 'absent' },
      defaultBranch,
      backend: backend.value,
      config: { autoReview: false, reviewBoundMs: 0, startBudget: 0, checksWaitMs: 0 },
      now,
      slot: null,
    },
  };
};

/**
 * Runs the fixer tick on the daemon's loop.
 *
 * @param opts - where the fleet acts.
 * @param logged - the refusals already logged, kept by the caller for the daemon's life.
 * @param now - epoch milliseconds.
 * @param world - the ports the tick acts through.
 * @param read - reads the rows and readings; {@link readFixerPass} by default.
 * @param slot - the queue and machine readings a start takes its slot from, replacing the reading's own; `null` reads as `queue-unread`.
 * @returns the tick's results, or `null` where nothing was read to act on.
 */
export const runAutoFixerPass = async (
  opts: ActOptions,
  logged: Set<string>,
  now: number = Date.now(),
  world: FixerTickWorld = defaultFixerTickWorld,
  read: (opts: ActOptions, now: number) => Promise<FixerPassReading | null> = readFixerPass,
  slot?: MachineSlot | null,
): Promise<FixerTickResult[] | null> => {
  const reading = await read(opts, now);
  if (reading === null) return null;
  return fixerTick(reading.rows, slot === undefined ? reading.readings : { ...reading.readings, slot }, opts, world, logged);
};

/** Reads a file, or `null` where it cannot be read. */
const readOrNull = (file: string): string | null => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

/** `kill -0` on one pid: `ESRCH` is dead, `EPERM` is alive, any other error is unanswerable. */
const killZero = (pid: string): PidCheck => {
  try {
    process.kill(Number(pid), 0);
    return 'alive';
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'ESRCH' ? 'dead' : code === 'EPERM' ? 'alive' : 'unanswerable';
  }
};

/** The ports built from the real adapters. */
const defaultFixerTickWorld: FixerTickWorld = {
  trees: (opts) => treesGit({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }),
  host: (opts) => hostShell({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }),
  worker: (opts) => processesFiles({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }),
  attempts: (opts) => fixerAttemptsFile(opts.repoRoot),
  build: (opts) => ({
    rerunFailed: async (branch, sha) =>
      (await buildShell({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir })).rerunFailed(branch, sha),
  }),
  freshAgents: (opts) => freshAgentRecordFile({ cwd: opts.repoRoot }),
  readEndingFile: readOrNull,
  refs: (opts) => refsOf(opts),
  agents: (opts) => agentsFs({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }),
  readVerdictFile: readOrNull,
  readLogFile: readOrNull,
  agentSettingsFile: (main) => {
    const file = path.join(main, '.plot', 'agent-settings.json');
    return fs.existsSync(file) ? file : null;
  },
  pidCheck: killZero,
  starterPid: process.pid,
  agentRun: (opts, fragment) =>
    agentRunCommand({
      boundedRun: boundedRunProcess(processesShell({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir })),
      fragment,
      limitPatterns: HARNESS_LIMIT_LINES.claude,
      now: Date.now,
    }),
};
