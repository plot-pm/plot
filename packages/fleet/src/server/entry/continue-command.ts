import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fleetStateFile } from '@plot-pm/domain/adapters/fleet-state/fleet-state-file';
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import type { DeskMonitors, FleetReading } from '@plot-pm/domain';
import { continueBranch } from '../../shared/continue-command.js';
import { ANSWER_MAX } from '../../shared/continuation.js';

/**
 * The master agent's `continue` controller, with no board and no HTTP.
 *
 * ```
 * node plot-continue-command.mjs <branch> <answer>
 * node plot-continue-command.mjs <branch> -        # the answer on stdin
 * ```
 *
 * Looks the branch up in the pulse the fleet bridged to disk, refuses
 * `unknown-branch` and `no-worktree`, and otherwise starts a NEW agent on the
 * desk. The new agent has a new pid.
 */

/** The usage line. */
const USAGE = 'usage: plot-continue-command.mjs <branch> <answer | ->';

type Printer = (s: string) => void;

/** The seams a test replaces. */
export interface ContinueCommandDeps {
  /** The fleet reading the branch is looked up in; the bridge file where absent. */
  pulse?: (repoRoot: string) => FleetReading | null;
  /** Starts the desk's monitor; the shell script where absent. */
  monitors?: DeskMonitors;
  /** Reads the answer from stdin; the process's stdin where absent. */
  stdin?: () => string;
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
 * Runs the continue command.
 *
 * @param argv - the branch, then the answer or `-`.
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
  deps: ContinueCommandDeps = {},
  write: Printer = (s) => process.stdout.write(s),
  warn: Printer = (s) => process.stderr.write(s),
): Promise<number> => {
  const [branch, given, ...extra] = argv;
  if (branch === undefined || branch === '' || given === undefined || extra.length > 0) {
    warn(`plot-continue-command: ${USAGE}\n`);
    return 2;
  }
  const answer = given === '-' ? (deps.stdin ?? (() => readFileSync(0, 'utf8')))() : given;
  if (answer.trim() === '') {
    warn('plot-continue-command: answer is required\n');
    return 2;
  }
  if (answer.length > ANSWER_MAX) {
    warn(`plot-continue-command: answer is longer than ${ANSWER_MAX} characters\n`);
    return 2;
  }
  const probe = await refsGit({ repoRoot: cwd, scriptDir }).repoRoot();
  if (!probe.ok) {
    warn('plot-continue-command: not a git repository — run this from inside the checkout\n');
    return 1;
  }
  const repoRoot = probe.value;
  const started = await continueBranch({
    opts: { repoRoot, scriptsDir: scriptDir },
    pulse: (deps.pulse ?? bridgedPulse)(repoRoot),
    branch,
    answer,
    monitors: deps.monitors,
  });
  if (started.kind === 'refused') {
    warn(`plot-continue-command: ${started.reason}: ${started.detail}\n`);
    return 1;
  }
  if (started.kind === 'failed') {
    warn(`plot-continue-command: ${started.error}\n`);
    return 1;
  }
  write(`continued ${branch}: pid ${started.pid} (replaces ${started.previousPid || 'none'})\nlog ${started.log}\n`);
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
  process.exit(await run(process.argv.slice(2), process.cwd(), scriptDir));
}
