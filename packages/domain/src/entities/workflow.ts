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

/**
 * Who leads a phase: a symbol and a word.
 *
 * Carried as both, never as colour alone — roughly one man in twelve
 * distinguishes red from green poorly, and the same page turns up in greyscale
 * screenshots. Colour may only repeat what these say.
 */
export interface PhaseLeadership {
  /** The symbol, shown beside the word rather than instead of it. */
  icon: string;
  /** Who leads the phase, as a word. */
  who: string;
}

/**
 * Who leads each phase.
 *
 * A fact about how a team works, so it belongs beside the phases rather than in
 * the view that draws them.
 */
export const PHASE_LEADERSHIP: Record<Phase, PhaseLeadership> = {
  Discovery: { icon: '👤', who: 'human-led' },
  Design: { icon: '👤', who: 'human-led' },
  Development: { icon: '🤖', who: 'agent-led' },
  Testing: { icon: '👤', who: 'human-led' },
  Released: { icon: '✓', who: 'done' },
};

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
  | 'implement'
  | 'release'
  | 'supervise';

/**
 * The workflows belonging to each phase, in the order a phase performs them.
 *
 * WHAT THIS ADDS: `WorkflowName` is a flat union of eight names, and the phases
 * are an ordered list of five. Nothing connected them, so *which work does this
 * phase name* had no answer in the domain.
 *
 * **THE FLEET'S WORKFLOWS BELONG TO NO PHASE, AND THAT IS THE ASSERTION.**
 * `assign`, `reap` and `supervise` act on **agents and desks**; the five below
 * act on **a plan moving through its lifecycle**. The two sets share no
 * successor relation — reaping a desk does not come after delivering a plan in
 * any sense a workflow could compute — so a list mixing them cannot answer
 * *what comes next*. They are absent here deliberately, not pending.
 *
 * So this is a PARTITION rather than an annotation: {@link phaseOf} answers
 * `null` for those three, and `null` is a stated answer.
 *
 * **NO PHASE IS INVENTED FOR THEM.** A `Fleet` phase would put them back into
 * an ordering they have no place in, and the board would gain a column for work
 * that no plan passes through.
 *
 * Placement follows each workflow's own writes, never a reading of its name:
 *
 * - `Discovery` performs none of these. It produces an approved story, and no
 *   workflow in this package acts on a story.
 * - `Design` ends at `approve`, which writes `State: Approved`.
 * - `Development` holds `dispatch` and `implement` — both act on an already
 *   Approved plan and write no phase — and ends at `deliver`, which writes
 *   `State: Delivered`. That matches the phase's own note that development
 *   ends at the merge.
 * - `Testing` ends at `release`, which writes `State: Released`.
 * - `Released` performs none: it is where work has arrived.
 *
 * A phase performing no workflow gets an empty list, which is a statement that
 * this package expresses none of its work — not that the phase is idle.
 */
export const PHASE_WORKFLOWS: Record<Phase, readonly WorkflowName[]> = {
  Discovery: [],
  Design: ['approve'],
  Development: ['dispatch', 'implement', 'deliver'],
  Testing: ['release'],
  Released: [],
};

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
