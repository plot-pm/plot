import { appKeyShell, shellContext } from '@plot-pm/domain/adapters';
import type { AppKeyReading } from '@plot-pm/domain/rules/app-key-start-lines';
import { probeAppKeysAtStart } from '@plot-pm/domain/workflows/app-key-start-probe';

/**
 * Checks every declared App key once and logs one line per key that is missing
 * or unreadable. Holds nothing; a reader that throws is logged as a failed
 * probe and the board goes on serving. Call it after the ready line prints.
 *
 * @param repoRoot - the checkout whose `## Plot Config` declares the keys.
 * @param scriptsDir - the directory holding the helper scripts, or null for the checkout's own.
 * @param log - receives each line.
 * @param read - reads one config key; the adapter by default.
 */
export const probeAppKeysAtBoardStart = (
  repoRoot: string,
  scriptsDir: string | null,
  log: (line: string) => void,
  read?: (configKey: string) => AppKeyReading,
): void => {
  try {
    const context = scriptsDir ? { repoRoot, scriptDir: scriptsDir } : shellContext(repoRoot);
    probeAppKeysAtStart(read ?? ((configKey) => appKeyShell(context, configKey)), (line) => log(`board: ${line}`));
  } catch (error) {
    log(`board: the App key probe failed — ${error instanceof Error ? error.message : String(error)}`);
  }
};
