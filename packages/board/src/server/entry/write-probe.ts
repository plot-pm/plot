import { writeProbeShell, type ShellContext } from '@plot-pm/domain/adapters';
import type { WriteProbe } from '@plot-pm/domain/ports/write-probe';
import { writeProbeAnswer, writeProbeRefusal } from '@plot-pm/domain/rules/write-probe';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot-fleetctl.sh` and `registryd-main.ts` run before
 * handing a claim over to a worker command.
 *
 * ```
 * node plot-write-probe.mjs 'claude -p'
 * proceed
 * ```
 *
 * The one argument is the configured `Worker command`, named for the report
 * rather than branched on — one prompt file governs every agent that declared
 * no charter, so the probe asks that file regardless of which command string
 * is configured. Prints `proceed` or `refuse` on its own line, followed by the
 * refusal's text where it refused. Exits 0 for `proceed` (an observed `yes` or
 * an unanswerable probe — absent is not false), 1 for `refuse` (an observed
 * `no`), and 2 for a missing argument.
 */

/**
 * Runs the probe and prints whether a claim may proceed.
 *
 * @param argv - the arguments after the script name: the configured `Worker command`.
 * @param probe - the probe to run.
 * @param write - where the answer goes.
 * @returns the process exit code.
 */
export const run = async (
  argv: readonly string[],
  probe: WriteProbe,
  write: (s: string) => void = (s) => process.stdout.write(s),
): Promise<number> => {
  const [command] = argv;
  if (command === undefined || command === '') {
    process.stderr.write('plot-write-probe: expected the configured Worker command\n');
    return 2;
  }
  const result = await probe.check(command);
  const reading = result.ok ? result.value : 'unanswerable';
  const decision = writeProbeAnswer(reading);
  if (decision === 'refuse') {
    write('refuse\n');
    write(`${writeProbeRefusal('no marker file appeared after the probe run')}\n`);
    return 1;
  }
  write('proceed\n');
  return 0;
};

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const context: ShellContext = {
    repoRoot: process.cwd(),
    scriptDir: process.env.PLOT_SCRIPTS_DIR ?? path.resolve(here, '..'),
  };
  process.exit(await run(process.argv.slice(2), writeProbeShell(context)));
}
