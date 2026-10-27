/** One process named in an implement lock: its pid and when it started. */
export interface LockedProcess {
  /** The process id. */
  pid: number;
  /** When the process started, epoch milliseconds. */
  startedAt: number;
}

/** Which run took an implement lock: a `/plot-implement` run, or a run of the `Brief command`. */
export type ImplementRunKind = 'implement' | 'brief';

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
  /** Which run took the lock; `null` for a record that names none. */
  run: ImplementRunKind | null;
  /** The checkout the run works in, as an absolute path; `null` for a record that names none. */
  tree: string | null;
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

/**
 * Whether a sighting names the recorded process: alive, and started within
 * `skewMs` of the recorded moment on either side.
 *
 * A table that cannot be asked (`alive === null`), or a start time that
 * cannot be read (`startedAt === null`) while the pid answers alive, reads as
 * the recorded process — *absent is not false*. This is the one rule shared
 * by an implement lock's holder and agent, a continue lock's holder, and the
 * reaper's desk-worker reading: each names a pid and a recorded start, and
 * asks the same question of whatever the process table now says about it.
 *
 * @param sighting - what the process table now says about the pid.
 * @param recorded - the pid and start time the lock (or manifest) recorded.
 * @param skewMs - how far the live start may sit from the recorded one.
 * @returns `true` where the sighting still names the recorded process.
 */
export const isRecordedProcess = (sighting: ProcessSighting, recorded: LockedProcess, skewMs: number): boolean =>
  sighting.alive === null ||
  (sighting.alive && (sighting.startedAt === null || Math.abs(sighting.startedAt - recorded.startedAt) < skewMs));

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
  if (isRecordedProcess(readings.holder, holder, IMPLEMENT_LOCK_SKEW_MS)) return true;
  if (
    holder.agent !== null &&
    readings.agent !== null &&
    isRecordedProcess(readings.agent, holder.agent, IMPLEMENT_LOCK_SKEW_MS)
  )
    return true;
  return holder.pgid !== null && readings.holder.alive === false && readings.groupAlive !== false;
};

/**
 * Writes a lock record as one line of tab-separated fields. The checkout path
 * is URI-encoded, so no tab or newline in it can split the line.
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
    holder.run ?? '-',
    holder.tree === null ? '-' : encodeURIComponent(holder.tree),
  ].join('\t') + '\n';

/** Reads one numeric field; `-` reads as `null`. */
const field = (text: string | undefined): number | null | undefined => {
  if (text === '-') return null;
  const value = Number(text);
  return text !== undefined && text !== '' && Number.isInteger(value) ? value : undefined;
};

/** Reads the run field; `-` reads as `null`. */
const runField = (text: string): ImplementRunKind | null | undefined =>
  text === '-' ? null : text === 'implement' || text === 'brief' ? text : undefined;

/** Reads the checkout field; `-` reads as `null`. */
const treeField = (text: string): string | null | undefined => {
  if (text === '-') return null;
  try {
    return decodeURIComponent(text);
  } catch {
    return undefined;
  }
};

/**
 * Reads a lock record written by {@link encodeImplementHolder}. A record of six
 * fields, which names no run and no checkout, reads with both `null`.
 *
 * @param text - the lock file's content.
 * @returns the record, or `null` where the text is not one.
 */
export const decodeImplementHolder = (text: string): ImplementHolder | null => {
  const fields = text.trim().split('\t');
  if (fields.length !== 6 && fields.length !== 8) return null;
  const [pid, startedAt, pgid, at, agentPid, agentStartedAt] = fields.slice(0, 6).map(field);
  const run = fields.length === 8 ? runField(fields[6]) : null;
  const tree = fields.length === 8 ? treeField(fields[7]) : null;
  if (typeof pid !== 'number' || typeof startedAt !== 'number' || typeof at !== 'number') return null;
  if (pgid === undefined || agentPid === undefined || agentStartedAt === undefined) return null;
  if (run === undefined || tree === undefined) return null;
  if (agentPid === null || agentStartedAt === null) {
    return agentPid === agentStartedAt ? { pid, startedAt, pgid, at, agent: null, run, tree } : null;
  }
  return { pid, startedAt, pgid, at, agent: { pid: agentPid, startedAt: agentStartedAt }, run, tree };
};

/**
 * Who holds an implement lock, as seen from one checkout.
 *
 * - `implement` — a `/plot-implement` run in this checkout, whose state file this checkout reads.
 * - `brief` — a run of the `Brief command`, which writes no state file.
 * - `desk` — a `/plot-implement` run in another checkout, whose state file is there.
 * - `unknown` — no holding record, or one that names no run or no checkout.
 */
export type ImplementLockHolder = 'implement' | 'brief' | 'desk' | 'unknown';

/**
 * Names who holds an implement lock, as seen from the checkout `tree`.
 *
 * @param holder - the holding record; `null` where the lock holds nothing or cannot be read.
 * @param tree - the asking checkout, as an absolute path spelt the way the holder's `tree` is.
 * @returns the holder's kind.
 */
export const implementLockHolder = (holder: ImplementHolder | null, tree: string): ImplementLockHolder => {
  if (holder === null || holder.run === null) return 'unknown';
  if (holder.run === 'brief') return 'brief';
  if (holder.tree === null) return 'unknown';
  return holder.tree === tree ? 'implement' : 'desk';
};
