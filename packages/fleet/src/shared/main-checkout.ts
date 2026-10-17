import fs from 'node:fs';
import path from 'node:path';

/**
 * The main checkout of the repository `repoRoot` belongs to.
 *
 * A desk worktree's `.git` is a file naming `<common>/worktrees/<name>`, and
 * that directory's `commondir` file names the common git directory; the main
 * checkout is the common directory's parent. Read from those files, so no
 * process is spawned. A lock path built from this root is the same from the
 * main checkout and from every desk.
 *
 * @param repoRoot - absolute path to a checkout's root.
 * @returns the main checkout's absolute path; `repoRoot` itself where it is the main checkout, is not a git checkout, or cannot be read.
 */
export const mainCheckout = (repoRoot: string): string => {
  const dotGit = path.join(repoRoot, '.git');
  try {
    if (!fs.statSync(dotGit).isFile()) return repoRoot;
    const named = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotGit, 'utf8'));
    if (named === null) return repoRoot;
    const gitDir = path.resolve(repoRoot, named[1]);
    const common = path.resolve(gitDir, fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim());
    return path.basename(common) === '.git' ? path.dirname(common) : repoRoot;
  } catch {
    return repoRoot;
  }
};
