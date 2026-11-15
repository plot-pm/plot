import { machineSystem, shellContext } from '@plot-pm/domain/adapters';
import { measureMachine, isAnswered, type Headroom, type HeldSlice, type Machine as MachineEntity } from '@plot-pm/domain';
import type { ConfigReadOptions } from './config-reader.js';

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
export async function readMachine(opts: ConfigReadOptions): Promise<MachineEntity> {
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

/**
 * The queue and machine readings a run start takes its slot from, with the
 * machine read only when a start asks for it.
 */
export interface MachineSlot {
  /** The slices the queue's last pass held, or `null` where no pass has been read. */
  readonly held: readonly HeldSlice[] | null;
  /** Measures the machine and answers its headroom; the caller asks it only for a start that the headroom can refuse. */
  readonly headroom: () => Promise<Headroom>;
  /** Whether `Machine override` is on. */
  readonly machineOverride: boolean;
}

/**
 * Wraps a reading so that it runs on the first call only.
 *
 * @param read - the reading.
 * @returns a function that answers the first call's promise on every call.
 */
export const readOnce = <T>(read: () => Promise<T>): (() => Promise<T>) => {
  let reading: Promise<T> | undefined;
  return () => {
    reading ??= read();
    return reading;
  };
};

/**
 * Asks a start rule with the headroom read only where it can change the answer.
 *
 * The rule is asked once with `unmeasured`, which refuses nothing. Where that
 * answer refuses, the measurement could not admit the start, so the machine is
 * not read. Where it admits and `Machine override` is off, the rule is asked
 * again with the measured headroom.
 *
 * @param slot - the queue and machine readings.
 * @param ask - the start rule, given a headroom.
 * @param admits - whether an answer admits the start.
 * @returns the rule's answer for this pass.
 */
export const askWithHeadroom = async <A>(
  slot: MachineSlot,
  ask: (headroom: Headroom) => A,
  admits: (answer: A) => boolean,
): Promise<A> => {
  const unmeasured = ask('unmeasured');
  if (!admits(unmeasured) || slot.machineOverride) return unmeasured;
  return ask(await slot.headroom());
};
