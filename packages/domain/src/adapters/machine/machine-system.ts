import { cpus, hostname, loadavg } from 'node:os';

import { answered, failed, type PortResult } from '../../port-result.js';
import type { Machine, MachineReading } from '../../ports/machine.js';
import { runProcess } from '../run-script.js';
import type { ShellContext } from '../scripts.js';

/** The cheapest git call there is; what is being timed is the fork, not the work. */
const PROBE = ['rev-parse', '--git-dir'] as const;

/**
 * Measures the machine by timing forks, and reports the reading only.
 *
 * The headroom verdict is deliberately not computed here. `headroomOf` in the
 * Machine entity holds that rule, and an adapter that returned a verdict would
 * be an adapter deciding.
 *
 * @param context - where the repository is; the probe runs inside it.
 * @returns a `Machine` backed by timed forks and `node:os`.
 */
export const machineSystem = (context: ShellContext): Machine => ({
  measure: async (samples): Promise<PortResult<MachineReading>> => {
    if (samples <= 0) return failed<MachineReading>();
    const startedAt = Date.now();
    for (let taken = 0; taken < samples; taken += 1) {
      const run = await runProcess('git', PROBE, { cwd: context.repoRoot });
      if (run.code !== 0) return failed<MachineReading>();
    }
    const sampleMs = Date.now() - startedAt;
    const [one = 0, five = 0, fifteen = 0] = loadavg();
    return answered({
      spawnCostMs: sampleMs / samples,
      sampleMs,
      loadAverage: [one, five, fifteen] as const,
      cores: cpus().length,
    });
  },

  hostname: async () => answered(hostname()),
});
