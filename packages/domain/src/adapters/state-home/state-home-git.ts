import { realpath } from 'node:fs/promises';

import { readsCoreWorktree } from '../../rules/main-checkout.js';
import type { StateHomeAnswer } from '../../rules/state-home.js';
import { stateHomeOf } from '../../rules/state-home.js';
import { processAnswers, type FixedAnswers, type ProcessRunner } from '../git-dirs/git-dirs.js';
import { runProcess } from '../run-script.js';

const UNREAD: StateHomeAnswer = { unread: true };

/**
 * The `core.worktree` reading of a common git directory: its value, `null`
 * where the key is unset (exit 1), or `undefined` where git failed otherwise.
 */
const coreWorktreeOf = async (commonDir: string, run: ProcessRunner): Promise<string | null | undefined> => {
  const result = await run('git', ['--git-dir', commonDir, 'config', '--get', 'core.worktree'], { cwd: commonDir });
  if (result.interrupted !== undefined) return undefined;
  if (result.code === 1) return null;
  if (result.code !== 0) return undefined;
  return result.stdout.replace(/\n$/, '');
};

/** The state home at a physical checkout, minted by {@link stateHomeOf} as every home is. */
export const homeAt = (checkout: string): StateHomeAnswer => stateHomeOf(`${checkout.replace(/\/+$/, '')}/.git`, null);

/**
 * The state home of the repository at `repoRoot`, asked of git.
 *
 * Reads `git rev-parse --path-format=absolute --git-common-dir` and realpaths
 * the answer. Where its last segment is not `.git`, reads
 * `git config --get core.worktree` against it; a `.git` directory starts no
 * second process. Hands both to {@link stateHomeOf} and realpaths the home it
 * answers.
 *
 * @param repoRoot - a main checkout, a linked worktree, or a submodule's working tree.
 * @param answers - the held git answers; {@link processAnswers} by default.
 * @param run - starts the `git config` process; {@link runProcess} by default.
 * @returns `{ home }`, or `{ unread: true }` where git did not answer, a path
 *   did not resolve, `git config` failed with an exit other than 1, or the
 *   common directory is not a `.git` directory and sets no `core.worktree`.
 */
export const stateHomeAt = async (
  repoRoot: string,
  answers: FixedAnswers = processAnswers,
  run: ProcessRunner = runProcess,
): Promise<StateHomeAnswer> => {
  const rev = await answers.absoluteCommonDir(repoRoot, repoRoot);
  const dir = rev.stdout.trim();
  if (rev.code !== 0 || dir === '') return UNREAD;
  try {
    const commonDir = await realpath(dir);
    const coreWorktree = readsCoreWorktree(commonDir) ? await coreWorktreeOf(commonDir, run) : null;
    if (coreWorktree === undefined) return UNREAD;
    const answer = stateHomeOf(commonDir, coreWorktree);
    return 'home' in answer ? homeAt(await realpath(answer.home)) : answer;
  } catch {
    return UNREAD;
  }
};
