import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';
import { run as runDeliver } from './deliver.js';

/**
 * A person's `deliver`, with no board and no receipt.
 *
 * ```
 * plot-deliver-command.mjs [--dry-run] [--branch <name>] [--who <name>] <slug>
 * ```
 *
 * Refuses `PLOT_UNATTENDED=1` before it reads anything, and refuses
 * `--release` by name: a release needs a passkey proof on the board's release
 * button. Otherwise runs `plot-deliver.mjs`'s `run` in this process with the
 * same arguments, directory and exit code. It writes no action receipt,
 * because no gated tool call follows `run`.
 */

type Printer = (s: string) => void;

/** The seams a test replaces. */
export interface DeliverCommandDeps {
  /** The delivery entry; `plot-deliver.mjs`'s `run` where absent. */
  run?: typeof runDeliver;
  /** The process environment; only `PLOT_UNATTENDED` is read. */
  env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Runs the deliver command.
 *
 * @param argv - the arguments `plot-deliver.mjs` takes, except `--release`.
 * @param cwd - a directory inside the repository.
 * @param scriptDir - the directory holding `plot-*.sh`.
 * @param deps - test seams.
 * @param write - where step and summary lines go.
 * @param warn - where refusals go.
 * @returns the exit code of `run`, or 1 for an unattended caller or `--release`.
 */
export const run = async (
  argv: readonly string[],
  cwd: string,
  scriptDir: string,
  deps: DeliverCommandDeps = {},
  write: Printer = (s) => process.stdout.write(s),
  warn: Printer = (s) => process.stderr.write(s),
): Promise<number> => {
  if ((deps.env ?? process.env).PLOT_UNATTENDED === '1') {
    warn(
      "plot-deliver-command: refused under PLOT_UNATTENDED=1 — an unattended caller delivers through the board's deliver button or the fleet, never through this command\n",
    );
    return 1;
  }
  if (argv.some((arg) => arg === '--release' || arg.startsWith('--release='))) {
    warn("plot-deliver-command: --release is not available here — a release needs the passkey proof on the board's release button\n");
    return 1;
  }
  return (deps.run ?? runDeliver)(argv, cwd, scriptDir, write, warn);
};

// Only when RUN, never when imported. The build defines PLOT_EMBEDDED so the
// embedded entry's own launch guard stays off.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const scriptDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  void endEntry(await run(process.argv.slice(2), process.cwd(), scriptDir));
}
