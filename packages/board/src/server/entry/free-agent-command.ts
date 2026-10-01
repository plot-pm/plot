// THROUGH THE NARROW PATH, not the package root, for the reason
// `agent-settings.ts` gives: the root import bundles every entity and rule.
import { freeAgentCommandRefusal } from '@plot-pm/domain/rules/free-agent-command';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Whether a repository's `Worker command` can run a free agent — the rule
 * `freeAgentCommandRefusal` reached without HTTP, for `plot-dispatch.sh --start`.
 *
 * ```
 * printf '%s' "$cmd" | plot-free-agent-command.mjs <loop-name> <loop-command>
 * # exit 0, nothing printed  — the command runs the loop, or is unset or `none`
 * # exit 3, two lines        — the defect, then the repair
 * # exit 2                   — the loop's name or command is missing
 * ```
 *
 * The command arrives on stdin, so no quoting in it reaches an argument list.
 * The loop's basename and the command that runs it arrive as arguments from the
 * shell that owns them, so neither this entry nor the rule names a script.
 * The refusal is two lines on stdout: the defect, then the repair. It reads
 * stdin, spawns nothing and opens nothing, and runs once per `--start`.
 */

/** The exit codes the caller reads. */
export const EXIT = {
  /** The command can run a free agent, or is not configured. */
  ok: 0,
  /** The caller did not name the loop. */
  usage: 2,
  /** The rule refused. */
  refused: 3,
} as const;

/**
 * Judges the `Worker command` that arrived on stdin.
 *
 * @param stdin - the configured `Worker command`.
 * @param args - the loop's basename, then the command that runs it.
 * @param write - where the refusal's two lines go.
 * @returns the process exit code.
 */
export const run = (
  stdin: string,
  args: readonly string[],
  write: (s: string) => void = (s) => process.stdout.write(s),
): number => {
  const [name = '', command = ''] = args;
  if (name === '' || command === '') return EXIT.usage;
  const refusal = freeAgentCommandRefusal(stdin, { name, command });
  if (refusal === undefined) return EXIT.ok;
  write(`${refusal.why}\n${refusal.repair}\n`);
  return EXIT.refused;
};

// Only when RUN, never when imported. `pathToFileURL` over the realpath, for
// the reason `agent-settings.ts` records: on macOS `/tmp` is a symlink.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  process.exit(run(Buffer.concat(chunks).toString('utf8'), process.argv.slice(2)));
}
