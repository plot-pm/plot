import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { deskFingerprint, readWatchLayout } from '../src/adapters/watch/watch-layout-fs.js';

let root: string | undefined;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'ignore' });
};

const repoWithDesk = (): { repo: string; desk: string } => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'plot-layout-')));
  const repo = join(root, 'repo');
  git(root, 'init', '-q', '-b', 'main', repo);
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'first');
  const desk = join(root, 'desk');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature/x', desk);
  return { repo, desk };
};

describe('readWatchLayout', () => {
  it('lists each linked desk with its admin directory and no main checkout', () => {
    const { repo, desk } = repoWithDesk();
    const layout = readWatchLayout({ repoRoot: repo, commonDir: join(repo, '.git'), registryDir: join(repo, 'agents') });
    expect(layout.desks).toEqual([{ path: desk, admin: join(repo, '.git', 'worktrees', 'desk') }]);
    expect(layout.registryDir).toBe(join(repo, 'agents'));
  });

  it('lists no desk where worktrees/ is missing or an entry has no gitdir', () => {
    const { repo } = repoWithDesk();
    expect(readWatchLayout({ repoRoot: repo, commonDir: join(repo, 'nowhere'), registryDir: '' }).desks).toEqual([]);
    writeFileSync(join(repo, '.git', 'worktrees', 'desk', 'gitdir'), '\n');
    expect(readWatchLayout({ repoRoot: repo, commonDir: join(repo, '.git'), registryDir: '' }).desks).toEqual([]);
    rmSync(join(repo, '.git', 'worktrees', 'desk', 'gitdir'));
    expect(readWatchLayout({ repoRoot: repo, commonDir: join(repo, '.git'), registryDir: '' }).desks).toEqual([]);
  });
});

describe('deskFingerprint', () => {
  it('is stable across a read-only status and changes with a commit', () => {
    const { desk, repo } = repoWithDesk();
    const admin = join(repo, '.git', 'worktrees', 'desk');
    writeFileSync(join(desk, 'a.txt'), '1');
    git(desk, 'add', 'a.txt');
    const before = deskFingerprint(admin);
    expect(before).not.toBeNull();
    git(desk, '--no-optional-locks', 'status', '--porcelain');
    expect(deskFingerprint(admin)).toBe(before);
    git(desk, 'commit', '-q', '-m', 'one');
    expect(deskFingerprint(admin)).not.toBe(before);
  });

  it('reads a short index whole, and null where a file is missing', () => {
    root = mkdtempSync(join(tmpdir(), 'plot-layout-'));
    expect(deskFingerprint(root)).toBeNull();
    writeFileSync(join(root, 'HEAD'), 'ref: x\n');
    writeFileSync(join(root, 'index'), 'abc');
    expect(deskFingerprint(root)).toBe(`ref: x\n\0${Buffer.from('abc').toString('hex')}`);
  });
});
