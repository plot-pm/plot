/**
 * Whether a waiting loop should replace its own process image.
 *
 * The board ran a day and a half on the code it loaded at start and kept a
 * repair that had already been retired on `main` — the JS loop lives as long
 * as its agent, so a bundle rebuilt after it started is invisible to it until
 * something restarts the process. This rule is the "something": given what
 * the caller read of the main checkout, the running bundle, the memory and the
 * platform, it answers once per pass whether to stay, restart, or stay and log
 * a reason.
 *
 * PURE AND SYNCHRONOUS. No port, no clock, no `process` read: every fact the
 * answer depends on is a field on {@link LoopRestartReadings}, taken as a value
 * by the caller. That is what makes the rule testable with plain objects and
 * covered by the domain's purity gate.
 */

/** What the caller read before asking whether to restart. */
export interface LoopRestartReadings {
  /**
   * Whether this is the check made before the loop's first pass, or a later
   * check made during a free wait.
   *
   * The first check asks a narrower question — only whether the main checkout
   * is clean and on the default branch, and whether its bundle differs from
   * the one already running. It runs before there is any wait to protect, so
   * it is the one exception to "restart only in a free wait".
   */
  phase: 'first' | 'later';
  /**
   * Whether the loop is currently in a free wait.
   *
   * Read for the LATER phase only. A prompt running, a checks wait and a
   * usage-limit wait all hold state a new process would have to rebuild, so a
   * later check outside a free wait never restarts — irrespective of what the
   * other readings say.
   */
  inFreeWait: boolean;
  /** Whether the main checkout's current branch is the repository's default. */
  onDefaultBranch: boolean;
  /** Whether the main checkout's bundle paths are clean — no uncommitted changes. */
  bundlePathsClean: boolean;
  /**
   * Whether the main checkout's `HEAD` contains the commit this loop loaded
   * its running bundle from.
   *
   * `unknown` where the caller's ancestry check could not answer — read for
   * the LATER phase only, and treated the same as `false`: absent is not
   * false, but a loop that cannot confirm the checkout moved FORWARD must not
   * restart on the strength of a hash alone. The first phase carries no
   * loaded commit yet, so it never reads this.
   *
   * `plot-ancestry: evidence` — handed on here as a reading rather than a
   * verdict; {@link restartAnswer} is what decides, and `unknown` is one of
   * the values it decides with.
   */
  headContainsLoaded: 'yes' | 'no' | 'unknown';
  /**
   * The pinned bundle's content hash, and the hash the running loop loaded —
   * equal when a rebuild produced byte-identical output.
   *
   * Content, never a version string or a timestamp: `main` rebuilds the
   * bundle after every merge, and a rebuild with identical content must not
   * restart a loop that is already running it.
   */
  pinnedHash: string;
  loadedHash: string;
  /** The loop's own resident memory, in bytes. */
  residentBytes: number;
  /** Whether `process.execve` exists on this Node — the one restart mechanism this rule may answer with. */
  execveAvailable: boolean;
}

/** The ceiling named in the plan: a loop above this resident size is a restart candidate regardless of the bundle. */
export const MEMORY_CEILING_BYTES = 300 * 1024 * 1024;

/** What {@link restartAnswer} decided, and why. */
export interface RestartVerdict {
  /**
   * `stay` — nothing to do. `restart` — replace the process image now.
   * `stay-and-log` — a condition that is worth a caller logging once (a failed
   * platform check, for instance) but keeps the process running.
   */
  verdict: 'stay' | 'restart' | 'stay-and-log';
  /** A sentence naming why, for the caller's log line. */
  reason: string;
}

/**
 * Whether the main checkout currently offers a bundle newer than the one
 * running — the fact BOTH phases ask, read differently by each.
 *
 * `unknown` ancestry is folded into `false` here, matching
 * {@link LoopRestartReadings.headContainsLoaded}'s own doc: the first phase never
 * reads ancestry (it carries no loaded commit yet) and so always passes this
 * leg; the later phase requires an explicit `yes`.
 */
const checkoutOffersNewerBundle = (readings: LoopRestartReadings): boolean => {
  if (readings.pinnedHash === readings.loadedHash) return false;
  if (!readings.onDefaultBranch || !readings.bundlePathsClean) return false;
  if (readings.phase === 'later' && readings.headContainsLoaded !== 'yes') return false;
  return true;
};

/**
 * Whether this loop's resident memory has passed {@link MEMORY_CEILING_BYTES}.
 *
 * Read for the LATER phase only, matching the plan: the ceiling restarts a
 * loop "while it waits for work", not before its first pass.
 */
const overMemoryCeiling = (readings: LoopRestartReadings): boolean =>
  readings.phase === 'later' && readings.inFreeWait && readings.residentBytes > MEMORY_CEILING_BYTES;

/**
 * Whether to replace this process's image, and why.
 *
 * THE FOUR LATER CONDITIONS ARE THE WHOLE RULE for a bundle-driven restart:
 * default branch, clean bundle paths, `HEAD` containing the loaded commit, and
 * a differing content hash. A main checkout that moved backwards, sits on
 * another branch, or carries a dirty bundle path triggers no restart, however
 * its hash compares — each is a failure the plan names explicitly (failure 5:
 * a process that keeps running old code because nothing above it ever asked).
 *
 * OUTSIDE A FREE WAIT, A LATER CHECK ANSWERS `stay` UNCONDITIONALLY. The
 * memory ceiling and the bundle check are both gated on `inFreeWait`, because
 * a prompt running, a checks wait and a usage-limit wait all hold state only
 * the next pass can rebuild.
 *
 * NO `process.execve` NEVER ANSWERS `restart`: a condition that would
 * otherwise restart falls through to `stay-and-log` instead, so a Node
 * without the primitive keeps running and the caller logs the gap once rather
 * than on every pass — the caller is what de-duplicates the line, since this
 * rule has no memory between calls.
 *
 * @param readings - what the caller read of the checkout, the wait, the
 *   memory and the platform.
 * @returns the verdict and a reason a log line can print.
 */
export const restartAnswer = (readings: LoopRestartReadings): RestartVerdict => {
  const newerBundle = checkoutOffersNewerBundle(readings);
  const overMemory = overMemoryCeiling(readings);

  if (readings.phase === 'later' && !readings.inFreeWait) {
    return { verdict: 'stay', reason: 'not in a free wait' };
  }

  if (!newerBundle && !overMemory) {
    return { verdict: 'stay', reason: 'no newer bundle and memory is within the ceiling' };
  }

  if (!readings.execveAvailable) {
    return {
      verdict: 'stay-and-log',
      reason: 'process.execve is not available on this Node, so the loop cannot restart itself',
    };
  }

  if (overMemory) {
    return {
      verdict: 'restart',
      reason: `resident memory ${readings.residentBytes} bytes passed the ${MEMORY_CEILING_BYTES} byte ceiling`,
    };
  }

  return {
    verdict: 'restart',
    reason:
      readings.phase === 'first'
        ? "the main checkout's bundle differs from the one this loop loaded"
        : "the main checkout's HEAD moved forward onto a newer, clean bundle",
  };
};
