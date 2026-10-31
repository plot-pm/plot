import {
  createPulse,
  divisorFor,
  ISSUE_REFRESH_MS,
  startPulse,
  type FleetReading,
  type ReaderClaim,
  type RunningPulse,
} from '@plot-pm/domain';
import type { Clock } from '@plot-pm/domain/ports/clock';
import type { ReaderLock } from '@plot-pm/domain/ports/reader-lock';

import type { FleetState, ScanAttempt } from '@plot-pm/domain/ports/fleet-state';

import { processStartedAt } from './board-run.js';
import { prGateOpen, refreshPrs, resolveBackend, type PrState, type PrWorld } from './pr-refresh.js';
import { PR_REFRESH_MS, REFRESH_MS, scanOnce, writeScan, type ScanState, type ScanWorld } from './fleet-scan.js';

/**
 * The fleet's three subscribers and the divisor each counts by.
 *
 * Derived from the base beat, never written down: `12` is right only while the
 * base is 5 s, and `divisorFor` reads it off `REFRESH_MS`, `PR_REFRESH_MS` and
 * `ISSUE_REFRESH_MS`.
 *
 * @returns the scan at every beat, the PR reader at every twelfth, the
 *   issue reader at every twenty-fourth, and the issue-write drain at every beat.
 */
export const fleetDivisors = (): { name: string; everyNthBeat: number }[] => {
  const base = createPulse(REFRESH_MS, 0);
  return [
    { name: 'fleet-scan', everyNthBeat: divisorFor(base, REFRESH_MS) },
    { name: 'pr-reader', everyNthBeat: divisorFor(base, PR_REFRESH_MS) },
    { name: 'issue-reader', everyNthBeat: divisorFor(base, ISSUE_REFRESH_MS) },
    { name: 'issue-writes', everyNthBeat: divisorFor(base, REFRESH_MS) },
  ];
};

/** What the fleet's clock runs on each of its beats. */
export interface FleetClockWork {
  /** One scan, writing the bridge on success. Never called while one is in flight. */
  scan: () => Promise<void>;
  /** One PR refresh behind its cadence gate. Never called while one is in flight. */
  prs?: () => Promise<void>;
  /** One issue refresh behind its own cadence gate. Never called while one is in flight. */
  issues?: () => Promise<void>;
  /** One drain of the tracker writes Plot made into the issue index. Never called while one is in flight. */
  issueWrites?: () => Promise<void>;
}

/** The fleet's running clock: the pulse, plus a wait for the runs it started. */
export interface RunningFleetClock extends RunningPulse {
  /**
   * Resolves once no scan and no PR refresh is in flight. A run's own
   * children and writes, such as the automatic writes after a scan, end
   * before it resolves. Call it after `stop()`, so no new beat starts a run.
   */
  idle: () => Promise<void>;
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
 * @param work - what each subscriber runs. A rejection is contained and
 *   warned: it ends that run and leaves the guard open for the next beat.
 * @param warn - receives a one-line reason when a subscriber's run rejects.
 * @returns the running pulse; `stop()` cancels its beats, and `idle()`
 *   resolves once every run already started has ended.
 */
export const startFleetClock = (
  clock: Clock,
  work: FleetClockWork,
  warn: (line: string) => void = () => undefined,
): RunningFleetClock => {
  const pulse = startPulse(clock, REFRESH_MS);
  const running = new Set<Promise<void>>();
  const guarded = (name: string, run: () => Promise<void>): (() => Promise<void>) => {
    let inFlight = false;
    return () => {
      if (inFlight) return Promise.resolve();
      inFlight = true;
      const current = (async () => {
        try {
          await run();
        } catch (e) {
          warn(`plot-fleetd: ${name} failed: ${e instanceof Error ? e.message : String(e)}\n`);
        } finally {
          inFlight = false;
        }
      })();
      running.add(current);
      void current.finally(() => running.delete(current));
      return current;
    };
  };
  const ticks: Record<string, () => Promise<void>> = {
    'fleet-scan': guarded('fleet-scan', work.scan),
    'pr-reader': guarded('pr-reader', work.prs ?? (async () => undefined)),
    'issue-reader': guarded('issue-reader', work.issues ?? (async () => undefined)),
    'issue-writes': guarded('issue-writes', work.issueWrites ?? (async () => undefined)),
  };
  for (const { name, everyNthBeat } of fleetDivisors()) {
    pulse.add({ name, everyNthBeat, tick: ticks[name] });
  }
  const idle = async (): Promise<void> => {
    while (running.size > 0) await Promise.all([...running]);
  };
  return { ...pulse, idle };
};

/**
 * Re-writes the last good bridge with only its `attempt` changed.
 *
 * A bridge that is missing or expired has no pulse to carry, so nothing is
 * written; the board scans in that state as it always has. A failed read or
 * write costs the record, never the scan.
 */
const recordAttempt = async (fleetState: FleetState, attempt: ScanAttempt): Promise<void> => {
  const current = await fleetState.read();
  if (!current.ok || current.value === null) return;
  await fleetState.write({ ...current.value, attempt });
};

/**
 * Builds the scan the fleet's clock runs: one scan that records nothing of its own, then the bridge.
 *
 * The bridge is written only after `scanOnce` returns. A scan that throws or
 * ends without a terminal pulse line leaves the previous bridge file untouched.
 *
 * @param world - what the scan reads through.
 * @param fleetState - the bridge port; the fleet is its only writer.
 * @param state - the cost caches, adopted by `scanOnce` on success only.
 * @param now - reads the clock for the bridge's `at`.
 * @param warn - receives a one-line reason when a scan or a write fails.
 * @param prError - reads the PR reader's last failure sentence, bridged beside
 *   the pulse. Required: a caller that drops it would bridge `null` while the
 *   PR reader fails.
 * @param after - runs with the pulse the scan just wrote, on a successful scan
 *   only. A scan that throws or whose bridge write is refused never calls it,
 *   so no automatic write acts on a pulse that did not land.
 * @returns the function to hand to {@link startFleetClock} as `scan`.
 */
export const fleetScan = (
  world: ScanWorld,
  fleetState: FleetState,
  state: ScanState,
  now: () => number,
  warn: (line: string) => void,
  prError: () => string | null,
  after?: (pulse: FleetReading) => Promise<void>,
): (() => Promise<void>) => async () => {
  let landed: FleetReading | null = null;
  const startedAt = now();
  await recordAttempt(fleetState, { startedAt, endedAt: null, outcome: 'running', error: null });
  try {
    const result = await scanOnce(world, state, { record: false });
    if (await writeScan(fleetState, result, now(), prError(), startedAt)) landed = result.reading;
    else warn('plot-fleetd: bridge write refused\n');
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    warn(`plot-fleetd: scan failed: ${reason}\n`);
    await recordAttempt(fleetState, { startedAt, endedAt: now(), outcome: 'failed', error: reason });
  }
  if (landed !== null && after) await after(landed);
};

/** The reader lock a PR pass elects under. */
export interface PrLock {
  /** The reader lock port; `readerLockFile` in production. */
  lock: ReaderLock;
  /**
   * The name this process heartbeats under: `fleetd` where absent, and
   * `reader.<pid>` for the standalone PR reader.
   */
  name?: string;
}

/** This process's reader-election claim, built fresh for every `elect` call. */
const ownClaim = (now: number): ReaderClaim => ({
  generation: 0,
  pid: process.pid,
  startedAt: processStartedAt(process.pid) ?? Math.round(now - process.uptime() * 1000),
  at: now,
});

/** Maps a published reader state onto the fields a following process renders without asking the host. */
const adoptReaderState = (state: PrState, published: { prError: string | null; prNextAt: number; prNextIsBackoff: boolean; prFullReadFailedAt: number | null }): void => {
  state.prError = published.prError;
  state.prNextAt = published.prNextAt;
  state.prNextIsBackoff = published.prNextIsBackoff;
  state.prFullReadFailedAt = published.prFullReadFailedAt;
};

/**
 * Builds the PR pass the fleet's clock runs: an election for this machine's
 * one PR reader, one host read behind the cadence gate, folded into the PR
 * index.
 *
 * ELECTS BEFORE THE GATE. A beat that lost the election asks the host
 * nothing and touches no store, whatever the cadence says — the gate decides
 * when THE READER refreshes, not whether this process is it.
 *
 * `held` skips the rest of the pass after the heartbeat: no host call, no
 * store touch, no reader-state write. A process newly electing adopts the current holder's published cadence and
 * failure state once, the moment it becomes the holder — `state.prAt ===
 * null` is that moment, a fresh process's own cold-start signal, checked
 * rather than trusting `elect`'s return word alone, because a holder that
 * renews every beat also reads `'elected'` on every call it already won.
 *
 * THE FOLD IS FENCED, NOT THE WHOLE PASS. `refreshPrs` re-reads the lock's
 * holder immediatly before the write that would otherwise race a takeover
 * mid-pass; losing that race skips only the fold, since the host was already
 * asked and that answer is still served.
 *
 * Every pass whose election answered publishes this process's heartbeat
 * under `prLock.name` (`fleetd` by default) before anything else, whether it
 * holds the lock or reads `held`. A `fleetd` that reads `held` against a
 * standalone reader is thereby visible to that reader, which exits and
 * releases the lock, and fleetd elects on its next pass. Every pass that holds
 * the lock and passes the gate also publishes this reader's cadence, so a
 * following board renders its latest reading without asking the host itself.
 *
 * A `failed` lock (its directory itself unwritable) skips the pass and warns
 * once per distinct cause, not once per beat, the same shape
 * `warnDefaultBranchOnce` in `registryd-main.ts` uses for its own repeating
 * condition.
 *
 * The lock's key is the connector `resolveBackend` resolves — `(realpath(common
 * git dir), connector)` once the adapter scopes it to this repository — read
 * before electing, the same key `writePrStore` already folds under.
 *
 * @param world - what the pass reaches; the fleet is the index's only writer.
 * @param state - the cadence, backoff and limit reading carried between passes.
 * @param prLock - the reader lock this pass elects under.
 * @param warn - receives a one-line reason when a pass throws or the lock fails.
 * @returns the function to hand to {@link startFleetClock} as `prs`.
 */
export const fleetPrs = (
  world: PrWorld,
  state: PrState,
  prLock: PrLock,
  warn: (line: string) => void,
): (() => Promise<void>) => {
  const now = world.now ?? Date.now;
  let lastFailureCause: string | null = null;
  const warnOnce = (cause: string, line: string): void => {
    if (cause === lastFailureCause) return;
    lastFailureCause = cause;
    warn(line);
  };
  return async () => {
    const key = await resolveBackend(state, world.host);
    const claim = ownClaim(now());
    const verdict = await prLock.lock.elect(key, claim);
    if (!verdict.ok) {
      warnOnce('elect-failed', `plot-fleetd: PR reader lock unavailable; skipping this pass\n`);
      return;
    }
    lastFailureCause = null;
    await prLock.lock.heartbeat(key, prLock.name ?? 'fleetd', now());
    if (verdict.value === 'held') return;
    if (state.prAt === null) {
      const published = await prLock.lock.readerState(key);
      if (published.ok && published.value !== null) adoptReaderState(state, published.value);
    }
    if (!prGateOpen(state.prNextAt, state.prNextIsBackoff)) return;
    try {
      await refreshPrs({ ...world, fenceFold: () => fenceFold(prLock, key) }, state);
    } catch (e) {
      warn(`plot-fleetd: PR read failed: ${e instanceof Error ? e.message : String(e)}\n`);
    }
    await prLock.lock.writeReaderState(key, {
      v: 1,
      prError: state.prError,
      prNextAt: state.prNextAt,
      prNextIsBackoff: state.prNextIsBackoff,
      prFullReadFailedAt: state.prFullReadFailedAt,
      at: now(),
    });
  };
};

/**
 * Whether this process still names the lock's holder, right before the fold
 * it fences. The pid alone decides it: any other live holder is by
 * construction a different process, and a claim this process itself
 * published under a later generation still carries this same pid.
 */
const fenceFold = async (prLock: PrLock, key: string): Promise<boolean> => {
  const held = await prLock.lock.holder(key);
  return held.ok && held.value !== null && held.value.pid === process.pid;
};
