import type { ShaRun } from '../entities/build.js';

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

/**
 * The branch's remote tip, as the loop's CI wait compares it.
 *
 * THREE VALUES, AND THE COMPARISON IS EQUALITY, NOT ANCESTRY. `pushed` is the
 * tip the loop's own commit; `other` is a different commit — another party
 * pushed on top, as in #1199 where a person's `0e64fafd` landed on the agent's
 * `f743e573` — and the wait ends rather than settling on a stranger's build.
 * `unknown` is a failure to read the tip at all (the git call failed or timed
 * out), which is not evidence that the tip moved: the wait keeps going.
 */
export type RemoteTipReading = 'pushed' | 'other' | 'unknown';

/** What `checksFromRuns` needs to decide one pass of the loop's CI wait. */
export interface ChecksFromRunsReadings {
  /** The branch the agent holds. */
  readonly branch: string;
  /** The commit the agent pushed — the desk's `HEAD` at the time it pushed. */
  readonly pushedSha: string;
  /**
   * The run `BuildPort.runForSha(branch, pushedSha)` answered, already
   * unwrapped: `null` for a branch with no runs at all, and `unknown` is
   * carried through {@link ChecksFromRunsReadings.tip} rather than here — a
   * connector that answers `unaskable` reads as no different from one that has
   * not run yet, because neither is evidence the pushed commit failed.
   *
   * MAY NOT BE FOR `pushedSha`. `runForSha`'s documented fallback is the
   * branch's newest run when it holds none for the asked-for commit, and
   * {@link ShaRun.sha} says which one was found — `checksFromRuns` reads it
   * and treats a run for any other commit as no run at all.
   */
  readonly run: ShaRun | null;
  /** Whether the remote tip is still the pushed commit. */
  readonly tip: RemoteTipReading;
  /** Seconds the agent has waited so far. */
  readonly waitedSeconds: number;
  /** `Checks wait` in seconds; `0` disables the wait. */
  readonly boundSeconds: number;
}

/**
 * The run conclusions that settle the wait — the same three words
 * {@link SETTLED_FINDINGS} already carries, read from {@link ShaRun.conclusion}
 * rather than from a BuildMonitor finding.
 */
const SETTLED_CONCLUSIONS: readonly string[] = ['success', 'failure', 'action_required'];

/**
 * The answer to one pass of the loop's own CI wait.
 *
 * - `wait`: the run for the pushed commit has no conclusion yet, and the tip
 *   is still that commit (or unreadable this pass). Keep waiting.
 * - `settled`: the run for the pushed commit concluded. The caller reads
 *   {@link ShaRun.conclusion} to decide pass or fail.
 * - `no-answer`: the wait reached `Checks wait` with nothing conclusive.
 * - `tip-moved`: the remote tip is no longer the pushed commit. The wait ends
 *   even inside the bound, because no build this loop could read would be
 *   about the agent's own work.
 */
export type ChecksFromRuns = 'wait' | 'settled' | 'no-answer' | 'tip-moved';

/**
 * Decides one pass of the loop's own CI wait, from the build connector's run
 * for the pushed commit and the branch's remote tip.
 *
 * THE TIP IS CHECKED FIRST, AND THE COMPARISON IS EQUALITY. `other` ends the
 * wait even with no run at all and even inside the bound, because no build
 * this loop could read would be about the agent's own work (#1199).
 *
 * **A RUN IS EVIDENCE ONLY FOR ITS OWN SHA.** {@link BuildPort.runForSha}
 * falls back to the branch's newest run when it has none for the asked-for
 * commit, and {@link ShaRun.sha} says which run it found. A fallback run for
 * an older commit settles nothing about the pushed one — the tip reading
 * alone cannot rule this out, because the tip can still read `pushed` while
 * CI simply has not started a run for the new commit yet. So this rule reads
 * {@link ShaRun.sha} too, and a run for any other commit is the same as no
 * run at all.
 *
 * `unknown` NEVER ENDS THE WAIT. A tip that could not be read this pass is not
 * evidence it moved — the same reading-over-absence rule every other part of
 * this estate keeps — so the wait continues and the next pass tries again.
 *
 * @param readings - what the loop measured this pass.
 * @returns the verdict for this pass.
 */
export const checksFromRuns = (readings: ChecksFromRunsReadings): ChecksFromRuns => {
  if (readings.tip === 'other') return 'tip-moved';

  const run = readings.run !== null && readings.run.sha === readings.pushedSha ? readings.run : null;

  if (run !== null && run.conclusion !== null && SETTLED_CONCLUSIONS.includes(run.conclusion)) {
    return 'settled';
  }

  return readings.waitedSeconds >= readings.boundSeconds ? 'no-answer' : 'wait';
};
