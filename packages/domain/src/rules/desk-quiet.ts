/**
 * How long a desk has been quiet, read from the newest of its live signals.
 */

/** The desk's AgentMonitor log, which fleetd and the worker wrapper write. */
export const AGENT_FINDINGS_FILE = '.plot-worker.monitor.agent.jsonl';

/** The desk's worker log, which the worker loop writes. */
export const DESK_LOG_FILE = '.plot-worker.log';

/**
 * The times, in epoch milliseconds, at which a desk's four live signals last
 * changed. A signal that could not be read is `null` or absent.
 */
export interface DeskQuietReadings {
  /** The mtime of `.plot-worker.pass`. */
  readonly passMs?: number | null;
  /** The mtime of `.plot-worker.monitor.agent.jsonl`. */
  readonly monitorMs?: number | null;
  /** The committer time of the desk's HEAD commit. */
  readonly headMs?: number | null;
  /** The mtime of `.plot-worker.log`. */
  readonly logMs?: number | null;
}

/**
 * Answers the age of the newest readable signal.
 *
 * @param readings - the signals' times; an absent or `null` time is skipped.
 * @param nowMs - the current time in epoch milliseconds.
 * @returns the age in whole seconds, 0 for a time in the future; `null`
 *   where no signal could be read.
 */
export const deskQuietSeconds = (readings: DeskQuietReadings, nowMs: number): number | null => {
  const times = [readings.passMs, readings.monitorMs, readings.headMs, readings.logMs].filter(
    (time): time is number => typeof time === 'number' && Number.isFinite(time),
  );
  if (times.length === 0) return null;
  return Math.max(0, Math.floor((nowMs - Math.max(...times)) / 1000));
};
