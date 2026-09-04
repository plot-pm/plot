import { supervise, type SuperviseDetail } from '@plot-pm/domain/workflows/supervise';
import type { Decision } from '@plot-pm/domain/workflows/decision';

import { readTick, type SupervisorWorld } from '../supervisor.js';
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
