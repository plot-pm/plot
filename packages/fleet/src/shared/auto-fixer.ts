import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  slicePrNext,
  type DefaultBranchReading,
  type SlicePrNextReadings,
  type SlicePrStep,
  type DeskDeadAnswer,
  type FixerReading,
} from '@plot-pm/domain';
import { roleCommand, roleAgentsJson, type RoleAgentRef } from '@plot-pm/domain/rules/role-command';
import type { PidCheck } from '@plot-pm/domain/rules/role-run-alive';
import { fixerPrompt, endedFixerAttempts, type FixerEvidence } from '@plot-pm/domain/rules/fixer-start';
import type { FixerAttemptsRecord, FixerFinding, FixerInFlight } from '@plot-pm/domain/entities/fixer-attempts';
import type { FixerAttemptsStore } from '@plot-pm/domain/ports/fixer-attempts';
import { fixerInFlight, fixerAttemptsExhausted, FIXER_BOUND_SECONDS } from '@plot-pm/domain/rules/fixer-attempts';
import { fixerAdmission, fixerRanToBound, runningFixers } from '@plot-pm/domain/rules/fixer-concurrency';
import type { SlotRefusalInput } from '@plot-pm/domain/rules/fleet-run';
import type { PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import type { FreshAgentRecordStore } from '@plot-pm/domain/ports/fresh-agent-record';
import type { RunLogLine } from '@plot-pm/domain/ports/run-log';
import type { Trees } from '@plot-pm/domain/ports/trees';
import type { Host } from '@plot-pm/domain/ports/host';
import type { Processes } from '@plot-pm/domain/ports/processes';
import type { AgentRun } from '@plot-pm/domain/ports/agent-run';
import {
  boundedRunProcess,
  defaultBranchFile,
  fixerAttemptsFile,
  freshAgentRecordFile,
  hostShell,
  prIndexFile,
  processesShell,
  treesGit,
} from '@plot-pm/domain/adapters';
import { agentRunCommand } from '@plot-pm/domain/adapters/agent-run/agent-run-command';
import { HARNESS_LIMIT_LINES } from '@plot-pm/domain/adapters/harness/limit-lines';
import { sprintScopeRef } from '@plot-pm/domain/adapters/sprint-scope-ref';
import { sameCommit } from '@plot-pm/domain/rules/same-commit';
import type { WorkerState } from '@plot-pm/domain/entities/fleet';
import { readEnding, ENDING_FILENAME } from '@plot-pm/domain/entities/ending';
import { takeContinueLock, releaseContinueLock, continueLockPath } from './continue-lock.js';
import { mainCheckout } from './main-checkout.js';
import { commonGitDir } from './agent-log.js';
import { hostOf, refsOf, runLogOf, scriptsOf, type ActOptions } from './action-log.js';

/** What the fixer tick reads and acts through; a test replaces each. */
export interface FixerTickWorld {
  readonly trees: (opts: ActOptions) => Pick<Trees, 'forBranch' | 'add' | 'fetch' | 'prune' | 'removeOnly'>;
  readonly host: (opts: ActOptions) => Pick<Host, 'prState'>;
  readonly worker: (opts: ActOptions) => Pick<Processes, 'workerState'>;
  readonly attempts: (opts: ActOptions) => Pick<FixerAttemptsStore, 'read' | 'append' | 'markInFlight'>;
  readonly freshAgents: (opts: ActOptions) => Pick<FreshAgentRecordStore, 'rowsFor'>;
  /** Reads a desk worktree's ending file; real `fs` by default, `null` for "no file". */
  readonly readEndingFile: (worktree: string) => string | null;
  /** Reads a role's definition file from the main checkout; real `fs` by default. */
  readonly readRoleFile: (main: string, role: string) => string | null;
  /** The path of the agent settings file in the main checkout, or `null` where it is absent. */
  readonly agentSettingsFile: (main: string) => string | null;
  /** Reads a review verdict file; real `fs` by default, `null` for a file that cannot be read. */
  readonly readVerdictFile: (file: string) => string | null;
  /** Asks the process table about one pid; `kill -0` by default. */
  readonly pidCheck: (pid: string) => PidCheck;
  /** The pid the in-flight mark names until the fixer's own pid is known: this process. */
  readonly starterPid: number;
  /** Starts the role agent; the `command` runner against real adapters by default. */
  readonly agentRun: (opts: ActOptions, fragment: string) => Pick<AgentRun, 'run'>;
}

/** The readings one tick hands {@link fixerTick} besides the PR's own. */
export type FixerTickReadings = Omit<SlicePrNextReadings, 'row' | 'desk' | 'correctionsSpentExhausted' | 'fixer'> & {
  /** The queue and machine readings a start takes its slot from; `null` reads as `queue-unread`. */
  readonly slot: SlotRefusalInput | null;
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

/** Where this fixer run's `--agents` JSON is written — outside the run's own tree, as `PLOT_ROLE_GATE` requires. */
const fixerAgentsJsonPath = (repoRoot: string, pr: number): string =>
  path.join(repoRoot, '.plot', 'state', 'fixer', `${pr}.agents.json`);

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

/** The turn limit `roleCommand` enforces for the fixer, read from its own frontmatter rather than hardcoded. */
const maxTurnsOf = (text: string): number => {
  const match = /^maxTurns:\s*(\d+)\s*$/m.exec(text);
  return match ? Number(match[1]) : 0;
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

/** One run-log line for a PR's fixer step. */
const fixerLine = (row: PrIndexRow, head: string, step: 'fixer-start' | 'fixer-end', outcome: string, now: number): RunLogLine => ({
  plan: '',
  branch: row.head,
  pr: String(row.number),
  head,
  step,
  outcome,
  at: new Date(now).toISOString(),
});

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
  const head = record.attempts[ended[ended.length - 1] ?? 0]?.headSha ?? '';
  const boundHit = ended.some((index) => {
    const startedAt = record.attempts[index]?.inFlight?.startedAt;
    return startedAt !== undefined && fixerRanToBound(startedAt, now);
  });
  if (boundHit) problems.push(`bound: the run reached ${FIXER_BOUND_SECONDS}s`);
  const outcome = problems.length === 0 ? 'moved' : `failed: ${[...new Set(problems)].join(', ')}`;
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

/**
 * One tick of the fixer arm over the open rows.
 *
 * For every row, the tick first settles the PR's ended fixers: an attempt whose
 * in-flight mark names a process that `roleRunAlive` reads as not alive gets
 * its worktree removed and its mark cleared. It then reads the slice's own
 * worktree (if any is on this machine), its worker state (translated into a
 * {@link DeskDeadAnswer}), whether its one fresh session is already spent on
 * `corrections-spent`, and the attempts record, and asks {@link slicePrNext}.
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

    const found = await world.trees(opts).forBranch(row.head);
    const deskTree = found.ok ? found.value : null;
    const worker = deskTree === null ? null : await world.worker(opts).workerState(deskTree.path, true);
    const desk: DeskDeadAnswer = worker?.ok ? deskDeadFromWorkerState(worker.value.state) : { dead: false, why: 'elsewhere' };
    const spentExhausted = await correctionsSpentExhausted(world, opts, deskTree?.path ?? null, row.head);
    const fixer: FixerReading =
      attempts === 'unreadable'
        ? { read: 'unread' }
        : { read: 'record', inFlight: fixerInFlight(attempts), exhausted: fixerAttemptsExhausted(attempts) };

    const step = slicePrNext({ ...readings, row, desk, correctionsSpentExhausted: spentExhausted, fixer });
    if (step.step !== 'fixer' || attempts === 'unreadable') {
      results.push({ pr: row.number, step });
      continue;
    }
    const index = attempts === 'none' ? 0 : attempts.attempts.length;
    const admission = fixerAdmission({
      running: await runningElsewhere(world, opts, rows, row.number),
      held: readings.slot?.held ?? null,
      headroom: readings.slot?.headroom ?? 'unmeasured',
      machineOverride: readings.slot?.machineOverride ?? false,
    });
    const started: FixerStartOutcome = admission.admit
      ? await startFixer(world, opts, row, step, index, readings.now, logged)
      : { started: false, why: admission.why };
    await logStart(opts, row, step.head, started, logged, readings.now);
    results.push({ pr: row.number, step, started });
  }
  return results;
};

/**
 * The finding a fixer attempt records: the SHA-256 of the review findings for
 * a HIGH, and the head SHA for a CI-red run, since the PR index carries no CI
 * run id.
 */
const findingFor = (evidence: FixerEvidence, head: string): FixerFinding =>
  evidence.kind === 'high'
    ? { kind: 'high', hash: createHash('sha256').update(evidence.findings).digest('hex') }
    : { kind: 'ci', runId: head };

/**
 * Carries out a `fixer` step.
 *
 * In order: reads the role file and builds its command; reads the evidence
 * (the review verdict of this head for a HIGH, the row's failing checks for a
 * CI-red run) and builds the prompt with `fixerPrompt`; takes the PR's start
 * lock in {@link fixerLockDir}; re-asks the host and refuses `pr-not-open` or
 * `head-moved`; creates the fixer's worktree at {@link fixerRunDir} DETACHED
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
 * @param step - the `fixer` step `slicePrNext` answered.
 * @param index - the position the appended attempt takes in the record.
 * @param now - epoch milliseconds of the tick.
 * @returns whether a process started, and its pid, or why not.
 */
const startFixer = async (
  world: FixerTickWorld,
  opts: ActOptions,
  row: PrIndexRow,
  step: { readonly head: string; readonly evidence: 'high' | 'ci-red' },
  index: number,
  now: number,
  logged: Set<string>,
): Promise<FixerStartOutcome> => {
  const main = mainCheckout(opts.repoRoot);
  const text = world.readRoleFile(main, 'fixer');
  if (text === null) return { started: false, why: 'role-files-failed' };
  const json = roleAgentsJson('fixer', text);
  if (json.read !== 'json') return { started: false, why: 'role-files-failed' };
  const agentsFile = fixerAgentsJsonPath(opts.repoRoot, row.number);
  const ref: RoleAgentRef = { name: 'fixer', agentsFile, settingsFile: path.join(main, '.claude', 'settings', 'fixer.json') };
  const role = roleCommand(ref, maxTurnsOf(text));
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
  } else {
    evidence = { kind: 'ci-red', failingChecks: row.failing_checks ?? [] };
  }
  const prompt = fixerPrompt({ pr: row.number, url: row.url, branch: row.head, head: step.head, evidence });
  if (prompt.read !== 'prompt') return { started: false, why: prompt.why };

  const lockDir = fixerLockDir(opts.repoRoot, row.number);
  fs.mkdirSync(lockDir, { recursive: true });
  const lock = takeContinueLock(lockDir);
  if (lock === null) return { started: false, why: 'lock-held' };
  const trees = world.trees(opts);
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
    fs.mkdirSync(path.dirname(agentsFile), { recursive: true });
    fs.writeFileSync(agentsFile, json.json, 'utf8');

    const startedAt = new Date(now).toISOString();
    const store = world.attempts(opts);
    const appended = await store.append(row.number, {
      headSha: step.head,
      finding: findingFor(evidence, step.head),
      inFlight: { pid: world.starterPid, startedAt },
    });
    if (!appended.ok) return (outcome = { started: false, why: 'append-failed' });

    outcome = await launchFixer(world, opts, row, worktree, command.command, prompt.text, main);
    const mark: FixerInFlight | null = outcome.started ? { pid: outcome.pid, startedAt } : null;
    const marked = await store.markInFlight(row.number, index, mark);
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
      .then((result) => {
        // Reached only where the process never spawned: `onStarted` settles
        // this promise in every path that does.
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
 * branch reading and the active sprint's scope.
 *
 * @param opts - where the fleet acts.
 * @param now - epoch milliseconds.
 * @returns the reading, or `null` where the host, the index or the open rows give nothing to act on.
 */
export const readFixerPass = async (opts: ActOptions, now: number): Promise<FixerPassReading | null> => {
  const host = hostOf(opts);
  const backend = await host.backend();
  if (!backend.ok) return null;
  const store = await prIndexFile({ cwd: opts.repoRoot }).read(backend.value);
  if (!store.ok || store.value === null) return null;
  const rows = store.value.rows.filter((row) => row.state === 'OPEN');
  if (rows.length === 0) return null;
  const reading = await defaultBranchFile(opts.repoRoot).read();
  const defaultBranch: DefaultBranchReading | null = reading.ok ? reading.value : null;
  const branch = defaultBranch?.branch ?? 'main';
  const scope = await sprintScopeRef(refsOf(opts), scriptsOf(opts), `origin/${branch}`);
  return {
    rows,
    readings: {
      newestMerged: null,
      scope,
      reviewRun: null,
      reviewStarts: null,
      verdict: { read: 'absent' },
      defaultBranch,
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
  slot?: SlotRefusalInput | null,
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
  worker: (opts) => processesShell({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }),
  attempts: (opts) => fixerAttemptsFile(opts.repoRoot),
  freshAgents: (opts) => freshAgentRecordFile({ cwd: opts.repoRoot }),
  readEndingFile: readOrNull,
  readRoleFile: (main, role) => readOrNull(path.join(main, '.claude', 'agents', `${role}.md`)),
  readVerdictFile: readOrNull,
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
