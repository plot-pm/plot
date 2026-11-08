import { describe, expect, it } from 'vitest';

import { stateSyncTick } from '../../src/shared/state-sync-tick.js';
import { fleetDivisors } from '../../src/shared/fleet-clock.js';

type Run = { stdout: string; stderr: string; code: number };
const scriptsOf = (answers: Run[]) => {
  const calls: string[][] = [];
  return {
    calls,
    awaited: async (_s: string, args: readonly string[]): Promise<Run> => {
      calls.push([...args]);
      return answers.shift() ?? { stdout: '', stderr: '', code: 0 };
    },
  };
};
const ok = (kind: string, extra = {}): Run => ({ stdout: `${JSON.stringify({ kind, ...extra })}\n`, stderr: '', code: 0 });

describe('stateSyncTick', () => {
  it('ends silently after one call where no key is declared', async () => {
    const scripts = scriptsOf([{ stdout: '', stderr: '', code: 4 }]);
    const warned: string[] = [];
    await stateSyncTick(scripts, (l) => warned.push(l))();
    expect(scripts.calls).toEqual([['--forward']]);
    expect(warned).toEqual([]);
  });
  it('runs the forward step, then the sync PR step as fleetd', async () => {
    const scripts = scriptsOf([ok('idle'), ok('none')]);
    await stateSyncTick(scripts, () => undefined)();
    expect(scripts.calls).toEqual([['--forward'], ['--pr', '--caller', 'fleetd']]);
  });
  it('warns once per cause and again after the cause clears', async () => {
    const conflict = ok('refused', { files: ['docs/plans/a.md'] });
    const scripts = scriptsOf([conflict, ok('none'), conflict, ok('none'), ok('idle'), ok('none'), conflict, ok('none')]);
    const warned: string[] = [];
    const tick = stateSyncTick(scripts, (l) => warned.push(l));
    await tick();
    await tick();
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('conflict in docs/plans/a.md');
    await tick();
    await tick();
    expect(warned).toHaveLength(2);
  });
  it('warns on a failed step with its exit code', async () => {
    const scripts = scriptsOf([{ stdout: '', stderr: 'boom\n', code: 1 }, ok('none')]);
    const warned: string[] = [];
    await stateSyncTick(scripts, (l) => warned.push(l))();
    expect(warned[0]).toContain('forward failed (exit 1): boom');
  });
});

describe('fleetDivisors', () => {
  it('runs state-sync at the PR cadence', () => {
    const d = fleetDivisors();
    expect(d.find((x) => x.name === 'state-sync')?.everyNthBeat).toBe(d.find((x) => x.name === 'pr-reader')?.everyNthBeat);
  });
});
