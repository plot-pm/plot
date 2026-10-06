import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { treesGit } from '../src/adapters/trees/trees-git.js';
import { treesFixture } from '../src/adapters/trees/trees-fixture.js';
import { refsGit } from '../src/adapters/refs/refs-git.js';
import { refsFixture } from '../src/adapters/refs/refs-fixture.js';

// `Trees.changedUnder` and `Refs.lastCommitTouching` against a real
// repository, and their fixtures.
const SCRIPT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'skills', 'plot', 'scripts');
const BUNDLE = 'skills/plot/scripts/board/plot-worker-loop.mjs';

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

let repo = '';

beforeAll(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-restart-reads-')));
  git(repo, 'init', '--quiet', '--initial-branch=main');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  fs.mkdirSync(path.join(repo, path.dirname(BUNDLE)), { recursive: true });
  fs.writeFileSync(path.join(repo, BUNDLE), 'one\n');
  fs.writeFileSync(path.join(repo, 'skills/plot/scripts/plot-x.sh'), 'echo\n');
  // The real build declaration, from which the desk-dirt filter reads the generated bundle paths.
  fs.mkdirSync(path.join(repo, 'packages/board'), { recursive: true });
  fs.copyFileSync(path.join(SCRIPT_DIR, '..', '..', '..', 'packages', 'board', 'build.mjs'), path.join(repo, 'packages/board/build.mjs'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '-m', 'bundle');
  fs.writeFileSync(path.join(repo, 'README.md'), 'r\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '-m', 'readme');
});

afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('treesGit.changedUnder', () => {
  it('lists a modified generated bundle that dirtyPaths filters out', async () => {
    const trees = treesGit({ repoRoot: repo, scriptDir: SCRIPT_DIR });
    fs.writeFileSync(path.join(repo, BUNDLE), 'rebuilt\n');
    try {
      expect(await trees.changedUnder(repo, ['skills/plot/scripts/'])).toEqual({ ok: true, value: [BUNDLE] });
      const dirty = await trees.dirtyPaths(repo);
      expect(dirty.ok && dirty.value.includes(BUNDLE)).toBe(false);
    } finally {
      git(repo, 'checkout', '--', BUNDLE);
    }
  });

  it('lists an untracked file and a modified script, and nothing outside the pathspec', async () => {
    const trees = treesGit({ repoRoot: repo, scriptDir: SCRIPT_DIR });
    fs.writeFileSync(path.join(repo, 'skills/plot/scripts/plot-x.sh'), 'echo changed\n');
    fs.writeFileSync(path.join(repo, 'skills/plot/scripts/new.sh'), 'new\n');
    fs.writeFileSync(path.join(repo, 'outside.txt'), 'x\n');
    try {
      const changed = await trees.changedUnder(repo, ['skills/plot/scripts/']);
      expect(changed.ok && [...changed.value].sort()).toEqual(['skills/plot/scripts/new.sh', 'skills/plot/scripts/plot-x.sh']);
    } finally {
      git(repo, 'checkout', '--', 'skills/plot/scripts/plot-x.sh');
      fs.rmSync(path.join(repo, 'skills/plot/scripts/new.sh'));
      fs.rmSync(path.join(repo, 'outside.txt'));
    }
  });

  it('answers an empty list for a clean pathspec, and fails outside a repository', async () => {
    const trees = treesGit({ repoRoot: repo, scriptDir: SCRIPT_DIR });
    expect(await trees.changedUnder(repo, ['skills/plot/scripts/'])).toEqual({ ok: true, value: [] });
    expect((await trees.changedUnder(path.join(repo, 'nowhere'), ['x'])).ok).toBe(false);
  });
});

describe('treesFixture.changedUnder', () => {
  it('answers the paths under the pathspec, and none for an unknown checkout', async () => {
    const trees = treesFixture({ changed: { '/main': ['skills/a.sh', 'docs/b.md'] } });
    expect(await trees.changedUnder('/main', ['skills/'])).toEqual({ ok: true, value: ['skills/a.sh'] });
    expect(await trees.changedUnder('/other', ['skills/'])).toEqual({ ok: true, value: [] });
  });
});

describe('Refs.lastCommitTouching', () => {
  it('names the newest commit that changed the path, and empty for a path no commit changed', async () => {
    const refs = refsGit({ repoRoot: repo, scriptDir: SCRIPT_DIR });
    expect(await refs.lastCommitTouching(BUNDLE)).toEqual({ ok: true, value: git(repo, 'rev-parse', 'HEAD~1') });
    expect(await refs.lastCommitTouching('never/there')).toEqual({ ok: true, value: '' });
  });

  it('answers from the fixture table', async () => {
    const refs = refsFixture({ lastCommits: { [BUNDLE]: 'abc' } });
    expect(await refs.lastCommitTouching(BUNDLE)).toEqual({ ok: true, value: 'abc' });
    expect(await refs.lastCommitTouching('x')).toEqual({ ok: true, value: '' });
  });
});
