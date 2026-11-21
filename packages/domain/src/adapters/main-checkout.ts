import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

import { stateHomeOf, type StateHomeAnswer } from '../rules/state-home.js';

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

const stateHomes = new Map<string, StateHomeAnswer>();

/**
 * The state home of the repository at `repoRoot`, asked of git synchronously.
 *
 * Reads `git rev-parse --path-format=absolute --git-common-dir`, realpaths
 * the answer and hands it to {@link stateHomeOf}. Cached per root: the
 * resolver spawns `git` at most once per root.
 *
 * @param repoRoot - a main checkout or a linked worktree.
 * @returns `{ home }`, or `{ unread: true }` where git did not answer, the path
 *   did not resolve, or the common directory is not a `.git` directory.
 */
export const stateHomeAtSync = (repoRoot: string): StateHomeAnswer => {
  const known = stateHomes.get(repoRoot);
  if (known !== undefined) return known;
  let answer: StateHomeAnswer;
  try {
    const out = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    answer = stateHomeOf(out === '' ? null : realpathSync(out));
  } catch {
    answer = stateHomeOf(null);
  }
  stateHomes.set(repoRoot, answer);
  return answer;
};
