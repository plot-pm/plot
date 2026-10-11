/** One process named in an implement lock: its pid and when it started. */
export interface LockedProcess {
  /** The process id. */
  pid: number;
  /** When the process started, epoch milliseconds. */
  startedAt: number;
}

/**
 * The record an implement lock holds.
 *
 * The holder is the process that took the lock and waits for the run. The
 * agent is the run's own child, recorded once it has started. `pgid` is set
 * only where the holder leads its own process group, so the group holds the
 * run's children and no other process.
 */
export interface ImplementHolder extends LockedProcess {
  /** The holder's process group; `null` where the holder does not lead one. */
  pgid: number | null;
  /** When the lock was taken, epoch milliseconds. */
  at: number;
  /** The run's agent process; `null` until it has started. */
  agent: LockedProcess | null;
}

/** What the process table says about one recorded pid. */
export interface ProcessSighting {
  /** Whether a process holds the pid; `null` where the table could not be asked. */
  alive: boolean | null;
  /** When the process now holding the pid started, epoch milliseconds; `null` where unread. */
  startedAt: number | null;
}

/** The readings {@link implementLockHeld} decides from. */
export interface ImplementHolderReadings {
  /** The holder's pid. */
  holder: ProcessSighting;
  /** The agent's pid; `null` where the record names no agent. */
  agent: ProcessSighting | null;
  /** Whether the holder's group has a member; `false` where the record names no group, `null` where unasked. */
  groupAlive: boolean | null;
}

/**
 * How far a start time read from the process table may sit from the recorded
 * one and still name the same process, in milliseconds.
 *
 * `ps -o lstart` reports whole seconds, and on Linux it reads up to 1.2 s
 * before the start the process itself records (`test/reconcile/own-process.mjs`,
 * `SKEW_MS`).
 */
export const IMPLEMENT_LOCK_SKEW_MS = 3000;

/** Whether a sighting names the recorded process: alive, and started at the recorded moment. */
const isRecorded = (sighting: ProcessSighting, recorded: LockedProcess): boolean =>
  sighting.alive === null ||
  (sighting.alive &&
    (sighting.startedAt === null || Math.abs(sighting.startedAt - recorded.startedAt) < IMPLEMENT_LOCK_SKEW_MS));

/**
 * Whether an implement lock still holds its slug.
 *
 * A lock older than `boundMs` holds nothing. Otherwise it holds while the
 * holder or the agent is alive under its recorded start time. A table that
 * cannot be asked, or a start time that cannot be read, counts as alive. A pid
 * alive under another start time is a reused pid and counts as gone. Where the
 * holder is gone and led its own group, the lock holds while that group has a
 * member: a holder killed alone leaves its run in the group.
 *
 * @param holder - the lock's record.
 * @param readings - the process table's answers for the record's pids and group.
 * @param now - epoch milliseconds.
 * @param boundMs - the longest a run may hold the lock, in milliseconds.
 * @returns `true` where the lock holds, `false` where another run may take it.
 */
export const implementLockHeld = (
  holder: ImplementHolder,
  readings: ImplementHolderReadings,
  now: number,
  boundMs: number,
): boolean => {
  if (now - holder.at >= boundMs) return false;
  if (isRecorded(readings.holder, holder)) return true;
  if (holder.agent !== null && readings.agent !== null && isRecorded(readings.agent, holder.agent)) return true;
  return holder.pgid !== null && readings.holder.alive === false && readings.groupAlive !== false;
};

/**
 * Writes a lock record as one line of tab-separated fields.
 *
 * @param holder - the record.
 * @returns the line, newline-terminated.
 */
export const encodeImplementHolder = (holder: ImplementHolder): string =>
  [
    holder.pid,
    holder.startedAt,
    holder.pgid ?? '-',
    holder.at,
    holder.agent?.pid ?? '-',
    holder.agent?.startedAt ?? '-',
  ].join('\t') + '\n';

/** Reads one numeric field; `-` reads as `null`. */
const field = (text: string | undefined): number | null | undefined => {
  if (text === '-') return null;
  const value = Number(text);
  return text !== undefined && text !== '' && Number.isInteger(value) ? value : undefined;
};

/**
 * Reads a lock record written by {@link encodeImplementHolder}.
 *
 * @param text - the lock file's content.
 * @returns the record, or `null` where the text is not one.
 */
export const decodeImplementHolder = (text: string): ImplementHolder | null => {
  const [pid, startedAt, pgid, at, agentPid, agentStartedAt, ...rest] = text.trim().split('\t').map(field);
  if (rest.length > 0 || typeof pid !== 'number' || typeof startedAt !== 'number' || typeof at !== 'number') {
    return null;
  }
  if (pgid === undefined || agentPid === undefined || agentStartedAt === undefined) return null;
  if (agentPid === null || agentStartedAt === null) {
    return agentPid === agentStartedAt ? { pid, startedAt, pgid, at, agent: null } : null;
  }
  return { pid, startedAt, pgid, at, agent: { pid: agentPid, startedAt: agentStartedAt } };
};
