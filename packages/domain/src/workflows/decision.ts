/**
 * What every workflow answers with: a decision, or a refusal naming its rule.
 *
 * A workflow is `readings -> Decision | Refusal` and performs nothing. The
 * readings arrive as plain values an adapter measured, so every rule is
 * reachable from a plain call with no repository, no host and no process.
 */

import type { EndingActor, EndingReason } from '../entities/ending.js';

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
  | WorktreeMoveWrite
  | AgentStartWrite
  | AgentSignalWrite
  | AgentResumeWrite
  | ChecksWrite
  | AgentAssignWrite
  | AgentAttemptWrite
  | BlockedMarkerWrite
  | ManifestClearWrite
  | LogClearWrite
  | CommitWrite
  | PushWrite
  | DeskResetWrite
  | AssignmentClearWrite
  | PromptRunWrite
  | CorrectionCountWrite
  | DeclarationWrite
  | SliceSpendWrite
  | LoopEndWrite
  | AgentFindingWrite
  | BuildFindingWrite;

/** Sets a plan's `**State:**` field, inside its `## Status` section only. */
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

/**
 * Rewrites a sprint item's `<!-- pr:, branch: -->` annotation, and ticks its box.
 *
 * `status:` WAS A THIRD FIELD until 2026-09-08. It was a second record of the
 * plan's own `State:`, and dead in both directions — 67 lines carried one and
 * nothing read the field. `pr` and `branch` stay because they name things no
 * plan field holds.
 */
export interface SprintAnnotationWrite {
  readonly kind: 'sprint-annotation';
  /** The sprint file the write lands in, relative to the repository root. */
  readonly file: string;
  /** The plan slug whose item line carries the annotation. */
  readonly plan: string;
  /** Whether to tick the item's checkbox — delivery does, approval does not. */
  readonly tick: boolean;
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

/**
 * Moves a worktree checkout to a new path.
 *
 * Distinct from remove-then-add: `git worktree move` keeps the branch, the
 * index and every uncommitted file, which is the whole reason a migration is
 * expressible at all. A recreate would discard exactly the work the migration
 * refuses to move when it finds it.
 */
export interface WorktreeMoveWrite {
  readonly kind: 'worktree-move';
  /** Its current absolute path. */
  readonly from: string;
  /** Where it goes, absolute. */
  readonly to: string;
}

/**
 * Starts one detached worker in a worktree.
 *
 * Detached is the point: the fleet must outlive the dispatching session. The
 * command itself is the repo's `Worker command` and is deliberately absent
 * here — Plot hardcodes no agent tooling, so naming one in a decision would
 * put a project's answer inside the domain.
 */
export interface AgentStartWrite {
  readonly kind: 'worker-start';
  /** The branch the worker is for. */
  readonly branch: string;
  /** The worktree it runs in, absolute. */
  readonly worktree: string;
}

/**
 * Signals a running worker to stop.
 *
 * The worktree and its claim survive it: the branch is still taken, and
 * removing either would be a write this design avoids.
 */
export interface AgentSignalWrite {
  readonly kind: 'worker-signal';
  /** The pid to signal. */
  readonly pid: string;
  /** The branch it was working on, for the message. */
  readonly branch: string;
}

/**
 * Hands a correction to an agent, into its own conversation where it can be.
 *
 * ONE WRITE FOR BOTH PATHS, and the `resumeId` is what separates them: a handle
 * means continue that conversation, `''` means start a fresh worker with the
 * same text in its brief. Two write kinds would ask every reader to remember
 * that the correction is identical either way, and the plan is explicit that it
 * is — a resumed agent reads it as *what you left undone*, a fresh one reads it
 * as *what the last attempt left undone*.
 *
 * The command is absent for the reason {@link AgentStartWrite} gives: Plot
 * hardcodes no agent tooling, so naming a harness in a decision would put a
 * project's answer inside the domain.
 */
export interface AgentResumeWrite {
  readonly kind: 'agent-resume';
  /** The branch the correction is about. */
  readonly branch: string;
  /** The worktree it runs in, absolute. */
  readonly worktree: string;
  /** The session to continue, or `''` when resume is unavailable. */
  readonly resumeId: string;
  /** What to hand the attempt, verbatim — the gate failures, as a prompt. */
  readonly correction: string;
}

/**
 * Tells the performer to run the local checks and resume the session with
 * the result — no model turn between the checks and the resume.
 *
 * **{@link AgentResumeWrite} IS THE MODEL FOR THIS.** Both hand an agent's
 * own session a result to continue from; they differ in what produces that
 * result. `agent-resume` carries a correction a person's build gate already
 * computed. This carries nothing to hand back yet, because the checks have
 * not run: the performer runs `plot-local-checks.mjs`'s own commands through
 * `boundedRun`, then resumes {@link resumeId} with either the one line "local
 * checks passed: <summary>" on a pass, or the failing command and the last 80
 * lines of its output on a fail. Neither text is a field here, because
 * neither is known until the performer runs the checks.
 */
export interface ChecksWrite {
  readonly kind: 'checks';
  /** The branch the checks are about. */
  readonly branch: string;
  /** The worktree to run the checks in, absolute. */
  readonly worktree: string;
  /** The session to resume with the checks' result. */
  readonly resumeId: string;
  /** The hand-back's own summary, for the resume's own context. */
  readonly summary: string;
}

/**
 * Hands one queued slice to one free agent — the registry's assignment.
 *
 * **THE MANIFEST IS THE CHANNEL, AND IT IS NOT A NEW ONE.** `branch` is already
 * the field an agent's identity carries, already rewritten on a hop, and already
 * what `isAgentFree` reads to answer *is this one available?*. Naming it here is
 * what turns that field's empty value from a report into an instruction: the
 * registry writes the branch a free agent is to take, and the agent reads its
 * own manifest instead of shopping through `--offline --next`.
 *
 * **A SECOND WRITE KIND WOULD BE A SECOND ANSWER TO ONE QUESTION.**
 * {@link AgentResumeWrite} hands an agent a correction about the branch it
 * already holds; this hands a free agent the branch itself. They differ in what
 * the agent is being told, not in how loudly, so a `correction` field here would
 * describe an agent nobody had a correction for.
 *
 * The brief is deliberately absent. It is read from `origin/<main>` at the path
 * the branch names, by both the gate that refused the hand-over and the agent
 * that takes it — carrying its text in the write would be a third copy that can
 * disagree with the ref.
 */
export interface AgentAssignWrite {
  readonly kind: 'agent-assign';
  /** The agent's session id — the manifest the write lands in. */
  readonly session: string;
  /** The desk it holds, absolute. */
  readonly worktree: string;
  /** The branch it is handed. */
  readonly branch: string;
  /** That branch's plan slug, so the agent's own scope follows the work. */
  readonly slug: string;
}

/**
 * Records that the supervisor spent one of its own retries.
 *
 * `attempts` AND NEVER `relaunches`. The two counters answer to different
 * parties: `relaunches` is a person's record of their `--restart`s, `attempts`
 * is the supervisor's record of its own tries and is what the bound reads.
 * Conflating them lets three manual restarts exhaust the automatic budget, or
 * the reverse.
 *
 * The new value is carried rather than an increment, so applying the write
 * twice lands the same number — a daemon SIGKILLed between deciding and writing
 * repeats the tick, and a repeated increment would spend a budget on one retry.
 */
export interface AgentAttemptWrite {
  readonly kind: 'agent-attempt';
  /** The worktree whose manifest records the count. */
  readonly worktree: string;
  /** What `attempts` becomes. */
  readonly attempts: number;
}

/**
 * Leaves a `PLOT-BLOCKED` marker on a desk the supervisor has given up on.
 *
 * THE ESTATE'S EXISTING *your turn* CHANNEL, not a new field. A `PLOT-BLOCKED*`
 * file is already what `plot-reap.sh` refuses on, what `plot-fleet-scan.sh`
 * reports, what `notBlockedGate` fails on and what the fleet reads to tell a
 * stopped agent from a finished one. A `needsAPerson` flag on the manifest
 * would be a second answer to the one question all four already ask.
 */
export interface BlockedMarkerWrite {
  readonly kind: 'blocked-marker';
  /** The worktree the marker lands in, absolute. */
  readonly worktree: string;
  /** The branch it is about. */
  readonly branch: string;
  /** The marker's body — why the supervisor stopped, and what a person must do. */
  readonly question: string;
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

/**
 * Makes a commit. Paths are staged explicitly, never `add -A`. Empty `paths`
 * means an empty commit — for the agent loop, the claim commit in the pass's
 * own desk.
 */
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
 * Resets a desk onto the branch the loop is handed, at take-up.
 *
 * The free wait comes before it: a desk is reset once an assignment is read,
 * never while the loop still waits for one. Checking out a base and a branch
 * with plain `git checkout` is what the shell's equivalent does, so a file the
 * earlier readings missed makes the write refuse rather than overwrite.
 * `agentLoop` in `agent-loop.ts` emits it at take-up only when the desk's
 * `resetRefusals` names nothing, for the same reason `deskIsResettable`
 * exists.
 */
export interface DeskResetWrite {
  readonly kind: 'desk-reset';
  /** The worktree to reset, absolute. */
  readonly worktree: string;
  /** The branch to check it out onto. */
  readonly branch: string;
  /** What the branch is cut from when it does not already exist locally. */
  readonly base: string;
}

/**
 * Clears the manifest's `branch` field, as `clear_manifest_branch` does.
 *
 * NOT {@link ManifestClearWrite}, which deletes the whole manifest and is
 * never what a free agent's loop means by *let go of this slice*. An agent
 * keeps its identity and its desk between slices; only the assignment goes.
 */
export interface AssignmentClearWrite {
  readonly kind: 'assignment-clear';
  /** The agent's session id — the manifest the write lands in. */
  readonly session: string;
}

/**
 * Records that the loop ran its first prompt on the slice it now holds.
 *
 * Distinct from every later prompt on the same slice — a correction also runs
 * a prompt, through {@link AgentResumeWrite} — so a reader asking *has this
 * slice been attempted at all* has one write to look for rather than a count
 * of {@link AgentResumeWrite}s that could be zero either because the slice
 * never started or because it finished on the first try.
 */
export interface PromptRunWrite {
  readonly kind: 'prompt-run';
  /** The worktree the prompt ran in, absolute. */
  readonly worktree: string;
  /** The branch it ran on. */
  readonly branch: string;
}

/**
 * Records a correction's own count, `correctionAttempts`, separately from the
 * manifest's `attempts`.
 *
 * TWO COUNTERS, NEVER ONE. `attempts` counts start retries
 * ({@link AgentAttemptWrite}) and supervisor relaunches, and a correction
 * raising it would let a CI failure exhaust the start-retry budget a prompt
 * that never ran would also spend. The new value is carried rather than an
 * increment, matching {@link AgentAttemptWrite}'s own reasoning: applying the
 * write twice must land the same number.
 */
export interface CorrectionCountWrite {
  readonly kind: 'correction-count';
  /** The worktree whose desk records the count. */
  readonly worktree: string;
  /** What `correctionAttempts` becomes. */
  readonly correctionAttempts: number;
}

/**
 * Writes `.plot-worker.envelope.json`, the file `supervise` reads and the
 * marker never is.
 *
 * EVERY ENDING THAT WAITS FOR A PERSON ALSO WRITES ONE, with `status:
 * 'blocked'`. With no declaration `supervise` answers `correct`, and a
 * correction is the wrong answer to a question the agent asked — so the loop
 * declares itself blocked on the same pass it ends for `blocked`, `unstarted`,
 * `limited` or `checks-unanswered`. `holding-work` writes none: that ending's
 * correction is *land your work*, and `supervise` answering `correct` is the
 * right answer there (`the-shell-loop-holds-unlanded-work`).
 */
export interface DeclarationWrite {
  readonly kind: 'declaration';
  /** The worktree the declaration lands in, absolute. */
  readonly worktree: string;
  /** The branch it is about. */
  readonly branch: string;
  /** Finished, or stopped and saying so. */
  readonly status: 'ok' | 'blocked';
  /** One sentence naming why; `''` when there is none to add. */
  readonly summary: string;
}

/** Records one slice's token spend at the seal, as `record_slice_spend` does. */
export interface SliceSpendWrite {
  readonly kind: 'slice-spend';
  /** The branch the slice was on. */
  readonly branch: string;
  /** The worktree it ran in, absolute. */
  readonly worktree: string;
}

/**
 * Ends the loop: the ending file, its `endings.jsonl` line, and — where the
 * ending is `limited` — the limited record a `--restart` after the reset
 * reads.
 *
 * ONE WRITE FOR THE WHOLE ENDING, rather than three kinds for three files that
 * are always written together. `exitCode` carries the table's own column
 * (0, 1 or 124) so a performer need not re-derive it from `reason`.
 */
export interface LoopEndWrite {
  readonly kind: 'loop-end';
  /** The worktree the loop ends in, absolute. */
  readonly worktree: string;
  /** The branch it held when it ended; `''` when it held none. */
  readonly branch: string;
  /** Why the loop ended. */
  readonly reason: EndingReason;
  /**
   * Which party ended it: `monitor` for `quiet`, `bound` for `bound` and
   * `unreadable`, and `agent` for every other reason `agentLoop` emits.
   */
  readonly actor: EndingActor;
  /** One sentence naming the reading. */
  readonly detail: string;
  /** The process exit code the table gives this reason. */
  readonly exitCode: number;
}

/**
 * Publishes a WorkerMonitor-shaped finding: `gone`, `idle` or `clear`.
 *
 * Named for the AGENT, not the process: `WorkerMonitor` in the doc comment
 * names the shape this write's finding is published in — the file format an
 * existing watcher already writes — while the write itself is the loop
 * reporting what it found about the agent it is. The `kind` string stays
 * `worker-finding` because that is the file and the vocabulary a reader greps
 * for on disk; only the exported identifier is Agent-side.
 */
export interface AgentFindingWrite {
  readonly kind: 'worker-finding';
  /** The worktree the finding is about, absolute. */
  readonly worktree: string;
  /** The branch the finding is about. */
  readonly branch: string;
  /** The finding to publish. */
  readonly finding: 'gone' | 'idle' | 'clear';
  /** When the finding first held, ISO-8601. */
  readonly since: string;
  /** One sentence naming the measurement behind the finding. */
  readonly evidence: string;
}

/** Writes a build finding line, in the shape the BuildMonitor writes today. */
export interface BuildFindingWrite {
  readonly kind: 'build-finding';
  /** The worktree the finding is about, absolute. */
  readonly worktree: string;
  /** The branch the finding is about. */
  readonly branch: string;
  /** The finding word: `build passed`, `build failed` or `build needs approval`. */
  readonly finding: string;
  /** The evidence sentence, naming the run and the commit. */
  readonly evidence: string;
}

/**
 * A workflow that decided to proceed, and everything it would write.
 *
 * INERT. It says *merge PR #42, set State: Approved, write this record* and
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

/**
 * The workflows this package expresses.
 *
 * Declared in `entities/workflow.ts` and re-exported here, which is where every
 * caller has always imported it from. It moved because the phases must name
 * their workflows and `entities/` may not import `workflows/` — the dependency
 * runs the other way, and a workflow's NAME is vocabulary rather than decision
 * machinery.
 */
import type { WorkflowName } from '../entities/workflow.js';
export type { WorkflowName };

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
  // FIXTURE-VERIFIED ONLY, AND THERE IS NO SCRIPT TO BORROW FROM. The
  // hand-over is specified in docs/plans/2026-09-02-an-agent-holds-one-desk.md.
  // `plot-dispatch.sh` is the workflow's CALLER — it hands a slice over and
  // returns — and the matching it triggers happens in the daemon, which has no
  // exit code to compare against.
  assign: 'fixture',
  deliver: 'script',
  dispatch: 'script',
  reap: 'script',
  // Transcribed from `plot-reconcile-scan.sh`, which has an exit code and a
  // machine-countable footer — so the sections it shares with this workflow can
  // be compared and a disagreement can fail a build.
  //
  // THE SCOPE HAS NO SCRIPT BEHIND IT, and that is the honest half of this
  // claim: the sweep answers one question about the whole estate, so the plan
  // and sprint scopes are specified in
  // docs/plans/2026-09-09-reconcile-is-a-controller-action.md and verified
  // against fixtures. The word is earned by the sections, not by the scoping.
  reconcile: 'script',
  // FIXTURE-VERIFIED ONLY. Transcribed from skills/plot-implement/SKILL.md.
  implement: 'fixture',
  // FIXTURE-VERIFIED ONLY. Transcribed from skills/plot-release/SKILL.md.
  release: 'fixture',
  // FIXTURE-VERIFIED ONLY, AND THERE IS NO SCRIPT TO BORROW FROM. The tick is
  // specified in docs/plans/2026-08-31-the-registry-supervises-its-agents.md
  // and `plot-registryd` is this workflow's caller rather than its source, so
  // there is nothing with an exit code to compare against yet.
  supervise: 'fixture',
  // FIXTURE-VERIFIED ONLY, AND DELIBERATELY NOT COMPARED AGAINST
  // `plot-worker-loop.sh`. A script with an exit code exists, but
  // docs/plans/2026-10-04-the-worker-loop-runs-in-js.md changes five of the
  // table's eighteen rows from that script's own behaviour on purpose — a
  // corpus comparison against it would fail on the rows the plan means to
  // change. The table in the plan's Design section is the specification this
  // workflow is checked against.
  'agent-loop': 'fixture',
};

/**
 * Whether a workflow's expression can be checked against something that fails.
 *
 * @param workflow - the workflow to ask about.
 * @returns true where a script backs it, false where only prose does.
 */
export const isScriptVerified = (workflow: WorkflowName): boolean =>
  EVIDENCE[workflow] === 'script';
