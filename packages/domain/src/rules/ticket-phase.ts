import { phaseOrder, type Phase } from '../entities/workflow.js';

/** One plan that names a ticket through `Issue:`, as far as the ticket's phase needs it. */
export interface TicketPlan {
  /** The plan's `State:`, lowercased: `draft`, `design`, `approved`, `delivered`, `released`, … */
  readonly state: string;
  /** How many non-deferred slice branches the plan lists; 0 where it lists none. */
  readonly total: number;
  /** How many of those branches merged, or `null` where no merged-PR reading exists for the plan. */
  readonly merged: number | null;
}

/** The phase word a ticket shows, and where it sits in the workflow. */
export interface TicketPhase {
  /** `planning`, `design`, `in progress`, `in progress <merged>/<total>`, `delivered` or `released`. */
  readonly label: string;
  /** Comparable position: lower is less advanced. */
  readonly order: number;
}

interface Placed {
  readonly phase: Phase;
  /** Position inside the phase, where one phase holds two states. */
  readonly rank: number;
  readonly label: (plan: TicketPlan) => string;
}

const PLACED: Readonly<Record<string, Placed>> = {
  draft: { phase: 'Design', rank: 0, label: () => 'planning' },
  design: { phase: 'Design', rank: 1, label: () => 'design' },
  approved: {
    phase: 'Development',
    rank: 0,
    label: (plan) => (plan.merged === null || plan.total === 0 ? 'in progress' : `in progress ${plan.merged}/${plan.total}`),
  },
  delivered: { phase: 'Testing', rank: 0, label: () => 'delivered' },
  released: { phase: 'Released', rank: 0, label: () => 'released' },
};

/**
 * The phase a ticket shows in *Waiting on you*, from the plans that name it.
 *
 * With several plans the least advanced one decides, ordered by
 * {@link phaseOrder} and, inside the Design phase, `draft` before `design`.
 * An Approved plan shows `in progress` with the merged and total slice counts
 * when the plan lists slices and a merged-PR reading exists; without a
 * reading it shows no count, never `0/0`. A plan in a state with no word here
 * (`rejected`, `superseded`) is ignored.
 *
 * @param plans - the plans whose `Issue:` field names the ticket.
 * @returns the label and order key, or `null` when no plan names the ticket.
 */
export const ticketPhase = (plans: readonly TicketPlan[]): TicketPhase | null => {
  let best: { plan: TicketPlan; placed: Placed; order: number } | null = null;
  for (const plan of plans) {
    const placed = PLACED[plan.state];
    if (placed === undefined) continue;
    const order = phaseOrder(placed.phase) * 10 + placed.rank;
    if (best === null || order < best.order) best = { plan, placed, order };
  }
  return best === null ? null : { label: best.placed.label(best.plan), order: best.order };
};

/**
 * Whether every plan naming a ticket is `released` — a ticket in this state
 * has nothing left unfinished and should not keep appearing as waiting work.
 *
 * `[]` answers `false`: a ticket no plan names is unplanned, not
 * released-and-done, and that case belongs to the caller that decides what an
 * absent plan list means, not to this predicate.
 *
 * @param plans - the plans whose `Issue:` field names the ticket.
 * @returns whether every plan in the list is in the `released` state.
 */
export const allReleased = (plans: readonly TicketPlan[]): boolean =>
  plans.length > 0 && plans.every((plan) => plan.state === 'released');

/**
 * Whether every plan naming a ticket is in a state {@link ticketPhase} cannot
 * place (`rejected`, `superseded`, or any other word absent from `PLACED`).
 *
 * `[]` answers `false`, for the same reason {@link allReleased} does: a ticket
 * no plan names is unplanned, not planned-and-dropped, and that distinction
 * belongs to the caller, not to this predicate. A ticket for which this
 * answers `true` is not unplanned — a plan does name it — but `ticketPhase`
 * has no label for it, so a caller that reads `ticketPhase(plans) === null`
 * as "unplanned" would wrongly sort and count it with tickets no plan names
 * at all.
 *
 * @param plans - the plans whose `Issue:` field names the ticket.
 * @returns whether every plan in the list is in a state this rule does not place.
 */
export const allUnplaceable = (plans: readonly TicketPlan[]): boolean =>
  plans.length > 0 && plans.every((plan) => PLACED[plan.state] === undefined);
