import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentRun } from '@plot-pm/domain/ports/agent-run';
import type { Refs } from '@plot-pm/domain/ports/refs';
import type { Trees } from '@plot-pm/domain/ports/trees';
import { roleAgentsJson, roleCommand, type RoleAgentRef } from '@plot-pm/domain/rules/role-command';
import { roleRunAlive } from '@plot-pm/domain/rules/role-run-alive';

/** The role file and its settings, read from the default branch. */
const ROLE_FILE = '.claude/agents/main-repair.md';
const SETTINGS_FILE = '.claude/settings/main-repair.json';

/** The turn limit of the role's session, the `maxTurns` its definition declares. */
export const MAIN_REPAIR_MAX_TURNS = 80;

/** What the starter reads and acts through. */
export interface RepairRoleDeps {
  /** The repository root; the role's files and its run record live under `.plot/state/main-repair/`. */
  repoRoot: string;
  /** Where `board/plot-gate.mjs` is; the gate bundle outside every desk tree. */
  scriptsDir: string;
  trees: Pick<Trees, 'list' | 'fetch' | 'addBranch'>;
  refs: Pick<Refs, 'defaultBranch' | 'showFile'>;
  /** Builds the runner for one shell fragment; the starter does not await its run. */
  runnerOf: (fragment: string) => AgentRun;
  /** The desk path for a branch, from the `Worktree root` key. */
  deskPath: (branch: string) => string;
  /** The `Main repair bound`, in seconds, the run's `boundSeconds`. */
  boundSeconds: number;
  /** Whether a pid answers. */
  pidAlive: (pid: number) => boolean;
  /** Epoch ms. */
  now: () => number;
  /** Receives a line when the run ends. */
  warn: (line: string) => void;
}

/** The recorded run of the role. */
interface RunRecord {
  branch: string;
  pid: number;
  startedAt: number;
}

/** The directory outside any desk that holds the role's files, its log and its run record. */
const stateDir = (repoRoot: string): string => join(repoRoot, '.plot', 'state', 'main-repair');

const readRun = (repoRoot: string): RunRecord | null => {
  try {
    const parsed = JSON.parse(readFileSync(join(stateDir(repoRoot), 'run.json'), 'utf8')) as Partial<RunRecord>;
    return typeof parsed.branch === 'string' && typeof parsed.pid === 'number' && typeof parsed.startedAt === 'number'
      ? { branch: parsed.branch, pid: parsed.pid, startedAt: parsed.startedAt }
      : null;
  } catch {
    return null;
  }
};

const writeRun = (repoRoot: string, run: RunRecord): void => {
  const file = join(stateDir(repoRoot), 'run.json');
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(run));
  renameSync(temp, file);
};

/**
 * The world's role half: the desk check, the role start and the liveness read.
 *
 * `startRole` fetches the claimed branch, creates the desk on it where none
 * exists, writes the role's `--agents` JSON and settings file from the default
 * branch's copies into `.plot/state/main-repair/` (outside the desk), and
 * starts the role through `runnerOf` without awaiting it. `PLOT_ROLE_GATE`
 * names the gate bundle under `scriptsDir`, outside the desk.
 *
 * @param deps - the ports and paths.
 * @returns `hasDesk`, `startRole` and `roleAlive` for {@link RepairStartWorld}.
 */
export const repairRoleOf = (deps: RepairRoleDeps) => {
  const dir = stateDir(deps.repoRoot);

  const hasDesk = async (branch: string): Promise<boolean> => {
    const listed = await deps.trees.list();
    return listed.ok && listed.value.some((tree) => tree.branch === branch);
  };

  const roleAlive = (branch: string): boolean => {
    const run = readRun(deps.repoRoot);
    if (run === null || run.branch !== branch) return false;
    return roleRunAlive({
      role: 'main-repair',
      pid: String(run.pid),
      check: (pid) => (deps.pidAlive(Number(pid)) ? 'alive' : 'dead'),
    });
  };

  /** Writes the role's two files from the default branch; null names why it could not. */
  const writeRoleFiles = async (): Promise<RoleAgentRef | string> => {
    const base = await deps.refs.defaultBranch();
    if (!base.ok) return 'the default branch could not be read';
    const definition = await deps.refs.showFile(`origin/${base.value}`, ROLE_FILE);
    const settings = await deps.refs.showFile(`origin/${base.value}`, SETTINGS_FILE);
    if (!definition.ok || !settings.ok) return `${ROLE_FILE} or ${SETTINGS_FILE} is not on origin/${base.value}`;
    const json = roleAgentsJson('main-repair', definition.value);
    if (json.read === 'refused') return json.why;
    mkdirSync(dir, { recursive: true });
    const agentsFile = join(dir, 'agents.json');
    const settingsFile = join(dir, 'settings.json');
    writeFileSync(agentsFile, json.json);
    writeFileSync(settingsFile, settings.value);
    return { name: 'main-repair', agentsFile, settingsFile };
  };

  const startRole = async (branch: string): Promise<'started' | 'failed'> => {
    const desk = deps.deskPath(branch);
    if (!(await hasDesk(branch))) {
      const fetched = await deps.trees.fetch(deps.repoRoot, branch);
      if (!fetched.ok) return 'failed';
      const added = await deps.trees.addBranch(desk, branch, `origin/${branch}`);
      if (!added.ok) return 'failed';
    }
    const role = await writeRoleFiles();
    if (typeof role === 'string') {
      deps.warn(`plot-fleetd: repair-start held — ${role}`);
      return 'failed';
    }
    const command = roleCommand(role, MAIN_REPAIR_MAX_TURNS);
    if (command.read === 'refused') {
      deps.warn(`plot-fleetd: repair-start held — ${command.why}`);
      return 'failed';
    }
    const started = new Promise<boolean>((resolve) => {
      const run = agentRunOf(deps, deps.runnerOf(command.command), role, desk, branch, (pid) => {
        writeRun(deps.repoRoot, { branch, pid, startedAt: deps.now() });
        resolve(true);
      });
      void run.then((ok) => {
        if (!ok) deps.warn(`plot-fleetd: the main-repair run for '${branch}' ended without a result`);
        resolve(false);
      });
    });
    return (await started) ? 'started' : 'failed';
  };

  return { hasDesk, startRole, roleAlive };
};

/** Starts the run; resolves `true` when the agent answered. `onStarted` fires on the pid. */
const agentRunOf = async (
  deps: RepairRoleDeps,
  agentRun: AgentRun,
  role: RoleAgentRef,
  desk: string,
  branch: string,
  onStarted: (pid: number) => void,
): Promise<boolean> => {
  const result = await agentRun.run({
    worktree: desk,
    prompt: `The default branch is red. Repair it from this worktree, on branch ${branch}. Open a fix PR, or do nothing if no safe fix exists.`,
    resumeId: '',
    role: 'main-repair',
    roleAgent: role,
    harness: '',
    model: '',
    effort: '',
    maxTurns: MAIN_REPAIR_MAX_TURNS,
    maxSpendUsd: 0,
    boundSeconds: deps.boundSeconds,
    contextWindow: 0,
    capabilities: [],
    env: {
      PLOT_UNATTENDED: '1',
      PLOT_ROLE_GATE: join(deps.scriptsDir, 'board', 'plot-gate.mjs'),
    },
    logFile: join(stateDir(deps.repoRoot), 'run.log'),
    onStarted,
  });
  return result.ok;
};
