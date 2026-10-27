import { writeProbeShell, type ShellContext } from '@plot-pm/domain/adapters';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';
import type { WriteProbe } from '@plot-pm/domain/ports/write-probe';
import { writeProbeNeeded, writeProbeOutcome } from '@plot-pm/domain/rules/write-probe';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot-fleetctl.sh` runs before handing a claim over
 * to a worker command.
 *
 * ```
 * node plot-write-probe.mjs 'claude -p'
 * plot-fleetctl: The worker command was refused every write it tried (...)
 * ```
 *
 * The one argument is the configured `Worker command`, named for the report
 * rather than branched on — one prompt file governs every agent that declared
 * no charter, so the probe asks that file regardless of which command string
 * is configured. An empty or `none` command starts nothing, so it is not
 * probed and exits 0 (`writeProbeNeeded`). Prints nothing on an observed `yes`
 * or an unanswerable probe. Prints the refusal's text on an observed `no`, and
 * the fix on a stale print (`writeProbeOutcome`), prefixed for its one shell
 * caller. Exits 0 to proceed, 1 to refuse, 2 for a missing argument.
 */

/**
 * Runs the probe and prints the refusal, if any.
 *
 * @param argv - the arguments after the script name: the configured `Worker command`.
 * @param probe - the probe to run.
 * @param write - where a refusal goes; unused when the probe does not refuse.
 * @returns the process exit code.
 */
export const run = async (
  argv: readonly string[],
  probe: WriteProbe,
  write: (s: string) => void = (s) => process.stderr.write(s),
): Promise<number> => {
  const [command] = argv;
  if (command === undefined) {
    process.stderr.write('plot-write-probe: expected the configured Worker command\n');
    return 2;
  }
  if (!writeProbeNeeded(command)) return 0;
  const outcome = writeProbeOutcome(await probe.check(command));
  if (outcome.message !== undefined) write(`plot-fleetctl: ${outcome.message}\n`);
  return outcome.answer === 'refuse' ? 1 : 0;
};

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const context: ShellContext = {
    repoRoot: process.env.PLOT_REPO_ROOT ?? process.cwd(),
    scriptDir: process.env.PLOT_SCRIPTS_DIR ?? path.resolve(here, '..'),
  };
  void endEntry(await run(process.argv.slice(2), writeProbeShell(context)));
}
