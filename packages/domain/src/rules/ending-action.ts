import type { EndingReading, EndingReason } from '../entities/ending.js';
import type { CommitReading } from './sample.js';

/**
 * What one tick read of a desk whose worker ended, for {@link endingAction}
 * alone to answer.
 *
 * **THE DESK, NOT THE REGISTRY.** A manifest is gone by the time a worker's
 * loop has ended, so a rule keyed on a registry entry never sees this ending
 * at all.
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
   * The ending and the manifest's removal are not one atomic write, so a
   * desk a start already has in flight answers `leave` for every reason —
   * acting on the ending here would race that start.
   */
  readonly hasManifest: boolean;
  /**
   * How many fresh sessions this slice already had, from
   * `.plot/state/fresh-agents.tsv`, counted across every ending reason.
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
  /**
   * Whether the host merged a PR for the branch; `'unanswerable'` where the
   * host could not be asked, which takes the same arm as `'not-merged'`.
   *
   * Read by the five outright `needs-a-person` rows only: a merged slice
   * answers `leave` there, because a marker on a merged desk reaches no
   * person and refuses the reap.
   */
  readonly prMerged: PrMergedReading;
  /**
   * Whether a person was already asked about this very ending: a record of
   * an earlier ask names the same plan, branch and ending time.
   *
   * A `needs-a-person` answer becomes `leave` where this is true. The answer
   * a person gives deletes the `PLOT-BLOCKED.md` marker and leaves the ending
   * file, so the marker cannot say whether the ending was already asked
   * about. A missing or unreadable record is `false`.
   */
  readonly endingAsked: boolean;
}

/** Whether an open PR carries a branch, or `'unanswerable'` where the host could not be asked. */
export type PrOpenReading = boolean | 'unanswerable';

/** Whether the host merged a PR for a branch, or `'unanswerable'` where the host could not be asked. */
export type PrMergedReading = 'merged' | 'not-merged' | 'unanswerable';

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
 * - `needs-a-person` — either a second fresh session would be owed on the
 *   same slice (whichever of `corrections-spent`, `turn-limit`, or an
 *   after-prompt `holding-work` asks for it — one fresh session per slice,
 *   shared across every ending reason that can trigger one, never one
 *   allowance per reason), or the ending is one of `blocked`, `spend-limit`,
 *   `unstarted`, `run-limit`, `checks-unanswered` — none of which earns a
 *   fresh session at all; a person is asked the first time any of these five
 *   is seen, unless the branch's PR merged. Either way, at most once per
 *   ending: an ending a person was already asked about answers `leave`.
 * - `leave` — every other case, including a desk a manifest already names,
 *   and the default where no row of this table answers otherwise: `bound`,
 *   `quiet`, `unreadable`, `spent`, `limited`, `unregistered`, and a take-up
 *   `holding-work` whose desk never started.
 */
export type EndingActionVerdict = 'release-claim' | 'start-fresh' | 'needs-a-person' | 'leave';

/**
 * The two ending reasons that earn a slice one fresh session without a
 * condition; `holding-work`, the third, earns one only after a prompt.
 */
const FRESH_SESSION_ENDINGS = new Set<EndingReason>(['corrections-spent', 'turn-limit']);

/**
 * The five ending reasons that go straight to a person, never a fresh
 * session.
 *
 * Unlike {@link FRESH_SESSION_ENDINGS}, none of these draws on
 * {@link EndingActionReadings.priorFreshSessions} — a broken invocation
 * (`unstarted`), a budget already spent (`spend-limit`, `run-limit`), an
 * unanswered build (`checks-unanswered`), or an agent that already said it
 * could not proceed (`blocked`) is not made right by starting the slice over,
 * so the first tick that sees one of these asks a person rather than
 * spending a fresh session on it.
 */
export const NEEDS_PERSON_ENDINGS: ReadonlySet<EndingReason> = new Set<EndingReason>([
  'blocked',
  'spend-limit',
  'unstarted',
  'run-limit',
  'checks-unanswered',
]);

/**
 * Whether an ending is one of the five {@link NEEDS_PERSON_ENDINGS}, whose
 * `needs-a-person` answer reads {@link EndingActionReadings.prMerged}.
 *
 * @param ending - the desk's ending reason, or `null` where none was read.
 * @returns true for `blocked`, `spend-limit`, `unstarted`, `run-limit` and
 *   `checks-unanswered`; false for every other reason and for `null`.
 */
export const endingAsksPersonOutright = (ending: EndingReason | null): boolean =>
  ending !== null && NEEDS_PERSON_ENDINGS.has(ending);

/**
 * Whether a `holding-work` ending came from a take-up that refused an
 * assignment other than the desk's own branch.
 *
 * An assignment equal to the ending's branch is the desk's own branch, so
 * releasing it would reach the unlanded work the ending reports.
 */
const takeUpRefused = (refusedAssignment: string, branch: string): boolean =>
  refusedAssignment !== '' && refusedAssignment !== branch;

/**
 * Decides what the supervisor's tick should do about a desk whose worker
 * ended: `release-claim` for `nothing-done` and for a take-up `holding-work`;
 * `start-fresh` or `needs-a-person` for `corrections-spent`, `turn-limit`,
 * and an after-prompt `holding-work`; `needs-a-person` outright for `blocked`,
 * `spend-limit`, `unstarted`, `run-limit`, and `checks-unanswered`; `leave`
 * for everything else.
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
 * **ONE ASK PER ENDING.** Every `needs-a-person` answer becomes `leave`
 * where {@link EndingActionReadings.endingAsked} says a person was already
 * asked about this ending. An outright `needs-a-person` ending answers
 * `leave` where {@link EndingActionReadings.prMerged} is `'merged'`.
 *
 * **ABSENT IS NOT FALSE.** A missing or unreadable ending answers `leave`;
 * `commitBeyondClaim: 'unanswerable'` takes the same arm as `'yes'` and
 * `prOpen: 'unanswerable'` the same arm as `true`, `prMerged: 'unanswerable'`
 * the same arm as `'not-merged'`, for the same reason
 * `priorFreshSessions` reads `0` rather than refusing — a failed read must
 * never point toward the destructive or escalating action.
 *
 * Pure: it reads no disk and holds nothing between calls.
 *
 * @param readings - what the tick measured of one desk.
 * @returns what the tick should do about it.
 */
export const endingAction = (readings: EndingActionReadings): EndingActionVerdict => {
  const verdict = endingTableAnswer(readings);
  return verdict === 'needs-a-person' && readings.endingAsked ? 'leave' : verdict;
};

/** The table {@link endingAction} answers from, before the already-asked guard. */
const endingTableAnswer = (readings: EndingActionReadings): EndingActionVerdict => {
  if (readings.hasManifest) return 'leave';
  if (readings.ending === 'holding-work') {
    if (takeUpRefused(readings.refusedAssignment, readings.branch)) return 'release-claim';
    return readings.priorFreshSessions > 0 ? 'needs-a-person' : 'start-fresh';
  }
  if (readings.ending !== null && FRESH_SESSION_ENDINGS.has(readings.ending)) {
    return readings.priorFreshSessions > 0 ? 'needs-a-person' : 'start-fresh';
  }
  if (endingAsksPersonOutright(readings.ending)) {
    return readings.prMerged === 'merged' ? 'leave' : 'needs-a-person';
  }
  if (readings.ending !== 'nothing-done') return 'leave';
  if (readings.commitBeyondClaim !== 'no') return 'leave';
  if (readings.prOpen !== false) return 'leave';
  return 'release-claim';
};

/**
 * Whether a desk's ending is one {@link endingAction} answers `start-fresh`
 * for while the slice has had no fresh session: `corrections-spent`,
 * `turn-limit`, or an after-prompt `holding-work`, written for `branch`.
 *
 * A fresh start reads this as its precondition in place of a `PLOT-BLOCKED`
 * marker. `holding-work` and `turn-limit` end with no marker in the tree, so
 * a precondition that asks only for a marker refuses every such start.
 *
 * @param ending - the desk's `.plot-worker.ending.json`, read as a value.
 * @param branch - the branch the start is for.
 * @returns true where the ending was read, names `branch`, and is one of the
 *   three; false for an absent or unreadable ending, another branch, a
 *   take-up `holding-work`, and every other reason.
 */
export const endingAsksFreshStart = (ending: EndingReading, branch: string): boolean => {
  if (ending.read !== 'ended' || ending.ending.branch !== branch) return false;
  const { reason, refusedAssignment } = ending.ending;
  if (reason === 'holding-work') return !takeUpRefused(refusedAssignment, branch);
  return FRESH_SESSION_ENDINGS.has(reason);
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

/**
 * Composes the `PLOT-BLOCKED.md` text for a slice that reached
 * `corrections-spent`, `turn-limit` or an after-prompt `holding-work` after
 * its one fresh session already ran.
 *
 * @param ending - the ending reason the slice reached again.
 * @param branch - the branch the desk holds.
 * @returns the marker text, ready for `Desk.writeBlockedMarker`.
 */
export const secondFreshSessionMarker = (ending: EndingReason, branch: string): string =>
  `The slice on \`${branch}\` already had its one fresh session (${ending}) and reached it again. Decide how it should proceed.`;

/**
 * Composes the `PLOT-BLOCKED.md` text for any ending {@link endingAction}
 * answers `needs-a-person` for, naming the reason and the one decision a
 * person owes it.
 *
 * **ONE SENTENCE OF DECISION PER REASON, NOT ONE SHARED SENTENCE.** A broken
 * invocation is fixed by a different hand than a spent budget: `unstarted`
 * names a prompt or command to repair, `spend-limit` and `run-limit` name
 * money or a run count already spent and ask whether to continue, and
 * `checks-unanswered` names a build that never answered. Collapsing these
 * into one sentence would read correctly for none of them.
 *
 * **`checks-unanswered` READS `detail`,** because the ending's own two
 * readings — `no-answer` and `tip-moved` — are different problems: the first
 * is a build nobody watched, the second is work a later push shadowed. No
 * other reason here branches on `detail`.
 *
 * **`corrections-spent`, `turn-limit` AND `holding-work` COMPOSE
 * {@link secondFreshSessionMarker}.** Those three answer `needs-a-person`
 * only after a fresh session already ran, so their question is a different
 * one.
 *
 * @param ending - the ending reason; one of {@link NEEDS_PERSON_ENDINGS} or
 *   the three fresh-session endings, or it throws.
 * @param branch - the branch the desk holds.
 * @param detail - the ending's own `detail`, verbatim.
 * @returns the marker text, ready for `Desk.writeBlockedMarker`.
 */
export const needsPersonMarker = (ending: EndingReason, branch: string, detail: string): string => {
  switch (ending) {
    case 'unstarted':
      return (
        `The worker on \`${branch}\` never ran a slice: its command exited before doing any work ` +
        `(${detail || 'no detail was recorded'}). Decide: fix the prompt or command this worker launches, then restart it.`
      );
    case 'spend-limit':
      return (
        `The worker on \`${branch}\` stopped on a spend limit (${detail || 'no detail was recorded'}). ` +
        `A fresh session would spend against the same slice. Decide: raise the spend limit, or leave this slice as it stands.`
      );
    case 'run-limit':
      return (
        `The worker on \`${branch}\` stopped on a run limit (${detail || 'no detail was recorded'}): the slice has used every run it was allowed. ` +
        `Decide: raise the run limit, or leave this slice as it stands.`
      );
    case 'checks-unanswered':
      return detail.includes('tip-moved')
        ? `No build ever answered for \`${branch}\`'s own work: the branch's remote tip moved to a commit this worker did not push (${detail}). ` +
            `Decide: whether the newer commit is this worker's to continue from, or someone else's.`
        : `No build ever answered for \`${branch}\` (${detail || 'no detail was recorded'}): the wait for CI ran out with nothing from the build connector. ` +
            `Decide: whether to wait longer, check the build connector, or resume without a CI answer.`;
    case 'blocked':
      return (
        `The worker on \`${branch}\` reported it could not proceed (${detail || 'no detail was recorded'}). ` +
        `Decide how it should proceed, or close out the slice.`
      );
    case 'corrections-spent':
    case 'turn-limit':
    case 'holding-work':
      return secondFreshSessionMarker(ending, branch);
    default:
      throw new Error(`needsPersonMarker does not compose for ending "${ending}"`);
  }
};
