import { describe, expect, it } from 'vitest';

import { clockManual } from '@plot-pm/domain/adapters';
import { HEARTBEAT_STALE_MS } from '@plot-pm/domain/rules/reader-election';

import { coldRead, freshCacheEntry, watchEntry, type CacheEntry, type FleetWatchDeps } from '../../src/server/fleet.js';

/**
 * The board runs its pulse exactly while an event stream is attached, and a
 * plain request gets one cold read. The scan and the PR read are counting stubs
 * and the clock is driven by hand, so a beat is a call and not 5 s of waiting.
 */

const REFRESH_MS = 5_000;
const T0 = Date.UTC(2026, 10, 8, 12, 0, 0);

interface Counted {
  deps: FleetWatchDeps;
  clock: ReturnType<typeof clockManual>;
  scans: () => number;
  prReads: () => number;
}

/** A scan stub that lands at once and stamps `entry.at`, as `refresh` does. */
const counting = (entry: CacheEntry, now: () => number = () => T0): Counted => {
  let scans = 0;
  let prReads = 0;
  const clock = clockManual(T0);
  return {
    clock,
    deps: {
      clock,
      scan: async () => {
        scans += 1;
        entry.at = now();
      },
      readPrs: async () => {
        prReads += 1;
      },
    },
    scans: () => scans,
    prReads: () => prReads,
  };
};

describe('watchEntry', () => {
  it('starts no pulse while no stream is attached', () => {
    const entry = freshCacheEntry();
    const c = counting(entry);
    watchEntry(entry, 0, c.deps);
    expect(entry.pulseClock).toBeNull();
    expect(c.clock.scheduled()).toBe(0);
  });

  it('starts one pulse for the first stream and none for the second', () => {
    const entry = freshCacheEntry();
    const c = counting(entry);
    watchEntry(entry, 1, c.deps);
    watchEntry(entry, 2, c.deps);
    expect(c.clock.scheduled()).toBe(1);
    // The attach itself catches up once; the second stream adds nothing.
    expect([c.scans(), c.prReads()]).toEqual([1, 1]);
  });

  it('beats the scan every 5 s and the PR read every 60 s while attached', () => {
    const entry = freshCacheEntry();
    const c = counting(entry);
    watchEntry(entry, 1, c.deps);
    c.clock.advance(12);
    expect([c.scans(), c.prReads()]).toEqual([1 + 12, 1 + 1]);
  });

  it('stops the pulse at zero streams and keeps the cache', () => {
    const entry = freshCacheEntry();
    const c = counting(entry);
    watchEntry(entry, 1, c.deps);
    entry.at = 123;
    watchEntry(entry, 0, c.deps);
    expect(entry.pulseClock).toBeNull();
    expect(c.clock.scheduled()).toBe(0);
    expect(entry.at).toBe(123);
  });

  it('catches up with one scan and one PR read on an attach after a stop, before the next beat', () => {
    const entry = freshCacheEntry();
    const c = counting(entry);
    watchEntry(entry, 1, c.deps);
    watchEntry(entry, 0, c.deps);
    const before = [c.scans(), c.prReads()];
    watchEntry(entry, 1, c.deps);
    expect([c.scans() - before[0], c.prReads() - before[1]]).toEqual([1, 1]);
    expect(c.clock.scheduled()).toBe(1);
  });

  it('runs no PR read, and so writes no reader-lock heartbeat, for HEARTBEAT_STALE_MS plus one reader beat after the last stream leaves', () => {
    // The PR read is the only caller of the board's heartbeat. With none for
    // longer than HEARTBEAT_STALE_MS, `stillFollowed` reads `none` and a
    // board-started `plot-pr-reader.mjs` exits (`packages/fleet/test/unit/pr-reader.test.ts`).
    const entry = freshCacheEntry();
    const c = counting(entry);
    watchEntry(entry, 1, c.deps);
    watchEntry(entry, 0, c.deps);
    const reads = c.prReads();
    c.clock.advance(HEARTBEAT_STALE_MS / REFRESH_MS + 12);
    expect(c.prReads()).toBe(reads);
  });
});

describe('coldRead', () => {
  it('starts two scans for two plain requests 6 s apart, and no pulse beat follows', () => {
    const entry = freshCacheEntry();
    let now = T0;
    const c = counting(entry, () => now);
    coldRead(entry, now, c.deps.scan);
    now += 6_000;
    coldRead(entry, now, c.deps.scan);
    expect(c.scans()).toBe(2);
    expect(entry.pulseClock).toBeNull();
    c.clock.advance(24);
    expect(c.scans()).toBe(2);
    expect(c.prReads()).toBe(0);
  });

  it('starts no scan for a second request inside 5 s', () => {
    const entry = freshCacheEntry();
    let now = T0;
    const c = counting(entry, () => now);
    coldRead(entry, now, c.deps.scan);
    now += 4_000;
    coldRead(entry, now, c.deps.scan);
    expect(c.scans()).toBe(1);
  });

  it('starts no scan while the pulse runs', () => {
    const entry = freshCacheEntry();
    const c = counting(entry);
    watchEntry(entry, 1, c.deps);
    const scans = c.scans();
    coldRead(entry, T0 + 60_000, c.deps.scan);
    expect(c.scans()).toBe(scans);
  });

  it('bounds cold reads by their own start where the scan time stays old', () => {
    // A fleet-owned scan stamps `at` with the bridge's older time.
    const entry = freshCacheEntry();
    const c = counting(entry, () => T0 - 600_000);
    coldRead(entry, T0, c.deps.scan);
    coldRead(entry, T0 + 1_000, c.deps.scan);
    expect(c.scans()).toBe(1);
  });
});
