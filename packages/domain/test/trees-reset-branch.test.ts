// `treesGit.resetBranch` against a real repository with a bare remote: the
// operation a booking run uses to re-cut its branch after a rejected push.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { treesGit } from '../src/adapters/trees/trees-git.js';
import { treesFixture } from '../src/adapters/trees/trees-fixture.js';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
  });

describe('treesGit.resetBranch', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  /** A clone of a bare `origin`, a booking worktree on `book`, and a second clone that moves `main`. */
  const estate = () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-reset-branch-')));
    roots.push(root);
    const origin = path.join(root, 'origin.git');
    const repo = path.join(root, 'repo');
    const other = path.join(root, 'other');
    const wt = path.join(root, 'wt');
    git(root, 'init', '-q', '--bare', '-b', 'main', origin);
    git(root, 'clone', '-q', origin, repo);
    fs.writeFileSync(path.join(repo, 'plan.md'), 'one\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'first');
    git(repo, 'push', '-q', 'origin', 'HEAD:main');
    git(repo, 'fetch', '-q', 'origin', 'main');
    git(repo, 'worktree', 'add', '-q', '-B', 'book', wt, 'origin/main');
    git(root, 'clone', '-q', origin, other);
    return { repo, other, wt };
  };

  it('resets a checked-out booking branch to the moved base, discarding the earlier attempt', async () => {
    const { repo, other, wt } = estate();
    fs.writeFileSync(path.join(wt, 'plan.md'), 'attempt one\n');
    git(wt, 'commit', '-q', '-am', 'attempt one');
    fs.writeFileSync(path.join(wt, 'plan.md'), 'unstaged leftover\n');
    fs.writeFileSync(path.join(other, 'plan.md'), 'moved\n');
    git(other, 'commit', '-q', '-am', 'moved');
    git(other, 'push', '-q', 'origin', 'HEAD:main');
    fs.writeFileSync(path.join(other, 'added.md'), 'tracked on main\n');
    git(other, 'add', 'added.md');
    git(other, 'commit', '-q', '-m', 'added');
    git(other, 'push', '-q', 'origin', 'HEAD:main');
    // An untracked file in the path the reset checks out.
    fs.writeFileSync(path.join(wt, 'added.md'), 'in the way\n');
    git(repo, 'fetch', '-q', 'origin', 'main');

    const trees = treesGit({ repoRoot: repo, scriptDir: path.join(repo, 'scripts') });
    expect(await trees.resetBranch(wt, 'book', 'origin/main')).toEqual({ ok: true, value: undefined });

    expect(git(wt, 'rev-parse', 'HEAD')).toBe(git(repo, 'rev-parse', 'origin/main'));
    expect(git(wt, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('book');
    expect(fs.readFileSync(path.join(wt, 'plan.md'), 'utf8')).toBe('moved\n');
    expect(fs.readFileSync(path.join(wt, 'added.md'), 'utf8')).toBe('tracked on main\n');
    expect(git(wt, 'status', '--porcelain')).toBe('');
  });

  it('answers failed where the path is no worktree', async () => {
    const { repo } = estate();
    const trees = treesGit({ repoRoot: repo, scriptDir: path.join(repo, 'scripts') });
    const missing = path.join(path.dirname(repo), 'absent');
    expect((await trees.resetBranch(missing, 'book', 'origin/main')).ok).toBe(false);
  });
});

describe('treesFixture.resetBranch', () => {
  it('answers ok, and failed at a path the fixture refuses', async () => {
    const trees = treesFixture({ resetBranchRefusedAt: ['/refused'] });
    expect((await trees.resetBranch('/ok', 'book', 'origin/main')).ok).toBe(true);
    expect((await trees.resetBranch('/refused', 'book', 'origin/main')).ok).toBe(false);
  });
});
