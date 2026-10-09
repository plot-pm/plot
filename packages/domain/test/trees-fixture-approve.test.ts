import { describe, it, expect } from 'vitest';
import { treesFixture } from '../src/adapters/trees/trees-fixture.js';

const calls = () => ({ resets: [], commits: [], pushes: [], commitsAs: [], fetches: [], stages: [] });

describe('treesFixture: the approve ladder writes', () => {
  it('records stage, commitAs, commitStaged and fetch, and answers each', async () => {
    const recorded = calls();
    const trees = treesFixture({ calls: recorded });
    expect((await trees.stage('/a', ['x.md'])).ok).toBe(true);
    expect((await trees.commitAs('/a', 'Ann <a@b>', 'm1')).ok).toBe(true);
    expect((await trees.commitStaged('/a', 'm2')).ok).toBe(true);
    expect((await trees.fetch('/a', 'main')).ok).toBe(true);
    expect(recorded.stages).toEqual([{ path: '/a', pathspecs: ['x.md'] }]);
    expect(recorded.commitsAs).toEqual([{ path: '/a', who: 'Ann <a@b>', message: 'm1' }]);
    expect(recorded.commits).toEqual([{ path: '/a', message: 'm2' }]);
    expect(recorded.fetches).toEqual([{ path: '/a', branch: 'main' }]);
  });

  it('fails the writes at the paths the fixture names', async () => {
    const trees = treesFixture({
      stageFailsAt: ['/a'],
      stagedCheckFailsAt: ['/a'],
      commitAsFailsAt: ['/a'],
      commitStagedFailsAt: ['/a'],
    });
    expect((await trees.stage('/a', ['x'])).ok).toBe(false);
    expect((await trees.hasStagedChanges('/a')).ok).toBe(false);
    expect((await trees.commitAs('/a', 'w', 'm')).ok).toBe(false);
    expect((await trees.commitStaged('/a', 'm')).ok).toBe(false);
  });

  it('answers hasStagedChanges from the staged list', async () => {
    const trees = treesFixture({ staged: ['/a'] });
    expect(await trees.hasStagedChanges('/a')).toEqual({ ok: true, value: true });
    expect(await trees.hasStagedChanges('/b')).toEqual({ ok: true, value: false });
  });

  it('answers originHead, userName and hasRef, and fails when undeclared', async () => {
    const declared = treesFixture({ originHead: 'abc', names: { '/a': 'Ann' }, refs: ['refs/x'] });
    expect(await declared.originHead('/a')).toEqual({ ok: true, value: 'abc' });
    expect(await declared.userName('/a')).toEqual({ ok: true, value: 'Ann' });
    expect(await declared.hasRef('/a', 'refs/x')).toEqual({ ok: true, value: true });
    expect(await declared.hasRef('/a', 'refs/y')).toEqual({ ok: true, value: false });
    const bare = treesFixture();
    expect((await bare.originHead('/a')).ok).toBe(false);
    expect((await bare.userName('/a')).ok).toBe(false);
  });
});
