import { type AgentReading, isAgentFree } from './free.js';
import type { LandedAnswer } from './landed.js';

/**
 * One slice waiting to be handed to an agent.
 *
 * **DERIVED, NEVER STORED.** An eligible slice with a brief and no claim *is*
 * queued — there is no queue file, no ordering record and nothing to reconcile
 * after a restart. `the-registry-supervises-its-agents` specifies the daemon
 * *"stateless across restarts by construction"*, and a stored queue is the one
 * thing that would break it: a daemon SIGKILLed mid-tick would come back
 * holding assignments nobody can verify against the estate.
 *
 * So every field here is a reading the fleet scan and the brief gate already
 * take. Nothing in this file asks a question that was not already being asked.
 */
export interface QueuedSlice {
  /** The branch, as the plan names it. */
  branch: string;
  /** The plan slug the slice belongs to, for the agent's own scope. */
  slug: string;
  /**
   * Whether a usable brief exists on the ref the agent will read.
   *
   * **A READING, NOT A PATH.** `plot-dispatch.sh`'s `brief_present` asks
   * `git cat-file -s origin/<main>:.plot/briefs/<suffix>.md` and answers
   * readable-and-non-empty; the caller hands that answer through. A rule that
   * took the path would have to decide what *present* means a second time, and
   * the two spellings would drift in the direction that starts an agent with
   * nothing to read.
   */
  briefPresent: boolean;
  /**
   * Whether the slice may be started at all — the fleet scan's `isClaimable`.
   *
   * Taken as a value for the reason every other reading here is: the verdict
   * needs the plan's phase, the slice's ordering and the host's answer about a
   * `waits:` prerequisite, and none of those is this rule's to fetch.
   */
  claimable: boolean;
  /**
   * Whether the host says this branch's work already landed.
   *
   * **A SECOND QUESTION, NOT A SECOND OPINION ON {@link QueuedSlice.claimable}.**
   * The caller's other reading — a remote ref — answers *has somebody started
   * this*, and merging DELETES that ref, so the event that finishes a slice is
   * the same event that returns it to the queue looking untouched. Measured
   * 2026-09-05: of the first three hand-overs this fleet ever decided, two were
   * branches whose PRs had merged an hour earlier.
   *
   * **THE ANSWER IS THE HOST'S `mergedAt`** — {@link landed} over the readings
   * `plot-pr-merged.sh` takes — never a PR's `state` and never ancestry. A
   * merged PR reports `CLOSED`, and squash-merge leaves a branch ahead of the
   * default branch forever.
   *
   * `unknown` is a host that could not be asked, and it HOLDS the slice. That
   * inverts the reaper's direction on purpose: there, *not merged* keeps what
   * was about to be deleted, and here the same word means *offer this to an
   * agent*, so an unreachable host would return every finished branch to the
   * queue at once.
   */
  landed: LandedAnswer;
}

/**
 * One agent the registry may hand a slice to.
 *
 * Carries the manifest's identity beside the reading `free.ts` judges, because
 * the assignment names an agent and {@link AgentReading} deliberately does not:
 * it answers *can this one take work?* and nothing about who it is.
 */
export interface QueueAgent {
  /** The session id the manifest is keyed on — the agent's identity. */
  session: string;
  /** The desk it holds, absolute; the registry writes its manifest, not its tree. */
  worktree: string;
  /** What was measured of it, for {@link isAgentFree}. */
  reading: AgentReading;
}

/** What the registry read when it asked whether it could hand anything over. */
export interface QueueReadings {
  /** Every slice a dispatch handed over, in the order the plans name them. */
  slices: readonly QueuedSlice[];
  /** Every registered agent, in registry order. */
  agents: readonly QueueAgent[];
}

/** One slice, handed to one agent. */
export interface Assignment {
  /** The agent's session id. */
  session: string;
  /** The desk it will work at. */
  worktree: string;
  /** The branch it is handed. */
  branch: string;
  /** That branch's plan slug. */
  slug: string;
}

/** Why a queued slice was not handed to anybody this pass. */
export type QueueHold =
  /** No brief on the ref the agent reads — the hand-over gate refused it. */
  | 'no-brief'
  /** The slice is not startable: its plan, its ordering or a `waits:` prerequisite. */
  | 'not-claimable'
  /** Nothing was free. The queue absorbs the timing; this is not an error. */
  | 'no-free-agent'
  /**
   * The host says this branch's work already merged — the slice is finished.
   *
   * Not a failure and not a queue that drains: the branch leaves the queue for
   * good, and this is what says why it left rather than being handed over.
   */
  | 'already-merged'
  /**
   * The host could not be asked whether this branch landed.
   *
   * **A HOLD RATHER THAN AN OFFER, WHICH INVERTS THE REAPER'S DIRECTION.**
   * Silence there keeps a checkout that would otherwise be deleted; silence
   * here would hand finished work to an agent. So an unreachable host costs
   * this pass its hand-overs and the next tick re-asks.
   */
  | 'merge-unknown';

/** One slice that stayed in the queue, and what held it there. */
export interface HeldSlice {
  /** The branch. */
  branch: string;
  /** What held it. */
  hold: QueueHold;
}

/** What one matching pass made of the queue. */
export interface QueueMatch {
  /** The slices handed over, in the order they were taken. */
  assignments: readonly Assignment[];
  /** The slices that stayed queued, with the reason. */
  held: readonly HeldSlice[];
  /** The agents that were free and got nothing, by session id. */
  idle: readonly string[];
}

/**
 * Whether a slice is ready to be handed to somebody.
 *
 * **THE BRIEF GATE, AT THE HAND-OVER RATHER THAN AT THE LAUNCH.** Its rule is
 * unchanged — a slice with no brief is not handed over — and only its position
 * moved. `plot-dispatch.sh` used to ask it after creating a desk and claiming a
 * branch, so a missing brief left a prepared desk nobody worked at; asked here,
 * the slice simply stays in the queue and no desk exists to strand.
 *
 * `--no-brief` is the operator's override and lives in the shell, where the
 * operator is: it hands over without a brief and says so, which keeps the
 * override on the record. This rule answers what is true of the slice, and a
 * caller carrying the override passes `briefPresent: true` having said so.
 *
 * @param slice - the queued slice.
 * @returns true when the slice may be handed to a free agent.
 */
export const isHandOverReady = (slice: QueuedSlice): boolean =>
  slice.claimable && slice.briefPresent;

/**
 * Why this slice is not ready, or `null` when it is.
 *
 * **IT ASKS {@link isHandOverReady} FIRST** rather than re-deriving the
 * negative, the discipline `whyNotFree` already holds: the word and its
 * explanation cannot then describe different slices.
 *
 * **THE LANDING QUESTION IS ASKED HERE AND NOT IN {@link isHandOverReady}.**
 * That rule reads *claimable and briefed* and was never wrong — it was being
 * told the wrong thing, because the reading that said *nobody has started
 * this* is a remote ref, and merging deletes the ref. So the ref keeps its own
 * question, this one gains a second, and the gate rule is untouched.
 *
 * **THE LANDING IS TESTED FIRST.** A merged branch keeps its brief and its
 * plan, so it answers `claimable` and `briefPresent` exactly as unstarted work
 * does; asked in either other order the hold would read `no-brief` or
 * `not-claimable` and send a reader to fix something that is already finished.
 *
 * @param slice - the queued slice.
 * @returns the hold, or null when the slice is ready.
 */
export const whyNotReady = (slice: QueuedSlice): QueueHold | null => {
  if (slice.landed === 'landed') return 'already-merged';
  if (slice.landed === 'unknown') return 'merge-unknown';
  if (isHandOverReady(slice)) return null;
  return slice.claimable ? 'no-brief' : 'not-claimable';
};

/**
 * Matches queued slices to free agents — the registry's assignment lock.
 *
 * **THERE IS ONE LOCK AND THIS IS IT.** Every agent used to shop for its own
 * branch through `plot-fleet-scan.sh --offline --next`, and git's rejection of a
 * diverged claim push was genuinely all that stopped two agents taking one
 * branch. `DESIGN-branch.md:52` called that push *"the whole locking
 * mechanism"* and was accurate while nothing assigned. Here the registry
 * assigns, so a collision stops being reachable rather than being caught: the
 * push is demoted to a backstop that costs nothing and should never fire, and
 * `plot-worker-loop.sh` logs a rejection as the registry bug it now is.
 *
 * **The two invariants a caller may rely on, and both are structural rather
 * than checked afterwards:**
 *
 * - **one slice to one agent** — a matched agent is removed from the pool, so
 *   no later slice can reach it;
 * - **never the same slice twice** — the loop visits each slice once and takes
 *   at most one assignment from it.
 *
 * **IT REFUSES NOTHING FOR WANT OF A FREE AGENT.** `0 free` ends the pass with
 * every remaining slice held on `no-free-agent`, which is a report and not an
 * error. Making the hand-over synchronous with fleet capacity is the coupling
 * `DESIGN-machine.md` §10 spent two revisions rejecting, and `DESIGN-agent.md:173`
 * states the property from the other side — *"a dispatch never asks the machine
 * for capacity"*. **The queue absorbs the timing.** A queue longer than the pool
 * is the normal case.
 *
 * **ORDER IS THE PLANS' AND NOT A PRIORITY.** Slices are taken as the caller
 * listed them and agents in registry order, so the pass is a function of its
 * readings and two daemons reading one estate reach one answer. Nothing here
 * ranks work; that judgement belongs to whoever writes the plan.
 *
 * @param readings - the queue and the fleet, as one pass measured them.
 * @returns what was handed over, what stayed queued, and who was left idle.
 */
export const matchQueue = (readings: QueueReadings): QueueMatch => {
  const free = readings.agents.filter((agent) => isAgentFree(agent.reading));
  const assignments: Assignment[] = [];
  const held: HeldSlice[] = [];
  let next = 0;

  for (const slice of readings.slices) {
    const hold = whyNotReady(slice);
    if (hold !== null) {
      held.push({ branch: slice.branch, hold });
      continue;
    }

    // THE POOL IS SPENT IN ORDER AND NEVER REVISITED. `next` only advances, so
    // an agent handed a slice is out of reach of every later one — which is the
    // *one slice to one agent* half of the lock, held by the loop's shape
    // rather than by a check that could be forgotten.
    if (next >= free.length) {
      held.push({ branch: slice.branch, hold: 'no-free-agent' });
      continue;
    }

    const agent = free[next];
    next += 1;
    assignments.push({
      session: agent.session,
      worktree: agent.worktree,
      branch: slice.branch,
      slug: slice.slug,
    });
  }

  return {
    assignments,
    held,
    idle: free.slice(next).map((agent) => agent.session),
  };
};
