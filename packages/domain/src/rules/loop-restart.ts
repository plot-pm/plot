/**
 * Whether a running worker loop replaces its own process image.
 *
 * Pure and synchronous: every fact the answer depends on is a field of
 * {@link LoopRestartReadings}, read by the caller.
 */

/** What the caller read before it asks {@link restartAnswer}. */
export interface LoopRestartReadings {
  /**
   * `first` for the check before the loop's first pass; `later` for a check
   * between passes. The first check runs before the loop holds any state, so
   * it reads neither {@link inFreeWait}, {@link headContainsLoaded} nor the
   * memory.
   */
  phase: 'first' | 'later';
  /** Whether the loop waits for work: no branch assigned and no prompt running. Read by the later phase. */
  inFreeWait: boolean;
  /** Whether the main checkout is on the repository's default branch. */
  onDefaultBranch: boolean;
  /** Whether the main checkout's bundle paths hold no uncommitted change. */
  bundlePathsClean: boolean;
  /**
   * Whether the main checkout's `HEAD` contains the commit it was on when this
   * process started. Read by the later phase, where only `yes` counts: `no` is
   * a checkout that moved backwards, and `unknown` is not evidence that it
   * moved forwards.
   */
  headContainsLoaded: 'yes' | 'no' | 'unknown';
  /** The content hash of the main checkout's bundle; `''` where it could not be read. */
  pinnedHash: string;
  /** The content hash of the bundle this process runs. */
  loadedHash: string;
  /** This process's resident memory, in bytes. */
  residentBytes: number;
  /** Whether this Node has `process.execve`. */
  execveAvailable: boolean;
}

/** The resident size above which a loop in a free wait restarts: 300 MB. */
export const MEMORY_CEILING_BYTES = 300 * 1024 * 1024;

/** What {@link restartAnswer} decided. */
export type RestartVerdict =
  | {
      verdict: 'restart';
      /** `pinned` restarts on the main checkout's bundle; `running` restarts on the bundle this process runs. */
      bundle: 'pinned' | 'running';
      reason: string;
    }
  | { verdict: 'stay'; reason: string }
  | {
      /** A restart this Node cannot carry out; the caller logs it once per process. */
      verdict: 'stay-and-log';
      reason: string;
    };

const offersNewerBundle = (readings: LoopRestartReadings): boolean =>
  readings.pinnedHash !== '' &&
  readings.pinnedHash !== readings.loadedHash &&
  readings.onDefaultBranch &&
  readings.bundlePathsClean &&
  (readings.phase === 'first' || readings.headContainsLoaded === 'yes');

/**
 * Whether to restart this process, on which bundle, and why.
 *
 * A bundle restart needs all of: the main checkout on the default branch, its
 * bundle paths clean, a content hash that differs from the running bundle's,
 * and, for a later check, the checkout's `HEAD` containing the commit it was
 * on at start. A later check restarts only in a free wait. In a free wait
 * above {@link MEMORY_CEILING_BYTES} with no newer bundle, the answer restarts
 * on the running bundle. Where a restart is due and `execveAvailable` is
 * false, the answer is `stay-and-log`.
 *
 * @param readings - what the caller read.
 * @returns `restart` with the bundle to restart on, `stay`, or `stay-and-log`; each with a reason for the log.
 */
export const restartAnswer = (readings: LoopRestartReadings): RestartVerdict => {
  if (readings.phase === 'later' && !readings.inFreeWait) {
    return { verdict: 'stay', reason: 'not in a free wait' };
  }
  const newer = offersNewerBundle(readings);
  const overMemory = readings.phase === 'later' && readings.residentBytes > MEMORY_CEILING_BYTES;
  if (!newer && !overMemory) {
    return { verdict: 'stay', reason: 'no newer bundle and memory is within the ceiling' };
  }
  if (!readings.execveAvailable) {
    return {
      verdict: 'stay-and-log',
      reason: 'process.execve is not available on this Node, so the loop cannot restart itself',
    };
  }
  if (newer) {
    return {
      verdict: 'restart',
      bundle: 'pinned',
      reason:
        readings.phase === 'first'
          ? "the main checkout's bundle differs from the one this loop loaded"
          : "the main checkout's HEAD moved forward onto a newer, clean bundle",
    };
  }
  return {
    verdict: 'restart',
    bundle: 'running',
    reason: `resident memory ${readings.residentBytes} bytes passed the ${MEMORY_CEILING_BYTES} byte ceiling`,
  };
};
