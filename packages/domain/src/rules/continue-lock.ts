import type { LockedProcess, ProcessSighting } from './implement-lock.js';

/**
 * The record a continue lock holds: the holder's pid and when it started, and
 * when the lock was taken.
 *
 * Narrower than `implement-lock.ts`'s `ImplementHolder`: nothing a
 * continuation starts is double-forked the way `/plot-implement`'s agent is,
 * so the lock names no agent, no process group and no run kind — only the
 * holder.
 */
export interface ContinueHolder extends LockedProcess {
  /** When the lock was taken, epoch milliseconds. */
  at: number;
}

/** The readings {@link continueLockHeld} decides from. */
export interface ContinueHolderReadings {
  /** The holder's pid. */
  holder: ProcessSighting;
}

/**
 * How far a start time read from the process table may sit from the recorded
 * one and still name the same process, in milliseconds — the same bound
 * `implement-lock.ts`'s `IMPLEMENT_LOCK_SKEW_MS` names, for the same
 * `ps -o lstart` reason.
 */
export const CONTINUE_LOCK_SKEW_MS = 3000;

/** Whether a sighting names the recorded process: alive, and started at the recorded moment. */
const isRecorded = (sighting: ProcessSighting, recorded: LockedProcess): boolean =>
  sighting.alive === null ||
  (sighting.alive &&
    (sighting.startedAt === null || Math.abs(sighting.startedAt - recorded.startedAt) < CONTINUE_LOCK_SKEW_MS));

/**
 * Whether a continue lock still holds its desk.
 *
 * A lock older than `boundMs` holds nothing. Otherwise it holds while the
 * holder is alive under its recorded start time. A table that cannot be
 * asked, or a start time that cannot be read, counts as alive — the same
 * *absent is not false* reading `implementLockHeld` applies. A pid alive
 * under another start time is a reused pid and counts as gone.
 *
 * @param holder - the lock's record.
 * @param readings - the process table's answer for the record's pid.
 * @param now - epoch milliseconds.
 * @param boundMs - the longest a continuation may hold the lock, in milliseconds.
 * @returns `true` where the lock holds, `false` where another call may take it.
 */
export const continueLockHeld = (
  holder: ContinueHolder,
  readings: ContinueHolderReadings,
  now: number,
  boundMs: number,
): boolean => {
  if (now - holder.at >= boundMs) return false;
  return isRecorded(readings.holder, holder);
};

/**
 * Writes a lock record as one line of tab-separated fields.
 *
 * @param holder - the record.
 * @returns the line, newline-terminated.
 */
export const encodeContinueHolder = (holder: ContinueHolder): string =>
  [holder.pid, holder.startedAt, holder.at].join('\t') + '\n';

/** Reads one numeric field. */
const field = (text: string | undefined): number | undefined => {
  const value = Number(text);
  return text !== undefined && text !== '' && Number.isInteger(value) ? value : undefined;
};

/**
 * Reads a lock record written by {@link encodeContinueHolder}.
 *
 * @param text - the lock file's content.
 * @returns the record, or `null` where the text is not one.
 */
export const decodeContinueHolder = (text: string): ContinueHolder | null => {
  const fields = text.trim().split('\t');
  if (fields.length !== 3) return null;
  const [pid, startedAt, at] = fields.map(field);
  if (typeof pid !== 'number' || typeof startedAt !== 'number' || typeof at !== 'number') return null;
  return { pid, startedAt, at };
};
