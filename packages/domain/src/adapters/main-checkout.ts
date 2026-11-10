import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const mainRoots = new Map<string, string>();

/**
 * The main checkout a repository root belongs to.
 *
 * A linked worktree shares fleetd, the reader lock, the heartbeat and the
 * fleet bridge with its main checkout. The root comes from `git rev-parse
 * --git-common-dir`, the directory the reader lock and `issues.json` resolve
 * from. Where that is not a `.git` directory, or git cannot answer, the root
 * is `repoRoot` itself. Cached per root: the answer cannot change while a
 * process runs, so the resolver spawns `git` at most once per root.
 *
 * @param repoRoot - a repository root, main checkout or linked worktree.
 * @returns the main checkout's real path, or `repoRoot` where it cannot be told.
 */
export const mainRootOf = (repoRoot: string): string => {
  const known = mainRoots.get(repoRoot);
  if (known !== undefined) return known;
  let root = repoRoot;
  try {
    const out = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const common = out === '' ? null : resolve(repoRoot, out);
    if (common !== null && basename(common) === '.git') root = realpathSync(dirname(common));
  } catch {
    root = repoRoot;
  }
  mainRoots.set(repoRoot, root);
  return root;
};
