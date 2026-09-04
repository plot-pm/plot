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
export * from './rules/sweepable.js';
export * from './rules/prompt.js';
export * from './rules/quiet.js';
export * from './rules/task.js';
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
  Phase,
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
export type * from './ports/trees.js';
export type * from './ports/clock.js';
export type * from './ports/scripts.js';
export type { MachineReading } from './ports/machine.js';
export type { Machine as MachinePort } from './ports/machine.js';
