import { phaseOrder, type Phase } from '../entities/workflow.js';

/** One plan that names a ticket through `Issue:`, as far as the ticket's phase needs it. */
export interface TicketPlan {
  /** The plan's slug, from its file name. */
  readonly slug: string;
  /** The plan's title. */
  readonly title: string;
  /** The plan's `Story:` slug; `''` where it names none. */
  readonly story: string;
  /** The plan's `State:`, lowercased: `draft`, `design`, `approved`, `delivered`, `released`, … */
  readonly state: string;
  /** How many non-deferred slice branches the plan lists; 0 where it lists none. */
  readonly total: number;
  /** How many of those branches merged, or `null` where no merged-PR reading exists for the plan. */
  readonly merged: number | null;
}

/** The phase word a ticket shows. */
export interface TicketPhase {
  /** `planning`, `design`, `in progress`, `in progress <merged>/<total>`, `delivered` or `released`. */
  readonly label: string;
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
 * @returns the label, or `null` when no plan names the ticket.
 */
export const ticketPhase = (plans: readonly TicketPlan[]): TicketPhase | null => {
  let best: { plan: TicketPlan; placed: Placed; order: number } | null = null;
  for (const plan of plans) {
    const placed = PLACED[plan.state];
    if (placed === undefined) continue;
    const order = phaseOrder(placed.phase) * 10 + placed.rank;
    if (best === null || order < best.order) best = { plan, placed, order };
  }
  return best === null ? null : { label: best.placed.label(best.plan) };
};

/**
 * Whether a ticket has nothing left that *Waiting on you* shows: every plan
 * naming it is `released`, or is in a state {@link ticketPhase} does not place
 * (`rejected`, `superseded`, or any other word absent from `PLACED`).
 *
 * `[]` answers `false`: a ticket no plan names is unplanned, and the caller
 * decides what an absent plan list means.
 *
 * @param plans - the plans whose `Issue:` field names the ticket.
 * @returns whether the list is non-empty and every plan in it is released or unplaceable.
 */
export const allFinished = (plans: readonly TicketPlan[]): boolean =>
  plans.length > 0 && plans.every((plan) => plan.state === 'released' || PLACED[plan.state] === undefined);

/** States a plan holds once the ticket's work stopped counting on it. */
const WITHDRAWN: ReadonlySet<string> = new Set(['rejected', 'superseded']);

/**
 * Whether a plan whose `Issue:` names a ticket still answers it. A `rejected`
 * or `superseded` plan answers nothing, so its ticket can get a new plan.
 * The ticket card and `POST /api/idea` both read this.
 *
 * @param state - the plan's `State:`, in any case.
 * @returns `false` for `rejected` and `superseded`, `true` for every other state.
 */
export const planAnswersTicket = (state: string): boolean => !WITHDRAWN.has(state.trim().toLowerCase());
