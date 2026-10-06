/**
 * Whether a running worker loop replaces its own process image.
 *
 * Pure and synchronous: every fact the answer depends on is a field of
 * {@link LoopRestartReadings}, read by the caller.
 */

/** What the caller read before it asks {@link restartAnswer}. */
export interface LoopRestartReadings {
  /** `first` for the check before the loop's first pass; `later` for a check between passes. */
  phase: 'first' | 'later';
  /** Whether the loop waits for work: no branch assigned and no prompt running. Read by the later phase. */
  inFreeWait: boolean;
  /** Whether the main checkout is on the repository's default branch. */
  onDefaultBranch: boolean;
  /** Whether the main checkout's script paths, the bundle among them, hold no uncommitted or untracked change. */
  scriptPathsClean: boolean;
  /**
   * Whether the main checkout's `HEAD` contains the newest commit that changed
   * the running bundle. `no` is a main checkout behind the running bundle or
   * moved backwards; `unknown` is not evidence either way.
   */
  headContainsRunning: 'yes' | 'no' | 'unknown';
  /** The content hash of the main checkout's bundle; `''` where it could not be read. */
  pinnedHash: string;
  /** The content hash of the bundle this process loaded. */
  loadedHash: string;
  /** The content hash of the running bundle's file now; `''` where it could not be read. */
  runningHashNow: string;
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
      /** A restart was due and something blocks it; the caller logs each reason once per process. */
      verdict: 'stay-and-log';
      reason: string;
    };

/** Why the main checkout's differing bundle may not be used; `null` where nothing blocks it. */
const pinnedBlock = (readings: LoopRestartReadings): string | null => {
  if (!readings.onDefaultBranch) return 'the main checkout is not on the default branch';
  if (!readings.scriptPathsClean) return "the main checkout's script paths hold uncommitted changes";
  if (readings.headContainsRunning === 'no') {
    return "the main checkout's HEAD does not contain the running bundle's commit: it is behind it or moved backwards";
  }
  if (readings.headContainsRunning === 'unknown') {
    return "it cannot be read whether the main checkout's HEAD contains the running bundle's commit";
  }
  return null;
};

/**
 * Whether to restart this process, on which bundle, and why.
 *
 * A restart on the main checkout's bundle needs all of: a content hash that
 * differs from the loaded one, the default branch, clean script paths, and
 * `HEAD` containing the newest commit that changed the running bundle. A
 * later check restarts only in a free wait. In a free wait above
 * {@link MEMORY_CEILING_BYTES} with no usable newer bundle, the answer
 * restarts on the running bundle, and only while its file still holds the
 * loaded content.
 *
 * `stay-and-log` names a restart that was due and is blocked: a differing
 * main bundle that a condition rules out, a main bundle that cannot be read,
 * a running bundle that changed on disk, or a Node without `process.execve`.
 *
 * @param readings - what the caller read.
 * @returns `restart` with the bundle to restart on, `stay`, or `stay-and-log`; each with a reason for the log.
 */
export const restartAnswer = (readings: LoopRestartReadings): RestartVerdict => {
  if (readings.phase === 'later' && !readings.inFreeWait) {
    return { verdict: 'stay', reason: 'not in a free wait' };
  }
  const differs = readings.pinnedHash !== '' && readings.pinnedHash !== readings.loadedHash;
  const block = differs ? pinnedBlock(readings) : null;
  const newer = differs && block === null;
  const overMemory = readings.phase === 'later' && readings.residentBytes > MEMORY_CEILING_BYTES;
  if (!newer && !overMemory) {
    if (block !== null) return { verdict: 'stay-and-log', reason: `the main checkout's bundle differs, but ${block}` };
    if (readings.pinnedHash === '') return { verdict: 'stay-and-log', reason: "the main checkout's bundle cannot be read" };
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
  if (readings.runningHashNow !== readings.loadedHash) {
    return {
      verdict: 'stay-and-log',
      reason: 'resident memory passed the ceiling, but the running bundle changed on disk since this loop loaded it',
    };
  }
  return {
    verdict: 'restart',
    bundle: 'running',
    reason: `resident memory ${readings.residentBytes} bytes passed the ${MEMORY_CEILING_BYTES} byte ceiling`,
  };
};
