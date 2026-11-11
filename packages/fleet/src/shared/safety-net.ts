import { missedChangeLine, missedChanges, safetyNetDue, type Readings, type RepoSnapshot } from '@plot-pm/domain';

import type { RecordReading } from './snapshot-fill.js';
import type { RunningWatchSet } from './watch-set.js';

/** What the safety net reads through. */
export interface SafetyNetWorld {
  /** The daemon's snapshot as held now. */
  held: () => RepoSnapshot;
  /** Records a reading into the daemon's snapshot. */
  record: RecordReading;
  /** The wall clock, epoch milliseconds. */
  now: () => number;
  /** Receives each log line. */
  write: (line: string) => void;
}

/** The running safety net: the scan wrapper, the record it hands the scan, and what the heartbeat reports. */
export interface SafetyNet {
  /** Records into the snapshot and keeps the reading as one the running full read took. */
  record: RecordReading;
  /**
   * Wraps a full read. Before it, the watch set re-syncs its desks and its
   * pending set is drained; after it, `missedChanges` compares the readings the
   * scan recorded with the ones held before it, and one line is written per
   * missed change. Where no watch set is armed, nothing is compared.
   */
  scan: (watchSet: RunningWatchSet | null, scan: () => Promise<void>) => () => Promise<void>;
  /** Marks the next full read as a safety-net read: a wake or a clock jump was read. */
  woke: () => void;
  /** When the last safety-net read finished, epoch milliseconds; `null` before the first. */
  lastAt: () => number | null;
  /** How many missed changes the full reads found since start. */
  missed: () => number;
}

/**
 * Starts fleetd's safety net.
 *
 * Every scan is a full read until the scan reads only what a trigger named, so
 * `missedChanges` runs after every scan. A scan that finishes while the safety
 * net is due (`safetyNetDue`: at start, 10 minutes after the last one, after a
 * wake) stamps `lastAt`. The trigger set named is what the drain returned plus
 * what is pending when the scan ends, so an event the scan's own reads raised
 * counts as named. The net starts no process.
 *
 * @param world - what the net reads through.
 * @returns the running net.
 */
export const startSafetyNet = (world: SafetyNetWorld): SafetyNet => {
  let taking: Partial<Readings> | null = null;
  let lastAt: number | null = null;
  let woke = false;
  let missed = 0;

  const record: RecordReading = (key, reading) => {
    world.record(key, reading);
    if (taking !== null) Object.assign(taking, { [key]: reading });
  };

  const scan = (watchSet: RunningWatchSet | null, run: () => Promise<void>) => async (): Promise<void> => {
    if (watchSet !== null) await watchSet.sync();
    const named = watchSet?.drain() ?? [];
    const held = world.held().readings;
    const fresh: Partial<Readings> = {};
    taking = fresh;
    try {
      await run();
    } finally {
      taking = null;
    }
    if (watchSet !== null) {
      const found = missedChanges(held, fresh, [...named, ...watchSet.pending()]);
      for (const change of found) world.write(missedChangeLine(change));
      missed += found.length;
    }
    const now = world.now();
    if (safetyNetDue(lastAt, now, woke)) {
      lastAt = now;
      woke = false;
    }
  };

  return {
    record,
    scan,
    woke: () => {
      woke = true;
    },
    lastAt: () => lastAt,
    missed: () => missed,
  };
};
