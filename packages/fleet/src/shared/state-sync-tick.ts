import { stateSyncDue, stateSyncStamp } from '@plot-pm/domain';
import type { Refs } from '@plot-pm/domain/ports/refs';
import type { Scripts } from '@plot-pm/domain/ports/scripts';
import { readRefSnapshot } from '@plot-pm/domain/workflows/plan-walk-cache';

/** The exit code `plot-state-sync.mjs` answers where no `State branch` key is declared. */
export const NO_STATE_BRANCH = 4;

/** The wall-clock bound of one sync run, in ms. */
const RUN_BOUND_MS = 120_000;

/**
 * Reads the stamp of the refs a state-sync run reads, starting no process:
 * the `State branch` key through a cached config read, the default branch and
 * the ref tips through the ref files.
 *
 * @param refs - the ref reader.
 * @param stateKey - reads the `State branch` key; `''` where it is absent.
 * @returns a reader answering the stamp `stateSyncStamp` builds, null where no
 *   key is declared, and undefined where the refs cannot be read.
 */
export const stateSyncStampOf = (
  refs: Refs,
  stateKey: () => Promise<string>,
): (() => Promise<string | null | undefined>) => async () => {
  const key = await stateKey();
  if (key.trim() === '') return null;
  const main = await refs.defaultBranch();
  const snapshot = main.ok ? await readRefSnapshot(refs) : null;
  if (!main.ok || snapshot === null || !snapshot.ok) return undefined;
  return stateSyncStamp(key, main.value, snapshot.value.oidOf);
};

/**
 * One state-sync pass: the forward merge, then the sync PR.
 *
 * Each step runs `plot-state-sync.mjs` through the scripts port. A repository
 * with no key answers exit 4 on the first step and the pass ends silently, so
 * it adds no host call. A refusal or a failure warns once per cause until the
 * cause changes: the tick runs every 60 s and the same conflict would
 * otherwise repeat on every one.
 *
 * Where `stamp` is given, a pass runs only while `stateSyncDue` reads the
 * stamp as moved since the last pass that settled: an idle beat starts no
 * process, and a beat whose stamp is null (no key) starts none either. A
 * stamp that cannot be read (undefined) runs the pass. A pass settles when
 * neither step failed; a failed step leaves the pass due on the next beat.
 *
 * @param scripts - the scripts port.
 * @param warn - receives one line per new cause.
 * @param stamp - reads the stamp of the refs the run reads; every beat runs where absent.
 * @returns the tick to hand to `startFleetClock` as `stateSync`.
 */
export const stateSyncTick = (
  scripts: Pick<Scripts, 'awaited'>,
  warn: (line: string) => void,
  stamp?: () => Promise<string | null | undefined>,
): (() => Promise<void>) => {
  const told = new Map<string, string>();
  let settled: string | null = null;
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
    let parsed: { done?: string; files?: string[]; reason?: string; why?: string } | null = null;
    try {
      parsed = line === '' ? null : JSON.parse(line);
    } catch {
      parsed = null;
    }
    if (run.code === 0 && parsed?.done === 'refused') return `conflict in ${(parsed.files ?? []).join(', ') || 'unnamed files'}`;
    if (run.code === 0) return null;
    const said = parsed?.why ?? parsed?.reason ?? lastLine(run.stderr);
    return `${step} failed (exit ${run.code})${said ? `: ${said}` : ''}`;
  };
  const pass = async (): Promise<boolean> => {
    const forward = await scripts.awaited('board/plot-state-sync.mjs', ['--forward'], { timeoutMs: RUN_BOUND_MS });
    if (forward.code === NO_STATE_BRANCH) return true;
    report('forward', causeOf('forward', forward));
    const pr = await scripts.awaited('board/plot-state-sync.mjs', ['--pr', '--caller', 'fleetd'], { timeoutMs: RUN_BOUND_MS });
    if (pr.code === NO_STATE_BRANCH) return true;
    report('pr', causeOf('pr', pr));
    return forward.code === 0 && pr.code === 0;
  };
  return async () => {
    if (stamp === undefined) {
      await pass();
      return;
    }
    const now = await stamp();
    if (now !== undefined && !stateSyncDue(settled, now)) return;
    const ok = await pass();
    if (ok && now !== undefined) settled = now;
  };
};
