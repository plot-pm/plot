import {
  type Assignment,
  type HeldSlice,
  type QueueReadings,
  matchQueue,
} from '../rules/queue.js';
import { type Decision, type Write, decide } from './decision.js';

/** What one matching pass decided, beyond its writes. */
export interface AssignDetail {
  /** Every slice handed over, in the order it was taken. */
  assignments: readonly Assignment[];
  /** Every slice that stayed queued, with what held it. */
  held: readonly HeldSlice[];
  /** The free agents nothing was handed to, by session id. */
  idle: readonly string[];
}

/** What one matching pass was asked to bound itself by. */
export interface AssignInput {
  /**
   * How many slices this pass may hand over; 0 for no bound.
   *
   * An operator's limit on what one pass DOES, the same shape and the same
   * reading `supervise` gives `max`. A slice past the bound is held on
   * `no-free-agent` rather than dropped, because that is what it is from the
   * queue's side: work that stays queued because nothing took it this pass.
   */
  max?: number;
}

/**
 * The hand-over: matches queued slices to free agents and names the writes.
 *
 * **IT PERFORMS NOTHING**, the property every workflow here has — the decision
 * names each manifest it would write and writes none, so a pass can be run
 * against a live estate to see what it would hand over.
 *
 * **IT NEVER REFUSES AS A WHOLE.** There is no `Refusal` variant, and that is
 * the plan's decision rather than an omission: an empty queue, a fleet with
 * nothing free, and a queue of slices that all lack briefs are three reports and
 * none of them is an error. `DESIGN-agent.md:173` — *"a dispatch never asks the
 * machine for capacity"* — and a workflow that could refuse on `0 free` would
 * put that ask back one level up.
 *
 * **Every judgement is {@link matchQueue}'s.** This adds the bound and the
 * writes; re-deciding any part of the match here would be a second
 * implementation of the assignment lock, and two locks is the state this plan
 * exists to leave.
 *
 * @param readings - the queue and the fleet, as one pass measured them.
 * @param input - the bound this pass was given.
 * @returns a decision naming every manifest write, in application order.
 */
export const assign = (
  readings: QueueReadings,
  input: AssignInput = {},
): Decision<AssignDetail> => {
  const max = input.max ?? 0;
  const match = matchQueue(readings);
  const taken = max > 0 ? match.assignments.slice(0, max) : match.assignments;

  // A SLICE THE BOUND STOPPED IS HELD, NOT LOST. It was ready and an agent was
  // free; only this pass's limit stood between them, so it reads `no-free-agent`
  // — the hold that says *still queued, nothing took it* — and the next pass
  // re-derives it from the estate exactly as this one did.
  const bounded: HeldSlice[] = match.assignments
    .slice(taken.length)
    .map((assignment) => ({ branch: assignment.branch, hold: 'no-free-agent' as const }));

  const writes: Write[] = taken.map((assignment) => ({
    kind: 'agent-assign',
    session: assignment.session,
    worktree: assignment.worktree,
    branch: assignment.branch,
    slug: assignment.slug,
  }));

  return decide('assign', writes, {
    assignments: taken,
    held: [...match.held, ...bounded],
    // AN AGENT THE BOUND SPARED IS STILL IDLE, and saying otherwise would make
    // a bounded pass report a busier fleet than it left.
    idle: [
      ...match.idle,
      ...match.assignments.slice(taken.length).map((assignment) => assignment.session),
    ],
  });
};
