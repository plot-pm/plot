import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

import { readsCoreWorktree } from '../rules/main-checkout.js';
import { stateHomeOf, type StateHomeAnswer } from '../rules/state-home.js';
import { homeAt } from './state-home/state-home-git.js';

const stateHomes = new Map<string, StateHomeAnswer>();

const UNREAD: StateHomeAnswer = { unread: true };

const gitOut = (args: readonly string[], cwd: string): string =>
  execFileSync('git', [...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/**
 * The `core.worktree` reading of a common git directory: its value, `null`
 * where the key is unset (exit 1), or `undefined` where git failed otherwise
 * or did not start.
 */
const coreWorktreeOf = (commonDir: string): string | null | undefined => {
  try {
    return gitOut(['--git-dir', commonDir, 'config', '--get', 'core.worktree'], commonDir).replace(/\n$/, '');
  } catch (error) {
    return (error as { status?: number | null }).status === 1 ? null : undefined;
  }
};

const resolve = (repoRoot: string): StateHomeAnswer => {
  let commonDir: string;
  try {
    const out = gitOut(['rev-parse', '--path-format=absolute', '--git-common-dir'], repoRoot).trim();
    if (out === '') return UNREAD;
    commonDir = realpathSync(out);
  } catch {
    return UNREAD;
  }
  const coreWorktree = readsCoreWorktree(commonDir) ? coreWorktreeOf(commonDir) : null;
  if (coreWorktree === undefined) return UNREAD;
  const answer = stateHomeOf(commonDir, coreWorktree);
  if (!('home' in answer)) return answer;
  try {
    return homeAt(realpathSync(answer.home));
  } catch {
    return UNREAD;
  }
};

/**
 * The state home of the repository at `repoRoot`, asked of git synchronously.
 *
 * Reads `git rev-parse --path-format=absolute --git-common-dir` and realpaths
 * the answer. Where its last segment is not `.git`, reads
 * `git config --get core.worktree` against it; a `.git` directory starts no
 * second process. Hands both to {@link stateHomeOf} and realpaths the home it
 * answers. Cached per root: the resolver asks git at most once per root.
 *
 * @param repoRoot - a main checkout, a linked worktree, or a submodule's working tree.
 * @returns `{ home }`, or `{ unread: true }` where git did not answer, a path
 *   did not resolve, `git config` failed with an exit other than 1, or the
 *   common directory is not a `.git` directory and sets no `core.worktree`.
 */
export const stateHomeAtSync = (repoRoot: string): StateHomeAnswer => {
  const known = stateHomes.get(repoRoot);
  if (known !== undefined) return known;
  const answer = resolve(repoRoot);
  stateHomes.set(repoRoot, answer);
  return answer;
};
