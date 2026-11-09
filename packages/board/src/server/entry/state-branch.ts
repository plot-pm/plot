import { hostShell, type ShellContext } from '@plot-pm/domain/adapters';
import type { Host } from '@plot-pm/domain/ports/host';
import { proposeStateBranch } from '@plot-pm/domain/rules/state-branch';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';

/**
 * The `node` entry point `/plot-init` and `/plot-board-setup` run, once per
 * adoption, to learn what to say about the `State branch` key.
 *
 * ```
 * node plot-state-branch.mjs --default main [--key refs/plot/state]
 * {"state":"restricted","proposed":"plot/state",…}
 * ```
 *
 * `--default` is the default branch's short name. `--key` is the configured
 * `State branch` value, omitted where the repository has none; a set key skips
 * the host. Prints one JSON `StateBranchProposal` and exits 0. A host that
 * cannot be asked prints `{"state":"unverified"}` and still exits 0: it is an
 * answer the proposal rule owns. Exits 2 on a missing `--default`.
 */

/**
 * Asks the host about the default branch, then the rule.
 *
 * @param argv - the arguments after the script name.
 * @param host - the host to ask.
 * @param write - where the answer goes.
 * @returns the process exit code.
 */
export const run = async (
  argv: readonly string[],
  host: Host,
  write: (s: string) => void = (s) => process.stdout.write(s),
): Promise<number> => {
  const option = (name: string): string | undefined => {
    const at = argv.indexOf(name);
    return at === -1 ? undefined : argv[at + 1];
  };
  const defaultBranch = option('--default') ?? '';
  const key = option('--key') ?? '';
  if (defaultBranch === '') {
    process.stderr.write('plot-state-branch: expected --default <branch>\n');
    return 2;
  }
  // A SET KEY IS NOT PROPOSED OVER, so the host is not asked: no request is
  // spent on an answer nothing reads.
  const asked = key.trim() === '' ? await host.branchRestrictions(defaultBranch) : null;
  const restrictions = asked !== null && asked.ok ? asked.value : null;
  write(`${JSON.stringify(proposeStateBranch(key, defaultBranch, restrictions))}\n`);
  return 0;
};

// Only when RUN, never when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const context: ShellContext = {
    repoRoot: process.cwd(),
    scriptDir: process.env.PLOT_SCRIPTS_DIR ?? path.resolve(here, '..'),
  };
  void endEntry(await run(process.argv.slice(2), hostShell(context)));
}
