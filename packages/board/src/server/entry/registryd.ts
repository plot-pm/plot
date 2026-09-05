import { supervise, type SuperviseDetail } from '@plot-pm/domain/workflows/supervise';
import { assign, type AssignDetail, type FleetCap } from '@plot-pm/domain/workflows/assign';
import type { Decision } from '@plot-pm/domain/workflows/decision';

import { readTick, type SupervisorWorld } from '../supervisor.js';
import { readQueue, type QueueWorld } from '../queue-reading.js';
import type { AgentEntry } from '../registry.js';

/**
 * How long the daemon waits between ticks, in milliseconds.
 *
 * **MEASURED FIRST, THEN CHOSEN. 60 seconds.** The plan's open question asks for
 * the tick's own cost before the interval; {@link TICK_COST_MS} is that cost,
 * taken by running the daemon rather than by estimating it.
 *
 * The interval sits among three cadences already measured on this machine:
 *
 * | cadence | who | cost |
 * |---|---|---|
 * | 5 s | the board's poll | serves in ~250 ms |
 * | 18.3 s | the fleet scan | 12.7 s of it is git |
 * | **60 s** | **this tick** | **3.5 s for 3 agents at load 38** |
 * | 8 h | the `Worker bound` | the thing being watched |
 *
 * **A tick is 6% of its own interval, so the daemon is idle 94% of the time.**
 * That headroom is the argument for 60 s rather than a smaller number: the tick
 * is 3.5 s at three agents and its per-agent term grows with the fleet, so an
 * interval close to the measured cost would make a busier estate's ticks
 * overlap. At 60 s this estate could hold roughly ten times the agents before
 * that happens.
 *
 * **It does not compete with the board's 5 s poll.** A tick runs in eleven of
 * every twelve board intervals' worth of silence, and the scan's 18.3 s is the
 * cadence it must not approach — 60 s is over three times it.
 *
 * **Why not shorter.** The tick asks the git host once per agent, and the host
 * is the only reading with an account and a rate limit behind it. At 60 s and
 * three agents that is 180 host calls an hour; at 10 s it would be 1,080, buying
 * a stranded desk found 50 seconds sooner.
 *
 * **Why not longer.** The failure this daemon exists for is a worker that died
 * with work committed and no PR; three sat unnoticed for hours on 2026-08-31.
 * An hour-long interval would make the supervisor's own latency comparable to
 * the latency it was built to remove.
 *
 * **It is waited AFTER a tick rather than between starts.** A slow tick delays
 * the next one instead of overlapping it, so two ticks never run at once on one
 * registry — the cheapest answer to the plan's open question about a lock.
 */
export const TICK_INTERVAL_MS = 60_000;

/**
 * What one tick cost when it was measured, end to end, in milliseconds.
 *
 * **Measured 2026-09-04 by RUNNING THE DAEMON — `plot-registryd.mjs --once`
 * against this repository's three registered agents, host reachable, machine at
 * load ~38.** Five runs: 2662, 3568, 2831, 4581, 3839 ms. **Mean 3496 ms.**
 *
 * **The first number recorded here was 976 ms and it was wrong, which is why
 * this one comes from the daemon rather than from a simulation of it.**
 * `scripts/measure-tick.mjs` timed the host call, the git calls and the disk
 * reads — every reading the plan named — and omitted the plan-store walk the
 * annotation gate needs. Run for real, that walk made a tick cost **10.0-11.5 s**,
 * because `readPlans` reads 172 files and the first daemon asked it once per
 * agent. Reading it once per tick is what brought the tick to the figure above.
 *
 * The lesson is the plan's own: a number nobody ran is a claim. The script is
 * kept because its BREAKDOWN is still the useful part — host 56-62%, git the
 * rest, disk 20 ms of it — but the total belongs to the daemon.
 *
 * **What it costs per agent is not the whole story.** One term is per tick (the
 * plan walk, the machine sample) and one is per agent (the host call, the git
 * reads). At three agents the two are comparable; on a larger fleet the
 * per-agent term dominates, and {@link TICK_INTERVAL_MS} is argued from it.
 */
export const TICK_COST_MS = 3_496;

/** What one tick of the daemon reported. */
export interface TickReport {
  /** When the tick started, epoch milliseconds. */
  startedAt: number;
  /** What it cost, in milliseconds. */
  costMs: number;
  /** How many agents the registry held. */
  agents: number;
  /** What it decided about the agents it supervises. */
  decision: Decision<SuperviseDetail>;
  /**
   * What stopped this tick before it could decide, or `''` when it finished.
   *
   * A tick that could not complete carries the reason here and an EMPTY
   * decision — no writes, no verdicts, nothing half-decided. The next tick
   * re-reads from disk and continues; see {@link tick}.
   */
  incomplete: string;
  /**
   * What it decided about the queue, or null where no queue world was given.
   *
   * **NULL IS *NOBODY ASKED*, NOT *THE QUEUE WAS EMPTY*.** A caller running the
   * supervision half alone gets null; an empty queue gets a decision with no
   * writes. Collapsing them would make a daemon that cannot read the plans
   * indistinguishable from one reading an estate with nothing to hand over.
   */
  handOver: Decision<AssignDetail> | null;
}

/** What a daemon needs to run one tick. */
export interface TickOptions {
  /** The registry's manifests, re-read at the start of every tick. */
  registry(): Promise<readonly AgentEntry[]>;
  /** What to read the estate through. */
  world: SupervisorWorld;
  /**
   * What to read the QUEUE through, or absent to run supervision alone.
   *
   * A second world rather than more members on the first, because the two ask
   * about different things: the supervisor reads what each registered agent
   * LEFT BEHIND, and the queue reads what the plans have WAITING. A tick that
   * cannot reach the plans still supervises every desk.
   */
  queue?: QueueWorld;
  /** How many agents one tick may act on; 0 for no bound. */
  max?: number;
  /**
   * How large the fleet may grow, what the machine says, and the desks this
   * tick is willing to cut — or absent to decide nothing about the fleet's size.
   *
   * **READ ONCE PER TICK, LIKE EVERY OTHER READING.** A cap that changed
   * between the queue read and the decision would let one tick match against a
   * fleet it then sized differently.
   *
   * **ASKED, NOT HELD.** It is a function rather than a value so a tick reads
   * the operator's current cap and the machine's current load; a value captured
   * at daemon start would make a control the board writes take effect only on
   * restart.
   */
  fleet?(): Promise<FleetCap>;
  /** The clock, so a test can hold one. */
  now?(): number;
}

/**
 * Runs ONE tick: re-read the registry, decide, and report.
 *
 * **IT PERFORMS NOTHING.** The decision it returns names every write and makes
 * none, which is the same property every other workflow in this repo has and is
 * what lets a daemon be dry-run against the live estate with no risk at all.
 * The caller applies the writes.
 *
 * **It holds nothing between calls, and that was measured rather than argued.**
 * The registry is re-read at the top of every tick and the previous tick's
 * decision is not consulted. Verified 2026-09-04 against this estate: a looping
 * daemon was `kill -9`ed two seconds into a 3.4 s tick — its log shows the tick
 * never finished — and the next whole tick reached the identical decision,
 * `agents=3 left=3 reap=0 correct=0 person=0 defer=0`. No state file was
 * written, because none is needed.
 *
 * **A TICK THAT CANNOT COMPLETE REPORTS AND DOES NOT THROW.** Every reading is
 * a call to a machine that can refuse — a registry directory removed mid-pass,
 * a git that will not fork, a host adapter that rejects rather than answering
 * `!ok`. Before this, any one of them escaped `tick` and ended the loop in
 * `run`, so the OS supervisor's restart was the ONLY recovery from a reading
 * that would have succeeded a minute later.
 *
 * So the failure becomes a value: {@link TickReport.incomplete} names what
 * stopped it, the decision is empty, and the loop takes its next tick. There is
 * **no journal, no lock file and no resume path**, because there is nothing to
 * resume — the next tick re-reads the registry and the desks from disk, which
 * is what it does after a `kill -9` too. Recovery and normal operation are the
 * same code path, and that is the whole reason the statelessness is worth
 * keeping.
 *
 * @param options - what to read, and the bound.
 * @returns what this tick read and what it decided, or why it could not.
 */
export const tick = async (options: TickOptions): Promise<TickReport> => {
  const now = options.now ?? Date.now;
  const startedAt = now();
  try {
    const entries = await options.registry();
    const readings = await readTick(entries, options.world);
    const decision = supervise(readings, { max: options.max ?? 0 });

    // THE HAND-OVER RUNS AFTER SUPERVISION, WITHIN ONE TICK, and the order is
    // load-bearing: supervision is what frees an agent, by reaping a finished
    // desk or by marking a spent one for a person. Matching first would hand
    // work against a fleet reading taken before this tick's own corrections.
    //
    // BOTH HALVES READ THE SAME REGISTRY LIST. A second read between them would
    // let one tick supervise one set of agents and hand work to another.
    //
    // THE FLEET CAP IS ASKED HERE AND NOWHERE ELSE IN THE TICK, so the size
    // decision reads the same estate the match did. A tick with no `fleet`
    // starts nothing and reports `scaling: null` — *nobody asked*, which is
    // what an operator running the supervision half alone gets.
    const handOver =
      options.queue === undefined
        ? null
        : assign(await readQueue(entries, options.queue), {
            max: options.max ?? 0,
            fleet: options.fleet === undefined ? undefined : await options.fleet(),
          });

    return {
      startedAt,
      costMs: now() - startedAt,
      agents: entries.length,
      decision,
      handOver,
      incomplete: '',
    };
  } catch (error) {
    // THE AGENT COUNT IS ZERO RATHER THAN A GUESS. A tick that failed reading
    // the registry never learnt the count, and one that failed after it would
    // report a number no verdict was reached about — which reads like a tick
    // that decided to leave every agent alone.
    //
    // AND `handOver` IS NULL, WHICH ITS OWN CONTRACT ALREADY SPELLS: null is
    // *nobody asked*. A tick that threw never reached the queue, so it did not
    // ask — an empty decision here would claim it looked and found nothing.
    return {
      startedAt,
      costMs: now() - startedAt,
      agents: 0,
      decision: emptyDecision(),
      handOver: null,
      incomplete: reasonFor(error),
    };
  }
};

/**
 * The decision an incomplete tick carries: no writes, no verdicts.
 *
 * Built here rather than taken from a partial `supervise` run, because a
 * partial run's verdicts were reached on readings the tick could not finish
 * taking. An empty decision says *nothing was decided*, which is true; a
 * truncated one would say *these agents were judged*, which is not.
 *
 * @returns a decision naming no write and no agent.
 */
const emptyDecision = (): Decision<SuperviseDetail> => ({
  outcome: 'decided',
  workflow: 'supervise',
  writes: [],
  detail: { agents: [], left: [], reaping: [], correcting: [], needingAPerson: [], deferred: [] },
});

/**
 * What to call the thing that stopped a tick.
 *
 * One line, because it goes into a log a person scans rather than a report they
 * open. A thrown non-Error is stringified rather than dropped: a rejection with
 * a string in it is still the reason.
 *
 * @param error - whatever was thrown.
 * @returns the reason, on one line and never empty.
 */
const reasonFor = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error);
  const line = text.split('\n')[0]?.trim() ?? '';
  return line === '' ? 'the reading failed and said nothing' : line;
};

/**
 * One line of report per tick, for a log a person reads.
 *
 * Written as counts rather than as a list: a tick over a quiet estate is the
 * common case and a line naming five zeros is what makes an unquiet one
 * visible. The branches themselves are in the decision.
 *
 * **An incomplete tick gets a DIFFERENT line, not a line of zeros.** The counts
 * of a tick that decided nothing and the counts of a tick that could not decide
 * are identical, and they mean opposite things: one is a quiet estate, the
 * other is a supervisor that is not supervising. The word `incomplete` and the
 * reason are what a person greps for, and what says the next tick is the
 * recovery.
 *
 * @param report - what the tick decided, or why it could not.
 * @returns the line, without its newline.
 */
export const tickLine = (report: TickReport): string => {
  if (report.incomplete !== '') {
    return [
      'plot-registryd tick incomplete',
      `reason=${JSON.stringify(report.incomplete)}`,
      `cost=${report.costMs}ms`,
      'next=re-reads',
    ].join(' ');
  }
  const detail = report.decision.detail;
  const fields = [
    `plot-registryd tick agents=${report.agents}`,
    `left=${detail.left.length}`,
    `reap=${detail.reaping.length}`,
    `correct=${detail.correcting.length}`,
    `person=${detail.needingAPerson.length}`,
    `defer=${detail.deferred.length}`,
  ];

  // THE QUEUE'S FIELDS ARE OMITTED WHEN NOBODY ASKED, rather than printed as
  // zeros. `queued=0 handed=0` on a tick that never read the plans says the
  // estate has nothing waiting, which is a claim this tick did not measure.
  if (report.handOver !== null) {
    const queue = report.handOver.detail;
    fields.push(
      `handed=${queue.assignments.length}`,
      `queued=${queue.held.length}`,
      `idle=${queue.idle.length}`,
    );
    // `started=` IS OMITTED WHEN NOBODY ASKED TO SCALE, the same rule the three
    // fields above follow: `started=0` on a tick that never read a cap claims
    // the fleet was already the size it should be, which is a claim this tick
    // did not measure.
    if (queue.scaling !== null) fields.push(`started=${queue.scaling.start}`);
  }

  fields.push(`cost=${report.costMs}ms`);
  return fields.join(' ');
};
