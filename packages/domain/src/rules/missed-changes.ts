import { READING_KEYS, type ReadingKey, type Readings } from '../entities/snapshot.js';
import { sameValue } from './snapshot-record.js';
import type { StaleReading } from './snapshot-stale.js';

/** How long fleetd waits between two safety-net reads, in milliseconds: 10 minutes. */
export const SAFETY_NET_MS = 600_000;

/** The reading keys held per desk: `desks` lists entries by `path`, `deskFiles` and `workers` key them by the desk's path. */
const PER_DESK_KEYS: readonly ReadingKey[] = ['desks', 'deskFiles', 'workers'];

/** The keys a full read takes but never compares: the walk is derived from the other readings and carries its own clock. */
const DERIVED_KEYS: readonly ReadingKey[] = ['walk'];

/** One reading a full read found changed while no trigger named it; `desk` is set for a per-desk key. */
export interface MissedChange {
  key: ReadingKey;
  desk?: string;
}

const byDesk = (key: ReadingKey, value: unknown): Map<string, unknown> => {
  if (key === 'desks') return new Map((value as readonly { path: string }[]).map((entry) => [entry.path, entry]));
  return new Map(Object.entries(value as Record<string, unknown>));
};

/**
 * Names each reading a full read found changed while no trigger named it.
 *
 * A key is compared only where both the held and the fresh reading are `read`;
 * a first read, a failed read and a key the full read did not take name
 * nothing. Content is compared, never `readAt`. The `walk` is never named. For
 * `desks`, `deskFiles` and `workers` each desk is compared on its own, and a
 * desk that appeared or went away is a change.
 *
 * @param held - the readings held before the full read.
 * @param fresh - the readings the full read took.
 * @param named - every reading a trigger named since the last full read. An
 *   entry with no `desk` covers the key on every desk.
 * @returns the missed changes in reading-key order, each desk of a key in path order.
 */
export const missedChanges = (
  held: Partial<Readings>,
  fresh: Partial<Readings>,
  named: readonly StaleReading[],
): readonly MissedChange[] => {
  const missed: MissedChange[] = [];
  for (const key of READING_KEYS) {
    if (DERIVED_KEYS.includes(key)) continue;
    const before = held[key];
    const after = fresh[key];
    if (before?.state !== 'read' || after?.state !== 'read') continue;
    if (named.some((reading) => reading.key === key && reading.desk === undefined)) continue;
    if (!PER_DESK_KEYS.includes(key)) {
      if (!sameValue(before.value, after.value)) missed.push({ key });
      continue;
    }
    const was = byDesk(key, before.value);
    const now = byDesk(key, after.value);
    for (const desk of [...new Set([...was.keys(), ...now.keys()])].sort()) {
      if (named.some((reading) => reading.key === key && reading.desk === desk)) continue;
      if (!sameValue(was.get(desk), now.get(desk))) missed.push({ key, desk });
    }
  }
  return missed;
};

/**
 * The log line fleetd writes for one missed change.
 *
 * @param change - what the full read found.
 * @returns `plot-fleetd: safety net: <key> [<desk>] changed with no trigger`, newline-terminated.
 */
export const missedChangeLine = (change: MissedChange): string =>
  `plot-fleetd: safety net: ${change.key}${change.desk === undefined ? '' : ` ${change.desk}`} changed with no trigger\n`;

/**
 * Whether the next full read is a safety-net read.
 *
 * @param lastAt - when the last safety-net read finished, epoch milliseconds; `null` before the first.
 * @param now - the wall clock, epoch milliseconds.
 * @param woke - whether a wake or a clock jump was read since the last one.
 * @returns `true` before the first, after a wake, once {@link SAFETY_NET_MS}
 *   has passed, and where the wall clock now reads earlier than the last one.
 */
export const safetyNetDue = (lastAt: number | null, now: number, woke = false): boolean =>
  lastAt === null || woke || now < lastAt || now - lastAt >= SAFETY_NET_MS;
