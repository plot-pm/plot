/** Why the board could not read a branch's worker log. */
export type LogMissReason = 'no-worktree' | 'no-log' | 'unreadable' | 'pulse-partial' | 'no-pulse';

/**
 * The sentence the worker-log panel shows for a log it could not read.
 *
 * Each reason has its own sentence, and each sentence names what is true and
 * what the reader can do.
 *
 * @param reason - why the log was not read.
 * @returns the sentence.
 */
export const logMissWord = (reason: LogMissReason): string => {
  switch (reason) {
    case 'no-worktree':
      return 'No worktree for this branch on this machine — ask the machine that took it.';
    case 'no-log':
      return 'The worktree is here, but no worker has written a log in it.';
    case 'unreadable':
      return 'The log file is there and would not open — check its permissions.';
    case 'pulse-partial':
      return 'The fleet scan has not reached this branch yet; ask again after the scan finishes.';
    case 'no-pulse':
      return 'There is no fleet reading to look this branch up in.';
  }
};

/**
 * Whether a worker-log miss answers 404: the board has no desk to look in.
 *
 * @param reason - why the log was not read.
 * @returns `true` for `no-worktree`, `pulse-partial` and `no-pulse`.
 */
export const logMissNotFound = (reason: LogMissReason): boolean =>
  reason === 'no-worktree' || reason === 'pulse-partial' || reason === 'no-pulse';
