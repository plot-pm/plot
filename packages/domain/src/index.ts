/**
 * `@plot-pm/domain` — Plot's entities, and nothing that reaches the world.
 *
 * The package boundary is the point. `contract/schema.ts` was already pure —
 * one import, no disk, no process, no network — so a `src/domain/` directory
 * inside the board would satisfy the same grep today. What it would not do is
 * make the dependency direction ENFORCEABLE: a directory can import
 * `../server/fleet.js`, and eventually something will. A package cannot — the
 * module resolver refuses, with no grep to run and no reviewer to notice.
 *
 * That is the difference between a gate and a rule.
 */
export * from './entities/fleet.js';
export * from './port-result.js';
export * from './entities/identity.js';
export * from './entities/person.js';
export * from './entities/machine.js';
export * from './entities/worktree.js';
export * from './entities/pr.js';
export * from './entities/agent.js';
export * from './entities/declaration.js';
export * from './entities/charter.js';
export * from './entities/ending.js';
export * from './entities/release.js';
export * from './entities/build.js';
export * from './entities/story.js';
export * from './entities/sprint.js';
export * from './entities/issue.js';
export * from './entities/limit.js';
export * from './entities/budget.js';
export * from './entities/wave.js';
export * from './entities/finding.js';
export * from './entities/subscription.js';
export * from './entities/pulse.js';
export * from './entities/channel-message.js';
export * from './rules/deliverable.js';
export * from './rules/reapable.js';
export * from './rules/channel.js';
export * from './rules/eligible.js';
export * from './rules/gates.js';
export * from './rules/resume.js';
export * from './rules/movable.js';
export * from './rules/phase.js';
export * from './rules/pulse.js';
export * from './rules/verdict.js';
export * from './rules/attention.js';
export * from './rules/budget-record.js';
export * from './rules/cadence.js';
export * from './rules/reaction.js';
export * from './rules/concurrency.js';
export * from './rules/refusal.js';
export * from './rules/sample.js';
export * from './rules/acting.js';
export * from './rules/free.js';
export * from './rules/queue.js';
export * from './rules/fleet-size.js';
export * from './rules/sweepable.js';
export * from './rules/prompt.js';
export * from './rules/quiet.js';
export * from './rules/task.js';
export * from './rules/landed.js';
export * from './rules/spend.js';
/**
 * The per-agent half of the tick, disambiguated for the same reason the phase
 * transitions are: `rules/supervision.ts` and `workflows/supervise.ts` both
 * answer to the word `supervise`, and both spellings are right in their own
 * module. The RULE decides about ONE agent; the WORKFLOW runs it over every
 * registered agent and orders the writes.
 *
 * The workflow keeps the plain name because it is what a daemon calling one
 * tick means. The rule takes the qualified one.
 */
export { supervise as superviseAgent, boundRefusal, missingDeclarationFailure, MAX_ATTEMPTS } from './rules/supervision.js';
export type {
  Supervision,
  SupervisionReadings,
  SupervisionVerdict,
  SupervisionCause,
} from './rules/supervision.js';
/**
 * The phase transitions — `plan -> phase + record`, the NARROW question of
 * which `## Status` line a lifecycle step writes.
 *
 * Six names are shared with `workflows/` and disambiguated here, the way
 * `MachinePort` is: a transition answers *what phase does this plan become?*
 * while a workflow answers *what would the whole operation write?*, and the
 * workflow uses the transition to answer its phase half. Both spellings are
 * right in their own module, so neither file is renamed and the barrel — the
 * one place both are in scope — carries the disambiguation.
 *
 * The workflow keeps the plain name because it is what `/plot-approve` means
 * to a caller. An alias in the other direction is what this repo already has
 * one of, and one is enough.
 */
export {
  approve as approveTransition,
  deliver as deliverTransition,
  release as releaseTransition,
  approvable,
  deliverable,
  releasable,
  isDecision,
  isRefusal,
} from './transitions/plan.js';
export type {
  PlanState,
  ReviewChannel,
  TransitionPlan,
  Precondition,
  RefusalReason,
  TransitionResult,
  Decision as PhaseDecision,
  Refusal as PhaseRefusal,
  ApproveInput as ApproveTransitionInput,
  DeliverInput as DeliverTransitionInput,
  ReleaseInput as ReleaseTransitionInput,
} from './transitions/plan.js';

/**
 * The story's transitions, disambiguated the way the plan's are and for the
 * same reason: both files carry a `Decision`, a `Refusal` and a `Precondition`,
 * and both spellings are right in their own module.
 *
 * The SHAPES diverge on purpose. `DESIGN-plan.md:810` says Plan and Story are
 * the two entities whose state is a stated fact, so both decide a write — but a
 * plan writes a `## Status` line and a story writes a frontmatter key plus an
 * `archived:` date, and one `Decision` serving both would abstract over the
 * distinction that gives each its fields.
 *
 * The VERBS are not aliased here: they are declared `setStoryStatus` and
 * `archiveStory` in their own module, because nothing collides with `setStatus`
 * or `archive` today and an alias on an uncollided name is the residue
 * `scripts/count-domain-aliases.sh` holds at zero. The four types below DO
 * collide with `transitions/plan.ts`, which is why they are aliased and the
 * verbs are not.
 */
export {
  setStoryStatus,
  archiveStory,
  storyStatusSettable,
  storyArchivable,
  derivedStanding,
  STORY_LIFECYCLE,
  isDecision as isStoryDecision,
  isRefusal as isStoryRefusal,
} from './transitions/story.js';
export type {
  StoryStanding,
  StoryPlanReading,
  SetStoryStatusInput,
  ArchiveStoryInput,
  Precondition as StoryPrecondition,
  RefusalReason as StoryRefusalReason,
  TransitionResult as StoryTransitionResult,
  Decision as StoryDecision,
  Refusal as StoryRefusal,
} from './transitions/story.js';

/**
 * The agent's transitions, disambiguated the way the plan's and the story's
 * are — the same four type names collide, for the third time.
 *
 * The SHAPE diverges further than the story's did, and the spec says why.
 * `DESIGN-plan.md:810` splits stated state from observed state: a plan and a
 * story state their own, so both decide a WRITE. An agent's is observed, so
 * this `Decision` carries a verdict — `from`, `to` and the component that read
 * it — and nothing to persist. Nothing anywhere writes an `AgentState`.
 *
 * The VERBS are not aliased, for the reason `transitions/story.ts` gives:
 * `observeAgentState`, `endingIsAttributable`, `manifestIsRegistryWritten` and
 * `elsewhereIsHonest` collide with nothing, and an alias on an uncollided name
 * is the residue `scripts/count-domain-aliases.sh` holds at zero.
 */
export {
  observeAgentState,
  agentStateObservable,
  endingIsAttributable,
  manifestIsRegistryWritten,
  elsewhereIsHonest,
  STATE_SOURCE,
  ENDING_ACTORS,
  isDecision as isAgentDecision,
  isRefusal as isAgentRefusal,
} from './transitions/agent.js';
export type {
  StateSource,
  ManifestWriter,
  ObserveStateInput,
  EndingAttributionInput,
  ManifestWriterInput,
  ElsewhereInput,
  Precondition as AgentPrecondition,
  RefusalReason as AgentRefusalReason,
  TransitionResult as AgentTransitionResult,
  Decision as AgentDecision,
  Refusal as AgentRefusal,
} from './transitions/agent.js';

/**
 * The worktree's transitions, disambiguated the way the other three are — the
 * same four type names collide, for the fourth time.
 *
 * A desk's state is OBSERVED, like an agent's, so this `Decision` carries a
 * verdict rather than a write. It adds one field the agent's has no use for:
 * `destroys`, naming what a move costs. Only `reapable -> gone` costs anything,
 * and what it costs is the slice's whole assertion — a checkout, which
 * `git worktree add` restores, and never a ref, which nothing does.
 *
 * The VERBS are not aliased, for the reason the other three give:
 * `observeWorktreeState` and `removalIsRecreatable` collide with nothing, and
 * an alias on an uncollided name is the residue
 * `scripts/count-domain-aliases.sh` holds at zero.
 */
export {
  observeWorktreeState,
  worktreeStateObservable,
  removalIsRecreatable,
  REMOVAL_IS_RECREATABLE,
  isDecision as isWorktreeDecision,
  isRefusal as isWorktreeRefusal,
} from './transitions/worktree.js';
export type {
  RemovalTarget,
  ObserveStateInput as WorktreeObserveStateInput,
  RemovalInput,
  Precondition as WorktreePrecondition,
  RefusalReason as WorktreeRefusalReason,
  TransitionResult as WorktreeTransitionResult,
  Decision as WorktreeDecision,
  Refusal as WorktreeRefusal,
} from './transitions/worktree.js';

/**
 * The lifecycle workflows — `readings -> Decision | Refusal`, deciding and
 * performing nothing. Exported from the pure barrel because they are pure:
 * every rule is reachable from a plain call with no adapter in scope.
 */
export * from './workflows/index.js';

/**
 * The ports — the interfaces the domain owns, and the only shapes through
 * which anything outside it may answer.
 *
 * The adapters are deliberately NOT re-exported here. This barrel is what a
 * pure consumer imports, and an `export *` from `adapters/` would put
 * `node:child_process` on the import graph of every module that reads an
 * entity — making the package's own purity boundary depend on tree-shaking
 * rather than on the module graph. An adapter is imported by its path, by the
 * one composition root that chooses it.
 *
 * `Machine` is exported as `MachinePort`, and only here. The entity and the
 * port genuinely share the name: DESIGN-ports.md §2b says a port is a noun
 * named for what it is asked ABOUT, and the thing being asked about is the
 * Machine entity. Renaming either file would break one of the two specs, so
 * the disambiguation sits at the barrel — the one place both names are in
 * scope — and each module keeps the name its own spec gives it.
 */
export type * from './ports/plan-store.js';
export type * from './ports/refs.js';
export type * from './ports/host.js';
export type * from './ports/budget.js';
export type * from './ports/slots.js';
export type * from './ports/processes.js';
export type * from './ports/performer.js';
export type * from './ports/trees.js';
export type * from './ports/clock.js';
export type * from './ports/scripts.js';
export type { MachineReading } from './ports/machine.js';
export type { Machine as MachinePort } from './ports/machine.js';
