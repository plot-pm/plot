import type { Supervision, SupervisionReadings } from '../rules/supervision.js';
import { supervise as superviseOne } from '../rules/supervision.js';
import { type Decision, type Write, decide } from './decision.js';

/**
 * What ONE tick read of the estate.
 *
 * One entry per registered agent, and nothing else. The daemon reads
 * `.plot/agents/*.json` and the desks they name, and that is the whole of its
 * input — there is no carried state, no queue and no memory of the previous
 * tick, which is what makes `kill -9` cost one tick rather than a decision.
 *
 * A daemon starting for the first time therefore sees exactly what one that has
 * run for a week sees, so agents that died before the daemon existed are picked
 * up by its first tick with no migration and no special case.
 */
export interface SuperviseReadings {
  /** What was measured of each registered agent, in registry order. */
  agents: readonly SupervisionReadings[];
}

/** What one tick was asked to bound itself by. */
export interface SuperviseInput {
  /**
   * How many agents this tick may act on; 0 for no bound.
   *
   * Counted against agents ACTED ON rather than agents read: an agent whose
   * worker is alive consumed nothing, so a bound of one does not spend itself
   * on the first row in the directory.
   */
  max?: number;
}

/** One agent this tick decided about, and what it decided. */
export interface SupervisedAgent {
  /** The branch. */
  branch: string;
  /** The desk. */
  worktree: string;
  /** What the tick decided, and why. */
  supervision: Supervision;
  /** Whether the bound stopped this agent being acted on. */
  boundedOut: boolean;
}

/** What a tick decided, beyond its writes. */
export interface SuperviseDetail {
  /** Every agent read, in registry order, with its verdict. */
  agents: readonly SupervisedAgent[];
  /** The branches this tick would reap. */
  reaping: readonly string[];
  /** The branches it would correct. */
  correcting: readonly string[];
  /** The branches it marked for a person. */
  needingAPerson: readonly string[];
  /** The branches a bound deferred to the next tick. */
  deferred: readonly string[];
  /** The branches whose worker is alive and were left alone. */
  left: readonly string[];
}

/**
 * The tick: reads every registered agent and decides what to do about each.
 *
 * IT NEVER REFUSES AS A WHOLE, the same property `reap` has and for the same
 * reason: the question is asked of each agent separately, and one agent's live
 * worker says nothing about the next one's stranded desk. A tick with nothing
 * to do is a decision with no writes.
 *
 * Every per-agent judgement is {@link superviseOne}'s. This adds the estate:
 * the order the writes are applied in, the bound, and the report. Re-deciding
 * any part of the verdict here would be a second implementation of the tick.
 *
 * **The writes are ordered per agent, and the order is load-bearing.** The
 * attempt count is written BEFORE the correction is handed over, because the
 * reverse leaves a daemon that died between the two having started a retry it
 * did not record — and an unrecorded retry is a budget that never runs out,
 * which is precisely the loop the `needs a person` stop exists to prevent.
 *
 * @param readings - what this tick measured of every registered agent.
 * @param input - the bound this run was given.
 * @returns a decision naming every write, in application order.
 */
export const supervise = (
  readings: SuperviseReadings,
  input: SuperviseInput = {},
): Decision<SuperviseDetail> => {
  const max = input.max ?? 0;
  const writes: Write[] = [];
  const agents: SupervisedAgent[] = [];
  const reaping: string[] = [];
  const correcting: string[] = [];
  const needingAPerson: string[] = [];
  const deferred: string[] = [];
  const left: string[] = [];
  let acted = 0;

  for (const reading of readings.agents) {
    const supervision = superviseOne(reading);

    // A LEFT AGENT IS REPORTED AND NEVER COUNTED. The bound is the operator's
    // limit on what a tick DOES; spending it on agents that are working would
    // make a bounded tick blind to the stranded desk behind them.
    if (supervision.verdict === 'leave') {
      left.push(supervision.branch);
      agents.push({ ...position(supervision), supervision, boundedOut: false });
      continue;
    }

    // `defer` LIKEWISE COSTS NOTHING. Its two causes — no headroom, no progress
    // — are both refusals to act, so counting one against the bound would let a
    // starved machine hide every agent behind it for a tick.
    if (supervision.verdict === 'defer') {
      deferred.push(supervision.branch);
      agents.push({ ...position(supervision), supervision, boundedOut: false });
      continue;
    }

    if (max > 0 && acted >= max) {
      agents.push({ ...position(supervision), supervision, boundedOut: true });
      continue;
    }
    acted += 1;

    if (supervision.verdict === 'reap') {
      reaping.push(supervision.branch);
      // THE REAPER'S GUARDS ARE NOT RE-IMPLEMENTED HERE. `plot-reap.sh` owns
      // five refusals and a stated licence, and this decision calls for the
      // removal rather than authorising it: the performer runs the reaper,
      // which asks its own questions and may still say no.
      writes.push({ kind: 'worktree-remove', path: supervision.worktree });
      writes.push({ kind: 'manifest-clear', worktree: supervision.worktree });
      writes.push({ kind: 'log-clear', branch: supervision.branch });
      agents.push({ ...position(supervision), supervision, boundedOut: false });
      continue;
    }

    if (supervision.verdict === 'needs-a-person') {
      needingAPerson.push(supervision.branch);
      writes.push({
        kind: 'blocked-marker',
        worktree: supervision.worktree,
        branch: supervision.branch,
        question: stopNotice(supervision),
      });
      agents.push({ ...position(supervision), supervision, boundedOut: false });
      continue;
    }

    correcting.push(supervision.branch);
    writes.push({
      kind: 'agent-attempt',
      worktree: supervision.worktree,
      attempts: supervision.nextAttempts,
    });
    writes.push({
      kind: 'agent-resume',
      branch: supervision.branch,
      worktree: supervision.worktree,
      resumeId: supervision.resume.available ? supervision.resume.resumeId : '',
      correction: supervision.correction,
    });
    agents.push({ ...position(supervision), supervision, boundedOut: false });
  }

  return decide('supervise', writes, {
    agents,
    reaping,
    correcting,
    needingAPerson,
    deferred,
    left,
  });
};

/**
 * The branch and desk a verdict is about.
 *
 * @param supervision - the verdict.
 * @returns its position, for a report row.
 */
const position = (supervision: Supervision): Pick<SupervisedAgent, 'branch' | 'worktree'> => ({
  branch: supervision.branch,
  worktree: supervision.worktree,
});

/**
 * What the supervisor leaves on a desk it has stopped working on.
 *
 * Written as a `PLOT-BLOCKED` marker's body, which means it is read by a person
 * rather than by an agent — so it names who stopped, why, and what the person
 * is being asked to decide. The gate failures follow verbatim: they are already
 * the specification of the fix, and the person deciding whether to restart this
 * branch needs the same list the next attempt would have been handed.
 *
 * @param supervision - the verdict that stopped.
 * @returns the marker's body.
 */
const stopNotice = (supervision: Supervision): string => {
  const head =
    supervision.cause === 'agent-blocked'
      ? `PLOT-BLOCKED: the agent on \`${supervision.branch}\` declared itself blocked and stopped. It reported that it cannot proceed, so a correction is not an answer — read its declaration and decide what it needs.`
      : `PLOT-BLOCKED: the supervisor gave up on \`${supervision.branch}\` after ${supervision.nextAttempts} attempts. Decide whether to restart it with \`plot-dispatch.sh --restart\`, finish it by hand, or defer the branch in the plan.`;

  if (supervision.failures.length === 0) return `${head}\n`;
  return [head, '', 'What the gates found:', ...supervision.failures.map((f) => `- ${f}`), ''].join(
    '\n',
  );
};
