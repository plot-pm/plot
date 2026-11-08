import type { DeltaMessage, PurposeRefusal, SnapshotMessage } from '../entities/channel-message.js';
import { SNAPSHOT_PROTOCOL } from '../entities/subscription.js';
import type { RepoSnapshot } from '../entities/snapshot.js';

/** The snapshot a reader holds, and the sender process it came from. */
export interface HeldSnapshot {
  /** The `epoch` of the fleetd process that sent the snapshot. */
  readonly epoch: string;
  readonly snapshot: RepoSnapshot;
}

/** A message the snapshot reader judges: a snapshot, a delta, or the refusal of the snapshot purpose. */
export type SnapshotInbound = SnapshotMessage | DeltaMessage | PurposeRefusal;

/** What a reader does with one inbound message. */
export type SnapshotSync =
  /** A full snapshot replaces the held copy. */
  | { readonly outcome: 'adopt'; readonly held: HeldSnapshot }
  /** A delta whose `base` and `epoch` match the held copy changed it. */
  | { readonly outcome: 'apply'; readonly held: HeldSnapshot }
  /** The held copy cannot be brought level by this message: subscribe again for a full snapshot. */
  | { readonly outcome: 'resync'; readonly reason: string }
  /** The sender speaks another protocol, or refused the purpose: read for yourself. */
  | { readonly outcome: 'mismatch'; readonly reason: string; readonly ours: number; readonly theirs: number | undefined };

/**
 * Judges one inbound message against the copy a reader holds.
 *
 * Checks the protocol first, so a message of another protocol is never
 * applied, whatever its generation says. A `snapshot` always adopts. A `delta`
 * applies only when a copy is held, the epochs are equal and `base` equals the
 * held generation; any other delta answers `resync`.
 *
 * @param held - the copy held now, or `undefined` before the first snapshot.
 * @param message - the message received.
 * @returns the outcome; `adopt` and `apply` carry the copy to hold next. The
 *   input is not changed.
 */
export const applySnapshotMessage = (
  held: HeldSnapshot | undefined,
  message: SnapshotInbound,
): SnapshotSync => {
  if (message.type === 'refused') {
    return { outcome: 'mismatch', reason: message.reason, ours: SNAPSHOT_PROTOCOL, theirs: undefined };
  }
  if (message.protocol !== SNAPSHOT_PROTOCOL) {
    return {
      outcome: 'mismatch',
      reason: `the sender speaks snapshot protocol ${message.protocol}; this reader speaks ${SNAPSHOT_PROTOCOL}`,
      ours: SNAPSHOT_PROTOCOL,
      theirs: message.protocol,
    };
  }
  if (message.type === 'snapshot') {
    return { outcome: 'adopt', held: { epoch: message.epoch, snapshot: message.snapshot } };
  }
  if (held === undefined) return { outcome: 'resync', reason: 'a delta arrived before any snapshot' };
  if (message.epoch !== held.epoch) {
    return { outcome: 'resync', reason: `the sender restarted: epoch ${held.epoch} became ${message.epoch}` };
  }
  if (message.base !== held.snapshot.generation) {
    return {
      outcome: 'resync',
      reason: `a delta applies to generation ${message.base}; the held copy is at ${held.snapshot.generation}`,
    };
  }
  return {
    outcome: 'apply',
    held: {
      epoch: held.epoch,
      snapshot: {
        generation: message.generation,
        readings: { ...held.snapshot.readings, ...message.readings },
      },
    },
  };
};
