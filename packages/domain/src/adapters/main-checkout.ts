import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

import { stateHomeOf, type StateHomeAnswer } from '../rules/state-home.js';

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
