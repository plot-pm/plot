import {
  addPending,
  changeOf,
  contentChanged,
  staleReadings,
  watchTargets,
  type SnapshotChange,
  type StaleReading,
  type WatchLayout,
  type WatchTarget,
} from '@plot-pm/domain';
import type { Watch, WatchHandle } from '@plot-pm/domain/ports/watch';

/** What the watch set reads through. */
export interface WatchSetWorld {
  /** Arms one directory; `watchFs` in production. */
  watch: Watch;
  /** The paths to watch, read again on every `sync`. */
  layout: () => WatchLayout;
  /** Epoch milliseconds, for `lastEventAt`. */
  now: () => number;
  /** The digest of every ref now; `null` where it cannot be read. */
  refsDigest: () => Promise<string | null>;
  /** One desk's git state as a string; `null` where it cannot be read. */
  deskFingerprint: (admin: string) => string | null;
  /** Receives each change `changeOf` raised, before the content check; `null` events are not reported. */
  onRaised?: (change: SnapshotChange) => void;
  /** Receives each change that passed the content check and entered the pending set. */
  onChange?: (change: SnapshotChange) => void;
}

/** The directories fleetd has armed, the readings their events made stale, and what the heartbeat reports. */
export interface RunningWatchSet {
  /** How many directories fleetd wants armed. */
  wanted: () => number;
  /** How many of those are armed and not degraded. */
  armed: () => number;
  /** When an event last arrived, epoch milliseconds; `null` before the first. */
  lastEventAt: () => number | null;
  /** The readings pending, in the order they were named. */
  pending: () => readonly StaleReading[];
  /** Whether a `remote` change or the safety net is among the pending changes: the walk fetches. */
  remotePending: () => boolean;
  /** Returns the pending readings and empties the set, the remote flag included. */
  drain: () => readonly StaleReading[];
  /** Puts drained readings back, and the remote flag where the drain held it: a scan that threw read none of them. */
  requeue: (readings: readonly StaleReading[], remote: boolean) => void;
  /** Adds a change a read reported in process, with no content check: a read raised it. */
  raise: (change: SnapshotChange) => void;
  /** Reads the layout again, arms new directories and closes removed ones. */
  sync: () => Promise<void>;
  /** Closes every watch and ignores later events; calling it again does nothing. */
  stop: () => void;
}

const targetId = (target: WatchTarget): string => `${target.recursive ? 'r' : 'n'}:${target.dir}`;

/**
 * Arms fleetd's watch set and keeps the pending set.
 *
 * Each event goes through `changeOf` and then a content check: a refs change
 * whose digest equals the one held, and a desk change whose fingerprint equals
 * the one held, change nothing, so fleetd's own `git status` and `git fetch`
 * leave the pending set empty. Events are handled one at a time in arrival
 * order. The set starts no process.
 *
 * @param world - what the set reads through.
 * @returns the running set. Its first `sync` has not run: call `sync()` once
 *   to arm the directories and take the first held readings.
 */
export const startWatchSet = (world: WatchSetWorld): RunningWatchSet => {
  let layout = world.layout();
  const handles = new Map<string, WatchHandle>();
  let targets: readonly WatchTarget[] = [];
  let held: { refs: string | null; desks: Map<string, string | null> } = { refs: null, desks: new Map() };
  let pending: readonly StaleReading[] = [];
  let remote = false;
  let lastEventAt: number | null = null;
  let stopped = false;
  let queue: Promise<void> = Promise.resolve();

  const accept = (change: SnapshotChange): void => {
    pending = addPending(pending, staleReadings(change));
    if (change.kind === 'remote' || change.kind === 'safety-net') remote = true;
    world.onChange?.(change);
  };

  const deskAdmin = (path: string): string | undefined => layout.desks.find((desk) => desk.path === path)?.admin;

  const handle = async (event: Parameters<Parameters<Watch['arm']>[2]>[0]): Promise<void> => {
    if (stopped) return;
    const change = changeOf(event, layout);
    if (change === null) return;
    world.onRaised?.(change);
    if (change.kind === 'refs') {
      const fresh = await world.refsDigest();
      const changed = contentChanged(held.refs, fresh);
      held = { ...held, refs: fresh };
      if (changed) accept(change);
      return;
    }
    if (change.kind === 'desk-git') {
      const admin = deskAdmin(change.desk);
      const fresh = admin === undefined ? null : world.deskFingerprint(admin);
      const changed = contentChanged(held.desks.get(change.desk) ?? null, fresh);
      held.desks.set(change.desk, fresh);
      if (changed) accept(change);
      return;
    }
    accept(change);
  };

  const sync = async (): Promise<void> => {
    if (stopped) return;
    layout = world.layout();
    targets = watchTargets(layout);
    const wanted = new Set(targets.map(targetId));
    for (const [id, open] of handles) {
      if (!wanted.has(id)) {
        open.close();
        handles.delete(id);
      }
    }
    for (const target of targets) {
      const id = targetId(target);
      if (handles.has(id)) continue;
      handles.set(
        id,
        world.watch.arm(target.dir, { recursive: target.recursive }, (event) => {
          if (stopped) return;
          lastEventAt = world.now();
          queue = queue.then(() => handle(event)).catch(() => undefined);
        }),
      );
    }
    const refs = held.refs ?? (await world.refsDigest());
    const desks = new Map<string, string | null>();
    for (const desk of layout.desks) desks.set(desk.path, held.desks.get(desk.path) ?? world.deskFingerprint(desk.admin));
    held = { refs, desks };
  };

  return {
    wanted: () => targets.length,
    armed: () => [...handles.values()].filter((open) => !open.degraded).length,
    lastEventAt: () => lastEventAt,
    pending: () => pending,
    remotePending: () => remote,
    drain: () => {
      const drained = pending;
      pending = [];
      remote = false;
      return drained;
    },
    requeue: (readings, again) => {
      pending = addPending(readings, pending);
      remote = remote || again;
    },
    raise: (change) => {
      if (!stopped) accept(change);
    },
    sync,
    stop: () => {
      if (stopped) return;
      stopped = true;
      for (const open of handles.values()) open.close();
      handles.clear();
    },
  };
};
