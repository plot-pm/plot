import { describe, expect, it } from 'vitest';

import { refsFixture } from '@plot-pm/domain/adapters/refs/refs-fixture';

import { stateSyncStampOf, stateSyncTick } from '../../src/shared/state-sync-tick.js';
import { fleetDivisors } from '../../src/shared/fleet-clock.js';

type Run = { stdout: string; stderr: string; code: number };
const scriptsOf = (answers: Run[]) => {
  const calls: string[][] = [];
  const names: string[] = [];
  return {
    calls,
    names,
    awaited: async (name: string, args: readonly string[]): Promise<Run> => {
      names.push(name);
      calls.push([...args]);
      return answers.shift() ?? { stdout: '', stderr: '', code: 0 };
    },
  };
};
// The shape `plot-state-sync.mjs` prints: `{"done":…}`, one line.
const ok = (done: string, extra = {}): Run => ({ stdout: `${JSON.stringify({ done, ...extra })}\n`, stderr: '', code: 0 });

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
  it('asks for the bundle where build.mjs ships it, under board/', async () => {
    const scripts = scriptsOf([ok('idle'), ok('none')]);
    await stateSyncTick(scripts, () => undefined)();
    expect(scripts.names).toEqual(['board/plot-state-sync.mjs', 'board/plot-state-sync.mjs']);
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
  it('names the reason a failed report gives in its why field', async () => {
    const scripts = scriptsOf([{ stdout: '{"done":"failed","why":"the origin could not be asked"}\n', stderr: 'plot-state-sync: x\n', code: 1 }, ok('none')]);
    const warned: string[] = [];
    await stateSyncTick(scripts, (l) => warned.push(l))();
    expect(warned[0]).toContain('forward failed (exit 1): the origin could not be asked');
  });
});

describe('fleetDivisors', () => {
  it('runs state-sync at the PR cadence', () => {
    const d = fleetDivisors();
    expect(d.find((x) => x.name === 'state-sync')?.everyNthBeat).toBe(d.find((x) => x.name === 'pr-reader')?.everyNthBeat);
  });
});

describe('stateSyncTick on the refs it reads', () => {
  /** A stamp reader that answers `stamps` in order, then the last one forever. */
  const stamps = (...values: (string | null | undefined)[]) => {
    let i = 0;
    return async () => values[Math.min(i++, values.length - 1)];
  };

  it('runs --forward once on a move of the state or default branch, and zero times on an idle beat', async () => {
    const scripts = scriptsOf([]);
    const tick = stateSyncTick(scripts, () => undefined, stamps('main=b1', 'main=b1', 'main=b1', 'main=b2', 'main=b2'));
    for (let beat = 0; beat < 5; beat += 1) await tick();
    expect(scripts.calls.filter((args) => args[0] === '--forward')).toHaveLength(2);
    expect(scripts.calls).toEqual([['--forward'], ['--pr', '--caller', 'fleetd'], ['--forward'], ['--pr', '--caller', 'fleetd']]);
  });

  it('starts nothing where no key is declared', async () => {
    const scripts = scriptsOf([]);
    const tick = stateSyncTick(scripts, () => undefined, stamps(null));
    await tick();
    await tick();
    expect(scripts.calls).toEqual([]);
  });

  it('runs again on the next beat after a failed step', async () => {
    const scripts = scriptsOf([{ stdout: '', stderr: 'boom\n', code: 1 }, ok('none'), ok('idle'), ok('none')]);
    const tick = stateSyncTick(scripts, () => undefined, stamps('main=b1'));
    await tick();
    await tick();
    await tick();
    expect(scripts.calls.filter((args) => args[0] === '--forward')).toHaveLength(2);
  });

  it('runs where the refs cannot be read', async () => {
    const scripts = scriptsOf([]);
    const tick = stateSyncTick(scripts, () => undefined, stamps(undefined));
    await tick();
    await tick();
    expect(scripts.calls.filter((args) => args[0] === '--forward')).toHaveLength(2);
  });
});

describe('stateSyncStampOf', () => {
  const refs = (stateTip: string) => refsFixture({ branches: ['main', 'plot/state', 'feature/x'], tips: { main: 'b1', 'plot/state': stateTip, 'feature/x': 'c1' } });

  it('reads null with no key, and reads no ref then', async () => {
    expect(await stateSyncStampOf({ ...refs('a1'), defaultBranch: async () => { throw new Error('read'); } }, async () => '')()).toBeNull();
  });

  it('moves with the state branch and names its tips', async () => {
    const before = await stateSyncStampOf(refs('a1'), async () => 'plot/state')();
    const after = await stateSyncStampOf(refs('a2'), async () => 'plot/state')();
    expect(before).toContain('refs/heads/plot/state=a1');
    expect(before).toContain('refs/remotes/origin/main=b1');
    expect(after).not.toBe(before);
  });

  it('reads undefined where the refs cannot be read', async () => {
    expect(await stateSyncStampOf({ ...refs('a1'), defaultBranch: async () => ({ ok: false, why: 'failed' }) }, async () => 'plot/state')()).toBeUndefined();
  });
});
