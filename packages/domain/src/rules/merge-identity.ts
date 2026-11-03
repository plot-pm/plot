import { asksMergerApp } from '../adapters/host/merger-backend.js';
import type { HostBackend } from '../ports/host.js';

/** The `Merger app` key as the adapter reads it. */
export type MergerAppReading =
  | { read: 'usable' }
  | { read: 'absent' }
  | { read: 'invalid'; reason: string }
  | { read: 'unread' };

/** Why {@link mergeIdentity} holds instead of naming an identity. */
export type MergeIdentityHold = 'merger-app-missing' | 'merger-app-invalid' | 'merger-app-unread';

/** Who a merge runs as, or why it cannot yet. */
export type MergeIdentity = { identity: 'app' | 'host' } | { identity: 'hold'; reason: MergeIdentityHold };

/**
 * Decides who a merge runs as, from the host backend and the `Merger app`
 * reading alone.
 *
 * On the backend {@link asksMergerApp} answers true for, only a `usable`
 * reading answers `app`; every other reading holds by name instead of
 * falling back to the signed-in identity — a hold a failed read cannot read
 * past (#3063's Motivation: a malformed key used to read as "declared", so
 * the merge was tried and refused by the host with no named reason). Every
 * other backend answers `host` without consulting the reading at all, so
 * Bitbucket keeps merging as the `bb` identity unchanged.
 *
 * @param backend - the host backend, from `Host.backend()`.
 * @param mergerApp - the `Merger app` reading; absent reads as `unread`.
 * @returns `app`, `host`, or a named hold.
 */
export const mergeIdentity = (backend: HostBackend, mergerApp: MergerAppReading | undefined): MergeIdentity => {
  if (!asksMergerApp(backend)) return { identity: 'host' };
  const reading = mergerApp ?? { read: 'unread' };
  switch (reading.read) {
    case 'usable':
      return { identity: 'app' };
    case 'absent':
      return { identity: 'hold', reason: 'merger-app-missing' };
    case 'invalid':
      return { identity: 'hold', reason: 'merger-app-invalid' };
    case 'unread':
      return { identity: 'hold', reason: 'merger-app-unread' };
  }
};
