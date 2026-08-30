/**
 * What every workflow answers with: a decision, or a refusal naming its rule.
 *
 * A workflow is `readings -> Decision | Refusal` and performs nothing. The
 * readings arrive as plain values an adapter measured, so every rule is
 * reachable from a plain call with no repository, no host and no process.
 */

/**
 * One write a decision would make, named so a performer can apply it and a
 * test can diff for it.
 *
 * Ordered rather than a set: `reap` removes a worktree BEFORE the manifest that
 * named it, because the reverse leaves a live checkout unregistered and the
 * registry answers that by synthesizing an `unknown` row.
 *
 * Every variant carries the values it needs and no formatting. Rendering a
 * `- **Approved:** ...` line is the performer's, so the decision stays
 * comparable across the two spellings a plan file allows.
 */
export type Write =
  | PlanPhaseWrite
  | PlanRecordWrite
  | PlanAnnotationWrite
  | HoldClearWrite
  | SprintAnnotationWrite
  | SprintNoteWrite
  | IndexMoveWrite
  | PrReadyWrite
  | PrMergeWrite
  | BranchCreateWrite
  | BriefWrite
  | WorktreeRemoveWrite
  | ManifestClearWrite
  | LogClearWrite
  | CommitWrite
  | PushWrite;

/** Sets a plan's `**Phase:**` field, inside its `## Status` section only. */
export interface PlanPhaseWrite {
  readonly kind: 'plan-phase';
  /** The plan file the write lands in, relative to the repository root. */
  readonly file: string;
  /** The phase to write, capitalised as the file spells it. */
  readonly phase: 'Approved' | 'Delivered' | 'Released';
}

/** Fills one dated `## Status` record, replacing the template's placeholder. */
export interface PlanRecordWrite {
  readonly kind: 'plan-record';
  /** The plan file the write lands in, relative to the repository root. */
  readonly file: string;
  /** Which record — the field name as the file spells it. */
  readonly field: 'Approved' | 'Started' | 'Delivered' | 'Released';
  /** The record's value, without its `- **Field:** ` prefix. */
  readonly value: string;
}

/** Annotates one branch line in a plan's slice section. */
export interface PlanAnnotationWrite {
  readonly kind: 'plan-annotation';
  /** The plan file the write lands in, relative to the repository root. */
  readonly file: string;
  /** The branch whose line carries the annotation. */
  readonly branch: string;
  /** The annotation's body, without its comment delimiters. */
  readonly annotation: string;
}

/**
 * Removes one branch's `.plot/hold` entry.
 *
 * Keyed by BRANCH and never by plan: the phase gate matches the branch name,
 * and a plan names several. One write per branch, so a performer that applies
 * half of them has done half of a nameable thing.
 */
export interface HoldClearWrite {
  readonly kind: 'hold-clear';
  /** The branch whose entry goes; entries this plan never named stay. */
  readonly branch: string;
}

/** Rewrites a sprint item's `<!-- pr:, status:, branch: -->` annotation. */
export interface SprintAnnotationWrite {
  readonly kind: 'sprint-annotation';
  /** The sprint file the write lands in, relative to the repository root. */
  readonly file: string;
  /** The plan slug whose item line carries the annotation. */
  readonly plan: string;
  /** The status to record. */
  readonly status: string;
  /** The PR number to record, or null to leave it. */
  readonly pr: number | null;
  /** The branch to record, or `''` to leave it. */
  readonly branch: string;
}

/** Appends a line under a sprint's `## Notes`, never inside a subsection. */
export interface SprintNoteWrite {
  readonly kind: 'sprint-note';
  /** The sprint file the write lands in, relative to the repository root. */
  readonly file: string;
  /** The note's text. */
  readonly note: string;
}

/** Moves a plan's index symlink between the phase directories. */
export interface IndexMoveWrite {
  readonly kind: 'index-move';
  /** The link's current path, relative to the repository root. */
  readonly from: string;
  /** Where it goes, relative to the repository root. */
  readonly to: string;
}

/** Takes a PR out of draft — the first half of approving it. */
export interface PrReadyWrite {
  readonly kind: 'pr-ready';
  /** The PR to mark ready. */
  readonly pr: number;
}

/** Merges a PR. The one irreversible write in the approve workflow. */
export interface PrMergeWrite {
  readonly kind: 'pr-merge';
  /** The PR to merge. */
  readonly pr: number;
  /** Whether to retire the head branch with the merge. */
  readonly deleteBranch: boolean;
}

/** Creates a branch and pushes it — the push being the claim. */
export interface BranchCreateWrite {
  readonly kind: 'branch-create';
  /** The branch to create. */
  readonly branch: string;
  /** What it is cut from, such as `origin/main`. */
  readonly base: string;
  /** Whether to push it; the push is the claim and the whole lock. */
  readonly push: boolean;
}

/** Writes the hand-off brief that outlives the dispatching session. */
export interface BriefWrite {
  readonly kind: 'brief';
  /** The brief's path, relative to the repository root. */
  readonly file: string;
  /** The branch the brief is for. */
  readonly branch: string;
}

/** Removes a worktree checkout. Re-creatable with `git worktree add`. */
export interface WorktreeRemoveWrite {
  readonly kind: 'worktree-remove';
  /** The worktree's absolute path. */
  readonly path: string;
}

/** Removes the registry manifest that named a worktree. */
export interface ManifestClearWrite {
  readonly kind: 'manifest-clear';
  /** The worktree the manifest named, absolute. */
  readonly worktree: string;
}

/**
 * Removes the agent-log files describing one branch's run.
 *
 * The branch's own `plot-resolve-<branch>` files — the log, its `.state` and its
 * `.prompt.md` — which map one-to-one onto the worktree being removed. Never the
 * per-plan `plot-dispatch-<slug>.log`, which spans a plan's branches and
 * outlives any one of them.
 *
 * Pure cleanup, and ordered last for that reason: a missing manifest orphans an
 * agent, while a missing log costs a record of work the host already merged.
 * Absence is the desired state, so removing a file that is not there is not a
 * failure.
 */
export interface LogClearWrite {
  readonly kind: 'log-clear';
  /** The branch whose run files go, as the log names them. */
  readonly branch: string;
}

/** Commits the staged writes. Paths are staged explicitly, never `add -A`. */
export interface CommitWrite {
  readonly kind: 'commit';
  /** The commit message. */
  readonly message: string;
  /** The paths to stage, relative to the repository root. */
  readonly paths: readonly string[];
}

/** Pushes a branch to a remote. */
export interface PushWrite {
  readonly kind: 'push';
  /** The branch to push. */
  readonly branch: string;
  /** The branch it lands on, or `''` when pushing the branch itself. */
  readonly onto: string;
}

/**
 * A workflow that decided to proceed, and everything it would write.
 *
 * INERT. It says *merge PR #42, set Phase: Approved, write this record* and
 * does nothing — which is what makes every workflow testable end to end with
 * no host and no repository.
 *
 * @typeParam Detail - what this workflow reports beyond its writes.
 */
export interface Decision<Detail = unknown> {
  readonly outcome: 'decided';
  /** Which workflow decided. */
  readonly workflow: WorkflowName;
  /**
   * Every write the decision calls for, in the order a performer applies them.
   *
   * Empty is a legitimate decision: an already-recorded transition has nothing
   * left to write and is not a refusal.
   */
  readonly writes: readonly Write[];
  /** What this workflow reports about its decision. */
  readonly detail: Detail;
}

/**
 * A workflow that refused, naming the rule that fired.
 *
 * @typeParam Reason - this workflow's named refusals.
 */
export interface Refusal<Reason extends string = string> {
  readonly outcome: 'refused';
  /** Which workflow refused. */
  readonly workflow: WorkflowName;
  /** Which rule fired — branched on rather than matched as prose. */
  readonly reason: Reason;
  /** Why the rule fired here, for a reader. */
  readonly detail: string;
}

/** The workflows this package expresses. */
export type WorkflowName = 'approve' | 'deliver' | 'reap' | 'implement' | 'release';

/** What a workflow answers: the writes it decided on, or the rule that stopped it. */
export type Outcome<Detail = unknown, Reason extends string = string> =
  | Decision<Detail>
  | Refusal<Reason>;

/**
 * Narrows an outcome to a decision.
 *
 * @param outcome - the outcome to test.
 * @returns true when the workflow decided to proceed.
 */
export const decided = <D, R extends string>(outcome: Outcome<D, R>): outcome is Decision<D> =>
  outcome.outcome === 'decided';

/**
 * Narrows an outcome to a refusal.
 *
 * @param outcome - the outcome to test.
 * @returns true when a rule stopped the workflow.
 */
export const refused = <D, R extends string>(outcome: Outcome<D, R>): outcome is Refusal<R> =>
  outcome.outcome === 'refused';

/**
 * Builds a refusal.
 *
 * @param workflow - the workflow refusing.
 * @param reason - the rule that fired.
 * @param detail - why it fired here.
 * @returns the refusal.
 */
export const refuse = <R extends string>(
  workflow: WorkflowName,
  reason: R,
  detail: string,
): Refusal<R> => ({ outcome: 'refused', workflow, reason, detail });

/**
 * Builds a decision.
 *
 * @param workflow - the workflow deciding.
 * @param writes - every write it would make, in application order.
 * @param detail - what it reports about the decision.
 * @returns the decision.
 */
export const decide = <D>(
  workflow: WorkflowName,
  writes: readonly Write[],
  detail: D,
): Decision<D> => ({ outcome: 'decided', workflow, writes, detail });

/**
 * The evidence behind a workflow, and how far it can be trusted.
 *
 * `script` marks a workflow transcribed from a shell script that exists and
 * has an exit code: the corpus and sandbox tiers can compare against it, so a
 * disagreement fails a build.
 *
 * `fixture` marks one transcribed from SKILL prose. The prose is the
 * specification — it is what every agent running the workflow follows today —
 * but it has no exit code, so there is no comparison to run and no mechanical
 * failure to earn. A disagreement between this domain and a paragraph is a
 * reading, and readings are how a promise nobody implemented survives review.
 *
 * The distinction is carried in the code rather than in a document because it
 * is the reason two of these five may not borrow the word the other three
 * earn.
 */
export type Evidence = 'script' | 'fixture';

/** Which source each workflow was transcribed from, and what that source can prove. */
export const EVIDENCE: Readonly<Record<WorkflowName, Evidence>> = {
  approve: 'script',
  deliver: 'script',
  reap: 'script',
  // FIXTURE-VERIFIED ONLY. Transcribed from skills/plot-implement/SKILL.md.
  implement: 'fixture',
  // FIXTURE-VERIFIED ONLY. Transcribed from skills/plot-release/SKILL.md.
  release: 'fixture',
};

/**
 * Whether a workflow's expression can be checked against something that fails.
 *
 * @param workflow - the workflow to ask about.
 * @returns true where a script backs it, false where only prose does.
 */
export const isScriptVerified = (workflow: WorkflowName): boolean =>
  EVIDENCE[workflow] === 'script';
