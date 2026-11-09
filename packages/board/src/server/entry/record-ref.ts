import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { shellContext } from '@plot-pm/domain/adapters/scripts';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';
import { derefRecord, readRecordFindings, readRefFor } from '@plot-pm/domain/workflows/record-listing';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Names the ref a plan path's records are read at.
 *
 * ```
 * plot-record-ref.mjs <state-branch-key> <default-branch> [<path>]
 * # stdout — one ref, for example `origin/main` or `refs/remotes/origin/plot/state`
 * # exit 0 — the ref is printed; exit 2 — arguments missing
 *
 * plot-record-ref.mjs --removed-key <state-branch-key> <default-branch>
 * # stdout — the reconcile section for a removed key, or nothing when no records are stranded
 *
 * plot-record-ref.mjs --deref <ref> <path>
 * # stdout — the path the symlinks at <path> lead to; exit 1 where a link cycles or leaves the repository
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
  if (argv[0] === '--deref') {
    const final = await derefRecord(refsGit(shellContext(cwd)), argv[1] ?? '', argv[2] ?? '');
    if (final === null) return 1;
    write(`${final}\n`);
    return 0;
  }
  if (argv[0] === '--removed-key') {
    const found = await readRecordFindings(refsGit(shellContext(cwd)), { stateBranch: argv[1] ?? '', defaultBranch: argv[2] ?? '' });
    const finding = found.recordKeyRemoved;
    if (finding !== null) {
      write(`\n== Removed State branch key ==\n  ${finding.text}\n${finding.fix.map((step, i) => `    ${i + 1}. ${step}\n`).join('')}`);
    }
    return 0;
  }
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
