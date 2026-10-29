import type { FixerAttempt, FixerAttemptsRecord } from '../entities/fixer-attempts.js';
import type { PortResult } from '../port-result.js';

/**
 * Keeps one PR's fixer attempts — one file per PR, under `.plot/state/` in
 * the common git dir.
 *
 * **ONE WRITER.** The tick that starts a fixer (`feature/fleetd-starts-the-
 * fixer`) is the only caller of {@link FixerAttemptsStore.append}. Every other
 * reader of this port only calls `read`.
 *
 * **THE ATTEMPT IS WRITTEN BEFORE THE FIXER STARTS.** The caller refuses the
 * start when `append` does not land — see {@link FixerAttemptsStore.append}.
 * A crash between the write and the start spends an attempt and adds no
 * writer; reversing the order would let a crash AFTER the start leave a
 * running fixer with no record, so a restart starts a second one.
 */
export interface FixerAttemptsStore {
  /**
   * Reads one PR's attempts.
   *
   * @param pr - the PR number.
   * @returns `'none'` where no record has ever been written for this PR,
   *   `'unreadable'` where the file exists but cannot be read as a record
   *   this version recognises (corrupt JSON, another `v`), or the record.
   *   `failed` only where the read itself could not be attempted at all —
   *   distinct from `'unreadable'`, which IS an answer the caller decides on.
   */
  read(pr: number): Promise<PortResult<FixerAttemptsRecord | 'none' | 'unreadable'>>;

  /**
   * Appends one attempt to the PR's record, creating the record where none
   * exists.
   *
   * **CALLED BEFORE THE FIXER STARTS, NEVER AFTER.** The caller refuses to
   * start the fixer when this answers anything but success — a swallowed
   * failure here is exactly the unrecorded fixer the plan exists to prevent.
   *
   * @param pr - the PR number.
   * @param attempt - the attempt to append, carrying its own `inFlight` mark.
   * @returns nothing on success; `failed` where the write did not land.
   */
  append(pr: number, attempt: FixerAttempt): Promise<PortResult<void>>;
}
