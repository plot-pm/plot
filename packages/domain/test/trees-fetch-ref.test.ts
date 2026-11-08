// `treesGit.fetchRef` and `treesGit.mergeIn` against a real repository with a
// bare remote: the two operations a state-branch booking cut is built from.
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

describe('treesGit.fetchRef and treesGit.mergeIn', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  const estate = () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fetch-ref-')));
    roots.push(root);
    const origin = path.join(root, 'origin.git');
    const repo = path.join(root, 'repo');
    git(root, 'init', '-q', '--bare', '-b', 'main', origin);
    git(root, 'clone', '-q', origin, repo);
    fs.writeFileSync(path.join(repo, 'plan.md'), 'one\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'first');
    git(repo, 'push', '-q', 'origin', 'HEAD:main');
    const trees = treesGit({ repoRoot: repo, scriptDir: path.join(repo, 'scripts') });
    return { repo, trees };
  };

  it('fetches a ref the origin holds into the tracking ref and answers true', async () => {
    const { repo, trees } = estate();
    git(repo, 'push', '-q', 'origin', 'HEAD:refs/plot/state');
    expect(await trees.fetchRef(repo, 'refs/plot/state', 'refs/remotes/origin/plot-state')).toEqual({ ok: true, value: true });
    expect(git(repo, 'rev-parse', 'refs/remotes/origin/plot-state')).toBe(git(repo, 'rev-parse', 'HEAD'));
  });

  it('answers false, not failed, where the origin holds no such ref', async () => {
    const { repo, trees } = estate();
    expect(await trees.fetchRef(repo, 'refs/heads/plot/state', 'refs/remotes/origin/plot/state')).toEqual({ ok: true, value: false });
  });

  it('answers failed where the origin cannot be asked', async () => {
    const { repo, trees } = estate();
    git(repo, 'remote', 'set-url', 'origin', path.join(repo, 'missing.git'));
    expect((await trees.fetchRef(repo, 'refs/heads/main', 'refs/remotes/origin/main')).ok).toBe(false);
  });

  it('merges a ref in and answers no conflicting files', async () => {
    const { repo, trees } = estate();
    git(repo, 'checkout', '-q', '-b', 'side');
    fs.writeFileSync(path.join(repo, 'side.md'), 'side\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'side');
    git(repo, 'checkout', '-q', 'main');
    fs.writeFileSync(path.join(repo, 'main.md'), 'main\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'main');
    expect(await trees.mergeIn(repo, 'side', 'plot')).toEqual({ ok: true, value: [] });
    expect(fs.existsSync(path.join(repo, 'side.md'))).toBe(true);
  });

  it('names the conflicting files, aborts the merge and leaves the tree clean', async () => {
    const { repo, trees } = estate();
    git(repo, 'checkout', '-q', '-b', 'side');
    fs.writeFileSync(path.join(repo, 'plan.md'), 'side\n');
    git(repo, 'commit', '-q', '-am', 'side');
    git(repo, 'checkout', '-q', 'main');
    fs.writeFileSync(path.join(repo, 'plan.md'), 'main\n');
    git(repo, 'commit', '-q', '-am', 'main');
    expect(await trees.mergeIn(repo, 'side', 'plot')).toEqual({ ok: true, value: ['plan.md'] });
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  it('answers failed where the ref to merge does not exist', async () => {
    const { repo, trees } = estate();
    expect((await trees.mergeIn(repo, 'no-such-ref', 'plot')).ok).toBe(false);
  });
});
