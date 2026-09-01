import { z } from "zod";

/**
 * PLOT'S ENTITY GRAPH — the plans, slices and branches the fleet is about.
 *
 * Moved here from the board's `contract/schema.ts`. These shapes were never
 * the board's: they are what a plan, a slice and a branch ARE, and they were
 * only in `contract/` because the board was the first thing to need a name for
 * them. The board imports them back and re-exports them, so its 53 importers
 * keep their paths and the definitions live where they can be depended on.
 *
 * A MOVE, NOT A COPY. There is no second implementation and no window in which
 * two answers exist — the board resolves these from here or not at all.
 *
 * The one import is `zod`, and that is the boundary the purity gate pins: a
 * schema and its type are ONE fact, so the validator moves with the shape
 * rather than being split from it. Nothing under `src/` may reach a disk, a
 * process or a network.
 */

// --- Fleet: what agents are doing, and what they wait for -------------------
//
// A different time axis from the board's view schemas: minutes rather than
// days, processes rather than artifacts.

/**
 * The scan's INTERNAL vocabulary, not the prose labels people read.
 *
 * `unknown` is what the scan says when it COULD NOT ASK — the git host was
 * throttled or failed, so whether the branch merged was never established. It
 * is deliberately not `open`: reporting a branch as unfinished because nobody
 * could be asked is a guess presented as an answer, and it counted merged work
 * among the unfinished on 2026-08-30.
 *
 * It is therefore a state no consumer may treat as a merge verdict. `open` and
 * `merged` are readings; this is the absence of one.
 */
export const BranchStateSchema = z.enum([
  'open',
  'wip',
  'merged',
  'claimed',
  'deferred',
  'unknown',
]);
export type BranchState = z.infer<typeof BranchStateSchema>;

/**
 * What the scan says about a slice — whether a dispatch could take it.
 *
 * `complete`   every non-deferred branch of this slice has merged
 * `eligible`   a dispatch would take this: prior slices landed AND the plan is approved
 * `blocked`    an earlier slice has not landed yet
 * `unapproved` the plan is not approved, so nothing here may be dispatched
 *
 * `eligible` asserts BOTH ordering and approval, so a reader may act on it
 * directly. `blocked` and `unapproved` are kept apart because they resolve
 * differently: the first by merging work, the second by a person approving the
 * plan.
 */
export const SliceVerdictSchema = z.enum(['complete', 'eligible', 'blocked', 'unapproved']);
export type SliceVerdict = z.infer<typeof SliceVerdictSchema>;

/**
 * What the scan found out about a worker on a branch — `worker_state()`'s five
 * outcomes, plus the case where this machine has nowhere to look.
 *
 * The scan's INTERNAL vocabulary, like `BranchStateSchema`: prose belongs to the
 * row, and a board that parsed a human sentence would break on a reworded one.
 *
 * All five of `worker_state()`'s outcomes are kept apart because collapsing them
 * re-creates the defect this exists to fix — `failed` and `finished` are
 * opposite actions, restart versus review. `elsewhere` is the sixth: no worktree
 * here, so the question cannot be answered rather than answered "no".
 */
export const WorkerStateSchema = z.enum([
  'running', 'finished', 'failed', 'ended', 'none', 'elsewhere',
  // Two TASK states beside the six PROCESS states above, added 2026-08-18.
  // Both arrive where the process exited 0 and the tree says the task did not
  // finish with it — see `worker` below for why the exit code cannot tell.
  'waiting', 'stalled',
]);
export type WorkerState = z.infer<typeof WorkerStateSchema>;

/**
 * Whether a RUNNING worker's child is actually doing work — the secondary cue
 * that says WHICH kind of running a `running` worker is in.
 *
 * A CUE, NOT A STATE, and that distinction is the whole point. `worker` is the
 * state; this is an attribute of one of its values. `running` is honest and
 * coarse — measured across the fleet 2026-08-25 it covered a worker mid-thought,
 * a worker between tasks, and a worker whose child had crashed hours earlier
 * while the loop waited on it, with 11 of 13 workers in that last, worst case.
 * This tells the first from the last WITHOUT promoting `idle` to a sixth
 * `worker` state and WITHOUT touching `AgentStateSchema`, whose five members are
 * pinned by a test: an idle worker with a live child still IS running.
 *
 * `working` when the worker's descendant CPU is advancing, `idle` when its clock
 * is frozen. `''` is the ONLY value beside every state but `running` — the cue
 * answers nothing there, and empty is the one absent-value shape the other
 * worker sibling fields (`worker_exit`, `worker_dirty_paths`) already use.
 *
 * THE DISCRIMINATOR IS THE CHILD'S CPU, NOT THE SHELL'S. The loop shell waits on
 * its child and burns near-zero CPU in every case, so `plot-worker-state.sh`
 * samples the whole descendant tree twice and compares — the growth is the
 * signal. Measured on the process table with no new bookkeeping.
 */
export const WorkerActivitySchema = z.enum(['working', 'idle', '']);
export type WorkerActivity = z.infer<typeof WorkerActivitySchema>;

export const SourceBranchSchema = z.object({
  branch: z.string(),
  state: BranchStateSchema,
  deferred: z.boolean(),
  /**
   * WHY the branch was deferred, as the plan recorded it — "" where nothing
   * was, and "" on every branch that is not deferred. `deferred` says which.
   *
   * Defaulted, so a pulse from a scan predating the field still validates: an
   * older scan cannot report a reason, and absent is the same answer it gave
   * before the field existed.
   */
  deferred_reason: z.string().default(''),
  /** Claim note from the plan, or "" — never null (house style). */
  claimed: z.string(),
  /**
   * A local worktree for this branch has uncommitted changes.
   *
   * The one thing the refs cannot see: an agent that has edited files and not
   * committed has written nothing git can report, so a branch someone is
   * actively working reads as abandoned. The scan runs on the machine that owns
   * the worktrees and reports what it finds there.
   *
   * STRICTLY ONE-DIRECTIONAL, and that is what lets it coexist with
   * refs-as-truth: `classify` may only use it to LIFT a branch out of quiet,
   * never to downgrade an answer. On a machine with no worktree for the branch
   * — every detached worker, every teammate's laptop, every CI run — it is
   * false, which is exactly the answer that changes nothing.
   *
   * Defaults to false so a pulse from an older scan still validates: absent and
   * "no worktree here" are the same statement, and both mean "answer from refs".
   */
  local_dirty: z.boolean().default(false),
  /**
   * Seconds since the newest write in this worktree, or null where none was
   * observed — `changed_ago_seconds` on the wire.
   *
   * THE FIELD THAT MAKES A WRITE AN EVENT. `local_dirty` is a SWITCH: it flips
   * once and stays flipped for as long as anything is uncommitted, so a change
   * detector watching it fires on the first keystroke of a session and never
   * again. Measured on the live board: three modified files, zero flashes in
   * 40 seconds.
   *
   * A timestamp does not have that shape. Every save moves it, so `true → true`
   * is still a change when the number beneath it moved — which is what the
   * reader means by *show me that writing is happening*.
   *
   * The scan has computed this per worktree all along (`changed_ago_of`); the
   * board simply never read it.
   */
  changed_ago_seconds: z.number().nullable().default(null),
  /**
   * The epoch second of that same newest evidence — what a CHANGE detector must
   * watch. `changed_ago_seconds` is recomputed against `now` on every scan, so
   * it moves once a second whether or not anything happened; watching it fires
   * on every pulse forever. This moves only when a commit lands, a file is
   * written, or the worker's log grows. Null wherever the age is null.
   */
  changed_at: z.number().nullable().default(null),
  /**
   * A local worktree for this branch is holding `.git/index.lock` — a write is
   * in progress THIS INSTANT.
   *
   * A THIRD signal beside `local_dirty` and `local_ahead`, answering a third
   * question. The three are neighbours and none of them is a flavour of another:
   * *someone is editing*, *finished work nobody else can see*, *a write is
   * happening right now*. Collapsing any pair would be the one-label-two-states
   * defect this story keeps finding.
   *
   * It is the most informative state a worktree can be in, and until #167 it was
   * the one the board could not see. `git status` fails under a lock, the scan
   * skipped the worktree in silence, and the branch answered from refs as if this
   * machine had none — so the row read *claimed, no commits yet* while an agent
   * was committing to it. The branch that looked least active was the busiest.
   *
   * LOCKED IS NOT MISSING. Both fail `git status` with identical empty output;
   * the scan interrogates the failure rather than assuming it, and a worktree
   * that has genuinely vanished still reports nothing at all.
   *
   * STRICTLY ONE-DIRECTIONAL, like its two neighbours: `classify` may only use it
   * to LIFT a branch out of quiet, never to downgrade an answer. False on every
   * machine that holds no worktree for the branch, which is exactly the answer
   * that changes nothing.
   *
   * Defaults to false so a pulse from an older scan still validates: absent and
   * "nothing is being written here" are the same statement, and both mean
   * "answer from refs".
   */
  local_locked: z.boolean().default(false),
  /**
   * Where this branch is checked out on THIS machine, or "".
   *
   * Kept although `local_dirty` is what moves the group, because it answers a
   * different question — *where did I put this* — and the plan modal is where
   * that gets asked. Shown for CLEAN worktrees too: dirtiness is evidence of
   * work, presence is evidence of location.
   *
   * True on this machine and meaningless on any other, so a reader elsewhere
   * gets "" and no path at all — a path that does not exist where you are
   * reading is worse than no path.
   */
  local_worktree: z.string().default(''),
  /**
   * A local worktree holds this branch AND its tip has not merged — somebody
   * holds it.
   *
   * THE DERIVATION `local_worktree` IS ONE INPUT TO, not a rename of it.
   * `local_worktree` answers *where is this checked out here*; `held` answers
   * *is that checkout evidence the branch is taken*. They diverge on exactly one
   * branch: a CLEAN worktree left on a branch whose work has landed. That is a
   * leftover directory — several exist on any machine that has run a fleet — and
   * reading it as *someone is working here* is the merged-leftover misread that
   * put shipped plans in WORKING. The scan excludes `merged` before it sets this,
   * so a consumer reads one boolean instead of re-deriving `!merged` itself.
   *
   * THE CLAIM REF STAYS PRIMARY. Held is additive and cannot lower an answer:
   * it is the only local signal a detached worker on another host cannot
   * produce, so a branch claimed and worked elsewhere reports `held: false` here
   * and answers from its claim ref exactly as before. Worktree evidence can only
   * move a branch from free to held, never the reverse.
   *
   * NEVER AN INPUT TO SLICE ELIGIBILITY. A slice settles on `merged` alone; a
   * held branch neither completes its own slice nor opens the next. Holding is a
   * fact the board reports, not a state the arithmetic reads.
   *
   * Defaults to false so a pulse from an older scan still validates: absent and
   * "nothing here holds it" are the same statement, and both mean "answer from
   * refs and the claim ref".
   */
  held: z.boolean().default(false),
  /**
   * A ref on the remote holds this branch — `origin/<branch>` exists.
   *
   * THE GIT FACT `plot-dispatch.sh` TESTS WHEN IT CLAIMS. Plot's whole locking
   * mechanism is a push of an empty commit that a non-fast-forward refuses, so
   * a branch whose ref already exists is one no dispatch can take. The scan
   * reads the refs to derive `merged` and `wip` already; this publishes the
   * fact instead of leaving each consumer to infer it.
   *
   * NOT A RENAME OF ITS NEIGHBOURS. `claimed` is the PLAN FILE's annotation —
   * "a reflection of a claim, not the claim itself; where the two disagree, git
   * wins" — and this is the git side of that disagreement. `held` is about a
   * WORKTREE on the scanning machine. This one is about a REF, so it is the
   * only claim signal that reads the same from everywhere: a branch claimed by
   * a detached worker on another host reports `held: false` and `ref_held:
   * true`, and that is the population the measured misread came from.
   *
   * WHY NOT KEEP INFERRING IT FROM `state`. `state === 'wip'` implies a ref and
   * is what auto-dispatch reads today, but the implication is one-way and lossy
   * at both ends: a MERGED PR overrides `wip` to `merged` while the ref
   * survives (a squash merge leaves the branch permanently ahead, and a
   * worktree can push it back after the host deletes it), and a `claimed`
   * branch is a ref carrying only claim commits that no `wip` test sees. Both
   * are refs a dispatch would be refused against.
   *
   * A STATEMENT ABOUT THE REF AND NOTHING ELSE. It does not assert the work is
   * unfinished, that a worker is alive, or that the branch should be left
   * alone. A merged branch whose ref outlived the merge reports true, because a
   * ref does hold it; what that means for dispatch is the consumer's judgement.
   * Keeping the interpretation out is what stops this becoming a second copy of
   * the state vocabulary, drifting against the first.
   *
   * NEVER AN INPUT TO SLICE ELIGIBILITY, like `held`: a slice settles on
   * `merged` alone.
   *
   * Defaults to false so a pulse from a scan predating the field still
   * validates. Note the default is the SAFE direction only for readers that
   * treat true as "do not dispatch": an older scan reports every branch as
   * unheld, which is the answer they got before this field existed.
   */
  ref_held: z.boolean().default(false),
  /**
   * Commits on the local branch that the remote does not have.
   *
   * The half `local_dirty` cannot answer, by construction: dirtiness reports
   * *someone is editing*, and committing CLEARS it. So the moment a worker
   * finishes tidily and pauses before pushing, the worktree is clean, the flag
   * is false, and the row reads *claimed, no commits yet* for a branch holding a
   * complete implementation — measured on the very branch that fixed the other
   * half, at 3 commits ahead and 0 dirty files.
   *
   * A REF fact, not a worktree fact — the distinction the scan is built on, and
   * the reason it is a separate field rather than a flavour of `local_dirty`.
   * Worktrees share one ref database, so a local branch with NO worktree still
   * holds commits nobody else can see, and this reports them.
   *
   * AHEAD ONLY. Being *behind* is not an invisible state — it is in the remote
   * for anyone to read — so this never speaks about divergence.
   *
   * Like `local_dirty`, strictly ONE-DIRECTIONAL: `classify` may only use it to
   * LIFT a branch out of quiet. 0 on a machine with no local ref for the branch
   * — every detached worker, every teammate's laptop, every CI run — which is
   * exactly the answer that changes nothing.
   *
   * Defaults to 0 so a pulse from an older scan still validates: absent and
   * "nothing unpushed here" are the same statement, and both mean "answer from
   * refs".
   */
  local_ahead: z.number().default(0),
  /**
   * Whether anything is actually RUNNING on this branch.
   *
   * A claim is a push: it says a dispatcher TOOK the branch, and nothing more.
   * Three rows sat in WORKING with a pulsing dot on 2026-08-17 while nobody was
   * working on any of them — the claim was real, the worker was never started.
   *
   * EIGHT VALUES, and every one of them earns its place by naming a different
   * next move:
   *
   * | value       | the reader's move                                 |
   * |-------------|---------------------------------------------------|
   * | `running`   | leave it alone                                    |
   * | `finished`  | review it                                         |
   * | `waiting`   | answer it — a marker in the tree asks a question  |
   * | `stalled`   | resume it — work is on the floor and has no PR    |
   * | `failed`    | restart it — `worker_exit` says how it died       |
   * | `ended`     | read the log; the exit status was not recorded    |
   * | `none`      | a worktree is here, but no pid — look in it       |
   * | `elsewhere` | no worktree here — ask the machine that took it   |
   *
   * THE MOVES ARE WHY THE VALUES ARE SEPARATE, NOT WHAT THE ROW SAYS. This
   * column is the argument for eight values — two states that take one move
   * would not need two names — and it is read here and nowhere else. Two
   * surfaces render from these states and they say different kinds of thing on
   * purpose: `AttentionItem` gives ADVICE (`action: 'restart it'`, beside the
   * `verdict` a consumer branches on and the `evidence` it traces to, which is
   * that endpoint's declared job), while a row's `note` states only what was
   * OBSERVED — an exit code, a stalled marker, a log's location. So *restart
   * it* is right in the first and wrong in the second, and the three broken
   * states (`failed`, `ended`, `stalled`) stopped saying it in notes on
   * 2026-08-20: whether a crash is worth restarting depends on its log and on
   * what else is in flight, neither of which the classifier can see.
   *
   * `waiting` AND `stalled` SPLIT WHAT `finished` USED TO COVER, and they
   * arrive only where the process exited 0. Measured across seven worktrees in
   * a four-agent fleet run: EVERY worker exited 0 — the one that opened its PR,
   * the one that stopped rather than claim a test run it had not seen, and the
   * one that stopped to ask which retry semantics were wanted. All three read
   * `finished`, whose move is *review it*, and two of the three needed an
   * answer instead. The exit code reports how a process TERMINATED, never
   * whether the task is DONE; only the tree separates them.
   *
   * Their moves are as opposite as `failed` and `finished`: *answer it* sends a
   * person to a question, *resume it* sends a worker back to work. Reporting
   * `waiting` as `stalled` is the worse direction — it invites a restart into
   * the same wait, which is a loop rather than a rescue, and was measured
   * happening twice to one branch — so a marker outranks work on the floor.
   *
   * `failed` and `finished` stay apart because their actions are OPPOSITE —
   * restart versus review — and one label over both sends the reader to a log to
   * find out which. That is the same one-label-two-states shape as `no commits
   * yet` covering both an idle branch and a finished-but-unpushed one.
   *
   * `none` means **unknown, never "nobody"**. `plot-dispatch` writes the pid
   * only where it started the worker itself, so a hand-started worker leaves
   * none — and hand-starting is the normal case for as long as `Worker command`
   * is unset. Five agents were started that way in one session; reading a
   * missing pid as "nobody is working" would report every one of them dead.
   * Absent is not false, the rule this file applies to every other missing
   * signal.
   *
   * `elsewhere` is a THIRD state, not a flavour of the second: the pid lives in
   * the worktree, so a branch claimed on another machine has no path to look at
   * at all. Looking and finding nothing differs from having nowhere to look, and
   * the actions differ with it.
   *
   * Defaults to `elsewhere` so a pulse from an older scan still validates:
   * a scan that reports nothing is a scan that could not look, which is exactly
   * what `elsewhere` says. It licenses no claim about a worker either way.
   */
  worker: WorkerStateSchema.default('elsewhere'),
  /**
   * The worker's pid as the SCAN read it, or "".
   *
   * Carried as a value rather than as something to re-derive, and that is the
   * whole point: `kill -0 0` signals the entire process GROUP and succeeds, so a
   * pid of `0` read naively is alive forever. The scan rejects it exactly as
   * `worker_state()` does and reports `none`, so `0` can never arrive here
   * beside `running`. Re-deriving liveness on this side would spring the trap
   * again.
   *
   * A string, not a number: it is an identifier to show a reader, never
   * arithmetic, and "" is the honest rendering of "no pid was recorded".
   */
  worker_pid: z.string().default(''),
  /**
   * The exit code of a worker that stopped, or "".
   *
   * Present with `failed` (and `"0"` with `finished`); empty with `ended`, which
   * is precisely the state that means *the status was not recorded*. Empty is
   * therefore never read as success — guessing `finished` from an absent record
   * is the one answer that tells a reader to stop looking.
   */
  worker_exit: z.string().default(''),
  /**
   * What a `stalled` worker left on the floor — the uncommitted files by name.
   *
   * NAMES RATHER THAN A COUNT, and the count was the cheaper option. `stalled`
   * exists so a person can decide whether to resume a branch, and "3
   * uncommitted files" does not support that decision: three scratch notes and
   * three half-finished modules read identically. The names make the row
   * actionable without a second command, which is the only reason to report
   * this rather than merely count it.
   *
   * EMPTY ON EVERY OTHER STATE, deliberately. Beside `finished` the same list
   * is whatever leftovers a merged branch happens to hold, and showing it would
   * invite exactly the reading `stalled` was added to prevent. Editor leftovers
   * (`.tmp*`, `.swp`, `.orig`, `.rej`, `.bak`) and Plot's own `.plot-worker.*`
   * records are already excluded upstream — they are not work.
   */
  worker_dirty_paths: z.array(z.string()).default([]),
  /**
   * Whether a `running` worker's child is doing work — `working`, `idle`, or "".
   *
   * The secondary cue beside `worker: 'running'`. `running` is honest and coarse
   * — it covers a worker mid-thought and a worker whose child crashed hours ago
   * while the loop waited on it — and this says which, without a sixth `worker`
   * state. Empty on every other state, the same absent-value shape
   * `worker_dirty_paths` above uses beside every state but `stalled`: the cue
   * answers nothing where a worker is not running.
   *
   * Measured, not tracked. `plot-worker-state.sh` samples the worker's whole
   * descendant CPU twice and reports the growth — the loop shell is near-zero
   * CPU in every case, so only the CHILD's clock separates a busy worker from a
   * dead one. Defaults to "" so a pulse from an older scan still validates.
   */
  worker_activity: WorkerActivitySchema.default(''),
  /**
   * The files that would collide merging this branch into the default branch.
   *
   * A SET, not a yes/no. `plot-merge-queue.sh` has predicted conflicts since it
   * was written and throws the file list away — the right question for a merge
   * ORDER and the wrong one here: on 2026-08-17 two branches (#176, #177)
   * conflicted in exactly one file, the board artifact, whose resolution is
   * mechanical, while a third needed a person. A boolean cannot tell those
   * apart, and every consumer that wanted to would have had to re-run
   * `merge-tree` itself.
   *
   * Computed by `git merge-tree --write-tree`, which merges ENTIRELY IN MEMORY:
   * no working tree, no index, nothing written. So the conflict is FORESEEN
   * rather than present — nothing here has merged anything.
   *
   * EMPTY MEANS NOTHING ON ITS OWN. Read it only beside `conflicts_known`; the
   * two together are what keep "merges cleanly" and "nobody could ask"
   * distinguishable, and reading this list alone turns every unanswerable branch
   * into a mergeable one.
   *
   * Defaults to [] so a pulse from an older scan still validates — and paired
   * with `conflicts_known`'s own false default, that older pulse says exactly
   * what it knows: nothing.
   */
  conflicts: z.array(z.string()).default([]),
  /**
   * Whether this branch's conflict set was OBSERVED — never whether it is empty.
   *
   * `false` is *not looked at*, and every way of reaching it is the same
   * statement: a git too old for `merge-tree --write-tree` (before 2.38 the
   * command exists and answers a DIFFERENT question, so it succeeds while
   * reporting every branch conflict-free), no ref for the branch, or nothing
   * unlanded to merge — a merged branch, or a bare claim, whose only commit
   * touches no file.
   *
   * Absent is not clean — the rule every other signal in this schema follows,
   * and the one hardest to hold here, because an empty list is the shape both
   * answers arrive in.
   */
  conflicts_known: z.boolean().default(false),
  /**
   * The files this branch changes relative to the default branch, capped.
   *
   * EVIDENCE, never a verdict — one of the three facts a CI failure is reported
   * with (*this branch changes only .md*), so a reader can weigh a failing step
   * against what the branch actually touched.
   *
   * REPORTED, but no longer PRINTED IN THE ROW. Since 2026-08-20 the row states
   * the step and the run history and puts this list behind the `⋯` menu: it is
   * the one of the three that is unbounded and consulted rarely, and six wrapped
   * paths of prose made every reader scroll past it. The field is unchanged and
   * so is the rule — the evidence travels with the state, and the menu is one
   * click on the same pulse, with no fetch.
   *
   * Nothing maps steps to paths, deliberately. That mapping is a table nobody
   * maintains and it goes silently wrong the first time a workflow is
   * restructured; Principle 3 puts the split here — scripts collect and report,
   * humans and skills interpret.
   *
   * Capped by the scan (see `PLOT_CHANGED_PATHS_LIMIT`): two hundred paths tell
   * a reader nothing they can hold in their head, and shipping them through a
   * 5 s poll costs without buying.
   */
  changed_paths: z.array(z.string()).default([]),
});
export type SourceBranch = z.infer<typeof SourceBranchSchema>;

/**
 * One branch's worth of a plan, plus its place in an order.
 *
 * A Slice holds the branches a plan wants landed together and belongs to
 * exactly one plan, which is what distinguishes it from a Wave: a Wave is the
 * FLEET's Wave — slices drawn from several plans, sized by the agents
 * available, assembled at dispatch and persisted nowhere. That entity does not
 * exist in code, and nothing in this package should be read as naming it
 * ([DESIGN-slice.md](../../../../docs/stories/the-master-agent-holds-the-fleet/DESIGN-slice.md)).
 */
export const PlanSliceSchema = z.object({
  name: z.string(),
  verdict: SliceVerdictSchema,
  branches: z.array(SourceBranchSchema),
});
export type PlanSlice = z.infer<typeof PlanSliceSchema>;

/**
 * Rewrites a `waves` key to `slices` on one object, so both wire spellings
 * parse to the same shape.
 *
 * `plot-fleet-scan.sh` is a separate process that ships separately and still
 * emits `waves`, so a board built from this package must read either. Used as a
 * `z.preprocess` step: it runs before validation, leaving Zod to report a
 * malformed value under whichever key carried it.
 *
 * @param value The raw object about to be validated. Anything that is not a
 *   plain object — including `null` and arrays — is returned untouched, so the
 *   schema behind it reports the type error rather than this function.
 * @returns `value` unchanged when it already has `slices` or has neither key;
 *   otherwise a copy with `waves` renamed to `slices`.
 */
const readEitherSpelling = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const object = value as Record<string, unknown>;
  if ('slices' in object || !('waves' in object)) return value;
  const { waves, ...rest } = object;
  return { ...rest, slices: waves };
};

/**
 * A plan and the slices it wants landed, as the scan reports them.
 *
 * Reads `slices` or the older `waves` off the wire and resolves to `slices`.
 * The parsed object exposes `slices` only: `plot-fleet-scan.sh` still emits
 * `waves`, so the inbound tolerance stays, but nothing downstream reads that
 * spelling.
 */
export const PlanSchema = z.preprocess(readEitherSpelling, z.object({
  file: z.string(),
  /**
   * The plan's own lifecycle state, as `plot-plan-meta.sh` normalizes it
   * (draft|approved|delivered|released|…). Half of a row's phase; the branch's
   * git state is the other half, and the two are composed by `rowPhase` rather
   * than by either source.
   *
   * The plan's `Started:` COUNT deliberately does not travel with it. A row is a
   * statement about one branch, and whether THAT branch has work is a question
   * git answers per branch — see `rowPhase`. The count is still what the board's
   * CARD reads, because a card is a statement about the plan.
   *
   * Defaults to "" so a pulse from an older scan still validates — and ""
   * yields no row phase at all, which renders as nothing rather than as a
   * guessed column.
   */
  phase: z.string().default(''),
  slices: z.array(PlanSliceSchema),
}));

/** The raw `plot-fleet-scan.sh --json` document, parsed. */
export const FleetReadingSchema = z.object({
  main: z.string(),
  /**
   * The LOCAL CHECKOUT, and only ever that — despite the name.
   *
   * `head` is `git rev-parse --short HEAD` in the scan, which is the tree the
   * operator is standing on, NOT the ref the scan read (`origin/<main>`). On
   * `main` after a fetch the two agree, which is why the misnomer survived.
   *
   * Kept because the scan still emits it, and read ONLY as a fallback for
   * `local_head` — never for `read_ref`. Mapping it to the ref that was read is
   * the precise bug this pair of fields exists to end.
   */
  head: z.string(),
  /**
   * The ref the scan actually READ — `origin/<main>`, not the local checkout.
   *
   * Optional because it postdates the scan that emits only `head`: a pulse from
   * an older scan (or a bridge file written by one) must still validate. Absent
   * means THE SCAN DID NOT SAY, which is not the same as "the local head", and
   * the two must never collapse — see `readRef` on `FleetSchema`.
   *
   * The scan reports the string `unknown` when `origin/<main>` cannot be
   * resolved at all (no remote, fresh clone). That is a said-so-explicitly
   * absence rather than a silent one, and it is deliberately NOT rewritten to
   * `HEAD`: substituting the local ref where the read ref is unknown
   * reintroduces the original defect exactly where it is hardest to notice.
   */
  read_ref: z.string().optional(),
  /**
   * The local checkout under its honest name, once the scan distinguishes the
   * two. Optional for the same reason as `read_ref`; `head` is its fallback,
   * because `head` has always carried this value.
   */
  local_head: z.string().optional(),
  plans: z.array(PlanSchema),
  /**
   * The scan's tallies, one counter per thing it counted.
   *
   * `waves` keeps its wire name here. This plan renames the ENTITY and the
   * plan's own list of them; the summary is a tally the board both parses and
   * BUILDS (`partialSummary`, `EMPTY_SUMMARY`), so its counter moves with those
   * producers rather than ahead of them.
   *
   * `FleetReadingSchema` is a plain `z.object` for a reason: the board's Fleet
   * view reuses this field through `FleetReadingSchema.shape.summary`, and a
   * preprocessed or transformed schema exposes no `.shape`.
   */
  summary: z.object({
    plans: z.number(),
    waves: z.number(),
    branches: z.number(),
    claimed: z.number(),
    eligible: z.number(),
    blocked: z.number(),
    deferred: z.number(),
    /**
     * Whether the git host answered when the scan asked it about PRs.
     *
     * The EVIDENCE field beside the counters: it says whether they can be
     * believed. `pr-list` is one GraphQL call in place of ~186 REST calls, so
     * throttling takes out every PR answer at once rather than degrading row by
     * row — the whole fleet then reads unmerged and every wave stays blocked,
     * which is indistinguishable from work genuinely in flight.
     *
     * THE TWO FAILURES ARE KEPT APART because they need different responses:
     * `throttled` is a spent budget that refills on a clock, `failed` is a host
     * that cannot be reached and will not clear by waiting.
     *
     * `.catch('unknown')` rather than a bare enum, because this field is
     * PARSED (`pulse-bridge.ts`) rather than cast: a word a later scan adds
     * would otherwise throw and take the whole pulse down, trading a missing
     * notice for a dead board. An unrecognised word reads as *the scan did not
     * say something we understand*, which renders no notice — silence is never
     * a claim, the direction every degradation in this plan takes.
     *
     * Defaults to `unknown` so a pulse from an older scan still validates, and
     * so the two summaries built without a scan behind them (`partialSummary`
     * mid-stream, `EMPTY_SUMMARY` on a cold cache) are not made to assert a
     * health they have no evidence for.
     */
    host: z.enum(['ok', 'throttled', 'failed', 'unknown']).catch('unknown').default('unknown'),
  }),
});
export type FleetReading = z.infer<typeof FleetReadingSchema>;
