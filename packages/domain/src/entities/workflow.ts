/**
 * The development workflow: the phases work passes through, in order, and who
 * leads each.
 *
 * A phase belongs to the WORKFLOW. A plan has a state and a story has a state;
 * both map onto these phases and neither carries one. `rules/phase.ts` holds
 * the two mappings.
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
 * The development workflow as one value: its phases, their order, their leaders.
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
} as const;
