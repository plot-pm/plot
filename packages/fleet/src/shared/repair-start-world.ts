import { isAbsolute, join, resolve } from 'node:path';

import { boundedRunProcess, hostShell, processesShell, refsGit, refsRemoteGit, repairRecordFile, defaultBranchFile, treesGit } from '@plot-pm/domain/adapters';
import { agentRunCommand } from '@plot-pm/domain/adapters/agent-run/agent-run-command';
import { HARNESS_LIMIT_LINES } from '@plot-pm/domain/adapters/harness/limit-lines';
import type { BuildPort } from '@plot-pm/domain/ports/build';

import { pidAlive } from './fleet-run.js';
import { repairRoleOf } from './repair-role.js';
import type { RepairStartWorld } from './repair-start.js';

/** What the production world needs beyond the repository's own adapters. */
export interface RepairStartWorldOptions {
  repoRoot: string;
  scriptsDir: string;
  /** The CI connector fleetd already built. */
  build: BuildPort;
  /** Runs one host call inside a host slot where the CI system is GitHub Actions. */
  slot: RepairStartWorld['slot'];
  /** The configured `Worktree root`, `''` for the default. */
  worktreeRoot: string;
  checksWaitMs: number;
  mainRepairBoundMs: number;
  checks: readonly string[];
  warn: (line: string) => void;
}

/**
 * Builds the world {@link repairStartTick} acts through, from the repository's
 * own adapters.
 *
 * The claim is `refsRemoteGit(...).claimBranch` against the default branch's
 * remote tip; the desk is `<Worktree root>/desk-<branch with / as ->`.
 *
 * @param options - the paths, the connector and the bounds.
 * @returns the world.
 */
export const repairStartWorldOf = (options: RepairStartWorldOptions): RepairStartWorld => {
  const context = { repoRoot: options.repoRoot, scriptDir: options.scriptsDir };
  const refs = refsGit(context);
  const remote = refsRemoteGit(context);
  const trees = treesGit(context);
  const host = hostShell(context);
  const root = options.worktreeRoot === '' ? '.worktrees' : options.worktreeRoot;
  const deskPath = (branch: string): string =>
    join(isAbsolute(root) ? root : resolve(options.repoRoot, root), `desk-${branch.replace(/\//g, '-')}`);
  const boundedRun = boundedRunProcess(processesShell(context));
  const role = repairRoleOf({
    repoRoot: options.repoRoot,
    scriptsDir: options.scriptsDir,
    trees,
    refs,
    runnerOf: (fragment) =>
      agentRunCommand({ boundedRun, fragment, limitPatterns: HARNESS_LIMIT_LINES.claude, now: Date.now }),
    deskPath,
    boundSeconds: Math.round(options.mainRepairBoundMs / 1000),
    pidAlive,
    now: Date.now,
    warn: options.warn,
  });

  return {
    reading: async () => {
      const read = await defaultBranchFile(options.repoRoot).read();
      return read.ok ? read.value : null;
    },
    repair: repairRecordFile(options.repoRoot),
    refs,
    build: options.build,
    host,
    baseSha: async () => {
      const base = await refs.defaultBranch();
      if (!base.ok) return null;
      const tip = await remote.remoteSha(base.value);
      return tip.ok && tip.value !== 'unknown' ? tip.value.sha : null;
    },
    claim: async (branch, baseSha) => {
      const claimed = await remote.claimBranch(branch, baseSha);
      return claimed.ok ? claimed.value : 'failed';
    },
    hasDesk: role.hasDesk,
    startRole: role.startRole,
    roleRun: role.roleRun,
    slot: options.slot,
    now: Date.now,
    checksWaitMs: options.checksWaitMs,
    mainRepairBoundMs: options.mainRepairBoundMs,
    checks: options.checks,
  };
};
