import type { SnapshotReading, ReadingKey, Readings, RepoSnapshot } from '../entities/snapshot.js';

/** What {@link recordReading} returns: the snapshot after the record, and the keys whose content changed. */
export interface Recorded {
  snapshot: RepoSnapshot;
  changed: readonly ReadingKey[];
}

/**
 * Compares two values by content: primitives by `Object.is`, arrays and plain
 * objects key by key, at any depth.
 *
 * @param a - one value.
 * @param b - the other.
 * @returns whether both hold the same content.
 */
export const sameValue = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((k) => Object.hasOwn(right, k) && sameValue(left[k], right[k]));
};

const contentOf = (reading: SnapshotReading<unknown>): unknown =>
  reading.state === 'read' ? ['read', reading.value] : reading.state === 'failed' ? ['failed', reading.reason] : ['unread'];

/**
 * Records one reading in a snapshot, compared by content.
 *
 * A reading whose state, value and reason equal the held one's changes
 * nothing: the given snapshot is returned as it is, `readAt` included. Any
 * other reading replaces the held one and moves `generation` by one. The given
 * snapshot is never modified.
 *
 * @param snapshot - the held snapshot.
 * @param key - the reading to record.
 * @param reading - the new reading for that key.
 * @returns the snapshot after the record, and `[key]` where the content changed or `[]` where it did not.
 */
export const recordReading = <K extends ReadingKey>(snapshot: RepoSnapshot, key: K, reading: Readings[K]): Recorded => {
  if (sameValue(contentOf(snapshot.readings[key]), contentOf(reading))) return { snapshot, changed: [] };
  return {
    snapshot: { generation: snapshot.generation + 1, readings: { ...snapshot.readings, [key]: reading } },
    changed: [key],
  };
};
