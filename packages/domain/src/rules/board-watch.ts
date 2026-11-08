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
