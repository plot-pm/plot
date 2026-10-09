import { supervisorState, type SupervisorRun } from './supervisor-reading.js';

/**
 * How old a bridged pulse may be while the fleet still counts as the scan's owner.
 *
 * Twice the scan's 90 s budget: a healthy fleet writes at least every
 * budget plus one beat, and a second missed scan is the first reading that
 * cannot be a slow one.
 */
export const OWNED_BRIDGE_MAX_AGE_MS = 180_000;

/** What decides who scans. */
export interface ScanOwnerReadings {
  /** One run of the supervisor reading; `undefined` where it has not run. */
  supervisor: SupervisorRun | undefined;
  /** Epoch ms the bridged pulse was written, or `null` where there is none. */
  bridgeAt: number | null;
  /** Epoch ms now. */
  now: number;
}

/**
 * Whether the fleet owns the scan, so the board reads the bridge and spawns none.
 *
 * True only when two facts agree: the supervisor reads `up`, and the bridge was
 * written within {@link OWNED_BRIDGE_MAX_AGE_MS}. Either alone is not enough.
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
  if (supervisorState(readings.supervisor) !== 'up') return false;
  const age = readings.now - readings.bridgeAt;
  return age >= 0 && age <= OWNED_BRIDGE_MAX_AGE_MS;
};
