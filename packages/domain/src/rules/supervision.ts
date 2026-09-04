import type { DeclarationReading } from '../entities/declaration.js';
import { isBlocked, isComplete } from '../entities/declaration.js';
import type { Headroom } from '../entities/machine.js';
import type { DeskReadings } from './gates.js';
import { gateFailures } from './gates.js';
import type { ResumeAvailability, ResumeReadings } from './resume.js';
import { correctionPrompt, resumeAvailability } from './resume.js';

/**
 * How many times the supervisor may pick one agent up before it stops.
 *
 * Read against `attempts` and never against `relaunches`. A person's restarts
 * are a separate record with a separate count, so three manual restarts leave
 * this budget untouched and two supervisor retries leave the person's record
 * untouched.
 */
export const MAX_ATTEMPTS = 2;

/**
 * What was measured of ONE agent at one tick.
 *
 * Every field is a reading rather than a judgement, the shape `DeskReadings`
 * and `ResumeReadings` already use — and it carries both of those whole rather
 * than restating their fields, because a second spelling of *what the gates
 * measured* is a second thing to keep in step.
 *
 * Nothing here is the daemon's memory. The tick re-reads all of it, which is
 * what makes `kill -9` cost one tick: there is no state to lose, because the
 * decision is a function of what is on disk.
 */
export interface SupervisionReadings {
  /** The branch this agent holds; `''` between slices is a real value. */
  branch: string;
  /** The desk it works, absolute. */
  worktree: string;
  /**
   * Whether a worker process is alive in that desk.
   *
   * The first question of the tick and the cheapest: a live worker is doing
   * its job, and a supervisor that acted on one would be racing the agent it
   * supervises.
   */
  workerAlive: boolean;
  /** What the agent declared about this branch, or why that could not be read. */
  declaration: DeclarationReading;
  /** What was measured of the desk, for the gates. */
  desk: DeskReadings;
  /** What was measured about resuming this agent's own conversation. */
  resume: ResumeReadings;
  /**
   * The supervisor's own retry count, from the manifest.
   *
   * `attempts`, never `relaunches`. Conflating them lets a person's three
   * manual restarts exhaust the automatic budget, or the reverse.
   */
  attempts: number;
  /**
   * Whether the last worker committed anything.
   *
   * The discriminating bound: it separates *ran out of time* from *was never
   * going to finish*. An agent that died having committed nothing gets no
   * second chance without a person.
   */
  madeProgress: boolean;
  /** The machine's headroom, asked before anything is spawned. */
  headroom: Headroom;
}

/**
 * What the supervisor decided about one agent.
 *
 * FIVE VERDICTS, AND `leave` IS NOT `reap`. A live worker and a finished one
 * both call for no correction, and only one of them has a desk to remove — a
 * supervisor that collapsed them would reap the desk out from under a running
 * agent.
 *
 * - `leave` — a worker is alive. Nothing to do, and nothing to read further.
 * - `reap` — declared complete and every gate passed. The desk may go.
 * - `correct` — the work is unfinished, the bounds allow another try, and the
 *   agent is handed what is missing.
 * - `needs-a-person` — the budget is spent, or the agent stopped and said so.
 *   A visible stop, which is the failure mode to prefer over a loop.
 * - `defer` — a bound said *not now* rather than *not ever*. The machine has no
 *   headroom, or nothing was committed to build on. Re-asked next tick.
 */
export type SupervisionVerdict = 'leave' | 'reap' | 'correct' | 'needs-a-person' | 'defer';

/**
 * Why the supervisor reached its verdict.
 *
 * Named rather than rendered, so a caller branches on the cause instead of
 * matching prose — and so `defer` can say which of its two bounds fired, which
 * is the difference between *wait for the machine* and *this needs a person to
 * look at it*.
 */
export type SupervisionCause =
  | 'worker-alive'
  | 'gates-passed'
  | 'gates-failed'
  | 'declaration-absent'
  | 'declaration-unreadable'
  | 'agent-blocked'
  | 'budget-spent'
  | 'no-progress'
  | 'no-headroom';

/**
 * What one agent's tick decided, and everything a caller needs to act on it.
 *
 * The correction and the resume handle travel WITH the verdict rather than
 * being re-derived by the caller: the gate failures are the specification of
 * the fix, and a caller that re-ran the gates to build the prompt would be
 * running them twice against a desk that may have changed between the two.
 */
export interface Supervision {
  /** What to do about this agent. */
  verdict: SupervisionVerdict;
  /** Why. */
  cause: SupervisionCause;
  /** The branch the verdict is about. */
  branch: string;
  /** The desk it is about. */
  worktree: string;
  /** One message per failed gate, in `ALL_GATES` order; empty when none failed. */
  failures: readonly string[];
  /**
   * What to hand the next attempt; `''` when there is no next attempt.
   *
   * The same text serves both paths — a resumed agent reads it as *what you
   * left undone*, a fresh worker reads it in its brief — which is why the
   * branch is named in it rather than assumed from context.
   */
  correction: string;
  /**
   * Whether the correction can be delivered into the agent's own conversation.
   *
   * Carried even on a verdict that is not `correct`, so a report can say *this
   * agent could not have been resumed anyway* without asking a second time.
   */
  resume: ResumeAvailability;
  /** What `attempts` becomes if this verdict is acted on. */
  nextAttempts: number;
}

/**
 * Whether the supervisor may pick this agent up again.
 *
 * THREE BOUNDS, ALL OF WHICH MUST HOLD, and they refuse in three different
 * ways on purpose. A spent budget is terminal and marks the agent for a person;
 * no progress and no headroom are both *not now*, and the tick re-asks them.
 *
 * A supervisor that relaunched unconditionally would be a fork bomb with good
 * intentions.
 *
 * @param readings - what was measured of the agent.
 * @returns the cause that refused, or null when every bound allows a retry.
 */
export const boundRefusal = (
  readings: Pick<SupervisionReadings, 'attempts' | 'madeProgress' | 'headroom'>,
): Extract<SupervisionCause, 'budget-spent' | 'no-progress' | 'no-headroom'> | null => {
  if (readings.attempts >= MAX_ATTEMPTS) return 'budget-spent';
  if (!readings.madeProgress) return 'no-progress';
  if (readings.headroom !== 'clear') return 'no-headroom';
  return null;
};

/**
 * What to tell an agent that left no believable declaration.
 *
 * Written in the gates' own register — a sentence naming what is missing and
 * what to do about it — because it lands in the same list and is read by the
 * same agent. `absent` and `unreadable` get different words: the first never
 * reached the write, the second wrote bytes that do not parse, and an agent
 * told to *write the file* when the file is there and malformed will write it
 * the same wrong way again.
 *
 * @param branch - the branch the declaration should be about.
 * @param reading - what the desk's declaration was read as.
 * @returns the failure, phrased to be pasted into a correction.
 */
export const missingDeclarationFailure = (
  branch: string,
  reading: DeclarationReading,
): string => {
  if (reading.read === 'unreadable') {
    return `The declaration in the worktree for \`${branch}\` does not parse: ${reading.why}. Rewrite \`.plot-worker.envelope.json\` as JSON with \`branch\` and \`status\` (\`ok\` or \`blocked\`), plus \`artifacts\`, \`pr\` and \`summary\`.`;
  }
  if (reading.read === 'declared') {
    return `The declaration for \`${branch}\` says \`blocked\`, so the branch is not finished. Resolve what stopped it, then rewrite \`.plot-worker.envelope.json\` with \`"status": "ok"\`.`;
  }
  return `No declaration was written for \`${branch}\`. A branch is finished when \`.plot-worker.envelope.json\` says so — absence means the work did not complete, whatever the exit code was. Write it in the worktree, naming the branch, \`"status": "ok"\`, the artifacts, the PR number and one sentence of summary.`;
};

/**
 * Decides what the supervisor does about one agent, from what it read.
 *
 * THE TICK, FOR ONE AGENT. The order of the questions is the design and not a
 * formality: liveness first because a live worker must never be acted on, the
 * declaration second because it is the agent's own account and outranks every
 * derived signal, and the bounds last because they only ever decide whether a
 * retry the earlier questions already called for may happen.
 *
 * Pure and synchronous. It reads no disk, spawns nothing and holds nothing
 * between calls — so a daemon that was SIGKILLed mid-tick reaches the same
 * verdict on the next one from the same files.
 *
 * @param readings - what was measured of the agent at this tick.
 * @returns the verdict, its cause, and what a caller needs to act on it.
 */
export const supervise = (readings: SupervisionReadings): Supervision => {
  const resume = resumeAvailability(readings.resume);
  const at = (
    verdict: SupervisionVerdict,
    cause: SupervisionCause,
    failures: readonly string[],
    nextAttempts: number,
  ): Supervision => ({
    verdict,
    cause,
    branch: readings.branch,
    worktree: readings.worktree,
    failures,
    correction: verdict === 'correct' ? correctionPrompt(readings.branch, failures) : '',
    resume,
    nextAttempts,
  });

  // A LIVE WORKER IS ANSWERED FIRST AND NOTHING ELSE IS READ. The gates read
  // what an agent LEFT BEHIND, and a running agent has left nothing behind yet
  // — every one of them would fail on a desk mid-work.
  if (readings.workerAlive) return at('leave', 'worker-alive', [], readings.attempts);

  // AN AGENT THAT STOPPED AND SAID SO GOES STRAIGHT TO A PERSON. `blocked` is
  // a question, and a correction prompt is not an answer to one: resuming here
  // would hand the agent back the problem it already reported it could not
  // solve. This is why the declaration has two values rather than one.
  if (isBlocked(readings.declaration)) {
    return at('needs-a-person', 'agent-blocked', [], readings.attempts);
  }

  const failures = [...gateFailures(readings.desk)];

  // COMPLETE MEANS DECLARED `ok` AND EVERY GATE PASSED, and both halves are
  // load-bearing. The declaration is the agent's claim; the gates are what was
  // measured of the desk. A claim nobody checked is what this plan replaced.
  if (isComplete(readings.declaration) && failures.length === 0) {
    return at('reap', 'gates-passed', [], readings.attempts);
  }

  // A MISSING DECLARATION IS ITSELF A FAILURE TO CORRECT, and it has to be
  // spelled out here because no gate reads one — the gates read the desk, and
  // `absence means incomplete` is a rule about the agent's account rather than
  // about what it left behind. Without this line an agent whose desk passes
  // every gate and declared nothing would be handed an empty correction: told
  // its work did not complete, and not told what to do.
  if (!isComplete(readings.declaration)) {
    failures.push(missingDeclarationFailure(readings.branch, readings.declaration));
  }

  const refusal = boundRefusal(readings);
  if (refusal === 'budget-spent') {
    return at('needs-a-person', 'budget-spent', failures, readings.attempts);
  }
  if (refusal !== null) return at('defer', refusal, failures, readings.attempts);

  // THE CAUSE NAMES WHICH READING CALLED FOR THE RETRY, and the three are not
  // one. `absent` is an agent that never got to speak — the load-bearing case,
  // and the one the `Worker bound` produces. `unreadable` is bytes nobody can
  // believe. `gates-failed` is an agent that declared `ok` over a desk that
  // does not bear it out.
  const cause: SupervisionCause = isComplete(readings.declaration)
    ? 'gates-failed'
    : readings.declaration.read === 'unreadable'
      ? 'declaration-unreadable'
      : 'declaration-absent';

  return at('correct', cause, failures, readings.attempts + 1);
};
