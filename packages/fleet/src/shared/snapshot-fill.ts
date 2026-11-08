import { emptySnapshot, READING_KEYS, type ReadingKey, type Readings, type RegistryEntry, type RepoSnapshot } from '@plot-pm/domain/entities/snapshot';
import { recordReading } from '@plot-pm/domain/rules/snapshot-record';

import type { AgentEntry } from './registry.js';

/**
 * Records one reading in the daemon's snapshot.
 *
 * Callers pass a value they already hold from a read they made for their own
 * decision. The function reads nothing and starts no process.
 */
export type RecordReading = <K extends ReadingKey>(key: K, reading: Readings[K]) => void;

/** The daemon's one snapshot and the function that fills it. */
export interface SnapshotHolder {
  /** @returns the snapshot as last recorded; the object is never modified afterwards. */
  current: () => RepoSnapshot;
  /** Records a reading through `recordReading`. */
  record: RecordReading;
}

/**
 * Builds the holder of one snapshot, every key `unread`.
 *
 * @returns the holder. `record` replaces the held snapshot with the result of
 *   `recordReading`, so an equal reading keeps the generation.
 */
export const createSnapshotHolder = (): SnapshotHolder => {
  let held = emptySnapshot();
  return {
    current: () => held,
    record: (key, reading) => {
      held = recordReading(held, key, reading).snapshot;
    },
  };
};

/**
 * A `read` reading.
 *
 * @param value - the value the loop read.
 * @param readAt - epoch ms the read finished; defaults to now.
 * @returns the reading to hand to {@link RecordReading}.
 */
export const readOf = <T>(value: T, readAt: number = Date.now()): { state: 'read'; readAt: number; value: T } => ({
  state: 'read',
  readAt,
  value,
});

/**
 * A `failed` reading.
 *
 * @param reason - why the read gave no value; an empty reason becomes `the read failed`.
 * @param readAt - epoch ms the read failed; defaults to now.
 * @returns the reading to hand to {@link RecordReading}.
 */
export const failedOf = (reason: string, readAt: number = Date.now()): { state: 'failed'; readAt: number; reason: string } => ({
  state: 'failed',
  readAt,
  reason: reason === '' ? 'the read failed' : reason,
});

/**
 * One manifest as the snapshot's `registry` reading holds it.
 *
 * @param entry - the parsed manifest.
 * @param text - the manifest's JSON text, from which the `slug` is read: the
 *   registry's own entry type does not carry it.
 * @returns the entry; `slug` is `''` where the text holds none.
 */
export const registryEntryOf = (entry: AgentEntry, text: string): RegistryEntry => {
  let slug = '';
  try {
    const raw: unknown = JSON.parse(text);
    const held = typeof raw === 'object' && raw !== null ? (raw as { slug?: unknown }).slug : undefined;
    if (typeof held === 'string') slug = held;
  } catch {
    slug = '';
  }
  return {
    session: entry.session,
    resumeId: entry.resumeId,
    branch: entry.branch,
    slug,
    worktree: entry.worktree,
    command: entry.command,
    startedAt: entry.startedAt,
    pid: entry.pid,
    previousPid: entry.previousPid,
    relaunches: entry.relaunches,
    attempts: entry.attempts,
  };
};

/**
 * Marks every key still `unread` as `failed` with one reason.
 *
 * For a run that reads some sources and by design not the rest: a reading no
 * read produced is not an empty one, and `unread` after the run would read as
 * a source nobody asked.
 *
 * @param holder - the snapshot to close.
 * @param reason - why the remaining keys carry no value.
 */
export const failUnread = (holder: SnapshotHolder, reason: string): void => {
  for (const key of READING_KEYS) {
    if (holder.current().readings[key].state === 'unread') holder.record(key, failedOf(reason));
  }
};
