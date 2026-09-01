// The three invalidation signals — asserted by SPAWN COUNT, because a signal
// that loops has reintroduced in the invalidation layer the very problem the
// monitors exist to remove.
import { afterEach, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  plansSignal,
  readSignals,
  refsSignal,
  unchanged,
  worktreesSignal,
} from '../../src/server/signals.js';
import { rmTree } from '../helpers.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmTree(d);
});

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-signals-'));
  dirs.push(dir);
  const git = (...a: string[]) =>
    execFileSync('git', ['-C', dir, ...a], { stdio: ['ignore', 'pipe', 'ignore'] });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 'T');
  git('config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-01-01-a.md'), '# A\n');
  git('add', '-A');
  git('commit', '-qm', 'first');
  return dir;
}
const git = (dir: string, ...a: string[]) =>
  execFileSync('git', ['-C', dir, ...a], { stdio: ['ignore', 'pipe', 'ignore'] });

describe('each signal costs one process for the whole set', () => {
  it('refs: one spawn, however many refs there are', () => {
    const dir = repo();
    for (let i = 0; i < 12; i++) git(dir, 'branch', `feature/b${i}`);
    const s = refsSignal(dir);
    expect(s.spawns).toBe(1);
    expect(s.token.split('\n').filter(Boolean).length).toBeGreaterThan(12);
  });

  it('plans: ZERO spawns — the loop is over syscalls, not processes', () => {
    const dir = repo();
    for (let i = 0; i < 20; i++) {
      fs.writeFileSync(path.join(dir, 'docs', 'plans', `2026-01-${10 + i}-p.md`), '# P\n');
    }
    expect(plansSignal(path.join(dir, 'docs', 'plans')).spawns).toBe(0);
  });

  it('worktrees: one spawn', () => {
    expect(worktreesSignal(repo()).spawns).toBe(1);
  });

  it('all three together cost two processes', () => {
    const dir = repo();
    const s = readSignals(dir, path.join(dir, 'docs', 'plans'));
    expect(s.refs.spawns + s.plans.spawns + s.worktrees.spawns).toBe(2);
  });
});

describe('a signal changes exactly when its subject does', () => {
  it('a moved LOCAL ref is detected', () => {
    const dir = repo();
    const before = refsSignal(dir);
    fs.writeFileSync(path.join(dir, 'x.txt'), 'x');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'second');
    expect(unchanged(before, refsSignal(dir))).toBe(false);
  });

  it('a moved REMOTE ref is detected — the hole a heads-only signal would leave', () => {
    // THE LOAD-BEARING CASE, and it must move the remote ref WITHOUT moving any
    // local one. An earlier version of this test committed to create the new
    // SHA — which moved `refs/heads/main` too, so a heads-only signal passed it
    // for the wrong reason. Verified by mutation: with `refs/remotes` removed
    // from the signal, that version stayed green and this one goes red.
    //
    // The counts this guards read `refs/remotes/origin/<main>..refs/heads/<br>`,
    // and the scan fetches every pulse. A heads-only signal would report
    // "unchanged" while every ahead-count in the estate had silently gone stale.
    const dir = repo();
    const sha = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    git(dir, 'update-ref', 'refs/remotes/origin/main', sha);

    const headsBefore = execFileSync(
      'git', ['-C', dir, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads'],
      { encoding: 'utf8' },
    );
    const before = refsSignal(dir);

    // A commit object with no ref pointing at it from refs/heads: written
    // directly, so the ONLY thing that moves is the remote ref. This is what a
    // `git fetch` does to origin/<main> while the local checkout stands still.
    const tree = execFileSync('git', ['-C', dir, 'write-tree'], { encoding: 'utf8' }).trim();
    const commit = execFileSync(
      'git', ['-C', dir, 'commit-tree', tree, '-p', sha, '-m', 'upstream moved'],
      { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t' } },
    ).trim();
    git(dir, 'update-ref', 'refs/remotes/origin/main', commit);

    const headsAfter = execFileSync(
      'git', ['-C', dir, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads'],
      { encoding: 'utf8' },
    );
    // The precondition the earlier version silently broke.
    expect(headsAfter).toBe(headsBefore);

    expect(unchanged(before, refsSignal(dir))).toBe(false);
  });

  it('a rewritten plan file is detected', () => {
    const dir = repo();
    const planDir = path.join(dir, 'docs', 'plans');
    const before = plansSignal(planDir);
    const f = path.join(planDir, '2026-01-01-a.md');
    fs.writeFileSync(f, '# A, edited and longer\n');
    fs.utimesSync(f, new Date(), new Date(Date.now() + 2000));
    expect(unchanged(before, plansSignal(planDir))).toBe(false);
  });

  it('an added plan is detected', () => {
    const dir = repo();
    const planDir = path.join(dir, 'docs', 'plans');
    const before = plansSignal(planDir);
    fs.writeFileSync(path.join(planDir, '2026-02-02-b.md'), '# B\n');
    expect(unchanged(before, plansSignal(planDir))).toBe(false);
  });

  it('an added worktree is detected', () => {
    const dir = repo();
    const before = worktreesSignal(dir);
    const wt = path.join(dir, '..', `wt-${path.basename(dir)}`);
    git(dir, 'worktree', 'add', '-q', '-b', 'feature/wt', wt);
    dirs.push(wt);
    expect(unchanged(before, worktreesSignal(dir))).toBe(false);
    git(dir, 'worktree', 'remove', '--force', wt);
  });

  it('a quiet estate reports UNCHANGED — the case the whole design exists for', () => {
    const dir = repo();
    const planDir = path.join(dir, 'docs', 'plans');
    const a = readSignals(dir, planDir);
    const b = readSignals(dir, planDir);
    expect(unchanged(a.refs, b.refs)).toBe(true);
    expect(unchanged(a.plans, b.plans)).toBe(true);
    expect(unchanged(a.worktrees, b.worktrees)).toBe(true);
  });
});

describe('unreadable is not unchanged', () => {
  it('an empty token never matches, not even another empty one', () => {
    // "Could not read" is not evidence of sameness. Treating two unknowns as
    // equal is how a broken repo serves stale answers forever — the same rule
    // the estate applies to `unknown` everywhere else.
    expect(unchanged({ token: '', spawns: 1 }, { token: '', spawns: 1 })).toBe(false);
    expect(unchanged({ token: 'x', spawns: 1 }, { token: '', spawns: 1 })).toBe(false);
    expect(unchanged(undefined, { token: 'x', spawns: 1 })).toBe(false);
  });

  it('a non-repo yields an empty ref token rather than throwing', () => {
    const notARepo = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-nonrepo-sig-'));
    dirs.push(notARepo);
    expect(refsSignal(notARepo).token).toBe('');
  });
});
