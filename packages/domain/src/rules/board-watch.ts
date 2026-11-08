import type { ReaderVerdict } from './reader-election.js';

/** What the board server knows about who watches it. */
export interface BoardWatchReading {
  /** Event streams held open on `GET /api/events`. */
  clients: number;
}

/**
 * Whether the board runs its refresh pulse.
 *
 * A shown tab is an attached event stream, so the pulse runs while at least one
 * stream is attached and stops at zero.
 *
 * @param reading the number of attached event streams
 * @returns true while one or more streams are attached
 */
export const pulseWanted = ({ clients }: BoardWatchReading): boolean => clients > 0;

/** What a plain request knows about the board's last reads. */
export interface ColdReadReading {
  /** Whether the refresh pulse runs. */
  pulseRunning: boolean;
  /** Whether a scan is in progress. */
  scanning: boolean;
  /** When the last scan's answer is from, in milliseconds; null before the first. */
  lastScanAt: number | null;
  /** When the last cold read started, in milliseconds; null before the first. */
  lastColdReadAt: number | null;
  /** The request's time, in milliseconds. */
  now: number;
  /** The refresh period, in milliseconds. */
  refreshMs: number;
}

/**
 * Whether a plain request starts one scan.
 *
 * A request with no pulse running starts one scan when both the last scan and
 * the last cold read are at least `refreshMs` old, and never starts the pulse.
 * A running pulse or a scan in progress answers no. A clock that moved
 * backwards answers yes, since a negative gap proves nothing about recency.
 *
 * @param reading the pulse, the scan and the request time
 * @returns true when the request starts one scan
 */
export const coldReadDue = (reading: ColdReadReading): boolean => {
  if (reading.pulseRunning || reading.scanning) return false;
  const last = Math.max(reading.lastScanAt ?? -Infinity, reading.lastColdReadAt ?? -Infinity);
  const gap = reading.now - last;
  return gap < 0 || gap >= reading.refreshMs;
};

/** What the board knows when it decides whether to start this machine's PR reader. */
export interface ReaderWatchReading {
  /** Event streams held open on `GET /api/events`. */
  clients: number;
  /** The board's verdict over the reader lock. */
  verdict: ReaderVerdict;
  /** Whether a fresh `fleetd` heartbeat exists under the lock. */
  fleetdLive: boolean;
}

/**
 * Whether the board starts this machine's `plot-pr-reader.mjs`.
 *
 * The board starts the reader only while an event stream is attached, the lock
 * elects, and no live `fleetd` heartbeat already reads PRs. A plain request
 * with no stream attached starts no reader.
 *
 * @param reading the attached streams, the lock verdict and the fleetd heartbeat
 * @returns true when the board starts the reader
 */
export const readerWanted = ({ clients, verdict, fleetdLive }: ReaderWatchReading): boolean =>
  pulseWanted({ clients }) && verdict === 'elect' && !fleetdLive;
