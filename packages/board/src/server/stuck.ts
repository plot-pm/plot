import {
  BOARD_ARTIFACT_PATH,
  type BranchState,
  type Stuck,
  type StuckRun,
} from '../contract/schema.js';

/**
 * Whether a branch can MOVE — a different question from what it IS, and the one
 * nothing in this board could answer.
 *
 * `classify` reports claimed, eligible, blocked, working. On 2026-08-17 five
 * branches got stuck in one afternoon and every one of them read as normal
 * through those words:
 *
 * | incident                     | what it cost                              |
 * |------------------------------|-------------------------------------------|
 * | #176 artifact conflict       | recreate worktree, take a side, 547 tests |
 * | #177 artifact conflict       | the same again                            |
 * | #177 rebase never pushed     | noticed by accident; 30 min of dead CI    |
 * | #179 Playwright CDN 403      | read the log, compare runs, rerun         |
 * | #172 fixture regression      | add the missing field                     |
 *
 * The #177 case is the sharp one and the reason `unpushed` is here at all: from
 * outside, **a rebase that stayed local is indistinguishable from an agent that
 * stopped** — which is the same confusion `opus5-longhorizon-hardening` named as
 * its central thesis.
 *
 * READ-ONLY AND STATELESS, both by construction rather than by intention. This
 * module imports nothing that can write — no `child_process`, no `fs` — so
 * every fact it decides from is one it was handed, and every conclusion is
 * re-derived from those facts on each call. There is no watcher state, which is
 * precisely why the watcher cannot drift from reality.
 */

/**
 * What the detector is handed. Every field is an observation someone else made:
 * this function performs no lookup of its own, which is what makes it testable
 * as a table and what keeps the read-only property structural.
 */
export interface StuckInput {
  /** The branch's git state, as the scan reports it. */
  state: BranchState;
  /**
   * The files that would collide merging into the default branch — see
   * `FleetBranchSchema.conflicts`. Meaningless without `conflictsKnown`.
   */
  conflicts: readonly string[];
  /**
   * Whether the conflict set was OBSERVED. False is *not looked at*, never
   * *clean*, and it is what stops an unanswerable branch from reading as
   * mergeable.
   */
  conflictsKnown: boolean;
  /** Commits this machine holds that the remote does not. */
  localAhead: number;
  /**
   * What the host says about the PR, or null where there is none.
   *
   * TWO of the six values mean anything here, and they mean different things.
   * `conflicts` is the host's own mergeability verdict, which can see what a
   * local prediction from stale refs cannot. `failing` means *report the
   * evidence*, never *this is broken* — the row states facts and a person
   * concludes. Every other value leaves the branch unstuck.
   */
  prState?: 'green' | 'pending' | 'failing' | 'none' | 'conflicts' | 'unknown' | null;
  /** The branch's changed paths — evidence carried onto a `ci-failing` row. */
  changedPaths?: readonly string[];
  /**
   * Which checks failed, by name. Evidence, and the line that was already in the
   * host payload and thrown away.
   */
  failingChecks?: readonly string[];
  /**
   * The branch's own recent runs. Evidence, and the line that decided the
   * 2026-08-17 case — nothing here compares them.
   */
  runHistory?: readonly StuckRun[];
}

/**
 * Every CI evidence field empty — what the three non-CI states carry.
 *
 * A FUNCTION rather than a shared constant, and deliberately: a single frozen
 * object would hand every caller the same three arrays, so one consumer sorting
 * or pushing in place would reach into every other result. Fresh arrays cost
 * nothing here and cannot be aliased.
 */
function noCiEvidence(): Pick<Stuck, 'changedPaths' | 'failingChecks' | 'runHistory'> {
  return { changedPaths: [], failingChecks: [], runHistory: [] };
}

/**
 * Is this conflict set the one case whose resolution is provable?
 *
 * **EXACTLY the artifact — one file, that file, and nothing else.** Not "the
 * artifact among the conflicts", and the difference is the whole point: an
 * implementation asking *is the artifact in this set* passes every
 * artifact-only case and silently misclassifies every mixed one. A merge that
 * conflicts in the artifact AND anything else needs judgement as a whole, even
 * though one of its files does not.
 *
 * The artifact case is provable rather than merely conventional, which is what
 * earns it a separate name: `.gitattributes` marks the file `-merge` so git
 * keeps one side whole and writes no markers, `build.mjs` embeds no timestamp
 * and no randomness so a rebuild does not depend on which side was kept, and
 * CI's no-diff gate fails the build if the committed artifact and a fresh
 * rebuild disagree. Take either side, rebuild, commit — a resolution nobody has
 * to read a diff to check.
 *
 * Exported because the pairing is the assertion that matters, and a test that
 * could only reach this through the whole detector would be testing two things
 * at once.
 */
export function isArtifactOnly(conflicts: readonly string[]): boolean {
  return conflicts.length === 1 && conflicts[0] === BOARD_ARTIFACT_PATH;
}

/**
 * Why this branch cannot move, or null.
 *
 * NULL IS THE COMMON ANSWER and the design depends on it: a branch that is not
 * stuck produces nothing at all. A watcher that flags everything flags nothing,
 * and the value of a populated result is that it is rare enough to look at.
 *
 * ORDER IS MEANING, not convenience. Conflicts precede a failing check because
 * GitHub starts no workflow for a branch that does not merge cleanly — so a
 * conflicting PR reports an empty rollup, and reading checks first would report
 * the consequence while withholding the cause. The board already learned this
 * twice, on PR #149 and PR #160, both of which said *no checks* while GitHub
 * said *this branch has conflicts*.
 *
 * `unpushed` comes last of the three because it is the weakest claim: it is
 * true only on the machine doing the looking, and a branch that also conflicts
 * has a fact about it that everyone can see.
 *
 * NOTHING IS FIXED HERE, and two of the four say so in their own way.
 * `unpushed` is reported and never pushed — pushing someone else's uncommitted
 * judgement is not a mechanical act. `ci-failing` carries evidence and no
 * verdict: the step, the paths, and (assembled by the caller) the branch's own
 * run history, from which a human concludes in seconds what took ten minutes of
 * log-reading. A heuristic mapping failing steps to changed paths was
 * explicitly rejected — that table is unmaintained by construction and goes
 * silently wrong the first time a workflow is restructured.
 */
export function stuckState(input: StuckInput): Stuck | null {
  const { state, conflicts, conflictsKnown, localAhead } = input;

  // A merged branch has already moved, and a deferred one was given up
  // deliberately — neither is waiting on anybody. Answering for them would put
  // a cue on finished work and on work nobody wants, which is the "flags
  // everything" failure in its two purest forms.
  if (state === 'merged' || state === 'deferred') return null;

  // ABSENT IS NOT CLEAN. An unobserved conflict set is empty, exactly like a
  // clean one, so the flag is what separates them — and consulting the list
  // without it would report every branch on an old git as mergeable.
  if (conflictsKnown && conflicts.length > 0) {
    const sorted = [...conflicts].sort();
    return {
      // EXACTLY the artifact, never the artifact among others — see
      // `isArtifactOnly`. The set travels with the answer so a reader can
      // count it rather than trust the classification.
      state: isArtifactOnly(sorted) ? 'artifact-conflict' : 'conflict',
      conflicts: sorted,
      localAhead: 0,
      ...noCiEvidence(),
    };
  }

  // THE HOST SAYS IT CONFLICTS AND THE PREDICTION DID NOT SEE IT.
  //
  // Two sources answer the same question from different vantage points, and
  // they disagree in one direction that matters. `merge-tree` predicts from the
  // refs THIS MACHINE holds; a fetch that has not run, or a ref that moved a
  // second ago, makes the prediction stale — while GitHub computed its verdict
  // against the branch as it actually stands. Both of the 2026-08-17 artifact
  // conflicts appeared only at `gh pr merge`, which is the same lesson from the
  // other side: a merge foreseen clean is not a merge proven clean.
  //
  // So a host-reported conflict is reported, and it is reported as `conflict`
  // and NEVER as `artifact-conflict`. The distinction between the two rests
  // entirely on the SET being exactly one known file, and here there is no set:
  // the host says *this does not merge* without saying where. Calling it
  // artifact-only would be the "is the artifact among the conflicts?" mistake in
  // its worst form — a guess with no set behind it at all, handed to the one
  // state a later wave is licensed to resolve without a human.
  //
  // Placed after the observed set and before the failing check, for the reason
  // the ordering already gives: GitHub starts no workflow for a branch that does
  // not merge, so this branch's checks are empty as a CONSEQUENCE of the
  // conflict, and reporting the consequence would withhold the cause.
  if (input.prState === 'conflicts') {
    return { state: 'conflict', conflicts: [], localAhead: 0, ...noCiEvidence() };
  }

  // A FAILING CHECK IS A SHAPE WORTH SURFACING, never a claim about this
  // failure. The row states what failed and what the branch touches; the caller
  // adds the branch's own run history; a person decides. That split is the
  // reason the plan calls this state *foreign-shaped* and not *foreign*.
  if (input.prState === 'failing') {
    return {
      state: 'ci-failing',
      conflicts: [],
      localAhead: 0,
      // THE THREE LINES, AND NO FOURTH. What failed, what the branch touches,
      // and how this branch has fared lately. No field here holds a conclusion,
      // and none is derived from another — the reader combines them.
      changedPaths: [...(input.changedPaths ?? [])],
      failingChecks: [...(input.failingChecks ?? [])],
      runHistory: [...(input.runHistory ?? [])],
    };
  }

  // WORK ONLY THIS MACHINE CAN SEE. Reported and never fixed: `localAhead` is
  // true only where the looking happens, and the fix is a push — which is
  // somebody else's judgement to release.
  if (localAhead > 0) {
    return { state: 'unpushed', conflicts: [], localAhead, ...noCiEvidence() };
  }

  return null;
}

/** How many branches are stuck, and in which of the four ways. */
export interface StuckSummary {
  stuck: number;
  artifact: number;
  conflict: number;
  unpushed: number;
  ci: number;
}

/**
 * Count the four states across a set of results.
 *
 * Derived from the results rather than tallied alongside them: a counter
 * incremented beside a decision is a second implementation of that decision,
 * and the two drift the first time a branch is added. All zeroes is the healthy
 * fleet and the honest answer for one nothing was looked at on — the summary
 * says how many, never why not.
 */
export function summarizeStuck(results: readonly (Stuck | null)[]): StuckSummary {
  const s: StuckSummary = { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 };
  for (const r of results) {
    if (!r) continue;
    s.stuck += 1;
    if (r.state === 'artifact-conflict') s.artifact += 1;
    else if (r.state === 'conflict') s.conflict += 1;
    else if (r.state === 'unpushed') s.unpushed += 1;
    else if (r.state === 'ci-failing') s.ci += 1;
  }
  return s;
}

/**
 * The machine-countable footer, in the shape this repo's other scans emit —
 * `plot-fleet-scan.sh`, `plot-merge-queue.sh` and `plot-reconcile-scan.sh` all
 * end on one, and consumers read that line rather than re-counting a body.
 *
 * Every state is named separately and every one is printed even at zero.
 * `stuck=2` alone would be the one-label-many-states defect wearing a number:
 * two conflicts and two unpushed rebases are the same count and opposite
 * errands. A key that vanishes when it is zero cannot be read as zero either —
 * absent and none are different statements, and a counter that only appears
 * when nonzero forces every reader to know the full key set in advance.
 */
export function stuckSummaryLine(summary: StuckSummary, main: string): string {
  return `summary: stuck=${summary.stuck} artifact=${summary.artifact} `
    + `conflict=${summary.conflict} unpushed=${summary.unpushed} ci=${summary.ci} `
    + `main=${main}`;
}
