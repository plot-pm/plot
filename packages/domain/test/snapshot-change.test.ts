import { describe, expect, it } from 'vitest';

import { addPending, changeOf, contentChanged, watchTargets, type WatchLayout } from '../src/rules/snapshot-change.js';

const layout: WatchLayout = {
  repoRoot: '/repo',
  commonDir: '/repo/.git/',
  registryDir: '/repo/.plot/agents',
  desks: [
    { path: '/repo/.worktrees/a', admin: '/repo/.git/worktrees/a' },
    { path: '/repo/.worktrees/b', admin: '/repo/.git/worktrees/b/' },
  ],
};

const at = (dir: string, name: string) => changeOf({ dir, name, kind: 'change' }, layout);

describe('changeOf', () => {
  it.each([
    ['any entry under refs/', '/repo/.git/refs', 'heads/feature/x', { kind: 'refs' }],
    ['packed-refs in the common git dir', '/repo/.git', 'packed-refs', { kind: 'refs' }],
    ['a nameless event in the common git dir', '/repo/.git', '', { kind: 'refs' }],
    ["a desk's index", '/repo/.git/worktrees/a', 'index', { kind: 'desk-git', desk: '/repo/.worktrees/a' }],
    ["a desk's HEAD", '/repo/.git/worktrees/b', 'HEAD', { kind: 'desk-git', desk: '/repo/.worktrees/b' }],
    ['a nameless event in a desk admin dir', '/repo/.git/worktrees/a', '', { kind: 'desk-git', desk: '/repo/.worktrees/a' }],
    ['PLOT-BLOCKED in a desk root', '/repo/.worktrees/a', 'PLOT-BLOCKED', { kind: 'desk-files', desk: '/repo/.worktrees/a' }],
    ['PLOT-CORRECTION.md in a desk root', '/repo/.worktrees/a', 'PLOT-CORRECTION.md', { kind: 'desk-files', desk: '/repo/.worktrees/a' }],
    ['a worker file in a desk root', '/repo/.worktrees/a', '.plot-worker.pid', { kind: 'desk-files', desk: '/repo/.worktrees/a' }],
    ['a nameless event in a desk root', '/repo/.worktrees/a', '', { kind: 'desk-files', desk: '/repo/.worktrees/a' }],
    ["a desk's worker log", '/repo/.worktrees/b', '.plot-worker.log', { kind: 'worker-log', desk: '/repo/.worktrees/b' }],
    ['any entry in the registry', '/repo/.plot/agents', 'x.json', { kind: 'registry' }],
    ['CLAUDE.md in the main checkout', '/repo', 'CLAUDE.md', { kind: 'config' }],
    ['a nameless event in the main checkout', '/repo', '', { kind: 'config' }],
  ])('maps %s', (_what, dir, name, expected) => {
    expect(at(dir, name)).toEqual(expected);
  });

  it.each([
    ['FETCH_HEAD in the common git dir', '/repo/.git', 'FETCH_HEAD'],
    ['a lock file in a desk admin dir', '/repo/.git/worktrees/a', 'index.lock'],
    ['an editor file in a desk root', '/repo/.worktrees/a', 'notes.txt'],
    ['another file in the main checkout', '/repo', 'README.md'],
    ['a directory that was never armed', '/elsewhere', 'CLAUDE.md'],
  ])('raises nothing for %s', (_what, dir, name) => {
    expect(at(dir, name)).toBeNull();
  });
});

describe('watchTargets', () => {
  it('lists refs recursively and every other source alone, with no trailing slash', () => {
    expect(watchTargets(layout)).toEqual([
      { dir: '/repo/.git/refs', recursive: true },
      { dir: '/repo/.git', recursive: false },
      { dir: '/repo/.git/worktrees/a', recursive: false },
      { dir: '/repo/.worktrees/a', recursive: false },
      { dir: '/repo/.git/worktrees/b', recursive: false },
      { dir: '/repo/.worktrees/b', recursive: false },
      { dir: '/repo/.plot/agents', recursive: false },
      { dir: '/repo', recursive: false },
    ]);
  });

  it('keeps a root path as it is', () => {
    expect(watchTargets({ ...layout, repoRoot: '/', desks: [] }).at(-1)).toEqual({ dir: '/', recursive: false });
  });
});

describe('contentChanged', () => {
  it.each([
    ['equal readings', 'a', 'a', false],
    ['different readings', 'a', 'b', true],
    ['no held reading', null, 'a', true],
    ['an unreadable fresh reading', 'a', null, true],
  ])('reads %s', (_what, held, fresh, expected) => {
    expect(contentChanged(held, fresh)).toBe(expected);
  });
});

describe('addPending', () => {
  it('adds each key once and each key and desk pair once', () => {
    const held = [{ key: 'refs' as const }];
    const next = addPending(held, [{ key: 'refs' }, { key: 'desks', desk: '/a' }, { key: 'desks', desk: '/b' }, { key: 'desks', desk: '/a' }]);
    expect(next).toEqual([{ key: 'refs' }, { key: 'desks', desk: '/a' }, { key: 'desks', desk: '/b' }]);
  });

  it('returns the held set itself when nothing is new', () => {
    const held = [{ key: 'refs' as const }];
    expect(addPending(held, [{ key: 'refs' }])).toBe(held);
  });
});
