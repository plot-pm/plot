/**
 * Whether an agent that finished a prompt still waits for its pull request's
 * checks.
 *
 * A failed build reaches its agent as a correction only while the agent holds
 * the slice. CI reports minutes after the push, so an agent that lets go of
 * the slice when its prompt ends never receives the failure. This rule keeps
 * the slice until the checks for the pushed head have a result, bounded by a
 * wait the caller configures.
 */

/** The BuildMonitor results that end the wait. */
export const SETTLED_FINDINGS: readonly string[] = ['build passed', 'build failed', 'build needs approval'];

/** One BuildMonitor finding, as the caller read it from the desk. */
export interface BuildFinding {
  /** The finding word, such as `build failed`. */
  readonly finding: string;
  /** The branch the monitor reported about. */
  readonly branch: string;
  /** The commit the finding is about, or `null` when its evidence names none. */
  readonly sha: string | null;
}

/** What the caller measured when it asks. */
export interface ChecksReadings {
  /** The branch the agent holds. */
  readonly branch: string;
  /** The desk's HEAD commit. */
  readonly head: string;
  /** Whether the branch's HEAD is on the remote. */
  readonly pushed: boolean;
  /** Whether an open pull request carries the branch. */
  readonly prOpen: boolean;
  /** The BuildMonitor's latest finding in the desk, or `null` when it has none. */
  readonly last: BuildFinding | null;
  /** Seconds the agent has waited so far. */
  readonly waitedSeconds: number;
  /** The longest wait allowed, in seconds; `0` disables the wait. */
  readonly boundSeconds: number;
}

/**
 * The answer.
 *
 * - `none`: no CI result is coming for this head (not pushed, no open PR, or
 *   waiting is disabled); the slice ends as it did before this rule.
 * - `wait`: the checks for this head have no result yet.
 * - `settled`: the BuildMonitor reported a result for this head; the caller's
 *   correction path reads it.
 * - `expired`: the wait reached its bound without a result.
 */
export type ChecksVerdict = 'none' | 'wait' | 'settled' | 'expired';

/**
 * The commit a BuildMonitor evidence sentence names.
 *
 * The monitor writes *"the run at <url> for <sha> concluded <conclusion>"*.
 *
 * @param evidence - the finding's `evidence` field.
 * @returns the sha, or `null` when the sentence has another shape.
 */
export const evidenceSha = (evidence: string): string | null => {
  const match = /\bfor ([0-9a-f]{7,40}) concluded\b/.exec(evidence);
  return match ? match[1] : null;
};

/**
 * Decides whether the agent waits for its checks.
 *
 * A finding about another branch, or about a commit other than the head, does
 * not settle the wait: the desk is reused across slices, and a run for an
 * older commit says nothing about the code the agent pushed last. A finding
 * whose evidence names no commit settles it, because discarding it would drop
 * every result the day the sentence changes shape.
 *
 * @param readings - what the caller measured.
 * @returns the verdict.
 */
export const checksVerdict = (readings: ChecksReadings): ChecksVerdict => {
  if (!readings.pushed || !readings.prOpen || readings.boundSeconds <= 0) return 'none';
  const last = readings.last;
  if (
    last !== null &&
    last.branch === readings.branch &&
    SETTLED_FINDINGS.includes(last.finding) &&
    (last.sha === null || last.sha === readings.head)
  ) {
    return 'settled';
  }
  return readings.waitedSeconds >= readings.boundSeconds ? 'expired' : 'wait';
};
