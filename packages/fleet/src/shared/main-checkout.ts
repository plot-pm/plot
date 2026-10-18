import path from 'node:path';

import { commonGitDir } from './agent-log.js';

/**
 * The main checkout of the repository `repoRoot` belongs to: the parent of the
 * common git directory {@link commonGitDir} reads, so no process is spawned. A
 * lock path built from this root is the same from the main checkout and from
 * every desk.
 *
 * @param repoRoot - absolute path to a checkout's root.
 * @returns the main checkout's absolute path; `repoRoot` itself where it is the main checkout, is not a git checkout, or cannot be read.
 */
export const mainCheckout = (repoRoot: string): string => {
  try {
    const common = commonGitDir(repoRoot);
    return common !== undefined && path.basename(common) === '.git' ? path.dirname(common) : repoRoot;
  } catch {
    return repoRoot;
  }
};
