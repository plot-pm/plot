import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { refFilesFs, type RefFiles } from '../src/adapters/refs/ref-files-fs.js';
import { refsGit } from '../src/adapters/refs/refs-git.js';
import { shellContext } from '../src/adapters/scripts.js';
import { treesGit } from '../src/adapters/trees/trees-git.js';
import type { PortResult } from '../src/port-result.js';
import { compareField, describingAs, type Disagreement, type Sides } from './compare.js';

/**
 * THE FILE READER AGAINST GIT: does `refFilesFs` answer what `refsGit` and
 * `treesGit` answer, over this repository and over a sandbox built with the
 * shapes the reader's rules exist for?
 *
 * The reader is a declared duplicate of git's ref rules
 * (`rules/ref-files.ts`). NEITHER SIDE IS AUTHORITATIVE: on a disagreement the
 * branch stops, and adjusting either side to make this pass is the one move
 * forbidden. A question the reader answers `unaskable` goes to git in
 * production, so it is counted and not compared.
 *
 * THIS REPOSITORY MOVES WHILE IT IS READ: other checkouts fetch, add worktrees
 * and pack refs. A comparison that disagrees is read again once, and only a
 * disagreement that holds on both reads fails.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');

const SIDES: Sides = { left: 'reader', right: 'git' };
const report = describingAs(SIDES);

/** What a result says, in a form both sides render alike. */
const said = <T>(result: PortResult<T>): unknown => (result.ok ? result.value : result.why);

/** The patterns production passes to `branchTips`. */
const PATTERNS: readonly (readonly string[])[] = [
  ['refs/remotes/origin/'],
  ['refs/remotes/origin'],
  ['refs/heads/'],
  ['refs/remotes/origin/idea/*'],
  ['refs/remotes/origin/feature/*', 'refs/remotes/origin/bug/*', 'refs/remotes/origin/infra/*'],
  ['refs/remotes/origin/feature*'],
  ['refs/remotes/origin/changeset-release/'],
];

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  }).trim();

/** One comparison pass over a checkout, and how many questions the reader left to git. */
interface Pass {
  found: Disagreement[];
  answered: number;
  leftToGit: string[];
}

const comparePass = async (dir: string, reader: RefFiles): Promise<Pass> => {
  // `null` keeps the right side git: the adapters read the files first by default.
  const refs = refsGit(shellContext(dir), undefined, null);
  const trees = treesGit(shellContext(dir), undefined, null);
  const pass: Pass = { found: [], answered: 0, leftToGit: [] };
  const check = <T>(subject: string, field: string, mine: PortResult<T>, theirs: PortResult<T>): void => {
    if (!mine.ok && mine.why === 'unaskable') {
      pass.leftToGit.push(`${subject} :: ${field} :: ${mine.reason ?? ''}`);
      return;
    }
    pass.answered += 1;
    compareField(pass.found, subject, field, said(mine), said(theirs));
  };

  for (const scope of ['local', 'remote', 'both'] as const) {
    check(scope, 'refState', reader.refState(scope), await refs.refState(scope));
  }
  check('origin/HEAD', 'defaultBranch', reader.defaultBranch(), await refs.defaultBranch());
  check('HEAD', 'currentBranch', reader.currentBranch(), await refs.currentBranch());
  for (const remote of [false, true]) {
    check(remote ? 'origin' : 'heads', 'listBranches', reader.listBranches(remote), await refs.listBranches(remote));
  }
  for (const patterns of PATTERNS) {
    check(patterns.join(' '), 'branchTips', reader.branchTips(patterns), await refs.branchTips(patterns));
  }

  const names = git(dir, 'for-each-ref', '--format=%(refname)%0a%(refname:short)').split('\n');
  for (const name of new Set([...names, 'HEAD', 'origin', 'main', 'no-such-ref-here'])) {
    if (name === '') continue;
    check(name, 'resolve', reader.resolve(name), await refs.resolve(name));
  }
  const remoteBranches = await refs.listBranches(true);
  for (const branch of [...(remoteBranches.ok ? remoteBranches.value.slice(0, 20) : []), 'no-such-branch-here']) {
    check(branch, 'remoteHead', reader.remoteHead(branch), await refs.remoteHead(branch));
  }

  // The order is "main first, the rest unordered": the linked worktrees are compared by path.
  const mine = reader.worktrees();
  const theirs = await trees.list();
  if (!mine.ok && mine.why === 'unaskable') {
    pass.leftToGit.push(`worktrees :: list :: ${mine.reason ?? ''}`);
  } else if (!mine.ok || !theirs.ok) {
    compareField(pass.found, 'worktrees', 'list', said(mine), said(theirs));
  } else {
    pass.answered += 1;
    compareField(pass.found, 'worktrees', 'main', mine.value[0]?.path, theirs.value[0]?.path);
    const byPath = (list: typeof mine.value) => new Map(list.map((tree) => [tree.path, tree]));
    const left = byPath(mine.value);
    const right = byPath(theirs.value);
    for (const path of new Set([...left.keys(), ...right.keys()])) {
      const pick = (tree: (typeof mine.value)[number] | undefined) =>
        tree === undefined ? 'absent' : { branch: tree.branch, detached: tree.detached, isMain: tree.isMain, prunable: tree.prunable };
      compareField(pass.found, path, 'worktree', pick(left.get(path)), pick(right.get(path)));
    }
  }
  return pass;
};

/** Compares twice where the first pass disagrees; only a disagreement both passes share is kept. */
const compareSettled = async (dir: string): Promise<Pass> => {
  const reader = refFilesFs(dir, undefined, {});
  const first = await comparePass(dir, reader);
  if (first.found.length === 0) return first;
  const second = await comparePass(dir, reader);
  const again = new Set(second.found.map(report));
  return { ...second, found: first.found.filter((one) => again.has(report(one))) };
};

describe('refFilesFs against git, over this repository', () => {
  it('agrees with git on every question it answers', async () => {
    const pass = await compareSettled(ROOT);
    expect(pass.found.map(report)).toEqual([]);
    // Vacuity guard: a reader that answered nothing would agree with anything.
    expect(pass.answered).toBeGreaterThan(100);
  });
});

describe('refFilesFs against git, over a sandbox', () => {
  let home = '';
  let repo = '';

  beforeAll(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), 'plot-ref-files-')));
    const origin = join(home, 'origin.git');
    git(home, 'init', '-q', '--bare', origin);
    repo = join(home, 'repo');
    git(home, 'init', '-q', repo);
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-q', '-m', 'one');
    git(repo, 'remote', 'add', 'origin', origin);
    for (const branch of ['feature/a', 'idea/b', 'dup', 'topic', 'held', 'origin/feature/a']) git(repo, 'branch', branch);
    git(repo, 'tag', '-a', '-m', 'v1', 'v1.0');
    git(repo, 'tag', 'topic');
    git(repo, 'push', '-q', 'origin', 'main', 'feature/a', 'idea/b');
    git(repo, 'fetch', '-q', 'origin');
    git(repo, 'remote', 'set-head', 'origin', 'main');
    git(repo, 'pack-refs', '--all');
    writeFileSync(join(repo, 'a.txt'), 'b\n');
    git(repo, 'commit', '-q', '-am', 'two');
    // A loose `dup` over the packed one.
    git(repo, 'update-ref', 'refs/heads/dup', 'HEAD');
    git(repo, 'worktree', 'add', '-q', '--detach', join(home, 'detached'), 'HEAD~1');
    git(repo, 'worktree', 'add', '-q', join(home, 'locked'), 'idea/b');
    git(repo, 'worktree', 'lock', join(home, 'locked'));
    git(repo, 'worktree', 'add', '-q', join(home, 'prunable'), 'feature/a');
    rmSync(join(home, 'prunable'), { recursive: true, force: true });
    // A locked worktree whose directory is gone is not prunable.
    git(repo, 'worktree', 'add', '-q', join(home, 'held'), 'held');
    git(repo, 'worktree', 'lock', join(home, 'held'));
    rmSync(join(home, 'held'), { recursive: true, force: true });
  });

  afterAll(() => {
    if (home !== '') rmSync(home, { recursive: true, force: true });
  });

  it('agrees with git from the main checkout and from a linked worktree', async () => {
    for (const dir of [repo, join(home, 'detached'), join(home, 'locked')]) {
      const pass = await compareSettled(dir);
      expect(pass.found.map(report), dir).toEqual([]);
      expect(pass.leftToGit, dir).toEqual([]);
    }
  });

  it('reads every shape the sandbox was built with', async () => {
    const reader = refFilesFs(repo, undefined, {});
    const trees = reader.worktrees();
    const byPath = new Map((trees.ok ? trees.value : []).map((tree) => [tree.path.slice(home.length + 1), [tree.isMain, tree.detached, tree.prunable]]));
    expect(trees.ok && trees.value[0]?.isMain).toBe(true);
    expect(Object.fromEntries(byPath)).toEqual({
      repo: [true, false, false],
      detached: [false, true, false],
      locked: [false, false, false],
      prunable: [false, false, true],
      held: [false, false, false],
    });
    expect(reader.branchTips(['refs/heads/origin/'])).toEqual({ ok: true, value: [{ branch: 'heads/origin/feature/a', sha: git(repo, 'rev-parse', 'HEAD~1') }] });
    expect(reader.resolve('dup')).toEqual({ ok: true, value: git(repo, 'rev-parse', 'HEAD') });
    expect(reader.resolve('v1.0')).toEqual({ ok: true, value: git(repo, 'rev-parse', 'v1.0') });
    expect(reader.defaultBranch()).toEqual({ ok: true, value: 'main' });
  });
});

describe('refFilesFs over a reftable repository', () => {
  let home = '';
  let repo = '';

  beforeAll(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), 'plot-ref-files-reftable-')));
    repo = join(home, 'repo');
    git(home, 'init', '-q', '--ref-format=reftable', repo);
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-q', '-m', 'one');
    git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  });

  afterAll(() => {
    if (home !== '') rmSync(home, { recursive: true, force: true });
  });

  it('answers unaskable on every method, and refsGit answers from git', async () => {
    const reader = refFilesFs(repo, undefined, {});
    const results: PortResult<unknown>[] = [
      reader.refState('both'),
      reader.defaultBranch(),
      reader.listBranches(false),
      reader.branchTips(['refs/heads/']),
      reader.resolve('main'),
      reader.currentBranch(),
      reader.remoteHead('main'),
      reader.worktrees(),
    ];
    for (const result of results) {
      expect(result).toEqual({ ok: false, why: 'unaskable', reason: 'extensions.refStorage is reftable' });
    }
    const refs = refsGit(shellContext(repo));
    const head = git(repo, 'rev-parse', 'HEAD');
    expect(await refs.resolve('main')).toEqual({ ok: true, value: head });
    expect(await refs.defaultBranch()).toEqual({ ok: true, value: 'main' });
    expect(await refs.refState('local')).toEqual({ ok: true, value: [{ ref: 'refs/heads/main', sha: head, head: true }] });
  });
});
