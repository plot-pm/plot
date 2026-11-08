import type { Scripts } from '@plot-pm/domain/ports/scripts';

/** The exit code `plot-state-sync.mjs` answers where no `State branch` key is declared. */
export const NO_STATE_BRANCH = 4;

/** The wall-clock bound of one sync run, in ms. */
const RUN_BOUND_MS = 120_000;

/**
 * One state-sync pass: the forward merge, then the sync PR.
 *
 * Each step runs `plot-state-sync.mjs` through the scripts port. A repository
 * with no key answers exit 4 on the first step and the pass ends silently, so
 * it adds no host call. A refusal or a failure warns once per cause until the
 * cause changes: the tick runs every 60 s and the same conflict would
 * otherwise repeat on every one.
 *
 * @param scripts - the scripts port.
 * @param warn - receives one line per new cause.
 * @returns the tick to hand to `startFleetClock` as `stateSync`.
 */
export const stateSyncTick = (scripts: Pick<Scripts, 'awaited'>, warn: (line: string) => void): (() => Promise<void>) => {
  const told = new Map<string, string>();
  const report = (step: string, cause: string | null): void => {
    if (cause === null) {
      told.delete(step);
      return;
    }
    if (told.get(step) === cause) return;
    told.set(step, cause);
    warn(`plot-fleetd: state-sync ${step}: ${cause}\n`);
  };
  const lastLine = (text: string): string => text.trim().split('\n').filter((l) => l !== '').pop() ?? '';
  const causeOf = (step: string, run: { stdout: string; stderr: string; code: number }): string | null => {
    const line = lastLine(run.stdout);
    let parsed: { kind?: string; files?: string[]; reason?: string } | null = null;
    try {
      parsed = line === '' ? null : JSON.parse(line);
    } catch {
      parsed = null;
    }
    if (run.code === 0 && parsed?.kind === 'refused') return `conflict in ${(parsed.files ?? []).join(', ') || 'unnamed files'}`;
    if (run.code === 0) return null;
    return `${step} failed (exit ${run.code})${parsed?.reason ? `: ${parsed.reason}` : lastLine(run.stderr) ? `: ${lastLine(run.stderr)}` : ''}`;
  };
  return async () => {
    const forward = await scripts.awaited('plot-state-sync.mjs', ['--forward'], { timeoutMs: RUN_BOUND_MS });
    if (forward.code === NO_STATE_BRANCH) return;
    report('forward', causeOf('forward', forward));
    const pr = await scripts.awaited('plot-state-sync.mjs', ['--pr', '--caller', 'fleetd'], { timeoutMs: RUN_BOUND_MS });
    if (pr.code === NO_STATE_BRANCH) return;
    report('pr', causeOf('pr', pr));
  };
};
