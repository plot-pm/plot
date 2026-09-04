import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  DECLARATION_FILENAME,
  readDeclaration,
  type DeclarationReading,
} from '@plot-pm/domain/entities/declaration';
import { headroomFor, type Headroom } from '@plot-pm/domain/entities/machine';
import {
  ALL_GATES,
  planAnnotatedGate,
  type ChangesetFile,
  type DeskReadings,
  type Gate,
  type PlanBranchLine,
} from '@plot-pm/domain/rules/gates';
import type { MergeReading } from '@plot-pm/domain/rules/reapable';
import type { SupervisionReadings } from '@plot-pm/domain/rules/supervision';
import type { SuperviseReadings } from '@plot-pm/domain/workflows/supervise';

import { type AgentEntry } from './registry.js';
import { transcriptDir, transcriptFile } from './transcript.js';

/**
 * What the supervisor reads the world through, so a test can hand it a world.
 *
 * Every member is a question the tick asks ONCE per agent. They arrive as
 * functions rather than as ports because the tick's readings are per-agent and
 * the ports are per-capability: `treesGit.dirtyPaths` and `hostShell.prMerged`
 * are two adapters answering about one desk, and the daemon is where they are
 * joined.
 *
 * Everything here is a READ. The supervisor's writes go through the decision it
 * returns, so this interface holds no way to spawn, kill or remove anything —
 * which is what keeps a bug here from being a bug that destroys work.
 */
export interface SupervisorWorld {
  /** Whether a worker process is alive in this desk. */
  workerAlive(worktree: string): Promise<boolean>;
  /** What the host said about any PR for this branch. */
  merge(branch: string): Promise<MergeReading>;
  /** The first uncommitted path in the desk, or `''` when it is clean. */
  dirtyPath(worktree: string): Promise<string>;
  /** The `PLOT-BLOCKED*` marker's filename, or `''` when the desk carries none. */
  blockedMarker(worktree: string): Promise<string>;
  /** The changeset files the desk added. */
  changesets(worktree: string): Promise<readonly ChangesetFile[]>;
  /** The workspace's package names, for the changeset gate. */
  workspacePackages(): Promise<readonly string[]>;
  /** The plan's line for this branch, or null where no plan or no reading. */
  planLine(branch: string): Promise<PlanBranchLine | null>;
  /** Whether the desk's branch holds commits the last worker made. */
  madeProgress(worktree: string, branch: string): Promise<boolean>;
  /** The machine's headroom, asked once per tick rather than per agent. */
  headroom(): Promise<Headroom>;
  /** The text of one file in a desk, or null when it is not there. */
  deskFile(worktree: string, name: string): string | null;
  /** Whether a transcript exists for a session id, from this desk. */
  transcriptFound(worktree: string, sessionId: string): boolean;
}

/**
 * Reads what one tick needs, for every agent the registry holds.
 *
 * ONE PASS, AND IT KEEPS NOTHING. The daemon re-reads the manifests and the
 * desks they name on every tick, so a process SIGKILLed mid-pass loses one
 * tick's readings and no decision — there is nothing to lose, because the
 * verdict is a function of what is on disk.
 *
 * The machine is asked ONCE and its answer is shared across every agent. It is
 * a property of the machine rather than of an agent, and asking per agent would
 * both cost N samples and let two agents in one tick see different headroom.
 *
 * @param entries - the registry's manifests, as `readAgentRegistry` reports them.
 * @param world - what to read the estate through.
 * @returns the tick's input, one entry per agent in registry order.
 */
export const readTick = async (
  entries: readonly AgentEntry[],
  world: SupervisorWorld,
): Promise<SuperviseReadings> => {
  const headroom = await world.headroom();
  const workspacePackages = await world.workspacePackages();
  const agents: SupervisionReadings[] = [];

  for (const entry of entries) {
    agents.push(await readAgent(entry, world, headroom, workspacePackages));
  }

  return { agents };
};

/**
 * Reads what one tick needs about ONE agent.
 *
 * The liveness question is asked first and the rest are asked anyway. A live
 * worker's readings are discarded by the rule, which costs one pass over a desk
 * and buys a reader that cannot be surprised: a tick that skipped the reads
 * would report a live agent with fields that look measured and are not.
 *
 * @param entry - the agent's manifest.
 * @param world - what to read the estate through.
 * @param headroom - the machine's answer, taken once for the whole tick.
 * @param workspacePackages - the workspace's package names.
 * @returns everything the rule reads about this agent.
 */
const readAgent = async (
  entry: AgentEntry,
  world: SupervisorWorld,
  headroom: Headroom,
  workspacePackages: readonly string[],
): Promise<SupervisionReadings> => {
  const { branch, worktree } = entry;
  const [workerAlive, merge, dirtyPath, blockedMarker, changesets, planLine, madeProgress] =
    await Promise.all([
      world.workerAlive(worktree),
      world.merge(branch),
      world.dirtyPath(worktree),
      world.blockedMarker(worktree),
      world.changesets(worktree),
      world.planLine(branch),
      world.madeProgress(worktree, branch),
    ]);

  const desk: DeskReadings = {
    branch,
    merge,
    changesets,
    workspacePackages,
    dirtyPath,
    blockedMarker,
    planLine,
  };

  return {
    branch,
    worktree,
    workerAlive,
    declaration: declarationOf(worktree, world),
    desk,
    gates: gatesFor(planLine),
    resume: {
      resumeId: entry.resumeId,
      transcriptFound:
        entry.resumeId !== '' && world.transcriptFound(worktree, entry.resumeId),
    },
    attempts: entry.attempts,
    madeProgress,
    headroom,
  };
};

/**
 * Reads one desk's declaration.
 *
 * A file that is not there reads `absent`, which is the load-bearing case: an
 * agent killed by the `Worker bound` never reaches the write, so absence means
 * incomplete whatever the exit code says.
 *
 * @param worktree - the desk to read.
 * @param world - what to read it through.
 * @returns what the desk declared, or why it could not be read.
 */
export const declarationOf = (worktree: string, world: SupervisorWorld): DeclarationReading =>
  readDeclaration(world.deskFile(worktree, DECLARATION_FILENAME));

/**
 * The gates a tick may honestly run, given what the plan reading could answer.
 *
 * **THE ANNOTATION GATE IS DROPPED WHERE THE PER-LINE PRs CANNOT BE READ, and
 * that is a gap in the plan-store port rather than a choice.**
 * `PlanRecordBranch` carries `deferred`, `deferredReason` and `claimed` and no
 * PR numbers; `plot-plan-meta.sh` emits the PRs a plan annotates as ONE array
 * for the whole plan. So a branch whose line reads `— did the thing → #692`
 * cannot be told from one whose line reads `— did the thing`.
 *
 * Running the gate on that reading would fail EVERY correctly annotated branch
 * and hand its agent a correction telling it to write a number that is already
 * there. Dropping the gate reports one thing less; running it reports one thing
 * wrong, and a supervisor that corrects an agent for work it did is worse than
 * one that does not notice the work.
 *
 * @param planLine - the plan's line for the branch, or null.
 * @returns every gate, or every gate but the annotation one.
 */
export const gatesFor = (planLine: PlanBranchLine | null): readonly Gate[] =>
  planLine === null || planLine.prs.length === 0
    ? ALL_GATES.filter((gate) => gate !== planAnnotatedGate)
    : ALL_GATES;

/**
 * Reads the estate through this machine.
 *
 * @param options - where the repository is, and the ports to ask.
 * @returns the world the tick reads through.
 */
export interface WorldOptions {
  /** The repository root. */
  repoRoot: string;
  /** Whether a pid is alive. */
  isAlive(pid: number): Promise<boolean>;
  /** What the host says about a branch. */
  prMerged(branch: string): Promise<MergeReading>;
  /** The uncommitted paths in a desk. */
  dirtyPaths(worktree: string): Promise<readonly string[]>;
  /** The `PLOT-BLOCKED*` markers in a desk. */
  markers(worktree: string, prefix: string): Promise<readonly string[]>;
  /** The plan line for a branch. */
  planLine(branch: string): Promise<PlanBranchLine | null>;
  /** The workspace's package names. */
  workspacePackages(): Promise<readonly string[]>;
  /** Whether the branch holds commits its last worker made. */
  madeProgress(worktree: string, branch: string): Promise<boolean>;
  /** The machine's spawn cost, in milliseconds; null when unmeasured. */
  spawnCostMs(): Promise<number | null>;
  /** The pid recorded for a desk, or null when none was recorded. */
  recordedPid(worktree: string): number | null;
  /** The home directory transcripts are looked for under. */
  home?: string;
}

/** The prefix a blocked marker's filename carries. */
const BLOCKED_PREFIX = 'PLOT-BLOCKED';

/**
 * Builds the world from a set of port-backed answers.
 *
 * Every member is a thin join of what a port already answers — which is the
 * point: this file adds the per-agent shape and nothing else, so a wrong answer
 * here is a wrong join rather than a second implementation of a reading.
 *
 * @param options - the port-backed answers.
 * @returns the world the tick reads through.
 */
export const worldFrom = (options: WorldOptions): SupervisorWorld => ({
  workerAlive: async (worktree) => {
    const pid = options.recordedPid(worktree);
    // A DESK WITH NO RECORDED PID HAS NO LIVE WORKER, and that is a reading
    // rather than a guess: the wrapper stamps `.plot-worker.pid` the instant it
    // learns its own child, so its absence means nothing was ever started here.
    if (pid === null) return false;
    return options.isAlive(pid);
  },
  merge: (branch) => options.prMerged(branch),
  dirtyPath: async (worktree) => (await options.dirtyPaths(worktree))[0] ?? '',
  blockedMarker: async (worktree) =>
    (await options.markers(worktree, BLOCKED_PREFIX))[0] ?? '',
  changesets: async (worktree) => changesetsIn(worktree),
  workspacePackages: () => options.workspacePackages(),
  planLine: (branch) => options.planLine(branch),
  madeProgress: (worktree, branch) => options.madeProgress(worktree, branch),
  headroom: async () => headroomFor(await options.spawnCostMs()),
  deskFile: (worktree, name) => fileOrNull(join(worktree, name)),
  transcriptFound: (worktree, sessionId) =>
    transcriptFile(transcriptDir(worktree, options.home), sessionId) !== null,
});

/**
 * Reads one file, treating absence as `null` rather than as an empty file.
 *
 * The distinction is the declaration's: `null` is a file that is not there,
 * `''` is a file that exists and holds nothing, and the second is unreadable
 * rather than absent.
 *
 * @param file - the path to read.
 * @returns the file's text, or null when it is not there or cannot be read.
 */
export const fileOrNull = (file: string): string | null => {
  try {
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  } catch {
    return null;
  }
};

/**
 * Reads the changeset files one desk added.
 *
 * Reads the directory rather than asking git what changed: a changeset the
 * agent wrote and did not commit is still a changeset, and the clean-tree gate
 * is what reports the uncommitted half of that.
 *
 * @param worktree - the desk to read.
 * @returns the changeset files, with their text; empty when the desk has none.
 */
export const changesetsIn = async (worktree: string): Promise<readonly ChangesetFile[]> => {
  const dir = join(worktree, '.changeset');
  const { readdir } = await import('node:fs/promises');
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const files: ChangesetFile[] = [];
  for (const name of names) {
    // `_template` and `README.md` are Changesets' own furniture, and `config.json`
    // is its configuration. None is a changeset, and counting one would let a
    // desk that added nothing pass the gate.
    if (!name.endsWith('.md') || name === 'README.md') continue;
    const text = fileOrNull(join(dir, name));
    if (text !== null) files.push({ path: `.changeset/${name}`, text });
  }
  return files;
};
