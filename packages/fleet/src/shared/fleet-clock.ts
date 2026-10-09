import { createPulse, divisorFor, startPulse, type RunningPulse } from '@plot-pm/domain';
import type { Clock } from '@plot-pm/domain/ports/clock';

import type { FleetState } from '@plot-pm/domain/ports/fleet-state';

import { PR_REFRESH_MS, REFRESH_MS, scanOnce, writeScan, type ScanState, type ScanWorld } from './fleet-scan.js';

/**
 * The fleet's two subscribers and the divisor each counts by.
 *
 * Derived from the base beat, never written down: `12` is right only while the
 * base is 5 s, and `divisorFor` reads it off `REFRESH_MS` and `PR_REFRESH_MS`.
 *
 * @returns the scan at every beat and the PR reader at every twelfth.
 */
export const fleetDivisors = (): { name: string; everyNthBeat: number }[] => {
  const base = createPulse(REFRESH_MS, 0);
  return [
    { name: 'fleet-scan', everyNthBeat: divisorFor(base, REFRESH_MS) },
    { name: 'pr-reader', everyNthBeat: divisorFor(base, PR_REFRESH_MS) },
  ];
};

/** What the fleet's clock runs on each of its beats. */
export interface FleetClockWork {
  /** One scan, writing the bridge on success. Never called while one is in flight. */
  scan: () => Promise<void>;
  /** One PR refresh behind its cadence gate. Never called while one is in flight. */
  prs?: () => Promise<void>;
}

/**
 * Starts the fleet's own clock: the scan on every beat and the PR refresh on
 * every twelfth, apart from the supervision tick.
 *
 * Each subscriber has an in-flight guard. A scan has a 90 s budget against a
 * 5 s beat, so a beat that arrives while a scan runs is dropped rather than
 * queued: a slow scan never starts a second one, and it never delays the
 * supervision loop, which this clock does not share.
 *
 * @param clock - the beat source; a manual clock in tests.
 * @param work - what each subscriber runs. A rejection is contained: it ends
 *   that run and leaves the guard open for the next beat.
 * @returns the running pulse; `stop()` cancels it.
 */
export const startFleetClock = (clock: Clock, work: FleetClockWork): RunningPulse => {
  const pulse = startPulse(clock, REFRESH_MS);
  const guarded = (run: () => Promise<void>): (() => Promise<void>) => {
    let inFlight = false;
    return async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        await run();
      } catch {
        /* the run reports its own failure; the clock only survives it */
      } finally {
        inFlight = false;
      }
    };
  };
  const ticks: Record<string, () => Promise<void>> = {
    'fleet-scan': guarded(work.scan),
    'pr-reader': guarded(work.prs ?? (async () => undefined)),
  };
  for (const { name, everyNthBeat } of fleetDivisors()) {
    pulse.add({ name, everyNthBeat, tick: ticks[name] });
  }
  return pulse;
};

/**
 * Builds the scan the fleet's clock runs: one recorded scan, then the bridge.
 *
 * The bridge is written only after `scanOnce` returns. A scan that throws or
 * ends without a terminal pulse line leaves the previous bridge file untouched.
 *
 * @param world - what the scan reads through.
 * @param fleetState - the bridge port; the fleet is its only writer.
 * @param state - the cost caches, adopted by `scanOnce` on success only.
 * @param now - reads the clock for the bridge's `at`.
 * @param warn - receives a one-line reason when a scan or a write fails.
 * @returns the function to hand to {@link startFleetClock} as `scan`.
 */
export const fleetScan = (
  world: ScanWorld,
  fleetState: FleetState,
  state: ScanState,
  now: () => number,
  warn: (line: string) => void,
): (() => Promise<void>) => async () => {
  try {
    const result = await scanOnce(world, state, { record: true });
    if (!(await writeScan(fleetState, result, now()))) warn('plot-fleetd: bridge write refused');
  } catch (e) {
    warn(`plot-fleetd: scan failed: ${e instanceof Error ? e.message : String(e)}`);
  }
};
