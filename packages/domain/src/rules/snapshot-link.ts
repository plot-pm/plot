import type { SnapshotSync } from './snapshot-sync.js';

/**
 * Where a reader of the snapshot stands with the sender, as `/api/fleet` reports it.
 *
 * - `absent`: no sender answered, or no message has arrived yet.
 * - `resyncing`: the held copy cannot be brought level and a new subscription is under way.
 * - `current`: the held copy is at the sender's generation.
 * - `mismatch`: the sender speaks another protocol or refused the purpose; the
 *   reader reads for itself.
 */
// plot-state: classification — a reader's view of one connection, derived from the last message and the link; no state moves into another by a command.
export const SNAPSHOT_LINK_STATES = ['absent', 'resyncing', 'current', 'mismatch'] as const;

/** The link's state with the facts that name it. */
export type SnapshotLink =
  | { readonly state: 'absent' }
  | { readonly state: 'resyncing'; readonly reason: string }
  | { readonly state: 'current'; readonly epoch: string; readonly generation: number }
  | { readonly state: 'mismatch'; readonly reason: string; readonly ours: number; readonly theirs: number | undefined };

/**
 * The link after one message was judged.
 *
 * @param sync - the outcome of `applySnapshotMessage`.
 * @returns `current` for `adopt` and `apply`, `resyncing` for `resync` and
 *   `mismatch` for `mismatch`, carrying both protocol versions.
 */
export const linkAfter = (sync: SnapshotSync): SnapshotLink => {
  if (sync.outcome === 'resync') return { state: 'resyncing', reason: sync.reason };
  if (sync.outcome === 'mismatch') {
    return { state: 'mismatch', reason: sync.reason, ours: sync.ours, theirs: sync.theirs };
  }
  return { state: 'current', epoch: sync.held.epoch, generation: sync.held.snapshot.generation };
};

/**
 * The link after the connection ended.
 *
 * @param link - the link before the end.
 * @returns `mismatch` unchanged, since a refused purpose is not cured by a
 *   reconnect; `resyncing` where a copy was current or resyncing; `absent` otherwise.
 */
export const linkAfterEnd = (link: SnapshotLink): SnapshotLink => {
  if (link.state === 'mismatch') return link;
  if (link.state === 'current') return { state: 'resyncing', reason: 'the connection to the sender ended' };
  return link.state === 'resyncing' ? link : { state: 'absent' };
};
