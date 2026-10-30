import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fleetStateFile } from '@plot-pm/domain/adapters/fleet-state/fleet-state-file';
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import type { Caller, DeskMonitors, FleetReading } from '@plot-pm/domain';
import { restartBranch, type RestartReaders } from '../../shared/restart-command.js';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';

/**
 * The master agent's `restart` controller, with no board and no HTTP.
 *
 * ```
 * node plot-restart-command.mjs <branch>
 * ```
 *
 * Looks the branch up in the pulse the fleet bridged to disk, refuses
 * `unknown-branch` and `no-worktree`, asks the domain's `restartWorker`, and
 * on its decision starts a NEW agent on the desk. The new agent has a new pid.
 */

/** The usage line. */
const USAGE = 'usage: plot-restart-command.mjs <branch>';

type Printer = (s: string) => void;

/** The seams a test replaces. */
export interface RestartCommandDeps {
  /** The fleet reading the branch is looked up in; the bridge file where absent. */
  pulse?: (repoRoot: string) => FleetReading | null;
  /** Starts the desk's monitor; the shell script where absent. */
  monitors?: DeskMonitors;
  /** The pull-request and process readings; the adapters where absent. */
  readers?: RestartReaders;
  /** The worktree git reports for the branch; `PLOT_RESTART_WORKTREE` where absent. */
  worktree?: string;
  /** Who is asking for the restart; `PLOT_UNATTENDED=1` maps to `'unattended'` where absent. */
  caller?: Caller;
  /** Whether the caller promised no network; `PLOT_RESTART_OFFLINE=1` where absent. */
  offline?: boolean;
}

/**
 * Reads the pulse the fleet bridged to disk.
 *
 * @param repoRoot - the repository root.
 * @returns the bridged reading, or `null` where there is no trustworthy one.
 */
const bridgedPulse = (repoRoot: string): FleetReading | null => {
  const read = fleetStateFile({ repoRoot }).readSync();
  return read.ok && read.value !== null ? read.value.pulse : null;
};

/**
 * Runs the restart command.
 *
 * @param argv - the branch.
 * @param cwd - where the command runs; the repository is found from it.
 * @param scriptDir - where the helper scripts are.
 * @param deps - test seams.
 * @param write - where the report goes.
 * @param warn - where refusals go.
 * @returns the process exit code — 0 an agent started, 1 refused or failed, 2 bad arguments.
 */
export const run = async (
  argv: readonly string[],
  cwd: string,
  scriptDir: string,
  deps: RestartCommandDeps = {},
  write: Printer = (s) => process.stdout.write(s),
  warn: Printer = (s) => process.stderr.write(s),
): Promise<number> => {
  const [branch, ...extra] = argv;
  if (branch === undefined || branch === '' || extra.length > 0) {
    warn(`plot-restart-command: ${USAGE}\n`);
    return 2;
  }
  const probe = await refsGit({ repoRoot: cwd, scriptDir }).repoRoot();
  if (!probe.ok) {
    warn('plot-restart-command: not a git repository — run this from inside the checkout\n');
    return 1;
  }
  const repoRoot = probe.value;
  const started = await restartBranch({
    opts: { repoRoot, scriptsDir: scriptDir },
    pulse: (deps.pulse ?? bridgedPulse)(repoRoot),
    branch,
    worktree: deps.worktree ?? process.env.PLOT_RESTART_WORKTREE,
    // No in-process fleetd caller reaches this entrance yet — `PLOT_UNATTENDED`
    // maps to 'unattended', never to 'fleetd'.
    caller: deps.caller ?? (process.env.PLOT_UNATTENDED === '1' ? 'unattended' : 'person'),
    offline: deps.offline ?? process.env.PLOT_RESTART_OFFLINE === '1',
    monitors: deps.monitors,
    readers: deps.readers,
  });
  if (started.kind === 'refused') {
    warn(`plot-restart-command: ${started.reason}: ${started.detail}\n`);
    return 1;
  }
  if (started.kind === 'failed') {
    warn(`plot-restart-command: ${started.error}\n`);
    return 1;
  }
  write(`restarted ${branch}: pid ${started.pid} (replaces ${started.previousPid || 'none'})\nlog ${started.log}\n`);
  return 0;
};

// Only when RUN, never when imported; see `dispatch-command.ts` for why.
declare const PLOT_EMBEDDED: boolean | undefined;
if (
  typeof PLOT_EMBEDDED === 'undefined' &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  const scriptDir =
    process.env.PLOT_SCRIPTS_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  void endEntry(await run(process.argv.slice(2), process.cwd(), scriptDir));
}
