import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';
import { run as runApprove } from './approve.js';

/**
 * A person's `approve`, with no board and no receipt.
 *
 * ```
 * plot-approve-command.mjs [--dry-run] [--spike] [--who <handle>] [--branch <name>] <slug>
 * ```
 *
 * Refuses `PLOT_UNATTENDED=1` before it reads anything: the board's agent arm
 * and fleetd reach approval through `plot-approve.mjs` under their own
 * receipts, and this name is not gated, so it must not admit an unattended
 * caller. Otherwise runs `plot-approve.mjs`'s `run` in this process with the
 * same arguments, directory and exit code. It writes no action receipt, because
 * no gated tool call follows `run`.
 */

type Printer = (s: string) => void;

/** The seams a test replaces. */
export interface ApproveCommandDeps {
  /** The approval entry; `plot-approve.mjs`'s `run` where absent. */
  run?: typeof runApprove;
  /** The process environment; only `PLOT_UNATTENDED` is read. */
  env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Runs the approve command.
 *
 * @param argv - the arguments `plot-approve.mjs` takes.
 * @param cwd - a directory inside the repository.
 * @param scriptDir - the directory holding `plot-*.sh`.
 * @param deps - test seams.
 * @param write - where step and summary lines go.
 * @param warn - where refusals go.
 * @returns the exit code of `run`, or 1 for an unattended caller.
 */
export const run = async (
  argv: readonly string[],
  cwd: string,
  scriptDir: string,
  deps: ApproveCommandDeps = {},
  write: Printer = (s) => process.stdout.write(s),
  warn: Printer = (s) => process.stderr.write(s),
): Promise<number> => {
  if ((deps.env ?? process.env).PLOT_UNATTENDED === '1') {
    warn(
      "plot-approve-command: refused under PLOT_UNATTENDED=1 — an unattended caller approves through the board's approve button or the fleet, never through this command\n",
    );
    return 1;
  }
  return (deps.run ?? runApprove)(argv, cwd, scriptDir, write, warn);
};

// Only when RUN, never when imported. The build defines PLOT_EMBEDDED so the
// embedded entry's own launch guard stays off.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const scriptDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  void endEntry(await run(process.argv.slice(2), process.cwd(), scriptDir));
}
