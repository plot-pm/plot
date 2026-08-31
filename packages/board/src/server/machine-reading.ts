import { machineSystem, shellContext } from '@plot-pm/domain/adapters';
import { measureMachine, isAnswered, type Machine as MachineEntity } from '@plot-pm/domain';
import type { BuildBoardOptions } from './board.js';

/**
 * THE MACHINE READING, TAKEN ON THE SCAN'S CLOCK.
 *
 * `DESIGN-machine.md` §9 asks for *"a single long-lived reading, sampled on a
 * cadence and shared by every consumer — not one per agent, which would
 * multiply the very cost it measures."* This module is that cadence: one
 * measurement per refresh, handed to `maybeAutoDispatch` as a VALUE.
 *
 * ## Why the reading and not the port
 *
 * `planAutoDispatch` is pure and `maybeAutoDispatch` is synchronous, and both
 * are deliberately so — the cross-pulse cap is asserted over repeated calls in
 * a unit test rather than through a live fleet. Measuring is async and forks
 * processes, so it happens HERE and the answer travels as a value. That is the
 * package's stated shape: *"the domain here takes readings as values, not
 * ports — no rule or workflow imports a port or awaits anything."*
 *
 * ## How many samples, and why so few
 *
 * Five. The adapter is time-bounded as well, so the count is the ceiling and
 * the clock is the real bound — but the count still decides what a CLEAR
 * machine pays, since a clear machine never reaches the time budget. Five
 * forks at 4.8 ms is 24 ms against a 5 s cadence; the same five on a starved
 * machine stop at the budget instead of at 1.44 s.
 */

/** How many forks to time. The time budget is what bounds a starved machine. */
const SAMPLES = 5;

/**
 * Measures this machine, or reports that it could not be measured.
 *
 * A FAILED MEASUREMENT IS `unmeasured`, NOT `starved`. `measureMachine` derives
 * the verdict from a null spawn cost as `unmeasured`, and `unmeasured`
 * dispatches — silence is never a refusal, which is the rule that keeps a
 * broken probe from quietly stopping the fleet.
 *
 * @param opts - where the repository is.
 * @returns the reading, its headroom derived from what was measured.
 */
export async function readMachine(opts: BuildBoardOptions): Promise<MachineEntity> {
  const machine = machineSystem(shellContext(opts.repoRoot));
  const measuredAt = Date.now();
  let reading;
  try {
    reading = await machine.measure(SAMPLES);
  } catch {
    // A throw is the same fact as a failure: nothing was measured. It is caught
    // rather than propagated because this runs inside the scan's success path,
    // and a probe that could not fork must not take the whole refresh with it.
    return measureMachine({
      spawnCostMs: null,
      measuredAt,
      sampleMs: 0,
      loadAverage: [0, 0, 0],
      cores: 0,
    });
  }
  if (!isAnswered(reading)) {
    return measureMachine({
      spawnCostMs: null,
      measuredAt,
      sampleMs: 0,
      loadAverage: [0, 0, 0],
      cores: 0,
    });
  }
  return measureMachine({
    spawnCostMs: reading.value.spawnCostMs,
    measuredAt,
    sampleMs: reading.value.sampleMs,
    loadAverage: reading.value.loadAverage,
    cores: reading.value.cores,
  });
}
