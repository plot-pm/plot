import { supervisorState, type SupervisorRun } from './supervisor-reading.js';

/**
 * How old a bridged pulse may be while the fleet still counts as the scan's owner.
 *
 * Twice the scan's 90 s budget: a healthy fleet writes at least every
 * budget plus one beat, and a second missed scan is the first reading that
 * cannot be a slow one.
 */
export const OWNED_BRIDGE_MAX_AGE_MS = 180_000;

/**
 * How long after its last scan attempt STARTED the fleet still counts as the
 * scan's owner while its bridge is older than {@link OWNED_BRIDGE_MAX_AGE_MS}.
 *
 * Twice the scan's 90 s budget (`FLEET_SCAN_BUDGET_MS`): a fleet that is still
 * trying starts the next attempt within one budget plus one beat of the last.
 */
export const OWNED_ATTEMPT_MAX_AGE_MS = 180_000;

/** What decides who scans. */
export interface ScanOwnerReadings {
  /** One run of the supervisor reading; `undefined` where it has not run. */
  supervisor: SupervisorRun | undefined;
  /** Epoch ms the bridged pulse was written, or `null` where there is none. */
  bridgeAt: number | null;
  /**
   * Epoch ms the fleet's last scan attempt started, or `null`/absent where the
   * bridge records none.
   */
  lastAttemptStartedAt?: number | null;
  /** Epoch ms now. */
  now: number;
}

/**
 * Whether the fleet owns the scan, so the board reads the bridge and spawns none.
 *
 * True only when two facts agree: the supervisor reads `up` or `unknown` (it
 * could not be asked, or the run was cut short), and the bridge was written
 * within {@link OWNED_BRIDGE_MAX_AGE_MS} OR the fleet's last scan attempt
 * started within {@link OWNED_ATTEMPT_MAX_AGE_MS} (it is mid-scan, or between
 * scans, and about to write a fresh bridge). Either alone is not enough. A reading
 * that resolves to `down` or `died` hands the scan to the board.
 * A loaded supervisor with a stale bridge is a daemon that hangs, and the board
 * scans in its place; a fresh bridge with no supervisor is the last write of a
 * daemon that stopped. The board's own scan writes nothing, so taking over
 * from a hung fleet cannot corrupt the bridge.
 *
 * @param readings - the supervisor run, the bridge's write time and the clock.
 * @returns true when the board must not scan.
 */
export const fleetOwnsScan = (readings: ScanOwnerReadings): boolean => {
  if (readings.supervisor === undefined || readings.bridgeAt === null) return false;
  const state = supervisorState(readings.supervisor);
  if (state !== 'up' && state !== 'unknown') return false;
  if (bridgeIsFresh(readings.bridgeAt, readings.now)) return true;
  const started = readings.lastAttemptStartedAt;
  if (started === null || started === undefined) return false;
  const sinceStart = readings.now - started;
  return sinceStart >= 0 && sinceStart <= OWNED_ATTEMPT_MAX_AGE_MS;
};

/**
 * Whether a bridge was written within {@link OWNED_BRIDGE_MAX_AGE_MS}.
 *
 * @param bridgeAt - epoch ms of the bridged pulse, or `null` where there is none.
 * @param now - epoch ms now.
 * @returns false with no bridge, for a bridge from the future, and past the bound.
 */
export const bridgeIsFresh = (bridgeAt: number | null, now: number): boolean => {
  if (bridgeAt === null) return false;
  const age = now - bridgeAt;
  return age >= 0 && age <= OWNED_BRIDGE_MAX_AGE_MS;
};

/** What a bridge file shows about its writer. */
export interface BridgeWriterReadings {
  /** Epoch ms of the bridged pulse, or `null` where there is none. */
  bridgeAt: number | null;
  /**
   * Whether the bridge carries a fact the fleet reads on its own timers: a
   * branch age, an approval date, an idea plan or a branch URL base. The
   * scan's own write carries none of them.
   */
  carriesTimerFacts: boolean;
  /** Epoch ms now. */
  now: number;
}

/**
 * Whether the fleet's writer holds the bridge, so a pulse leaves it alone.
 *
 * True when the bridge is fresh and carries a timer fact, which only the
 * fleet's `writeScan` writes. A missing, stale or thin bridge has no live
 * writer, and a pulse that records writes it.
 *
 * @param readings - the bridge's time, whether it carries timer facts, and the clock.
 * @returns true when a pulse must not write the bridge.
 */
export const fleetHoldsBridge = (readings: BridgeWriterReadings): boolean =>
  readings.carriesTimerFacts && bridgeIsFresh(readings.bridgeAt, readings.now);

/** What the board shows while the fleet owns a bridge older than its freshness bound. */
export interface OwnedBridgeNoteReadings {
  /** Epoch ms the bridged pulse was written. */
  bridgeAt: number;
  /** The fleet's last scan attempt, or `null` where the bridge records none. */
  attempt: { startedAt: number; outcome: 'running' | 'ok' | 'failed'; error: string | null } | null;
  /** Epoch ms now. */
  now: number;
}

/**
 * The sentence the board shows instead of starting a second scan.
 *
 * Names the bridge's age and, where the fleet's last attempt failed, that
 * failure. `null` while the bridge is fresh: nothing is amiss to report.
 *
 * @param readings - the bridge's write time, the last attempt and the clock.
 * @returns the note, or `null` when the bridge is within {@link OWNED_BRIDGE_MAX_AGE_MS}.
 */
export const ownedBridgeNote = (readings: OwnedBridgeNoteReadings): string | null => {
  if (bridgeIsFresh(readings.bridgeAt, readings.now)) return null;
  const seconds = Math.round((readings.now - readings.bridgeAt) / 1000);
  const base = `the fleet's last scan landed ${seconds} s ago and its next is under way`;
  const attempt = readings.attempt;
  if (attempt !== null && attempt.outcome === 'failed') {
    return `${base}; its last attempt failed: ${attempt.error ?? 'no reason recorded'}`;
  }
  return base;
};
