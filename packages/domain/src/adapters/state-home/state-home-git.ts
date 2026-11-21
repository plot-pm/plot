import { realpath } from 'node:fs/promises';

import type { StateHomeAnswer } from '../../rules/state-home.js';
import { stateHomeOf } from '../../rules/state-home.js';
import { processAnswers, type FixedAnswers } from '../git-dirs/git-dirs.js';

/**
 * The state home of the repository at `repoRoot`, asked of git.
 *
 * Reads `git rev-parse --path-format=absolute --git-common-dir`, realpaths
 * the answer and hands it to {@link stateHomeOf}.
 *
 * @param repoRoot - a main checkout or a linked worktree.
 * @param answers - the held git answers; {@link processAnswers} by default.
 * @returns `{ home }`, or `{ unread: true }` where git did not answer, the path
 *   did not resolve, or the common directory is not a `.git` directory.
 */
export const stateHomeAt = async (repoRoot: string, answers: FixedAnswers = processAnswers): Promise<StateHomeAnswer> => {
  const run = await answers.absoluteCommonDir(repoRoot, repoRoot);
  const dir = run.stdout.trim();
  if (run.code !== 0 || dir === '') return stateHomeOf(null);
  try {
    return stateHomeOf(await realpath(dir));
  } catch {
    return stateHomeOf(null);
  }
};
