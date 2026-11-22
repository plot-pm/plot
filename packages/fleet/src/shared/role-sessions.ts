import fs from 'node:fs';
import path from 'node:path';

/**
 * The desk's role-session record: the transcript handles that role runs
 * started with the desk as their working directory.
 *
 * A leaf module: it imports nothing from the continuation code, so the worker
 * loop's bundle can read the record without pulling in `continuation.ts`.
 */

/** The file in a desk's own gitdir that lists the transcript handles role runs started there. */
const ROLE_SESSIONS_FILENAME = 'plot-role-sessions';

/**
 * The desk's role-session record file, in the desk's own gitdir and outside
 * the tree, so it never reads as unlanded work.
 *
 * @param worktree - the desk's absolute path.
 * @returns the file's path; `undefined` where the desk has no readable `.git`.
 */
export const roleSessionsFile = (worktree: string): string | undefined => {
  const dotGit = path.join(worktree, '.git');
  try {
    if (fs.statSync(dotGit).isDirectory()) return path.join(dotGit, ROLE_SESSIONS_FILENAME);
    const named = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'));
    return named === null ? undefined : path.join(path.resolve(worktree, named[1].trim()), ROLE_SESSIONS_FILENAME);
  } catch {
    return undefined;
  }
};

/**
 * The handles a role run started on this desk, read from its record.
 *
 * @param worktree - the desk's absolute path.
 * @returns the handles; empty where no record is readable.
 */
export const roleSessions = (worktree: string): Set<string> => {
  const file = roleSessionsFile(worktree);
  if (file === undefined) return new Set();
  try {
    return new Set(fs.readFileSync(file, 'utf8').split('\n').filter((line) => line !== ''));
  } catch {
    return new Set();
  }
};

/**
 * Appends the handles a role run started on this desk to the desk's
 * role-session record, so that `resumeHandleUsable` rejects each as
 * `role-listed`. A record that cannot be written is skipped.
 *
 * @param worktree - the desk's absolute path.
 * @param handles - the transcript handles the role run started.
 */
export const recordRoleSessions = (worktree: string, handles: Iterable<string>): void => {
  const lines = [...handles].map((handle) => `${handle}\n`).join('');
  const file = roleSessionsFile(worktree);
  if (lines === '' || file === undefined) return;
  try {
    fs.appendFileSync(file, lines);
  } catch {
    /* an unwritable record leaves the record as it was */
  }
};
