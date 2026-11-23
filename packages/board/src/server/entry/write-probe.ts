import { writeProbeShell, type ShellContext } from '@plot-pm/domain/adapters';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';
import type { ProbePrompt, WriteProbe } from '@plot-pm/domain/ports/write-probe';
import { answer } from '@plot-pm/fleet/server/entry/prompt';
import { probePromptUnder } from '@plot-pm/fleet/shared/probe-prompt';
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
 * rather than branched on. The probe tests the fallback prompt and, where
 * `PLOT_AGENT` names an agent, the prompt that agent's charter resolves to
 * ({@link promptsToProbe}). An empty or `none` command starts nothing, so it is
 * not probed and exits 0 (`writeProbeNeeded`). Prints nothing on an observed
 * `yes` or an unanswerable probe. Prints the refusal's text on an observed
 * `no`, and the fix on a stale print (`writeProbeOutcome`), each followed by a
 * line naming the probed prompts, prefixed for its one shell caller. Exits 0
 * to proceed, 1 to refuse, 2 for a missing argument.
 */

/**
 * The prompts `--start` probes: the fallback prompt, and the prompt of the
 * charter `agent` names.
 *
 * @param repoRoot - the checkout the prompts resolve under.
 * @param agent - the `PLOT_AGENT` value, or `''`.
 * @param resolvePrompt - the prompt entry's `answer`.
 * @returns the fallback prompt first, then the named agent's prompt or refusal.
 */
export const promptsToProbe = (
  repoRoot: string,
  agent: string,
  resolvePrompt: (root: string, name: string) => string = answer,
): ProbePrompt[] => [
  probePromptUnder(repoRoot, '', resolvePrompt),
  ...(agent === '' ? [] : [probePromptUnder(repoRoot, agent, resolvePrompt)]),
];

/** The probed prompts in one line: each file with its charter, or a refusal. */
const probedLine = (prompts: readonly ProbePrompt[]): string =>
  prompts
    .map((p) => ('refused' in p ? `a refused charter (${p.refused})` : p.charter === null ? p.file : `${p.file} (charter '${p.charter}')`))
    .join(', ');

/**
 * Runs the probe and prints the refusal, if any.
 *
 * @param argv - the arguments after the script name: the configured `Worker command`.
 * @param probe - the probe to run.
 * @param prompts - the prompts to probe, as {@link promptsToProbe} answers.
 * @param write - where a refusal goes; unused when the probe does not refuse.
 * @returns the process exit code.
 */
export const run = async (
  argv: readonly string[],
  probe: WriteProbe,
  prompts: readonly ProbePrompt[],
  write: (s: string) => void = (s) => process.stderr.write(s),
): Promise<number> => {
  const [command] = argv;
  if (command === undefined) {
    process.stderr.write('plot-write-probe: expected the configured Worker command\n');
    return 2;
  }
  if (!writeProbeNeeded(command)) return 0;
  const outcome = writeProbeOutcome(await probe.check(command, prompts));
  if (outcome.message !== undefined) {
    write(`plot-fleetctl: ${outcome.message}\n`);
    write(`plot-fleetctl: probed ${probedLine(prompts)}\n`);
  }
  return outcome.answer === 'refuse' ? 1 : 0;
};

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const context: ShellContext = {
    repoRoot: process.env.PLOT_REPO_ROOT ?? process.cwd(),
    scriptDir: process.env.PLOT_SCRIPTS_DIR ?? path.resolve(here, '..'),
  };
  const prompts = promptsToProbe(context.repoRoot, process.env.PLOT_AGENT ?? '');
  void endEntry(await run(process.argv.slice(2), writeProbeShell(context), prompts));
}
