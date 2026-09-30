import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import type { TempSweep } from '../../ports/temp-sweep.js';
import type { ShellContext } from '../scripts.js';
import { scriptsShell } from '../scripts/scripts-shell.js';

/** The marker whose modification time records the last sweep, under the repository root. */
export const TEMP_SWEEP_MARKER = join('.plot', 'state', 'temp-sweep.at');

/**
 * Runs `plot-reap.sh --sweep-temp --yes` and keeps the time of the last run as
 * the modification time of `.plot/state/temp-sweep.at`.
 *
 * The marker is written BEFORE the sweep runs, so a sweep that fails is retried
 * an hour later rather than on every tick.
 *
 * @param context - the repository root and the scripts directory.
 * @returns a `TempSweep` backed by the reaper script and one marker file.
 */
export const tempSweepShell = (context: ShellContext): TempSweep => {
  const marker = join(context.repoRoot, TEMP_SWEEP_MARKER);
  const scripts = scriptsShell(context);
  return {
    lastAt: async () => {
      try {
        return (await stat(marker)).mtimeMs;
      } catch {
        return null;
      }
    },
    sweep: async (): Promise<PortResult<string>> => {
      try {
        await mkdir(dirname(marker), { recursive: true });
        await writeFile(marker, `${new Date().toISOString()}\n`);
      } catch {
        return failed();
      }
      const run = await scripts.awaited('plot-reap.sh', ['--sweep-temp', '--yes']);
      if (run.code !== 0) return failed();
      const summary = run.stdout.split('\n').find((line) => line.startsWith('temp-summary:'));
      return summary === undefined ? failed() : answered(summary);
    },
  };
};
