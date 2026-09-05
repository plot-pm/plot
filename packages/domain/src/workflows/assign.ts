import type { Headroom } from '../entities/machine.js';
import { type FleetSize, fleetSize } from '../rules/fleet-size.js';
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
  /**
   * How many agents this pass would bring up, and why not more — or `null`
   * where nobody asked it to scale.
   *
   * **NULL IS *NOBODY ASKED*, NOT *NOTHING WAS NEEDED*.** A pass run without a
   * fleet cap gets null; one run with a cap over a queue nothing was waiting on
   * gets a {@link FleetSize} naming zero. Collapsing them would make a daemon
   * with no cap configured indistinguishable from one over a quiet estate.
   */
  scaling: FleetSize | null;
}

/**
 * What the fleet may grow to, and what the machine says about growing it.
 *
 * **THE CAP IS THE OPERATOR'S AND THE MACHINE IS THE MACHINE'S**, which is why
 * both are here and neither is inferred: an estate with 456 queued slices must
 * not answer by starting 456 agents, and a machine at its bound must be able to
 * give fewer than the cap allows.
 */
export interface FleetCap {
  /** The most agents this machine may run at once. */
  size: number;
  /**
   * What the machine reading came to, as `headroomFor` reads it.
   *
   * A READING, never fetched: the caller sampled the machine, or answered
   * `unmeasured`, which is not `starved`.
   */
  headroom: Headroom;
  /** What one fork cost, for the sentence a shortfall prints; null when unmeasured. */
  spawnCostMs: number | null;
  /**
   * The desk each started agent gets, in the order they are started.
   *
   * **THE DOMAIN DOES NOT INVENT A PATH.** Where a free agent's desk goes is an
   * adapter's answer — it depends on a `Worktree root` this package cannot
   * read — so the caller supplies as many as it is willing to cut and the
   * decision starts at most that many. A shorter list is its own bound, and the
   * shortfall says so.
   */
  desks: readonly string[];
}

/** What one matching pass was asked to bound itself by. */
export interface AssignInput {
  /**
   * How large the fleet may be, and what the machine says — or absent to
   * decide nothing about the fleet's size.
   *
   * **A PASS WITHOUT IT SCALES NOTHING**, which is what keeps this addition
   * inert for every existing caller: no `worker-start` write is emitted and
   * {@link AssignDetail.scaling} is null.
   */
  fleet?: FleetCap;
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

  const held = [...match.held, ...bounded];
  // AN AGENT THE BOUND SPARED IS STILL IDLE, and saying otherwise would make a
  // bounded pass report a busier fleet than it left.
  const idle = [
    ...match.idle,
    ...match.assignments.slice(taken.length).map((assignment) => assignment.session),
  ];

  const scaling = scaleUp(readings, held, input.fleet);
  for (const desk of (input.fleet?.desks ?? []).slice(0, scaling?.start ?? 0)) {
    // THE BRANCH IS EMPTY AND THAT IS THE WHOLE INSTRUCTION. `AgentStartWrite`
    // has carried a branch since it was written and nothing ever applied it;
    // the first thing to apply it starts an agent with NO slice, because
    // `isAgentFree` already reads `branch === ''` as available and the
    // hand-over above is what fills it. A start that named a branch would be
    // the assignment happening twice, in two places, with two locks.
    writes.push({ kind: 'worker-start', branch: '', worktree: desk });
  }

  return decide('assign', writes, { assignments: taken, held, idle, scaling });
};

/**
 * How many agents this pass would bring up, or `null` where nobody asked.
 *
 * **THE TRIGGER IS `queued > running`, AND BOTH ARE COUNTED FROM THIS PASS'S
 * OWN READINGS.** A slice held on `no-free-agent` is work that was ready and
 * had nobody to take it, which is exactly the shortage a new agent answers; a
 * slice held on `no-brief` or `not-claimable` is not, and starting an agent for
 * it would put a worker in front of a gate rather than in front of work.
 *
 * **THE REQUEST IS THE CAP, NOT THE QUEUE.** An estate with 456 queued slices
 * asks for the fleet's size and not for 456 agents; `fleetSize` then subtracts
 * what is running and lets the machine reduce it further. So the daemon grows
 * the fleet TOWARDS its cap while work waits and never past it.
 *
 * **IT IS RE-DERIVED EVERY PASS AND STORED NOWHERE.** The count comes from the
 * queue and the fleet as this pass measured them, so a daemon SIGKILLed between
 * deciding and starting repeats the reading rather than resuming a target —
 * which is the statelessness the tick's own contract rests on.
 *
 * @param readings - the queue and the fleet, as this pass measured them.
 * @param held - the slices that stayed queued, with what held each.
 * @param fleet - the cap and the machine, or undefined to scale nothing.
 * @returns how many to start and why not more, or null where nobody asked.
 */
const scaleUp = (
  readings: QueueReadings,
  held: readonly HeldSlice[],
  fleet: FleetCap | undefined,
): FleetSize | null => {
  if (fleet === undefined) return null;

  const waiting = held.filter((slice) => slice.hold === 'no-free-agent').length;
  // EVERY REGISTERED AGENT COUNTS AS RUNNING, free or busy alike. The question
  // is how many workers this machine is carrying, and a free agent is carrying
  // one — it holds a slot and is about to be handed a slice. Counting only the
  // busy ones would start a second agent beside every idle one every tick.
  const running = readings.agents.length;

  const answer = fleetSize({
    requested: waiting === 0 ? running : fleet.size,
    running,
    spawnCostMs: fleet.spawnCostMs,
    headroom: fleet.headroom,
  });

  // THE DESKS ARE THE CALLER'S SECOND BOUND, and it is reported rather than
  // silently applied: a daemon that could cut only one desk this tick started
  // one agent, and an operator reading `started 1 of 3` must not conclude the
  // machine was busy when the machine said nothing.
  if (answer.start <= fleet.desks.length) return answer;
  return {
    ...answer,
    start: fleet.desks.length,
    shortfall: `started ${fleet.desks.length} of ${answer.start} — only ${fleet.desks.length} desk${fleet.desks.length === 1 ? ' was' : 's were'} offered for this pass`,
  };
};
