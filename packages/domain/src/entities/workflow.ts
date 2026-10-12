import { DEFAULT_PHASE_MAP, PHASE_LEADERSHIP, phaseWorkflows } from '../rules/workflow-phases.js';

/**
 * The development workflow: the phases work passes through, in order, who leads
 * each, and the work each one names.
 *
 * A phase belongs to the WORKFLOW. A plan has a state and a story has a state;
 * both map onto these phases and neither carries one. `rules/phase.ts` holds
 * the two mappings.
 *
 * The fleet's workflows belong to no phase here, by assertion rather than by
 * omission — see {@link PHASE_WORKFLOWS}.
 */

/**
 * The phases of the development workflow, in the order work passes through them.
 *
 * Each names work performed, not a record of what happened:
 *
 * - `Discovery` — finding out what should be built. It produces an approved
 *   story: brainstormed, challenged, agreed.
 * - `Design` — answering a question approval cannot, by spike, tracer bullet or
 *   spec against reality. It produces approved, dispatchable plans.
 * - `Development` — dispatching and implementing. An approved plan is here
 *   whether or not a branch has started: unstarted work waits for an agent.
 * - `Testing` — reviewing, reaping and proving the thing works. Development
 *   ends at the merge, so a delivered plan is here.
 * - `Released` — tagged and shipped.
 *
 * Five rather than one per plan state: Delivered and Released are both work
 * that has landed, and a phase is a partition.
 *
 * Named `BOARD_PHASES` because the board renders one column per phase and
 * `z.enum(BOARD_PHASES)` types the wire field. The board reads this list; it
 * does not own it.
 */
export const BOARD_PHASES = [
  'Discovery', 'Design', 'Development', 'Testing', 'Released',
] as const;

/** One phase of the development workflow. */
export type Phase = (typeof BOARD_PHASES)[number];

export { PHASE_LEADERSHIP } from '../rules/workflow-phases.js';
export type { PhaseLeadership } from '../rules/workflow-phases.js';

/**
 * A phase's position in the workflow, counting from zero.
 *
 * Data rather than a gate: the state transitions decide what may happen next,
 * and a second enforcer here could only disagree with them. Compare two
 * positions to order two phases; nothing refuses on the answer.
 *
 * @param phase - the phase to place.
 * @returns its index in {@link BOARD_PHASES}.
 */
export const phaseOrder = (phase: Phase): number => BOARD_PHASES.indexOf(phase);

/**
 * The workflows this package expresses.
 *
 * Lives here rather than in `workflows/decision.ts` because the phases below
 * must name their workflows, and `entities/` may not import `workflows/` — the
 * dependency runs the other way. A workflow's NAME is vocabulary; its decision
 * machinery is not, and that stays where it was. `decision.ts` re-exports this,
 * so every existing import path is unchanged.
 */
export type WorkflowName =
  | 'approve'
  | 'assign'
  | 'deliver'
  | 'dispatch'
  | 'reap'
  | 'reconcile'
  | 'implement'
  | 'release'
  | 'merge'
  | 'supervise'
  | 'agent-loop';

/**
 * The workflows belonging to each phase, in the order a phase performs them.
 *
 * Derived, not listed: {@link phaseWorkflows} places each lifecycle workflow in the first
 * declared phase holding a state it acts on, applied here to {@link DEFAULT_PHASE_MAP}.
 * `approve` acts on `draft` and `design`; `dispatch`, `implement` and `deliver` act on
 * `approved`; `release` acts on `delivered`.
 *
 * **THE FLEET'S WORKFLOWS BELONG TO NO PHASE, AND THAT IS THE ASSERTION.**
 * `assign`, `reap`, `supervise` and `agent-loop` act on **agents and desks**; the five above
 * act on **a plan moving through its lifecycle**. The two sets share no successor relation, so
 * a list mixing them cannot answer *what comes next*. They are absent deliberately, and
 * {@link phaseOf} answers `null` for them: `null` is a stated answer. No phase is invented for
 * them.
 *
 * A phase acting on no workflow gets an empty list, which states that this package expresses
 * none of its work, not that the phase is idle.
 */
export const PHASE_WORKFLOWS = phaseWorkflows(DEFAULT_PHASE_MAP) as Record<Phase, readonly WorkflowName[]>;

/**
 * The phase a workflow belongs to, or `null` where it belongs to none.
 *
 * `null` IS AN ANSWER. The fleet's three workflows act on agents and desks
 * rather than on a plan's lifecycle, so they sit outside the phases by
 * assertion — a caller reading `null` has learned that, not failed to find
 * something.
 *
 * Data rather than a gate, exactly as {@link phaseOrder} is: nothing refuses on
 * this answer. The state transitions decide what may happen next, and a second
 * enforcer here could only disagree with them.
 *
 * @param workflow - the workflow to place.
 * @returns its phase, or `null` when it belongs to no phase.
 */
export const phaseOf = (workflow: WorkflowName): Phase | null =>
  BOARD_PHASES.find((phase) => PHASE_WORKFLOWS[phase].includes(workflow)) ?? null;

/**
 * The development workflow as one value: its phases, their order, their leaders,
 * and the work each phase names.
 *
 * A frozen record rather than a class — the workflow holds no state and
 * performs no I/O, so there is nothing to construct.
 */
export const DevelopmentWorkflow = {
  /** The phases, in the order work passes through them. */
  phases: BOARD_PHASES,
  /** Who leads each phase. */
  leadership: PHASE_LEADERSHIP,
  /** A phase's position, counting from zero. */
  order: phaseOrder,
  /** The workflows each phase performs, in the order it performs them. */
  workflows: PHASE_WORKFLOWS,
  /** The phase a workflow belongs to, or `null` for the fleet's. */
  phaseOf,
} as const;
