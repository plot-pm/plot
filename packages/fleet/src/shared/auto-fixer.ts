import fs from 'node:fs';
import path from 'node:path';

import {
  slicePrNext,
  type SlicePrNextReadings,
  type SlicePrStep,
  type DeskDeadAnswer,
  type FixerReading,
} from '@plot-pm/domain';
import { roleCommand, roleAgentsJson, type RoleAgentRef } from '@plot-pm/domain/rules/role-command';
import type { FixerFinding } from '@plot-pm/domain/entities/fixer-attempts';
import type { FixerAttemptsStore } from '@plot-pm/domain/ports/fixer-attempts';
import { fixerInFlight, fixerAttemptsExhausted } from '@plot-pm/domain/rules/fixer-attempts';
import type { PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import type { FreshAgentRecordStore } from '@plot-pm/domain/ports/fresh-agent-record';
import type { Trees } from '@plot-pm/domain/ports/trees';
import type { Host } from '@plot-pm/domain/ports/host';
import type { Processes } from '@plot-pm/domain/ports/processes';
import type { AgentRun } from '@plot-pm/domain/ports/agent-run';
import {
  hostShell,
  processesShell,
  boundedRunProcess,
  treesGit,
  fixerAttemptsFile,
  freshAgentRecordFile,
} from '@plot-pm/domain/adapters';
import { agentRunCommand } from '@plot-pm/domain/adapters/agent-run/agent-run-command';
import { HARNESS_LIMIT_LINES } from '@plot-pm/domain/adapters/harness/limit-lines';
import { sameCommit } from '@plot-pm/domain/rules/same-commit';
import type { WorkerState } from '@plot-pm/domain/entities/fleet';
import { readEnding, ENDING_FILENAME } from '@plot-pm/domain/entities/ending';
import { takeContinueLock, releaseContinueLock, continueLockPath } from './continue-lock.js';
import { mainCheckout } from './main-checkout.js';
import type { ActOptions } from './action-log.js';

/** What the fixer tick reads and acts through; a test replaces each. */
export interface FixerTickWorld {
  readonly trees: (opts: ActOptions) => Pick<Trees, 'forBranch' | 'addBranch' | 'removeOnly'>;
  readonly host: (opts: ActOptions) => Pick<Host, 'prState'>;
  readonly worker: (opts: ActOptions) => Pick<Processes, 'workerState'>;
  readonly attempts: (opts: ActOptions) => Pick<FixerAttemptsStore, 'read' | 'append'>;
  readonly freshAgents: (opts: ActOptions) => Pick<FreshAgentRecordStore, 'rowsFor'>;
  /** Reads a desk worktree's ending file; real `fs` by default, `null` for "no file". */
  readonly readEndingFile: (worktree: string) => string | null;
  /** Reads a role's definition file from the main checkout; real `fs` by default. */
  readonly readRoleFile: (main: string, role: string) => string | null;
  /** Starts the role agent; the `command` runner against real adapters by default. */
  readonly agentRun: (opts: ActOptions, fragment: string) => Pick<AgentRun, 'run'>;
}

/** The readings one tick hands {@link fixerTick} besides the PR's own. */
export type FixerTickReadings = Omit<SlicePrNextReadings, 'row' | 'desk' | 'correctionsSpentExhausted' | 'fixer'>;

/** Why a fixer start was refused, beyond a `PortResult`'s own `'failed'`/`'unaskable'`. */
export type FixerStartRefusal =
  | 'append-failed'
  | 'lock-held'
  | 'pr-not-open'
  | 'head-moved'
  | 'unaskable'
  | 'worktree-leftover'
  | 'worktree-failed'
  | 'role-files-failed'
  | 'role-command-refused'
  | 'command-exited-unstarted';

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

/** The name every continue-lock file, guard and scratch file starts with. */
const LOCK_REMNANT_PREFIX = path.basename(continueLockPath('/'));

/**
 * Clears a run directory that holds no worktree, so `git worktree add` can create it.
 *
 * Removes the directory where it is empty or holds only continue-lock files —
 * what a failed `git worktree add`, or a start that took its lock inside the
 * run directory, leaves. Removes nothing else.
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
 * `corrections-spent` ending — the one case {@link ciRedArm} reads instead of
 * {@link DeskDeadAnswer}, because `deskDead` reads that fresh session's own
 * `PLOT-BLOCKED` marker as `waiting` rather than `dead` (see
 * {@link SlicePrNextReadings.correctionsSpentExhausted}'s own doc comment).
 *
 * Reads the desk's `.plot-worker.ending.json` and, only where that ending is
 * `corrections-spent`, `.plot/state/fresh-agents.tsv` for a prior row on this
 * branch. Called with no plan name, since the PR index carries none — a row
 * written for a different plan reusing this branch name would be missed,
 * which undercounts rather than overcounts, the safe direction for a check
 * that only ever makes the fixer start MORE readily on a desk that is free.
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

/**
 * One tick of the fixer arm over the open rows.
 *
 * For every row, finds the slice's own worktree (if any is on this machine)
 * and reads its worker state fresh (translated into a {@link DeskDeadAnswer})
 * and whether its one fresh session is already spent on `corrections-spent`,
 * plus the fixer attempts record, then asks {@link slicePrNext}. On a `fixer`
 * step: writes the attempt first and refuses the start outright on any
 * failure to do so, takes the PR's fixer start lock in {@link fixerLockDir},
 * re-asks the host for the PR's current state and head before starting,
 * creates the fixer's OWN worktree (separate from the slice's) on the PR's own
 * branch at {@link fixerRunDir}, and starts the role through the `command`
 * agent runner with a `roleCommand`-built fragment. The lock is released once
 * the start call returns; it bounds the start sequence, not the fixer's run.
 *
 * @param rows - the open rows.
 * @param readings - the readings that do not depend on the row.
 * @param opts - the repository and scripts directory.
 * @param world - the ports the tick reads and acts through; the real adapters where absent.
 * @returns one result per row.
 */
export const fixerTick = async (
  rows: readonly PrIndexRow[],
  readings: FixerTickReadings,
  opts: ActOptions,
  world: FixerTickWorld = defaultFixerTickWorld,
): Promise<FixerTickResult[]> => {
  const results: FixerTickResult[] = [];
  for (const row of rows) {
    const found = await world.trees(opts).forBranch(row.head);
    const deskTree = found.ok ? found.value : null;
    const hasPr = true;
    const worker = deskTree === null ? null : await world.worker(opts).workerState(deskTree.path, hasPr);
    const desk: DeskDeadAnswer = worker?.ok ? deskDeadFromWorkerState(worker.value.state) : { dead: false, why: 'elsewhere' };
    const spentExhausted = await correctionsSpentExhausted(world, opts, deskTree?.path ?? null, row.head);

    const asked = await world.attempts(opts).read(row.number);
    const attempts = asked.ok ? asked.value : 'unreadable';
    const fixer: FixerReading =
      attempts === 'unreadable'
        ? { read: 'unread' }
        : { read: 'record', inFlight: fixerInFlight(attempts), exhausted: fixerAttemptsExhausted(attempts) };

    const step = slicePrNext({ ...readings, row, desk, correctionsSpentExhausted: spentExhausted, fixer });
    if (step.step !== 'fixer') {
      results.push({ pr: row.number, step });
      continue;
    }

    results.push({
      pr: row.number,
      step,
      started: await startFixer(world, opts, row, step, fixerRunDir(opts.repoRoot, row.number)),
    });
  }
  return results;
};

/** The finding a fixer attempt records — unresolved by the plan this wave built from: no HIGH-finding hash or CI run-id producer exists yet, so this reads the head commit as a stand-in hash and names no run-id. Reported as a judgment call, not a mechanism this wave invented to replace. */
const findingFor = (step: { readonly evidence: 'high' | 'ci-red' }, head: string): FixerFinding =>
  step.evidence === 'high' ? { kind: 'high', hash: head } : { kind: 'ci', runId: head };

/**
 * Carries out a `fixer` step: write the attempt, take the lock, re-ask the
 * host, create the worktree, and start the role.
 *
 * The lock lives in {@link fixerLockDir}, so the run directory does not exist
 * when `git worktree add` creates it. A run directory that holds only lock
 * files or nothing is removed first; one that holds anything else, a
 * worktree among them, refuses the start as `worktree-leftover`. A start that
 * created the worktree and then failed removes it through
 * {@link Trees.removeOnly} before it releases the lock.
 *
 * **WRITES NO `inFlight` MARK — a gap this wave inherits, not one it
 * invented.** The plan's text ("writes the attempt and its in-flight mark
 * before it starts the fixer") presumes the pid is known before the append;
 * it is not — `AgentRun.run`'s `onStarted` callback is the only source of a
 * fixer's pid, and it fires only once the process has actually been spawned,
 * after the append this function must already have made and refused on
 * failure. `FixerAttemptsStore` (wave 1, sealed) exposes only `read`/
 * `append`, no way to patch an existing attempt's `inFlight` field once the
 * pid is known. So `fixerInFlight`'s "no second fixer" protection is NOT
 * fully realised: the continue lock still serialises two callers racing the
 * same tick, but a second tick running after this one returns would read
 * this PR's newest attempt with no `inFlight` mark and could start a second
 * fixer beside a still-running one. Reported, not silently worked around.
 *
 * @param world - the fixer tick's world.
 * @param opts - the repository and scripts directory.
 * @param row - the PR's row, for its number.
 * @param step - the `fixer` step `slicePrNext` answered.
 * @param worktree - the fixer's worktree, absolute.
 * @returns whether a process started, and its pid, or why not.
 */
const startFixer = async (
  world: FixerTickWorld,
  opts: ActOptions,
  row: PrIndexRow,
  step: { readonly head: string; readonly evidence: 'high' | 'ci-red' },
  worktree: string,
): Promise<FixerStartOutcome> => {
  const store = world.attempts(opts);
  const appended = await store.append(row.number, { headSha: step.head, finding: findingFor(step, step.head) });
  if (!appended.ok) return { started: false, why: 'append-failed' };

  const lockDir = fixerLockDir(opts.repoRoot, row.number);
  fs.mkdirSync(lockDir, { recursive: true });
  const lock = takeContinueLock(lockDir);
  if (lock === null) return { started: false, why: 'lock-held' };
  const trees = world.trees(opts);
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
    const made = await trees.addBranch(worktree, row.head, pr.headSha);
    if (!made.ok) {
      clearRunDirRemnants(worktree);
      return (outcome = { started: false, why: 'worktree-failed' });
    }
    added = true;
    outcome = await launchFixer(world, opts, row, worktree);
    return outcome;
  } finally {
    if (added && !outcome.started) {
      const removed = await trees.removeOnly(worktree);
      if (!removed.ok) console.error(`could not remove the fixer worktree ${worktree} after a failed start`);
    }
    releaseContinueLock(lockDir, lock);
  }
};

/**
 * Writes the role's `--agents` JSON and starts the fixer in its worktree.
 *
 * @param world - the fixer tick's world.
 * @param opts - the repository and scripts directory.
 * @param row - the PR's row, for its number.
 * @param worktree - the fixer's worktree, absolute; it exists.
 * @returns whether a process started, and its pid, or why not.
 */
const launchFixer = async (
  world: FixerTickWorld,
  opts: ActOptions,
  row: PrIndexRow,
  worktree: string,
): Promise<FixerStartOutcome> => {
  const main = mainCheckout(opts.repoRoot);
  const text = world.readRoleFile(main, 'fixer');
  if (text === null) return { started: false, why: 'role-files-failed' };
  const json = roleAgentsJson('fixer', text);
  if (json.read !== 'json') return { started: false, why: 'role-files-failed' };
  const agentsFile = fixerAgentsJsonPath(opts.repoRoot, row.number);
  fs.mkdirSync(path.dirname(agentsFile), { recursive: true });
  fs.writeFileSync(agentsFile, json.json, 'utf8');

  const ref: RoleAgentRef = {
    name: 'fixer',
    agentsFile,
    settingsFile: path.join(main, '.claude', 'settings', 'fixer.json'),
  };
  const command = roleCommand(ref, maxTurnsOf(text));
  if (command.read !== 'command') return { started: false, why: 'role-command-refused' };

  const logFile = path.join(opts.repoRoot, '.plot', 'state', 'fixer', `${row.number}.log`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  return await new Promise<FixerStartOutcome>((resolve) => {
    let settled = false;
    // NOT AWAITED: the run itself is the fixer's whole session, which can
    // run for its full turn bound. `launchFixer` resolves once the process
    // is launched — mirroring `board-run.ts`'s `startBoardRun`, the
    // fleet's existing shape for "start a role, don't wait for it to end."
    world
      .agentRun(opts, command.command)
      .run({
        worktree,
        prompt: '',
        resumeId: '',
        role: 'fixer',
        harness: '',
        model: '',
        effort: '',
        maxTurns: 0,
        maxSpendUsd: 0,
        boundSeconds: 0,
        contextWindow: 0,
        capabilities: [],
        env: { PLOT_ROLE_GATE: path.join(main, 'skills', 'plot', 'scripts', 'board', 'plot-gate.mjs') },
        logFile,
        onStarted: (pid) => {
          settled = true;
          resolve({ started: true, pid });
        },
      })
      .then((result) => {
        // Reached only where the process never spawned at all — `onStarted`
        // settles this promise in every path that does.
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

/** The ports built from the real adapters. */
const defaultFixerTickWorld: FixerTickWorld = {
  trees: (opts) => treesGit({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }),
  host: (opts) => hostShell({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }),
  worker: (opts) => processesShell({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }),
  attempts: (opts) => fixerAttemptsFile(opts.repoRoot),
  freshAgents: (opts) => freshAgentRecordFile({ cwd: opts.repoRoot }),
  readEndingFile: (file) => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  },
  readRoleFile: (main, role) => {
    try {
      return fs.readFileSync(path.join(main, '.claude', 'agents', `${role}.md`), 'utf8');
    } catch {
      return null;
    }
  },
  agentRun: (opts, fragment) =>
    agentRunCommand({
      boundedRun: boundedRunProcess(processesShell({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir })),
      fragment,
      limitPatterns: HARNESS_LIMIT_LINES.claude,
      now: Date.now,
    }),
};
