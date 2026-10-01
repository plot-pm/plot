// THROUGH THE NARROW PATH, not the package root, for the reason
// `agent-settings.ts` gives: the root import bundles every entity and rule.
import { deskRoot, deskRootPlacement } from '@plot-pm/domain/rules/desk-root';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Where Plot creates dispatch worktrees and writes its action records — the
 * rule `deskRoot` reached without HTTP, for every shell site that resolved it
 * privately.
 *
 * ```
 * plot-desk-root.mjs <repo-root> [configured]
 * # exit 0  — the absolute desk root on stdout, one line, no trailing slash
 * plot-desk-root.mjs --exclude-line <repo-root> [configured]
 * # exit 0  — the repo-relative exclude line, or nothing when outside the repo
 * # exit 2  — the repository root is missing
 * ```
 *
 * Both readings arrive as arguments from the shell that took them, so this
 * entry reaches no filesystem and runs no git. The repository root is the MAIN
 * checkout: inside a desk, `--show-toplevel` answers that desk, and a default
 * of `.worktrees` would then resolve beneath it.
 *
 * READ THE EXIT CODE, NOT STDOUT'S EMPTINESS. `--exclude-line` prints nothing
 * for a desk root outside the repository, which is a complete answer and not a
 * failure; only a non-zero exit says the question could not be asked. No
 * caller keeps a fallback default, because a second default is the defect this
 * rule removes.
 *
 * It runs once per operator command, which the cost rule permits
 * (`docs/shell-and-domain.md`).
 */

/** The exit codes the caller reads. */
export const EXIT = {
  /** The rule answered. */
  ok: 0,
  /** The caller named no repository root. */
  usage: 2,
} as const;

/**
 * Answers the desk root, or its exclude line, for the readings given.
 *
 * @param args - `--exclude-line` optionally, then the repository root and the
 *   configured `Worktree root`.
 * @param write - where the answer goes.
 * @returns the process exit code.
 */
export const run = (
  args: readonly string[],
  write: (s: string) => void = (s) => process.stdout.write(s),
): number => {
  const wantsExclude = args[0] === '--exclude-line';
  const [repoRoot = '', configured = ''] = wantsExclude ? args.slice(1) : args;
  if (repoRoot.trim() === '') return EXIT.usage;
  const reading = { configured, repoRoot };
  if (!wantsExclude) {
    write(`${deskRoot(reading)}\n`);
    return EXIT.ok;
  }
  const placement = deskRootPlacement(reading);
  // Outside the repository nothing is excluded, and that is the answer.
  if (placement.excludeLine !== undefined) write(`${placement.excludeLine}\n`);
  return EXIT.ok;
};

// Only when RUN, never when imported. `pathToFileURL` over the realpath, for
// the reason `agent-settings.ts` records: on macOS `/tmp` is a symlink.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exit(run(process.argv.slice(2)));
}
