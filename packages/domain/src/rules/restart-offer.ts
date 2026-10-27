/** The worker states a restart replaces: a process that is gone, or that exited with work unfinished. */
const RESTARTABLE: readonly string[] = ['stalled', 'failed', 'ended', 'none'];

/**
 * Whether a claimed slice's row offers Restart.
 *
 * The offer follows the states `restartWorker` accepts. `running` and `waiting`
 * are refused there, `finished` is a desk fact the reaper and `continue` handle,
 * and `elsewhere` names a worktree on another machine.
 *
 * @param worker - the row's worker state word; a word outside the states offers nothing.
 * @returns `true` where the row offers Restart.
 */
export const restartOffered = (worker: string): boolean => RESTARTABLE.includes(worker);
