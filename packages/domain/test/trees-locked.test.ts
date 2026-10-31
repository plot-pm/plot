import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { treesFixture } from '../src/adapters/trees/trees-fixture.js';
import { treesGit } from '../src/adapters/trees/trees-git.js';

/** `locked` reads the filesystem only, so these cases need no repository. */
let root = '';
const trees = () => treesGit({ repoRoot: root, scriptDir: root });
const make = (...parts: string[]): string => {
  const dir = path.join(root, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-trees-locked-')));
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('treesGit().locked', () => {
  it('reads a lock in a main checkout and its absence', async () => {
    const held = make('main-held');
    fs.mkdirSync(path.join(held, '.git'));
    fs.writeFileSync(path.join(held, '.git', 'index.lock'), '');
    const free = make('main-free');
    fs.mkdirSync(path.join(free, '.git'));
    expect(await trees().locked(held)).toEqual({ ok: true, value: true });
    expect(await trees().locked(free)).toEqual({ ok: true, value: false });
  });

  it('follows a linked worktree pointer, absolute or relative', async () => {
    const gitdir = make('meta', 'worktrees', 'w');
    fs.writeFileSync(path.join(gitdir, 'index.lock'), '');
    const absolute = make('linked-abs');
    fs.writeFileSync(path.join(absolute, '.git'), `gitdir: ${gitdir}\n`);
    const relative = make('linked-rel');
    fs.writeFileSync(path.join(relative, '.git'), 'gitdir: ../meta/worktrees/w\n');
    const other = make('meta', 'worktrees', 'v');
    const unlocked = make('linked-free');
    fs.writeFileSync(path.join(unlocked, '.git'), `gitdir: ${other}\n`);
    expect(await trees().locked(absolute)).toEqual({ ok: true, value: true });
    expect(await trees().locked(relative)).toEqual({ ok: true, value: true });
    expect(await trees().locked(unlocked)).toEqual({ ok: true, value: false });
  });

  it('answers not locked for a missing path, a missing .git and an empty pointer', async () => {
    const bare = make('no-dot-git');
    const empty = make('empty-pointer');
    fs.writeFileSync(path.join(empty, '.git'), 'gitdir:\n');
    expect(await trees().locked(path.join(root, 'nothing'))).toEqual({ ok: true, value: false });
    expect(await trees().locked(bare)).toEqual({ ok: true, value: false });
    expect(await trees().locked(empty)).toEqual({ ok: true, value: false });
  });

  it('serves the fixture from its stated paths', async () => {
    const fixture = treesFixture({ locked: ['/a'] });
    expect(await fixture.locked('/a')).toEqual({ ok: true, value: true });
    expect(await fixture.locked('/b')).toEqual({ ok: true, value: false });
  });
});
