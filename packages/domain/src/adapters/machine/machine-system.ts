import { cpus, hostname, loadavg } from 'node:os';

import { answered, failed, type PortResult } from '../../port-result.js';
import type { Machine, MachineReading } from '../../ports/machine.js';
import { runProcess } from '../run-script.js';
import type { ShellContext } from '../scripts.js';

/** The cheapest git call there is; what is being timed is the fork, not the work. */
const PROBE = ['rev-parse', '--git-dir'] as const;

/**
 * How long a measurement may spend sampling, in milliseconds.
 *
 * A count-bounded loop costs `samples x spawnCostMs`, so on the machine it is
 * meant to detect it is at its most expensive: 100 forks cost 0.48 s at
 * 4.8 ms/fork and 28.7 s at 287 ms/fork. Measured 2026-08-30 while deciding
 * whether to dispatch — 28.7 s spent asking whether the machine was busy.
 *
 * 250 ms bounds the worst case at roughly one twentieth of the board's 5 s
 * pulse, and is long enough for the ~20 forks a clear machine fits into it.
 */
export const DEFAULT_SAMPLE_BUDGET_MS = 250;

/** The seams a measurement needs, so a starved machine can be stubbed. */
export interface MachineSystemOptions {
  /**
   * How long sampling may run before it stops early, in milliseconds. Defaults
   * to {@link DEFAULT_SAMPLE_BUDGET_MS}.
   */
  sampleBudgetMs?: number;
  /** Runs one probe; defaults to {@link runProcess}. */
  run?: typeof runProcess;
  /** Reads the clock; defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Measures the machine by timing forks, and reports the reading only.
 *
 * The headroom verdict is deliberately not computed here. `headroomFor` in the
 * Machine entity holds that rule, and an adapter that returned a verdict would
 * be an adapter deciding.
 *
 * Sampling is bounded by TIME as well as by count: it stops at `samples`
 * readings or at `sampleBudgetMs` elapsed, whichever comes first, and divides
 * by what it actually took. A reading from three forks is still a reading, and
 * `sampleMs` says what it cost. Bounding by count alone makes the observer
 * most expensive exactly where it is most needed — the story's own complaint
 * reproduced by its fix.
 *
 * The budget is checked AFTER each probe, so at least one is always taken: a
 * measurement that returns without forking has measured nothing, and a zero
 * budget must not be reported as a spawn cost of zero.
 *
 * @param context - where the repository is; the probe runs inside it.
 * @param options - the sampling budget and the clock/process seams for tests.
 * @returns a `Machine` backed by timed forks and `node:os`.
 */
export const machineSystem = (context: ShellContext, options: MachineSystemOptions = {}): Machine => {
  const budgetMs = options.sampleBudgetMs ?? DEFAULT_SAMPLE_BUDGET_MS;
  const run = options.run ?? runProcess;
  const now = options.now ?? Date.now;

  return {
    measure: async (samples): Promise<PortResult<MachineReading>> => {
      if (samples <= 0) return failed<MachineReading>();
      const startedAt = now();
      let taken = 0;
      while (taken < samples) {
        const probe = await run('git', PROBE, { cwd: context.repoRoot });
        if (probe.code !== 0) return failed<MachineReading>();
        taken += 1;
        // Checked after the probe, never before: one reading is the floor, and
        // stopping here is what keeps a starved machine from charging
        // `samples x spawnCostMs` for the answer that it is starved.
        if (now() - startedAt >= budgetMs) break;
      }
      const sampleMs = now() - startedAt;
      const [one = 0, five = 0, fifteen = 0] = loadavg();
      return answered({
        // Divided by what was TAKEN, not by what was asked for. Dividing by
        // `samples` after an early stop would under-report the cost by exactly
        // the factor that made the stop necessary.
        spawnCostMs: sampleMs / taken,
        sampleMs,
        loadAverage: [one, five, fifteen] as const,
        cores: cpus().length,
      });
    },

    hostname: async () => answered(hostname()),

    privateAddress: async () => {
      // `tailscale` is the mesh this machine may be on, and its ABSENCE is the
      // common case: the binary is not installed, or it is installed and not
      // logged in. Both exit non-zero, and both mean *there is no mesh address*
      // rather than *the machine could not be asked* — so the empty answer is
      // `answered('')` and never a failure a caller would report.
      const run = await runProcess('tailscale', ['ip', '-4'], { cwd: context.repoRoot });
      if (run.code !== 0) return answered('');
      // The first line only: `ip -4` prints one address per interface, and a
      // caller building a URL needs one.
      return answered(run.stdout.trim().split('\n')[0]?.trim() ?? '');
    },
  };
};
