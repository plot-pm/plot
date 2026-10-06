import type { BranchState } from '../entities/fleet.js';

/*
 * THE ONE PLACE A BRANCH'S STATE IS DECIDED.
 *
 * `transitions/branch.ts` sits beside this file and judges a MOVE between two
 * derived states. This derives them. The two are the pair the story asks for:
 * one says what a branch is, one says which change of that is legal.
 *
 * The precedence below is `plot-fleet-scan.sh`'s, taken from its branches
 * rather than from a summary of them, and stated here as testable order rather
 * than as the order of an `if`.
 */

/**
 * What the host was able to say when the scan asked whether a branch merged.
 *
 * THREE ANSWERS, NOT TWO, and the third is the whole reason this rule takes
 * readings rather than booleans. `plot-fleet-scan.sh` distinguishes a question
 * that was never put from one that went unanswered — *"a question that was not
 * put is not a question that went unanswered"* — and the two produce different
 * states.
 *
 * `unasked`   no host configured, or `--offline`. Nothing was lost, so a
 *             branch with no other evidence stays `open`.
 * `throttled` a spent quota, `secondary` a secondary rate limit, `failed` a
 *             transport error. The question was put and went unanswered, so
 *             the scan holds no evidence either way and the branch is
 *             `unknown`.
 *
 * `secondary` gates like the other two: its faster recovery changes what an
 * operator should DO, never how much evidence this scan holds.
 */
export type HostReach = 'ok' | 'unasked' | 'throttled' | 'secondary' | 'failed';

/**
 * What the host said about a branch's pull request, including the two ways it
 * can say nothing.
 *
 * `none`       the host answered, and no pull request exists for the branch.
 * `unreadable` the host could not be asked, or its reply could not be parsed —
 *              the scan's `-`. NOT the same as `none`: absence of an answer is
 *              not an answer of absence.
 */
export type PrReading = 'OPEN' | 'MERGED' | 'CLOSED' | 'none' | 'unreadable';

/**
 * One prerequisite a plan's `waits:` annotation names, and what the host said
 * about it.
 */
export interface WaitsReading {
  /** The branch this one waits on, as the plan named it. */
  branch: string;
  /** What the host said about that branch's pull request. */
  pr: PrReading;
  /**
   * Whether the branch is in `namedSlices` of the whole plan estate: a slice
   * that is not deferred, of a plan whose phase is not terminal. `false` for a
   * name no plan contains, a deferred slice, and a slice of a delivered,
   * released, rejected or superseded plan.
   */
  namedSlice: boolean;
}

/** The phases after which a plan starts no further slice. */
const TERMINAL_PHASES: ReadonlySet<string> = new Set([
  'delivered',
  'released',
  'rejected',
  'superseded',
]);

/** One plan as `namedSlices` reads it. */
export interface PlanSlices {
  /** The plan's phase, as `plot-plan-meta.sh` spells it (lower case). */
  phase: string;
  /** Every slice the plan names, with the plan's `deferred:` flag. */
  slices: readonly { branch: string; deferred: boolean }[];
}

/**
 * The slices somebody may still start: the set `WaitsReading.namedSlice` is
 * read from.
 *
 * A branch is in the set when a plan in a non-terminal phase names it as a
 * slice and does not defer it. An `idea/` branch and a name whose last segment
 * holds a dot are not slices: the first carries a plan, the second is a file
 * path. The caller passes every plan of the estate, never one plan.
 *
 * @param plans - every plan of the estate.
 * @returns the branch names.
 */
export const namedSlices = (plans: readonly PlanSlices[]): Set<string> =>
  new Set(
    plans
      .filter((plan) => !TERMINAL_PHASES.has(plan.phase))
      .flatMap((plan) => plan.slices)
      .filter((s) => !s.deferred && !s.branch.startsWith('idea/'))
      .filter((s) => !/\.[^/]*$/.test(s.branch))
      .map((s) => s.branch),
  );

/**
 * What was measured of ONE branch, from the four sources that can answer.
 *
 * Every field is a reading rather than a judgement. Who took them is the
 * caller's business, which is what keeps this rule pure and callable with no
 * adapter in scope — the shape `rules/reapable.ts` already uses.
 *
 * ABSENCE IS SPELT, NOT IMPLIED. `refTip` is `null` for a branch with no remote
 * ref, `hostReach` names which of the three silences applies, and `pr` carries
 * `unreadable` apart from `none`. A shell `case` holds those apart by care; a
 * typed reading holds them apart by construction, and that is the reason the
 * derivation is worth moving at all.
 */
export interface BranchReadings {
  /**
   * Whether the plan annotates this branch `deferred:`.
   *
   * A STATEMENT, NOT A MEASUREMENT, and it outranks everything git says —
   * somebody gave the branch up. `plot-fleet-scan.sh:3454` applies it at the
   * call site, outside `branch_state()`; here it is the first rule, which is
   * the same precedence written where it can be tested.
   */
  deferredByPlan: boolean;
  /** The remote ref's object id, or `null` when no remote ref exists. */
  refTip: string | null;
  /** The default branch's remote object id, or `null` when it cannot be read. */
  mainTip: string | null;
  /**
   * Whether the default branch carries a conforming merge commit naming this
   * branch — the evidence that survives a deleted ref.
   *
   * Read only where there is no ref. See {@link branchState} for why it may not
   * be consulted before the ref check.
   */
  mergeSubjectFound: boolean;
  /** How far the host got when asked about this repository's pull requests. */
  hostReach: HostReach;
  /** What the host said about this branch's own pull request. */
  pr: PrReading;
  /**
   * Whether the host's pull request list held every pull request of the
   * repository, so that `none` for this branch rules out a merged one. `false`
   * for a list cut at its limit, an empty list, or no list.
   */
  prListComplete: boolean;
  /**
   * Commits this branch carries that the default branch lacks — every commit,
   * claim markers included.
   */
  commitsAhead: number;
  /**
   * Of those, the ones that are real work: a claim marker is titled
   * `plot: claim …` AND empty, and both facts are required. A human commit
   * titled `plot: claim handling refactor` carrying files is real work.
   * `realCommits` in `empty-claim.ts` holds the definition.
   */
  realCommitsAhead: number;
  /** Every prerequisite the plan names, empty where it names none. */
  waits: readonly WaitsReading[];
}

/**
 * What the prerequisites mean for the branch waiting on them.
 *
 * `MERGED`                    cleared — the annotation stops mattering, and
 *                             the branch keeps the state its own readings
 *                             earned.
 * `none`, not `namedSlice`   `blocked`: the host has no pull request for the
 *                             name, and no live plan will start it — no plan
 *                             names it, its plan defers it, or its plan is
 *                             delivered, released, rejected or superseded. It
 *                             resolves by editing the plan that waits.
 * `none`, `namedSlice`        `waiting`: a slice nobody has started yet. Its
 *                             pull request opens when its work starts.
 * everything else             `waiting`. A CLOSED pull request counts here —
 *                             the host has seen the branch, so the name is
 *                             right; somebody withdrew the work. `unreadable`
 *                             counts here too: silence is neither permission
 *                             to start nor proof of a typo.
 *
 * A slice of a terminal plan whose pull request merged reads `MERGED` and
 * clears, the same as any other merged prerequisite: `namedSlice` decides only
 * what `none` means.
 *
 * `blocked` OUTRANKS `waiting`, in either order: a typo among several
 * prerequisites needs a plan edit and no merge clears it. An empty list clears,
 * the same as every member reading `MERGED`.
 *
 * @param waits - every prerequisite the plan names, with its readings.
 * @returns `blocked`, `waiting`, or `null` where every prerequisite merged.
 */
export const waitVerdict = (waits: readonly WaitsReading[]): BranchState | null => {
  if (waits.some((w) => w.pr === 'none' && !w.namedSlice)) return 'blocked';
  if (waits.some((w) => w.pr !== 'MERGED')) return 'waiting';
  return null;
};

/**
 * The states a prerequisite may replace.
 *
 * `deferred` outranks it — somebody gave the branch up, which is a decision,
 * while waiting is a measurement — and so does any state meaning work exists:
 * `wip`, `claimed` and `merged` all say the branch was started, and overriding
 * `merged` would stop its wave settling FOREVER, which is the blocked-on-success
 * failure the annotation exists to avoid.
 *
 * So the override lands exactly where the defect is: a branch that reads as
 * unstarted, which is the population `--next` hands out.
 *
 * EXPORTED BECAUSE READING A PREREQUISITE COSTS A HOST ROUND TRIP. The scan
 * spends one only where the answer could change the state, and that condition
 * is this list. A caller deciding it for itself would be a second copy of the
 * precedence in the one place a reader would never look for it, so the rule
 * says which states it may replace and nobody re-derives it.
 */
export const REPLACEABLE_BY_PREREQUISITE: readonly BranchState[] = ['open', 'unknown'];

/**
 * The branch's own state, before its plan's prerequisite is considered.
 *
 * @param readings - what was measured of the branch.
 * @returns one of the six states git and the host can produce.
 */
const ownState = (readings: BranchReadings): BranchState => {
  // THE REF CHECK STAYS IN FRONT. DO NOT HOIST THE MERGE LOOKUP ABOVE IT.
  //
  // A branch name can be reused: merge `bug/flaky`, delete it, then recreate it
  // for a second attempt. The FIRST attempt's merge subject is still on the
  // default branch, and it is now STALE EVIDENCE — it describes work that
  // landed, while the branch of that name carries new work that has not.
  //
  // The merge lookup is safe only BY PLACEMENT: it lives in the no-ref arm, and
  // a recreated branch has a ref, so it never reaches the lookup. Reading it
  // first looks like a cheap early answer and would report in-flight work as
  // `merged`, opening the next wave on it.
  if (readings.refTip === null) {
    // No ref carries two meanings: a branch never started, and a branch merged
    // with its ref deleted at merge. The wave arithmetic reads `open` as
    // OUTSTANDING, so answering `open` for both means a finished wave never
    // completes and `--next` names finished work as the next thing to start.
    //
    // Positive evidence only. Where none exists — a squash merge, a
    // hand-rewritten subject, a branch genuinely never started — `open` stands.
    if (readings.mergeSubjectFound) return 'merged';
    // The local walk is out of evidence, so the host is asked. It may only ever
    // move this branch from `open` to `merged`: a miss, a CLOSED pull request,
    // or a host that could not answer all fall through.
    if (readings.pr === 'MERGED') return 'merged';
    // `open` IS A CLAIM ABOUT A PULL REQUEST: that one was looked for and none
    // was found. With no ref the host is the only remaining source, so where it
    // could not be asked that claim was never earned.
    //
    // `unknown` is OUTSTANDING exactly as `open` is, so no wave verdict moves
    // and an unreachable host still answers *not merged*. What it changes is
    // CLAIMABILITY: `--next` offers `open` branches, so an `unknown` branch is
    // not handed out — which is right, because *nobody has started this* is
    // precisely the claim that went unverified.
    //
    // GATED ON THE THREE FAILURES ONLY, never on "not ok". See {@link HostReach}.
    if (
      readings.hostReach === 'throttled'
      || readings.hostReach === 'secondary'
      || readings.hostReach === 'failed'
    ) {
      return 'unknown';
    }
    return 'open';
  }

  if (readings.commitsAhead > 0) {
    // A CLAIM is a branch whose only commits beyond the default branch are
    // claim markers — empty commits a dispatcher pushed to take the work. They
    // must be real commits and not a bare pointer at the default branch: two
    // branches pointing at one commit do not diverge, so both pushes succeed
    // and both sides think they hold the claim.
    if (readings.realCommitsAhead === 0) return 'claimed';
    // Real work the default branch does not contain: `wip`, and only `wip`.
    // Ancestry is not asked here and must not be: a branch carrying a commit
    // the default branch lacks cannot be an ancestor of it, so the question is
    // already answered by the count above.
    //
    // A RESURRECTED REF BREAKS THAT PREMISE, and the host is what closes it.
    // `delete_branch_on_merge` removes the ref at merge, and a worktree still
    // holding the branch can push it back — the ref then exists again while the
    // work sits on the default branch under a DIFFERENT commit, because a
    // squash merge rewrites it. Measured 2026-08-23:
    // `bug/done-holds-finished-plans-only`, pull request #356 merged, read
    // `wip` for three hours and its wave never completed.
    //
    // ONLY `MERGED` MAY OVERRIDE, and only toward `merged`. `OPEN` means a pull
    // request exists for work still in flight, which is what `wip` already
    // says; `CLOSED`, `none` and `unreadable` are not evidence that anything
    // landed.
    if (readings.pr === 'MERGED') return 'merged';
    return 'wip';
  }

  // Nothing of its own. NOT a claim: that shape is indistinguishable from
  // merged work, which is why claims carry a commit.
  if (readings.refTip === readings.mainTip) {
    // It points AT the default branch: no work of its own, and none of its own
    // landed.
    return 'open';
  }
  // Behind the default branch, or the default branch unreadable. Ancestry does
  // not separate landed work from a ref cut at an older tip of the default
  // branch, so the host's answer decides.
  if (readings.mainTip === null) return 'unknown';
  if (readings.pr === 'MERGED') return 'merged';
  // With no host, ancestry is the only merge signal there is.
  if (readings.hostReach === 'unasked') return 'merged';
  if (
    readings.hostReach === 'throttled'
    || readings.hostReach === 'secondary'
    || readings.hostReach === 'failed'
    || readings.pr === 'unreadable'
  ) {
    return 'unknown';
  }
  if (readings.pr === 'OPEN') return 'wip';
  // `none` and `CLOSED`: no pull request for this branch merged. A capped list
  // cannot rule out a merged one outside its window.
  return readings.prListComplete ? 'open' : 'unknown';
};

/**
 * The state a branch is in, from what was read of it.
 *
 * THE PRECEDENCE, HIGHEST FIRST — and it is the deliverable rather than the
 * order of an `if`:
 *
 * 1. **A plan's `deferred:` beats everything git says.** Somebody gave the
 *    branch up. It is a decision, not a measurement, and no merge state
 *    overturns it.
 * 2. **The branch's own readings**, in the order {@link ownState} states: the
 *    ref before the merge subject, the claim count before the work count, the
 *    tip comparison before the host's answer.
 * 3. **A prerequisite's state beats `open` and `unknown`, and nothing else.**
 *    A branch carrying work, a claim or a merge keeps the state its work
 *    earned.
 *
 * `unknown` MARKS AN ABSENT READING, NEVER AN EMPTY ONE. A host that was never
 * asked leaves `open`; a host that was asked and could not answer leaves
 * `unknown`. The two are different inputs here — see {@link HostReach} — so
 * they cannot be conflated by accident.
 *
 * @param readings - what was measured of the branch.
 * @returns one of the eight states in {@link BranchState}.
 */
export const branchState = (readings: BranchReadings): BranchState => {
  if (readings.deferredByPlan) return 'deferred';

  const own = ownState(readings);

  if (readings.waits.length > 0 && REPLACEABLE_BY_PREREQUISITE.includes(own)) {
    const verdict = waitVerdict(readings.waits);
    if (verdict !== null) return verdict;
  }

  return own;
};
