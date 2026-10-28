// `treesGit.addBranch` and `resetBranch` against a real repository with a bare
// remote: a booking worktree cut from `origin/<default>` must write no
// `branch.<name>.merge` key into the shared `.git/config`, or concurrent
// writers collide on git's own config lock (`error: could not lock config
// file .git/config: File exists`).
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { treesGit } from '../src/adapters/trees/trees-git.js';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
  });

describe('treesGit — booking branches carry no upstream', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  /** A clone of a bare `origin`, with a local `origin/main` ref to start a booking branch from. */
  const estate = () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-no-upstream-')));
    roots.push(root);
    const origin = path.join(root, 'origin.git');
    const repo = path.join(root, 'repo');
    git(root, 'init', '-q', '--bare', '-b', 'main', origin);
    git(root, 'clone', '-q', origin, repo);
    fs.writeFileSync(path.join(repo, 'plan.md'), 'one\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'first');
    git(repo, 'push', '-q', 'origin', 'HEAD:main');
    git(repo, 'fetch', '-q', 'origin', 'main');
    return { repo };
  };

  it('addBranch from origin/main leaves no branch.<name>.merge key', async () => {
    const { repo } = estate();
    const trees = treesGit({ repoRoot: repo, scriptDir: path.join(repo, 'scripts') });
    const wt = path.join(path.dirname(repo), 'wt-add');

    expect(await trees.addBranch(wt, 'book-add', 'origin/main')).toEqual({ ok: true, value: undefined });

    expect(() => git(repo, 'config', '--get', 'branch.book-add.merge')).toThrow();
  });

  it('resetBranch onto origin/main leaves no branch.<name>.merge key', async () => {
    const { repo } = estate();
    const trees = treesGit({ repoRoot: repo, scriptDir: path.join(repo, 'scripts') });
    const wt = path.join(path.dirname(repo), 'wt-reset');
    git(repo, 'worktree', 'add', '-q', '--no-track', '-B', 'book-reset', wt, 'origin/main');

    expect(await trees.resetBranch(wt, 'book-reset', 'origin/main')).toEqual({ ok: true, value: undefined });

    expect(() => git(repo, 'config', '--get', 'branch.book-reset.merge')).toThrow();
  });

  it('runs 10 concurrent addBranch calls into 10 distinct worktrees', async () => {
    const { repo } = estate();
    const trees = treesGit({ repoRoot: repo, scriptDir: path.join(repo, 'scripts') });
    const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-no-upstream-concurrent-')));
    try {
      const count = 10;
      const results = await Promise.all(
        Array.from({ length: count }, (_, at) =>
          trees.addBranch(path.join(scratch, `wt-${at}`), `book-concurrent-${at}`, 'origin/main'),
        ),
      );

      expect(results.filter((result) => result.ok)).toHaveLength(count);
      for (let at = 0; at < count; at += 1) {
        expect(fs.statSync(path.join(scratch, `wt-${at}`)).isDirectory()).toBe(true);
      }
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});
