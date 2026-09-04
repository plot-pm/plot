import { supervise, type SuperviseDetail } from '@plot-pm/domain/workflows/supervise';
import type { Decision } from '@plot-pm/domain/workflows/decision';

import { readTick, type SupervisorWorld } from '../supervisor.js';
import type { AgentEntry } from '../registry.js';

/**
 * How long the daemon waits between ticks, in milliseconds.
 *
 * **MEASURED FIRST, THEN CHOSEN. 60 seconds.** The plan's open question asks
 * for the tick's own cost before the interval, and {@link TICK_COST_MS} is that
 * cost, taken on this estate with `scripts/measure-tick.mjs`.
 *
 * The interval sits between three cadences already measured on this machine:
 *
 * | cadence | who | cost |
 * |---|---|---|
 * | 5 s | the board's poll | serves in ~250 ms |
 * | 18.3 s | the fleet scan | 12.7 s of it is git |
 * | **60 s** | **this tick** | **~976 ms for 3 agents under load** |
 * | 8 h | the `Worker bound` | the thing being watched |
 *
 * **It does not compete with the board's 5 s poll.** A tick is under a second
 * for this estate, so it lands inside one board interval and is absent from
 * eleven of the next twelve. The scan's 18.3 s is the number it must not
 * approach, and 60 s is over three times it.
 *
 * **Why not shorter.** The tick asks the git host once per agent, and the host
 * is the only reading with an account and a rate limit behind it — 62% of the
 * measured cost. At 60 s and this estate's three agents that is 180 host calls
 * an hour; at 10 s it would be 1,080, buying a stranded desk found 50 seconds
 * sooner.
 *
 * **Why not longer.** The failure this daemon exists for is a worker that died
 * with work committed and no PR; three sat unnoticed for hours on 2026-08-31.
 * An hour-long interval would make the supervisor's own latency comparable to
 * the latency it was built to remove.
 *
 * **It is a floor rather than a schedule.** The daemon waits this long AFTER a
 * tick finishes rather than every this-long, so a slow tick delays the next one
 * instead of overlapping it. Two ticks at once on one registry is the case the
 * plan's open question about a lock is about, and not starting the second is
 * the cheapest way not to need one.
 */
export const TICK_INTERVAL_MS = 60_000;

/**
 * What one tick cost when it was measured, in milliseconds per agent.
 *
 * **Measured 2026-09-04 with `scripts/measure-tick.mjs`, against this estate's
 * three registered agents, host reachable.** Two readings, and both are kept
 * because the difference between them is the point:
 *
 * | machine | mean per tick | per agent | host share |
 * |---|---|---|---|
 * | load ~8 | 421 ms | 140 ms | 62% |
 * | **load ~36** | **976 ms** | **325 ms** | **56%** |
 *
 * **The loaded figure is the one recorded here.** The daemon runs on the
 * machine the fleet runs on, so the idle number describes a condition it will
 * rarely meet — and an interval sized from it would be sized for the case that
 * does not matter.
 *
 * The dominant term is the host call, one `prMerged` per agent, which is why
 * {@link TICK_INTERVAL_MS} is argued from the host's cost rather than the
 * daemon's. Git is the second and disk is noise: 20 ms of the 976.
 *
 * Re-run the script rather than re-deriving this. A number in a comment that
 * nobody can reproduce is a claim.
 */
export const TICK_COST_MS = 976;

/** What one tick of the daemon reported. */
export interface TickReport {
  /** When the tick started, epoch milliseconds. */
  startedAt: number;
  /** What it cost, in milliseconds. */
  costMs: number;
  /** How many agents the registry held. */
  agents: number;
  /** What it decided. */
  decision: Decision<SuperviseDetail>;
}

/** What a daemon needs to run one tick. */
export interface TickOptions {
  /** The registry's manifests, re-read at the start of every tick. */
  registry(): Promise<readonly AgentEntry[]>;
  /** What to read the estate through. */
  world: SupervisorWorld;
  /** How many agents one tick may act on; 0 for no bound. */
  max?: number;
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
 * **It holds nothing between calls.** The registry is re-read at the top of
 * every tick and the previous tick's decision is not consulted, so a daemon
 * SIGKILLed anywhere in this function costs one tick and no state — the next
 * one reaches the same conclusions from the same manifests.
 *
 * @param options - what to read, and the bound.
 * @returns what this tick read and what it decided.
 */
export const tick = async (options: TickOptions): Promise<TickReport> => {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const entries = await options.registry();
  const readings = await readTick(entries, options.world);
  const decision = supervise(readings, { max: options.max ?? 0 });
  return { startedAt, costMs: now() - startedAt, agents: entries.length, decision };
};

/**
 * One line of report per tick, for a log a person reads.
 *
 * Written as counts rather than as a list: a tick over a quiet estate is the
 * common case and a line naming five zeros is what makes an unquiet one
 * visible. The branches themselves are in the decision.
 *
 * @param report - what the tick decided.
 * @returns the line, without its newline.
 */
export const tickLine = (report: TickReport): string => {
  const detail = report.decision.detail;
  return [
    `plot-registryd tick agents=${report.agents}`,
    `left=${detail.left.length}`,
    `reap=${detail.reaping.length}`,
    `correct=${detail.correcting.length}`,
    `person=${detail.needingAPerson.length}`,
    `defer=${detail.deferred.length}`,
    `cost=${report.costMs}ms`,
  ].join(' ');
};
