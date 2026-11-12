import { missedChangeLine, missedChanges, safetyNetDue, scanTrigger, type Readings, type RepoSnapshot, type ScanPlan } from '@plot-pm/domain';

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
   * Wraps the scan with its trigger. A beat with no pending change, no degraded
   * watch and no due safety net starts nothing. Otherwise the watch set
   * re-syncs, its pending set is drained, and the scan runs with what that
   * names; a full read is then compared by `missedChanges` against the readings
   * held before it, one line per missed change. A scan that did not land puts
   * the drained readings back and leaves the safety net due. Where no watch
   * set is armed, every beat scans in full and nothing is compared.
   */
  scan: (watchSet: RunningWatchSet | null, scan: (plan: ScanPlan) => Promise<boolean>) => () => Promise<void>;
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
 * A scan that reads every reading (a due safety net, a degraded watch, a
 * process with no watch set) and lands stamps `lastAt`; `safetyNetDue` is
 * true at start, 10 minutes after the last stamp and after a wake. A scan
 * that reads only what a trigger named stamps nothing. The trigger set named
 * is what the drain returned plus what is pending when the scan ends, so an
 * event the scan's own reads raised counts as named. The net starts no process.
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

  const scan = (watchSet: RunningWatchSet | null, run: (plan: ScanPlan) => Promise<boolean>) => async (): Promise<void> => {
    const decision = scanTrigger({
      watched: watchSet !== null,
      pending: watchSet?.pending() ?? [],
      remotePending: watchSet?.remotePending() ?? false,
      armed: watchSet?.armed() ?? 0,
      wanted: watchSet?.wanted() ?? 0,
      safetyNetDue: safetyNetDue(lastAt, world.now(), woke),
    });
    if (!decision.run) return;
    if (watchSet !== null) await watchSet.sync();
    const remote = watchSet?.remotePending() ?? false;
    const named = watchSet?.drain() ?? [];
    const full = decision.readings === 'all';
    const held = world.held().readings;
    const fresh: Partial<Readings> = {};
    taking = fresh;
    let landed = false;
    try {
      landed = await run(decision);
    } finally {
      taking = null;
      if (!landed) watchSet?.requeue(named, remote);
    }
    if (!landed) return;
    if (watchSet !== null) {
      const found = missedChanges(held, fresh, [...named, ...watchSet.pending()]);
      for (const change of found) world.write(missedChangeLine(change));
      missed += found.length;
    }
    if (full) {
      lastAt = world.now();
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
