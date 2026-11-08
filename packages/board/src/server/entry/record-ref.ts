import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { shellContext } from '@plot-pm/domain/adapters/scripts';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';
import { readRefFor } from '@plot-pm/domain/workflows/record-listing';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Names the ref a plan path's records are read at.
 *
 * ```
 * plot-record-ref.mjs <state-branch-key> <default-branch> [<path>]
 * # stdout — one ref, for example `origin/main` or `refs/remotes/origin/plot/state`
 * # exit 0 — the ref is printed; exit 2 — arguments missing
 * ```
 *
 * `plot-dispatch.sh` and `plot-reconcile-scan.sh` run it only where a `State
 * branch` key is declared, once per path they read. It reads local refs and
 * makes no network call.
 *
 * @param argv - the key, the default branch and an optional path.
 * @param cwd - a directory inside the repository.
 * @param write - where the ref goes.
 * @param warn - where usage goes.
 * @returns the process exit code.
 */
export const run = async (
  argv: readonly string[],
  cwd: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
  warn: (s: string) => void = (s) => process.stderr.write(s),
): Promise<number> => {
  const [stateBranch, defaultBranch, path] = argv;
  if (stateBranch === undefined || !defaultBranch) {
    warn('usage: plot-record-ref.mjs <state-branch-key> <default-branch> [<path>]\n');
    return 2;
  }
  const refs = refsGit(shellContext(cwd));
  write(`${await readRefFor(refs, { stateBranch, defaultBranch }, path || undefined)}\n`);
  return 0;
};

// Runs only when launched as a program; a test imports `run` without starting it.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  void endEntry(await run(process.argv.slice(2), process.env.PLOT_REPO_ROOT ?? process.cwd()));
}
