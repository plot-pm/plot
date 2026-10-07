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
  /** The commit the agent pushed — the desk's `HEAD` at the time it pushed. */
  readonly pushedSha: string;
  /**
   * The run `BuildPort.runForSha(branch, pushedSha)` answered, already
   * unwrapped: `null` for a branch with no runs at all, and `unknown` is
   * carried through {@link ChecksFromRunsReadings.tip} rather than here — a
   * connector that answers `unaskable` reads as no different from one that has
   * not run yet, because neither is evidence the pushed commit failed.
   *
   * IS FOR `pushedSha` OR IS `null`. `runForSha` answers only for the sha it
   * was asked about, never another commit's run, so {@link ShaRun.sha} here
   * always equals `pushedSha` when `run` is non-null.
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
 * - `none`: waiting is disabled (`Checks wait` is `0` or less); no wait
 *   starts. The same answer {@link checksVerdict} gives for that bound.
 * - `wait`: the run for the pushed commit has no conclusion yet, and the tip
 *   is still that commit (or unreadable this pass). Keep waiting.
 * - `settled`: the run for the pushed commit concluded. The caller reads
 *   {@link ShaRun.conclusion} to decide pass or fail.
 * - `no-answer`: the wait reached `Checks wait` with nothing conclusive.
 * - `tip-moved`: the remote tip is no longer the pushed commit. The wait ends
 *   even inside the bound, because no build this loop could read would be
 *   about the agent's own work.
 */
export type ChecksFromRuns = 'none' | 'wait' | 'settled' | 'no-answer' | 'tip-moved';

/**
 * Decides one pass of the loop's own CI wait, from the build connector's run
 * for the pushed commit and the branch's remote tip.
 *
 * THE TIP IS CHECKED FIRST, AND THE COMPARISON IS EQUALITY. `other` ends the
 * wait even with no run at all and even inside the bound, because no build
 * this loop could read would be about the agent's own work (#1199).
 *
 * **A RUN IS EVIDENCE ONLY FOR ITS OWN SHA.** {@link BuildPort.runForSha}
 * answers only for the sha it was asked about, so in practice `run.sha`
 * always equals `pushedSha` here. This rule still reads {@link ShaRun.sha}
 * rather than assuming it: a run for any other commit is read as no run at
 * all, the same answer a connector that has not started one yet gives.
 *
 * `unknown` NEVER ENDS THE WAIT AS `tip-moved`. A tip that could not be read
 * this pass is not evidence it moved, so the wait continues and the next pass
 * tries again. At `Checks wait` it ends `no-answer`, as any wait with nothing
 * conclusive does.
 *
 * A BOUND OF `0` OR LESS ANSWERS `none` before any other reading, as
 * {@link checksVerdict} does: no wait starts.
 *
 * @param readings - what the loop measured this pass.
 * @returns the verdict for this pass.
 */
export const checksFromRuns = (readings: ChecksFromRunsReadings): ChecksFromRuns => {
  if (readings.boundSeconds <= 0) return 'none';
  if (readings.tip === 'other') return 'tip-moved';

  const run = readings.run !== null && readings.run.sha === readings.pushedSha ? readings.run : null;

  if (run !== null && run.conclusion !== null && SETTLED_CONCLUSIONS.includes(run.conclusion)) {
    return 'settled';
  }

  return readings.waitedSeconds >= readings.boundSeconds ? 'no-answer' : 'wait';
};

/** The BuildMonitor finding words, verbatim as `FindingNameSchema` carries them. */
export type BuildFindingWord = 'build passed' | 'build failed' | 'build needs approval';

/** One pass's build finding: the word to publish and the evidence sentence behind it. */
export interface BuildFindingAnswer {
  readonly finding: BuildFindingWord;
  readonly evidence: string;
}

/**
 * Translates a run's status and conclusion into the finding the BuildMonitor
 * used to publish, in the same three words and the same evidence shape.
 *
 * MIRRORS `sample_finding` (`plot-build-monitor.sh:327`), MINUS ITS FIRST ARM.
 * The shell decides `head moved` before reading a conclusion, because
 * `monitor_run_for_sha` can answer about a sha other than the one asked. This
 * loop's `run` reading already excludes that case — {@link checksFromRuns}
 * discards a run whose sha is not `pushedSha` before this is ever called — so
 * there is no `head moved` arm here: the reading this function receives is
 * never about a stale commit.
 *
 * `action_required` is checked in both fields, as the shell's combined
 * `status:conclusion` case did, because a run awaiting approval has reported
 * it in either place depending on where the run sits.
 *
 * **NARROWER THAN THE SHELL ON `build failed`.** `sample_finding` reads any
 * terminal conclusion other than `success`/`action_required` — including
 * `timed_out`, `cancelled`, `startup_failure` — as `build failed`. This
 * function does not, because {@link SETTLED_CONCLUSIONS} (shared with
 * {@link checksFromRuns}) only names `success`/`failure`/`action_required` as
 * settled; the loop's own call site never reaches a `timed_out` or
 * `cancelled` run through `buildFindingFor` — `checksFromRuns` keeps it at
 * `wait`/`no-answer` instead. A documented gap, not ported here.
 *
 * @param run - the settled run `checksFromRuns` found for the pushed sha.
 * @returns the finding and its evidence sentence, or `null` while the run has
 *   not reached a word this function recognises (expected for a run
 *   `checksFromRuns` itself does not call `settled` — see above).
 */
export const buildFindingFor = (run: ShaRun): BuildFindingAnswer | null => {
  const url = run.url || 'an unknown url';
  if (run.status === 'waiting' || run.status.includes('action_required') || run.conclusion === 'action_required') {
    return {
      finding: 'build needs approval',
      evidence: `the run at ${url} for ${run.sha} is waiting for a manual approval before it can start`,
    };
  }
  if (run.conclusion === 'success') {
    return { finding: 'build passed', evidence: `the run at ${url} for ${run.sha} concluded success` };
  }
  if (run.conclusion !== null && SETTLED_CONCLUSIONS.includes(run.conclusion)) {
    return { finding: 'build failed', evidence: `the run at ${url} for ${run.sha} concluded ${run.conclusion}` };
  }
  return null;
};
