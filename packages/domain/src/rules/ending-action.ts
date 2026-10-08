import type { EndingReason } from '../entities/ending.js';
import type { CommitReading } from './sample.js';

/**
 * What one tick read of a desk whose worker ended, for {@link endingAction}
 * alone to answer.
 *
 * **THE DESK, NOT THE REGISTRY.** The same reason `FreshAgentReadings`
 * (`rules/fresh-agent.ts`) reads the desk rather than an agent entry: a
 * manifest is gone by the time a worker's loop has ended, and a rule keyed on
 * a registry entry never sees this ending at all.
 */
export interface EndingActionReadings {
  /** The ending this desk's worker wrote, or `null` where none was written or it could not be read. */
  readonly ending: EndingReason | null;
  /** The branch the ending names. */
  readonly branch: string;
  /**
   * The assignment a take-up refused because the desk held unlanded work, as
   * the ending recorded it; `''` for every other ending.
   */
  readonly refusedAssignment: string;
  /**
   * Whether a manifest already names this desk.
   *
   * **A DESK THE TICK IS ABOUT TO START IS NOT A DESK WITH NO MANIFEST.**
   * Mirrors `FreshAgentReadings.hasManifest`'s own reasoning: the ending and
   * the manifest's removal are not one atomic write, so a desk a start
   * already has in flight answers `leave` for every reason — acting on the
   * ending here would race that start.
   */
  readonly hasManifest: boolean;
  /**
   * How many fresh sessions this slice already had, from
   * `.plot/state/fresh-agents.tsv`, counted across every ending reason —
   * the same count {@link FreshAgentReadings} and
   * {@link FreshAgentTurnLimitReadings} already shared before this file took
   * over their rows.
   *
   * **A MISSING OR UNREADABLE RECORD IS `0`, NEVER A REFUSAL AND NEVER A
   * SECOND SESSION'S PROOF.** Absence can start one session too many; it
   * must never be read as *this slice already had one*, which would strand
   * it at a person for a record this estate never wrote.
   */
  readonly priorFreshSessions: number;
  /**
   * Whether the branch holds a commit beyond its claim, or an open PR —
   * `nothing-done`'s own two readings, carried here rather than re-asked.
   *
   * `commitBeyondClaim: 'unanswerable'` takes the same branch as `'yes'`:
   * releasing a claim on a failed git read is the destructive direction.
   */
  readonly commitBeyondClaim: CommitReading;
  /**
   * Whether an open pull request still carries the branch; `'unanswerable'`
   * where the host could not be asked, which takes the same arm as `true`.
   */
  readonly prOpen: PrOpenReading;
}

/** Whether an open PR carries a branch, or `'unanswerable'` where the host could not be asked. */
export type PrOpenReading = boolean | 'unanswerable';

/**
 * What the supervisor's tick should do about a desk whose worker ended.
 *
 * - `release-claim` — a claim is this tick's to release through
 *   `ClaimRelease`; {@link endingReleaseBranch} names which. For
 *   `nothing-done` it is the ending's branch, which holds no commit beyond
 *   the claim and no open PR. For a take-up `holding-work` it is the refused
 *   assignment, which the desk never started.
 * - `start-fresh` — the first fresh session this slice has had, for
 *   `corrections-spent`, `turn-limit`, or an after-prompt `holding-work`
 *   (one that refused no assignment, or refused its own branch).
 * - `needs-a-person` — a second fresh session would be owed on the same
 *   slice, whichever of the three endings above asks for it. One fresh
 *   session per slice, shared across every ending reason that can trigger
 *   one — never one allowance per reason.
 * - `leave` — every other case, including a desk a manifest already names,
 *   and the default where no row of this table answers otherwise: `bound`,
 *   `quiet`, `unreadable`, `spent`, `unstarted`, `limited`, `unregistered`,
 *   `blocked`, `checks-unanswered`, `run-limit`, `spend-limit`, and a
 *   take-up `holding-work` whose desk never started.
 */
export type EndingActionVerdict = 'release-claim' | 'start-fresh' | 'needs-a-person' | 'leave';

/** The three ending reasons that can earn a slice one fresh session. */
const FRESH_SESSION_ENDINGS = new Set<EndingReason>(['corrections-spent', 'turn-limit']);

/**
 * Whether a `holding-work` ending came from a take-up that refused an
 * assignment other than the desk's own branch.
 *
 * An assignment equal to the ending's branch is the desk's own branch, so
 * releasing it would reach the unlanded work the ending reports.
 */
const takeUpRefused = (readings: EndingActionReadings): boolean =>
  readings.refusedAssignment !== '' && readings.refusedAssignment !== readings.branch;

/**
 * Decides what the supervisor's tick should do about a desk whose worker
 * ended: `release-claim` for `nothing-done` and for a take-up `holding-work`;
 * `start-fresh` or `needs-a-person` for `corrections-spent`, `turn-limit`,
 * and an after-prompt `holding-work`; `leave` for everything else.
 *
 * **THE LOOP ENDS, THE TICK RELEASES, AND THE TICK STARTS.** `agentLoop`
 * cannot tell a live peer from itself, and `releaseClaim` refuses an
 * `agent-live` read from the manifests — so an ending only ever names what to
 * do; this rule's verdict is the tick's instruction, never a release or a
 * session already performed.
 *
 * **A MANIFEST-NAMED DESK ANSWERS `leave` FOR EVERY REASON.** The ending and
 * the manifest's removal are not one atomic write, so a desk a start already
 * has in flight must not have its claim released, or a second session
 * started, out from under it.
 *
 * **ONE FRESH SESSION PER SLICE, SHARED ACROSS THREE ENDINGS.**
 * `corrections-spent`, `turn-limit`, and an after-prompt `holding-work` (one
 * that refused no assignment, or refused its own branch) all draw on the same
 * {@link EndingActionReadings.priorFreshSessions} count: the first one of the
 * three a slice reaches answers `start-fresh`, and any of the three reached
 * afterward — on the same slice, whichever ending — answers `needs-a-person`.
 * A take-up `holding-work` is not in this set: it answers `release-claim`
 * from {@link takeUpRefused} before the fresh-session rows are reached at all.
 *
 * **ABSENT IS NOT FALSE.** A missing or unreadable ending answers `leave`;
 * `commitBeyondClaim: 'unanswerable'` takes the same arm as `'yes'` and
 * `prOpen: 'unanswerable'` the same arm as `true`, for the same reason
 * `priorFreshSessions` reads `0` rather than refusing — a failed read must
 * never point toward the destructive or escalating action.
 *
 * Pure: it reads no disk and holds nothing between calls.
 *
 * @param readings - what the tick measured of one desk.
 * @returns what the tick should do about it.
 */
export const endingAction = (readings: EndingActionReadings): EndingActionVerdict => {
  if (readings.hasManifest) return 'leave';
  if (readings.ending === 'holding-work') {
    if (takeUpRefused(readings)) return 'release-claim';
    return readings.priorFreshSessions > 0 ? 'needs-a-person' : 'start-fresh';
  }
  if (readings.ending !== null && FRESH_SESSION_ENDINGS.has(readings.ending)) {
    return readings.priorFreshSessions > 0 ? 'needs-a-person' : 'start-fresh';
  }
  if (readings.ending !== 'nothing-done') return 'leave';
  if (readings.commitBeyondClaim !== 'no') return 'leave';
  if (readings.prOpen !== false) return 'leave';
  return 'release-claim';
};

/**
 * The branch whose claim a `release-claim` answer from {@link endingAction}
 * releases.
 *
 * @param readings - the same readings {@link endingAction} answered.
 * @returns the refused assignment for a take-up `holding-work` ending, and
 *   the ending's own branch for every other ending.
 */
export const endingReleaseBranch = (readings: EndingActionReadings): string =>
  readings.ending === 'holding-work' ? readings.refusedAssignment : readings.branch;

/**
 * Composes the one fresh session's answer for an after-prompt `holding-work`
 * ending: commit, check, and push the work the prompt left behind, naming
 * every file the desk still holds.
 *
 * **NOT `freshAgentAnswer` OR `freshAgentTurnLimitAnswer`, BECAUSE NEITHER
 * FITS.** Nothing was spent and no run failed — the desk simply never landed
 * what a prompt left in its tree, so this names the held files instead of a
 * correction history or a run that does not exist for this ending.
 *
 * **THE FILES ARE A VALUE, NEVER A READ THIS FUNCTION TAKES ITSELF.** The
 * same purity {@link freshAgentAnswer} and {@link freshAgentTurnLimitAnswer}
 * keep: the tick takes a live `Trees.dirtyPaths` read of the desk and hands
 * the result here as `heldFiles`, so a restarted supervisor composes the same
 * answer from the same files rather than this function reaching the
 * worktree on its own.
 *
 * **`null` IS NOT `[]`.** An unreadable listing composes a line saying the
 * files could not be listed; an empty array composes no file at all — never
 * answers the fresh session with silence where disk gave no answer.
 *
 * @param branch - the branch the desk holds.
 * @param heldFiles - every dirty path `Trees.dirtyPaths` read for this desk,
 *   or `null` where the read failed.
 * @returns the answer, ready to hand to a continuation alongside its brief.
 */
export const holdingWorkAnswer = (branch: string, heldFiles: readonly string[] | null): string => {
  const parts: string[] = [
    `The previous session on \`${branch}\` left work uncommitted or unpushed: commit it, run the checks it touches, and push before you do anything else.`,
    '',
  ];
  parts.push('## Files this desk still holds', '');
  if (heldFiles === null) {
    parts.push('The held files could not be listed — read the worktree yourself before starting.');
  } else if (heldFiles.length === 0) {
    parts.push('No file was listed as held, though the ending reported unlanded work — read the worktree yourself before starting.');
  } else {
    parts.push(...heldFiles.map((file) => `- ${file}`));
  }
  return parts.join('\n');
};
