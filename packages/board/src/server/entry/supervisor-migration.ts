import { supervisorMigrates } from '@plot-pm/domain/rules/supervisor-migration';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot-fleetctl.sh --start` runs, once per start.
 *
 * ```
 * node plot-supervisor-migration.mjs "$served" "$repo_root"
 * yes
 * ```
 *
 * **Its own artifact** for the reason every other one gives: the decision is a
 * two-string comparison and nothing else here spawns a process to make it.
 *
 * **Argv, not stdin.** The caller already holds both paths as shell variables
 * from `supervisor_checkout`/`pwd -P`; a tab-separated stdin document would
 * invent a parsing step neither side needs.
 */

/**
 * Prints the rule's answer for one pair of paths.
 *
 * @param servedPath the old-label unit's working directory, physically
 *   resolved; empty when the label names none
 * @param repoRoot this repository's main checkout, physically resolved
 * @returns `'yes'` when the unit may be migrated, `'no'` otherwise
 */
export const answer = (servedPath: string, repoRoot: string): string =>
  supervisorMigrates({ servedPath, repoRoot }) ? 'yes' : 'no';

/**
 * Reads argv, prints the answer.
 *
 * @param argv `[servedPath, repoRoot]`
 * @param write where the answer goes
 * @returns the process exit code — 0 answered, 2 wrong argument count
 */
export const run = (
  argv: readonly string[],
  write: (s: string) => void = (s) => process.stdout.write(s),
): number => {
  if (argv.length !== 2) {
    process.stderr.write(`plot-supervisor-migration: expected 2 arguments, got ${argv.length}\n`);
    return 2;
  }
  const [servedPath, repoRoot] = argv as [string, string];
  write(`${answer(servedPath, repoRoot)}\n`);
  return 0;
};

// Only when RUN, never when imported. See standing.ts for why `pathToFileURL`
// rather than a template literal.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exit(run(process.argv.slice(2)));
}
