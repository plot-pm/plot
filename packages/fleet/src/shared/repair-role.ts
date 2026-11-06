import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentRun } from '@plot-pm/domain/ports/agent-run';
import type { Refs } from '@plot-pm/domain/ports/refs';
import type { Trees } from '@plot-pm/domain/ports/trees';
import { HARNESS_START_REFUSALS } from '@plot-pm/domain/adapters/harness/limit-lines';
import { failedStart } from '@plot-pm/domain/rules/failed-start';
import { roleCommand, type RoleAgentRef } from '@plot-pm/domain/rules/role-command';
import type { RoleRunReading } from '@plot-pm/domain/rules/repair-start';
import { roleRunAlive } from '@plot-pm/domain/rules/role-run-alive';
import { roleFilesAt } from './role-files.js';

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

/** The recorded run of the role; `endedAt` is its ending record, written when the run ends. */
interface RunRecord {
  branch: string;
  pid: number;
  startedAt: number;
  endedAt?: number;
  /** The CLI's refusal sentence, set with `endedAt` where the run never started an agent. */
  startFailed?: string;
}

/** The directory outside any desk that holds the role's files, its log and its run record. */
const stateDir = (repoRoot: string): string => join(repoRoot, '.plot', 'state', 'main-repair');

const readRun = (repoRoot: string): RunRecord | null => {
  try {
    const parsed = JSON.parse(readFileSync(join(stateDir(repoRoot), 'run.json'), 'utf8')) as Partial<RunRecord>;
    if (typeof parsed.branch !== 'string' || typeof parsed.pid !== 'number' || typeof parsed.startedAt !== 'number') return null;
    const run: RunRecord = { branch: parsed.branch, pid: parsed.pid, startedAt: parsed.startedAt };
    if (typeof parsed.endedAt !== 'number') return run;
    return typeof parsed.startFailed === 'string' ? { ...run, endedAt: parsed.endedAt, startFailed: parsed.startFailed } : { ...run, endedAt: parsed.endedAt };
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
 * The world's role half: the desk check, the role start and the run read.
 *
 * `startRole` fetches the claimed branch, creates the desk on it where none
 * exists, loads the role's files through {@link roleFilesAt} (a fetched default
 * branch's copies) into `.plot/state/main-repair/` (outside the desk), and
 * starts the role through `runnerOf` without awaiting it. `PLOT_ROLE_GATE`
 * names the gate bundle under `scriptsDir`, outside the desk. The run record
 * `.plot/state/main-repair/run.json` names the branch, the pid and the start
 * time; when the run ends, `endedAt` is added to it as the ending record.
 *
 * @param deps - the ports and paths.
 * @returns `hasDesk`, `startRole` and `roleRun` for {@link RepairStartWorld}.
 */
export const repairRoleOf = (deps: RepairRoleDeps) => {
  const dir = stateDir(deps.repoRoot);

  const hasDesk = async (branch: string): Promise<boolean> => {
    const listed = await deps.trees.list();
    return listed.ok && listed.value.some((tree) => tree.branch === branch);
  };

  const roleRun = (branch: string, sinceMs: number): RoleRunReading => {
    const run = readRun(deps.repoRoot);
    if (run === null || run.branch !== branch || run.startedAt < sinceMs) return 'none';
    if (run.endedAt !== undefined) return run.startFailed === undefined ? 'ended' : 'start-failed';
    const alive = roleRunAlive({
      role: 'main-repair',
      pid: String(run.pid),
      check: (pid) => (deps.pidAlive(Number(pid)) ? 'alive' : 'dead'),
    });
    return alive ? 'alive' : 'crashed';
  };

  const startRole = async (branch: string): Promise<'started' | 'failed'> => {
    const desk = deps.deskPath(branch);
    if (!(await hasDesk(branch))) {
      const fetched = await deps.trees.fetch(deps.repoRoot, branch);
      if (!fetched.ok) return 'failed';
      const added = await deps.trees.addBranch(desk, branch, `origin/${branch}`);
      if (!added.ok) return 'failed';
    }
    const files = await roleFilesAt(deps, { role: 'main-repair', outDir: dir, settings: true });
    if (files.read === 'refused') {
      deps.warn(`plot-fleetd: repair-start held — ${files.why}`);
      return 'failed';
    }
    const role: RoleAgentRef = { name: 'main-repair', agentsFile: files.agentsFile, settingsFile: files.settingsFile };
    const command = roleCommand(role, files.maxTurns);
    if (command.read === 'refused') {
      deps.warn(`plot-fleetd: repair-start held — ${command.why}`);
      return 'failed';
    }
    const started = new Promise<boolean>((resolve) => {
      let record: RunRecord | null = null;
      const run = agentRunOf(deps, deps.runnerOf(command.command), role, files.maxTurns, desk, branch, (pid) => {
        record = { branch, pid, startedAt: deps.now() };
        writeRun(deps.repoRoot, record);
        resolve(true);
      });
      void run.then((ran) => {
        if (ran.refusal !== null) deps.warn(`plot-fleetd: the main-repair run for '${branch}' did not start: ${ran.refusal}`);
        else if (!ran.ok) deps.warn(`plot-fleetd: the main-repair run for '${branch}' ended without a result`);
        try {
          if (record !== null) {
            writeRun(deps.repoRoot, { ...record, endedAt: deps.now(), ...(ran.refusal === null ? {} : { startFailed: ran.refusal }) });
          }
        } catch {
          deps.warn(`plot-fleetd: the ending record of the main-repair run for '${branch}' could not be written`);
        }
        resolve(false);
      });
    });
    return (await started) ? 'started' : 'failed';
  };

  return { hasDesk, startRole, roleRun };
};

/**
 * Starts the run. `ok` is true when the agent answered; `refusal` is the CLI's
 * refusal sentence where the run ended `unstarted` with that line as the last
 * of the output it appended, else `null`. `onStarted` fires on the pid.
 */
const agentRunOf = async (
  deps: RepairRoleDeps,
  agentRun: AgentRun,
  role: RoleAgentRef,
  maxTurns: number,
  desk: string,
  branch: string,
  onStarted: (pid: number) => void,
): Promise<{ ok: boolean; refusal: string | null }> => {
  const result = await agentRun.run({
    worktree: desk,
    prompt: `The default branch is red. Repair it from this worktree, on branch ${branch}. Open a fix PR, or do nothing if no safe fix exists.`,
    resumeId: '',
    role: 'main-repair',
    roleAgent: role,
    harness: '',
    model: '',
    effort: '',
    maxTurns,
    maxSpendUsd: 0,
    boundSeconds: deps.boundSeconds,
    contextWindow: 0,
    capabilities: [],
    env: {
      PLOT_ROLE_GATE: join(deps.scriptsDir, 'board', 'plot-gate.mjs'),
    },
    logFile: join(stateDir(deps.repoRoot), 'run.log'),
    onStarted,
  });
  if (!result.ok) return { ok: false, refusal: null };
  const refused = failedStart({ status: null, output: result.value.finalText ?? '' }, HARNESS_START_REFUSALS.claude);
  return { ok: true, refusal: result.value.end.answer === 'unstarted' && refused.failed ? refused.line : null };
};
