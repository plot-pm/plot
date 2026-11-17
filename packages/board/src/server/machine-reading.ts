import { accountSpend, measureMachine, type Machine } from '@plot-pm/domain';
import { budgetAccount, budgetFile, machineSystem, shellContext } from '@plot-pm/domain/adapters';
import type { FleetMachine, MachineBudget } from '../contract/schema.js';

/** How long one reading serves every `/api/fleet` poll, in milliseconds. */
export const MACHINE_REFRESH_MS = 60_000;

/** How many forks one measurement times; the count `fleetCapForRepo` uses. */
const MACHINE_SAMPLES = 5;

/** The seams one reader needs; each substitutable in a test. */
export interface MachineReaderDeps {
  /** Takes one measurement of the machine; null where it failed. */
  measure: () => Promise<Machine | null>;
  /** Reads the host's budget buckets for a connector; null where the record is unread. */
  budgets: (connector: string) => Promise<readonly MachineBudget[] | null>;
  now: () => number;
}

/**
 * Builds the reader behind the payload's `machine` field.
 *
 * Measures at most once per {@link MACHINE_REFRESH_MS} and serves that reading to every call inside the window, because
 * each measurement forks processes and the poll runs every 4 s. A failed measurement is held for the same window and
 * reads `unmeasured`; the next call after the window measures again. Concurrent calls share one measurement. A change
 * of connector name re-reads the budget, never the machine.
 *
 * @param deps - the measurement, the budget read and the clock.
 * @returns a function answering the current reading for the named connector, or null connector for none.
 */
export const machineReader = (deps: MachineReaderDeps) => {
  let machine: { at: number; reading: Promise<Machine | null> } | null = null;
  let budget: { at: number; connector: string; reading: Promise<readonly MachineBudget[] | null> } | null = null;
  return async (connector: string | null): Promise<FleetMachine> => {
    const now = deps.now();
    if (machine === null || now - machine.at >= MACHINE_REFRESH_MS) {
      machine = { at: now, reading: deps.measure().catch(() => null) };
    }
    if (connector !== null && connector !== '' && (budget === null || budget.connector !== connector || now - budget.at >= MACHINE_REFRESH_MS)) {
      budget = { at: now, connector, reading: deps.budgets(connector).catch(() => null) };
    }
    const measured = await machine.reading;
    const buckets = connector !== null && connector !== '' && budget !== null ? await budget.reading : null;
    return {
      headroom: measured?.headroom ?? 'unmeasured',
      load1: measured?.loadAverage[0] ?? null,
      cores: measured?.cores ?? null,
      host: connector === null || connector === '' || buckets === null ? null : { connector, buckets: [...buckets] },
    };
  };
};

/**
 * The reader for one repository, over the real machine and the budget record.
 *
 * The budget comes from the record's files and starts no host call.
 *
 * @param repoRoot - the repository root.
 */
export const machineReaderFor = (repoRoot: string) => {
  const account = budgetAccount({ repoRoot });
  const record = budgetFile();
  return machineReader({
    measure: async () => {
      const started = Date.now();
      const reading = await machineSystem(shellContext(repoRoot)).measure(MACHINE_SAMPLES);
      return reading.ok ? measureMachine({ ...reading.value, measuredAt: started }) : null;
    },
    budgets: async (connector) => {
      const lines = await record.lines();
      if (!lines.ok) return null;
      const spend = accountSpend(lines.value, connector, await account(connector), Date.now());
      return [...spend.buckets].map(([bucket, rate]) => ({
        bucket,
        limit: rate.reading?.limit ?? null,
        remaining: rate.headroom,
        resetAt: rate.reading?.resetAt ?? null,
      }));
    },
    now: Date.now,
  });
};
