// THROUGH THE NARROW PATH, not the package root, for the reason
// `agent-settings.ts` gives: the root import bundles every entity and rule.
import { startCommand } from '@plot-pm/domain/rules/start-command';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Which command starts an agent — the rule `startCommand` reached without
 * HTTP, for `plot-dispatch.sh`'s `start_worker`.
 *
 * ```
 * printf '%s' "$cmd" | plot-start-command.mjs <free|assigned> <loop-name> <loop-command>
 * run	default	PLOT_UNATTENDED=1 '…/plot-worker-loop.sh'   # exit 0
 * run	configured	<the configured command>                  # exit 0
 * declined                                                   # exit 0
 * <why>                                                      # exit 3, two lines:
 * <repair>                                                   #   the defect, the repair
 * # exit 2 — an argument is missing or the agent is neither `free` nor `assigned`
 * ```
 *
 * The configured command arrives on stdin, so no quoting in it reaches an
 * argument list. The loop's basename and the command that runs it arrive as
 * arguments from the shell that owns them, so neither this entry nor the rule
 * names a script. The command is the LAST field, so a tab inside it survives.
 * It reads stdin, spawns nothing and opens nothing, and runs once per agent
 * start.
 */

/** The exit codes the caller reads. */
export const EXIT = {
  /** The answer is `run` or `declined`. */
  ok: 0,
  /** The caller's arguments are incomplete. */
  usage: 2,
  /** The rule refused. */
  refused: 3,
} as const;

/**
 * Answers for the `Worker command` that arrived on stdin.
 *
 * @param stdin - the configured `Worker command`; empty when the key is absent.
 * @param args - `free` or `assigned`, the loop's basename, the command that runs it.
 * @param write - where the answer goes.
 * @returns the process exit code.
 */
export const run = (
  stdin: string,
  args: readonly string[],
  write: (s: string) => void = (s) => process.stdout.write(s),
): number => {
  const [agent = '', name = '', command = ''] = args;
  if ((agent !== 'free' && agent !== 'assigned') || name === '' || command === '') return EXIT.usage;
  const answer = startCommand(stdin, { name, command }, agent);
  switch (answer.start) {
    case 'run':
      write(`run\t${answer.from}\t${answer.command}\n`);
      return EXIT.ok;
    case 'declined':
      write('declined\n');
      return EXIT.ok;
    case 'refused':
      write(`${answer.why}\n${answer.repair}\n`);
      return EXIT.refused;
  }
};

// Only when RUN, never when imported. `pathToFileURL` over the realpath, for
// the reason `agent-settings.ts` records: on macOS `/tmp` is a symlink.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  process.exit(run(Buffer.concat(chunks).toString('utf8'), process.argv.slice(2)));
}
