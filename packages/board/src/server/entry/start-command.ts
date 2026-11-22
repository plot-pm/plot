// THROUGH THE NARROW PATH, not the package root, for the reason
// `agent-settings.ts` gives: the root import bundles every entity and rule.
import { startCommand, type PromptReading } from '@plot-pm/domain/rules/start-command';
import { resolvePrompt } from '@plot-pm/domain/rules/prompt';
import { runnerChoice } from '@plot-pm/domain/rules/runner-choice';
import { read } from '@plot-pm/fleet/server/entry/prompt';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';

/**
 * Which command starts an agent — the rule `startCommand` reached without
 * HTTP, for `plot-dispatch.sh`'s `start_worker`.
 *
 * ```
 * printf '%s' "$cmd" | plot-start-command.mjs <free|assigned> <loop-name> <loop-command> <repo-root> <agent-runner>
 * run	<the configured command>       # exit 0
 * unconfigured	<repair>               # exit 0 — the key is absent or empty
 * declined                            # exit 0 — the key is `none`
 * <defect>	<why>                      # exit 3, two lines: the defect word
 * <repair>                            #   (`no-loop`, `charter-refused` or
 *                                     #   `prompt-absent`) and why, the repair
 * # exit 2 — an argument is missing or the agent is neither `free` nor `assigned`
 * ```
 *
 * The configured command arrives on stdin, so no quoting in it reaches an
 * argument list. The loop's basename and the command that runs it arrive as
 * arguments from the shell that owns them, so neither this entry nor the rule
 * names a script. The repo root and the `Agent runner` value (`''` when unset)
 * arrive as arguments too, and `PLOT_AGENT` comes from the environment; the
 * entry reads the charter and the prompt file's existence from them, because the
 * domain reads no file. A command that runs the loop on the `command` runner
 * with no prompt file refuses. The command is a stdin field, so a tab inside it survives.
 * It reads stdin, the charter `PLOT_AGENT` names through the fleet's shared
 * reader `read`, and whether the resolved prompt file exists; it spawns nothing
 * and writes nothing, and runs once per agent start.
 */

/** The exit codes the caller reads. */
export const EXIT = {
  /** The answer is `run`, `unconfigured` or `declined`. */
  ok: 0,
  /** The caller's arguments are incomplete. */
  usage: 2,
  /** The rule refused. */
  refused: 3,
} as const;

/**
 * Reads what the loop will source: the runner it will use, the prompt file the
 * charter resolves to, and whether that file exists under `root`.
 *
 * @param root - the repo root, the main checkout.
 * @param agent - the `PLOT_AGENT` name, or `''`.
 * @param agentRunner - the `Agent runner` value, or `''`.
 * @param command - the configured `Worker command`.
 * @returns the reading `startCommand` takes.
 */
export const readPrompt = (root: string, agent: string, agentRunner: string, command: string): PromptReading => {
  const reading = read(root, agent);
  const choice = runnerChoice({
    agentRunner: agentRunner === 'sdk' || agentRunner === 'command' ? agentRunner : '',
    isWorker: true,
    fragment: command,
    charterHarness: reading.read === 'declared' ? reading.charter.harness : '',
    defaultsToSdkWhenNamed: false,
  });
  const resolution = resolvePrompt(reading);
  return {
    runner: choice.runner === 'sdk' ? 'sdk' : 'command',
    resolution,
    present: resolution.resolve !== 'refused' && existsSync(join(root, resolution.prompt)),
  };
};

/**
 * Answers for the `Worker command` that arrived on stdin.
 *
 * @param stdin - the configured `Worker command`; empty when the key is absent.
 * @param args - `free` or `assigned`, the loop's basename, the command that runs
 *   it, the repo root, the `Agent runner` value.
 * @param write - where the answer goes.
 * @param env - the environment `PLOT_AGENT` is read from.
 * @returns the process exit code.
 */
export const run = (
  stdin: string,
  args: readonly string[],
  write: (s: string) => void = (s) => process.stdout.write(s),
  env: NodeJS.ProcessEnv = process.env,
): number => {
  const [agent = '', name = '', command = '', root = '', agentRunner = ''] = args;
  if ((agent !== 'free' && agent !== 'assigned') || name === '' || command === '' || root === '') return EXIT.usage;
  const prompt = readPrompt(root, env.PLOT_AGENT ?? '', agentRunner, stdin.trim());
  const answer = startCommand(stdin, { name, command }, agent, prompt);
  switch (answer.start) {
    case 'run':
      write(`run\t${answer.command}\n`);
      return EXIT.ok;
    case 'unconfigured':
      write(`unconfigured\t${answer.repair}\n`);
      return EXIT.ok;
    case 'declined':
      write('declined\n');
      return EXIT.ok;
    case 'refused':
      write(`${answer.defect}\t${answer.why}\n${answer.repair}\n`);
      return EXIT.refused;
  }
};

// Only when RUN, never when imported. `pathToFileURL` over the realpath, for
// the reason `agent-settings.ts` records: on macOS `/tmp` is a symlink.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  void endEntry(run(Buffer.concat(chunks).toString('utf8'), process.argv.slice(2)));
}
