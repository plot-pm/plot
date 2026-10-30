import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fleetStateFile, fleetStoppedFile } from '@plot-pm/domain/adapters';
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import type { Caller, FleetReading } from '@plot-pm/domain';
import { FLEET_STOPPED_VERSION } from '@plot-pm/domain';
import { restartBranch as realRestartBranch, type RestartBranchInput } from '../../shared/restart-command.js';
import type { DeskContinuation } from '../../shared/continuation.js';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';

/**
 * Records, and later restarts, exactly the branches one fleet-level `--stop`
 * stopped — with no HTTP.
 *
 * ```
 * printf '%s\n' "$br" | node plot-restart-stopped-command.mjs --record
 * node plot-restart-stopped-command.mjs
 * ```
 *
 * `--record` reads one branch per line on stdin, optionally followed by a tab
 * and the branch's desk path, and replaces `.plot/state/fleet-stopped.json`
 * with exactly that list — the branches `plot-fleetctl.sh --stop` itself
 * stopped this run, never a branch stopped by any other means.
 *
 * With no arguments, restarts every branch that file lists, each through the
 * restart controller {@link restartBranch} wraps, reports each branch's
 * outcome by name, and clears the file once the pass is done. A recorded desk
 * path reaches the controller as `worktree`, so a branch restarts without a
 * fresh pulse. A branch's refusal is reported and does not stop the rest of
 * the list. An absent or unparseable file restarts nothing and exits 0 —
 * there is nothing to restart.
 */

type Printer = (s: string) => void;

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
 * Records the branches named on stdin as this run's stopped list.
 *
 * @param repoRoot - the repository root.
 * @param stdin - one `branch` or `branch<TAB>desk path` per line; blank lines are skipped.
 * @returns the process exit code — 0 once written, 1 on a write failure.
 */
const record = async (repoRoot: string, stdin: string, warn: Printer): Promise<number> => {
  const rows = stdin.split('\n').filter((line) => line !== '').map((line) => line.split('\t'));
  const branches = rows.map(([branch]) => branch ?? '');
  const worktrees = Object.fromEntries(rows.filter(([, wt]) => wt).map(([branch, wt]) => [branch, wt]));
  const written = await fleetStoppedFile(repoRoot).write({
    v: FLEET_STOPPED_VERSION,
    branches,
    worktrees,
    at: new Date().toISOString(),
  });
  if (!written.ok) {
    warn('plot-restart-stopped-command: could not write the stopped-branches record\n');
    return 1;
  }
  return 0;
};

/** What a restart pass reads instead of the real world; a test replaces each. */
export interface RestartRecordedDeps {
  pulse: FleetReading | null;
  caller: Caller;
  restartBranch: (input: RestartBranchInput) => Promise<DeskContinuation>;
}

/**
 * Restarts every branch the stopped-branches record lists, then clears it.
 *
 * @param repoRoot - the repository root.
 * @param scriptDir - where the helper scripts are.
 * @param deps - the restart controller and the readings it needs; the real
 *   bridged pulse, `PLOT_UNATTENDED` and {@link realRestartBranch} where absent.
 * @returns the process exit code — 0 whether or not any branch was listed.
 */
const restartRecorded = async (
  repoRoot: string,
  scriptDir: string,
  write: Printer,
  warn: Printer,
  deps?: RestartRecordedDeps,
): Promise<number> => {
  const store = fleetStoppedFile(repoRoot);
  const read = await store.read();
  const found = read.ok ? read.value : null;
  if (found === null || found.branches.length === 0) {
    write('no stopped branches recorded\n');
    return 0;
  }
  const pulse = deps ? deps.pulse : bridgedPulse(repoRoot);
  // No in-process fleetd caller reaches this entrance yet — `PLOT_UNATTENDED`
  // maps to 'unattended', never to 'fleetd'.
  const caller = deps ? deps.caller : (process.env.PLOT_UNATTENDED === '1' ? 'unattended' : 'person');
  const restart = deps ? deps.restartBranch : realRestartBranch;
  for (const branch of found.branches) {
    const worktree = found.worktrees?.[branch];
    const started = await restart({
      opts: { repoRoot, scriptsDir: scriptDir },
      pulse,
      branch,
      ...(worktree ? { worktree } : {}),
      caller,
    });
    if (started.kind === 'refused') {
      warn(`${branch}: refused ${started.reason}: ${started.detail}\n`);
    } else if (started.kind === 'failed') {
      warn(`${branch}: ${started.error}\n`);
    } else {
      write(`${branch}: restarted pid ${started.pid} (replaces ${started.previousPid || 'none'})\n`);
    }
  }
  await store.clear();
  return 0;
};

/**
 * Runs the restart-stopped command.
 *
 * @param argv - `['--record']` to replace the list from stdin; `[]` to restart it.
 * @param cwd - where the command runs; the repository is found from it.
 * @param scriptDir - where the helper scripts are.
 * @param stdin - branch names for `--record`; ignored otherwise.
 * @param write - where the report goes.
 * @param warn - where refusals and failures go.
 * @param deps - test seam for the restart pass; absent in real use.
 * @returns the process exit code — 2 on an unknown argument, otherwise as each mode documents above.
 */
export const run = async (
  argv: readonly string[],
  cwd: string,
  scriptDir: string,
  stdin: string,
  write: Printer = (s) => process.stdout.write(s),
  warn: Printer = (s) => process.stderr.write(s),
  deps?: RestartRecordedDeps,
): Promise<number> => {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== '--record')) {
    warn('plot-restart-stopped-command: usage: plot-restart-stopped-command.mjs [--record]\n');
    return 2;
  }
  const probe = await refsGit({ repoRoot: cwd, scriptDir }).repoRoot();
  if (!probe.ok) {
    warn('plot-restart-stopped-command: not a git repository — run this from inside the checkout\n');
    return 1;
  }
  const repoRoot = probe.value;
  return argv[0] === '--record'
    ? record(repoRoot, stdin, warn)
    : restartRecorded(repoRoot, scriptDir, write, warn, deps);
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
  const argv = process.argv.slice(2);
  const stdin = argv[0] === '--record' ? readFileSync(0, 'utf8') : '';
  void endEntry(await run(argv, process.cwd(), scriptDir, stdin));
}
