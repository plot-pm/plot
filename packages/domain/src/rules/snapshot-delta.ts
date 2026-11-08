import type { DeltaMessage } from '../entities/channel-message.js';
import { SNAPSHOT_PROTOCOL } from '../entities/subscription.js';
import type { ReadingKey, Readings, RepoSnapshot } from '../entities/snapshot.js';

/**
 * Builds the `delta` message for one change of a snapshot.
 *
 * @param epoch - the sender's epoch.
 * @param before - the snapshot before the change; its generation is the delta's `base`.
 * @param after - the snapshot after the change; its generation is the delta's `generation`.
 * @param changed - the keys whose content changed.
 * @returns the message carrying the changed readings only, or `undefined` where
 *   no key changed or the generation did not rise: nothing is sent for a
 *   record that changed nothing.
 */
export const deltaOf = (
  epoch: string,
  before: RepoSnapshot,
  after: RepoSnapshot,
  changed: readonly ReadingKey[],
): DeltaMessage | undefined => {
  if (changed.length === 0 || after.generation <= before.generation) return undefined;
  const readings: Partial<Readings> = {};
  for (const key of changed) Object.assign(readings, { [key]: after.readings[key] });
  return {
    type: 'delta',
    protocol: SNAPSHOT_PROTOCOL,
    epoch,
    generation: after.generation,
    base: before.generation,
    readings,
  };
};
