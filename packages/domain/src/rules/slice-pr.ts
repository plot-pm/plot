/**
 * What opening a slice's pull request writes, and the four refusals that stop it.
 *
 * OPENING A PR WAS THE ACTION WITH NO CONTROLLER. Measured 2026-09-08, against
 * the nine endpoints the board already exposes: activating a sprint, approving
 * a plan, dispatching a slice and delivering a plan each had one and none was
 * used — and opening a PR had none to skip. Three were opened with
 * `gh pr create` that afternoon, and the sprint before, fifteen branches
 * carried finished work nobody could see because no PR was raised at all.
 *
 * A SLICE PR IS A LIFECYCLE EVENT, WHICH IS WHY IT NEEDS A RULE. The fleet scan
 * reads it, `plot-pr-merged.sh` reads it, the delivery gate reads it. An action
 * every reader depends on is not one to leave to whoever remembers the flag.
 *
 * WHAT THIS DECIDES AND WHAT IT DOES NOT. It decides whether the PR may be
 * opened, what its title says, what its body says, and what the opening
 * announces about the work the branch carries. It opens nothing: the performer
 * owns the `pr-create`, the way `plot-sprint-state.sh` owns the write
 * `setSprintState` decided.
 *
 * THE TITLE AND BODY COME FROM THE PLAN, NOT FROM THE LAST COMMIT SUBJECT. A
 * slice's identity is the wave the plan names it under; its last commit is
 * whatever the agent happened to finish with, and on this estate that is
 * routinely `plot: build the board artifact`. So a wave with no name is a
 * refusal rather than a title borrowed from git.
 */

/** Why opening a slice's PR refused, as a value a caller branches on. */
export type SlicePrRefusalReason =
  /** The branch belongs to no plan — nothing states what the PR would be for. */
  | 'plan-unknown'
  /** The plan names the branch but no wave heading, so the PR has no title. */
  | 'slice-unnamed'
  /** The branch is already carried by an open or merged PR. */
  | 'pr-exists'
  /** The branch holds no commit the base does not — there is nothing to open. */
  | 'branch-empty';

/** A refused opening, naming the rule that fired. */
export interface SlicePrRefusal {
  readonly outcome: 'refused';
  /** Which rule fired. */
  readonly reason: SlicePrRefusalReason;
  /** Why it fired here, printed whole by the caller. */
  readonly detail: string;
}

/**
 * What the opening announces about the work the branch carries.
 *
 * `carries-work` is the ordinary answer and says nothing. The other two are the
 * `a-merged-pr-carried-work` reading, taken at open time rather than at
 * delivery: that plan taught the delivery gate to notice a slice whose merged
 * PR carried nothing, and this is the moment the same reading can say so while
 * the PR is still being written.
 */
export type WorkNotice = 'carries-work' | 'marker-only' | 'unknown';

/** What opening a slice's PR would write. */
export interface SlicePrDecision {
  readonly outcome: 'decided';
  /** The head branch. */
  readonly head: string;
  /** The branch the PR merges into. */
  readonly base: string;
  /** The title, from the wave the plan names the branch under. */
  readonly title: string;
  /** The body, in the order its parts are written. */
  readonly body: string;
  /** Whether the PR is opened as a draft. */
  readonly draft: boolean;
  /**
   * What the branch's commits say about the work it carries.
   *
   * NAMED AT OPEN TIME AND NEVER REFUSED ON. `a-merged-pr-carried-work`
   * measured 60 merged PRs and found seven carrying nothing, of which only two
   * were the defect: three were claim PRs whose slice finished under a
   * different PR. A refusal would have been right about the PR and wrong about
   * the plan, so this reports, and the body says so where it holds.
   */
  readonly notice: WorkNotice;
}

/** What opening a slice's PR answers: what to open, or the rule that stopped it. */
export type SlicePrResult = SlicePrDecision | SlicePrRefusal;

/**
 * Narrows a result to a refusal.
 *
 * @param result - what the rule answered.
 * @returns true where a rule stopped the opening.
 */
export const isSlicePrRefusal = (result: SlicePrResult): result is SlicePrRefusal =>
  result.outcome === 'refused';

/** What a branch's own commits say, as the adapter measured them. */
export interface SlicePrReadings {
  /** The branch the PR would be opened for. */
  readonly branch: string;
  /** The branch it merges into. */
  readonly base: string;
  /** The plan's slug, or `''` where no plan names this branch. */
  readonly planSlug: string;
  /** The plan file's path, or `''` where no plan names this branch. */
  readonly planFile: string;
  /**
   * The wave heading the plan names this branch under, or `''`.
   *
   * THE TITLE IS THIS AND NOTHING ELSE. A plan that names a branch under no
   * heading refuses rather than falling back to the branch name: the wave
   * heading is a sentence a person wrote about the slice, and a branch name is
   * a slug.
   */
  readonly sliceName: string;
  /** The brief's path, or `''` where the slice has none. */
  readonly briefFile: string;
  /** The PR number already carrying this branch, or 0 where none does. */
  readonly existingPr: number;
  /** How many commits the branch holds that its base does not. */
  readonly commits: number;
  /**
   * Whether those commits changed anything but a marker or a claim.
   *
   * `unknown` where the diff could not be read, and it never claims the branch
   * is empty: a diff that could not be taken is not a diff that was empty, the
   * line `DeliverBranchReading.carriedWork` already draws and the one every
   * `unknown` on this estate draws.
   */
  readonly carriedWork: boolean | 'unknown';
}

/** What the caller adds to the readings. */
export interface SlicePrInput {
  /** Whether to open the PR as a draft. */
  readonly draft: boolean;
}

/**
 * The sentence a `marker-only` opening puts in its body.
 *
 * IT IS A QUESTION AND NOT A VERDICT, in the words
 * `a-merged-pr-carried-work` settled: a branch may legitimately carry no
 * implementation because its work landed under another PR, and a sentence
 * asserting otherwise would be wrong three times in seven.
 */
export const MARKER_ONLY_NOTICE =
  '> **This branch carries no implementation** — its commits change nothing outside a `PLOT-BLOCKED*` marker and its claim. Check whether the work landed under another PR, mark the slice `deferred:`, or finish it before merging.';

/**
 * Compose the body of a slice's PR.
 *
 * THE PARTS ARE THE PLAN, THE BRIEF AND THE NOTICE, in that order. A reader
 * opening the PR is asked *which slice is this* first, and the two files that
 * answer it are the two a reviewer opens next.
 *
 * @param readings - what the adapter measured about the branch and its plan.
 * @param notice - what the branch's commits said about the work it carries.
 * @returns the body, as markdown.
 */
const bodyFor = (readings: SlicePrReadings, notice: WorkNotice): string => {
  const parts = [`Slice of [${readings.planSlug}](${readings.planFile}): **${readings.sliceName}**.`];
  if (readings.briefFile !== '') {
    parts.push(`Brief: [\`${readings.briefFile}\`](${readings.briefFile}).`);
  }
  if (notice === 'marker-only') {
    parts.push(MARKER_ONLY_NOTICE);
  }
  return parts.join('\n\n');
};

/**
 * Decides what opening a slice's pull request would write.
 *
 * FOUR REFUSALS, EACH A MEASUREMENT RATHER THAN A JUDGEMENT. A branch no plan
 * names has no slice to describe; a plan naming it under no heading has no
 * title to give; a branch a PR already carries would get a second one; a branch
 * with no commits cannot be opened at all — that last is the host's own error,
 * *"No commits between main and branch"*, recorded in `skills/plot/changelog.md`
 * and worth refusing before the call rather than after it.
 *
 * IT REPORTS ON THE WORK AND REFUSES ON NONE OF IT. `notice` carries the
 * `a-merged-pr-carried-work` reading and never stops the opening: that plan
 * measured a refusal here as wrong in three cases of seven, and the estate has
 * an annotation for the case it would have blocked.
 *
 * @param readings - what the adapter measured about the branch, its plan and
 *   its commits.
 * @param input - whether to open as a draft.
 * @returns the PR to open, or a refusal naming the rule that fired:
 *   `plan-unknown`, `slice-unnamed`, `pr-exists` or `branch-empty`.
 */
export const openSlicePr = (
  readings: SlicePrReadings,
  input: SlicePrInput,
): SlicePrResult => {
  if (readings.planSlug === '' || readings.planFile === '') {
    return {
      outcome: 'refused',
      reason: 'plan-unknown',
      detail: `no plan names '${readings.branch}' — a slice PR states which plan it serves, so open it from a branch a plan's Branches section lists, or add the branch to the plan first`,
    };
  }
  if (readings.sliceName === '') {
    return {
      outcome: 'refused',
      reason: 'slice-unnamed',
      detail: `'${readings.planSlug}' names '${readings.branch}' under no wave heading — the PR title is that heading, and a branch name is not one`,
    };
  }
  if (readings.existingPr > 0) {
    return {
      outcome: 'refused',
      reason: 'pr-exists',
      detail: `#${readings.existingPr} already carries '${readings.branch}' — push to the branch and the PR follows it`,
    };
  }
  if (readings.commits <= 0) {
    return {
      outcome: 'refused',
      reason: 'branch-empty',
      detail: `'${readings.branch}' holds no commit '${readings.base}' does not — there is nothing to open a PR for`,
    };
  }
  const notice: WorkNotice =
    readings.carriedWork === 'unknown' ? 'unknown' : readings.carriedWork ? 'carries-work' : 'marker-only';
  return {
    outcome: 'decided',
    head: readings.branch,
    base: readings.base,
    title: readings.sliceName,
    body: bodyFor(readings, notice),
    draft: input.draft,
    notice,
  };
};
