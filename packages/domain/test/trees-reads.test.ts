import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { treesGit } from '../src/adapters/trees/trees-git.js';
import { treesFixture } from '../src/adapters/trees/trees-fixture.js';
import type { Trees } from '../src/ports/trees.js';

/**
 * The worktree adapters against a REAL repository with a REAL linked worktree,
 * because that is the only thing `treesGit` can be asserted against.
 *
 * A mock of `git` would assert that the adapter passes the arguments the mock
 * was written to expect, which is a tautology: every question here is a single
 * `git` invocation, so the implementation IS the argument list. What can go
 * wrong is a wrong flag, a porcelain field read at the wrong offset, or an exit
 * code taken for the wrong answer — and each of those survives a mock and fails
 * against git.
 *
 * A DETACHED WORKTREE IS PART OF THE FIXTURE. `''` for a detached HEAD is the
 * answer this migration relies on: `server-info.ts` and `fleet.ts` both render
 * nothing rather than a short sha, and a suite whose every checkout is on a
 * branch would never see it.
 */
const git = (cwd: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd, encoding: 'utf8' });

let repo = '';
let linked = '';
let detached = '';

beforeAll(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-trees-git-')));
  git(repo, ['init', '--quiet', '--initial-branch=main']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '-m', 'first']);

  linked = path.join(repo, '..', `${path.basename(repo)}-wt`);
  git(repo, ['worktree', 'add', '--quiet', '-b', 'feature/linked', linked]);

  detached = path.join(repo, '..', `${path.basename(repo)}-detached`);
  const head = git(repo, ['rev-parse', 'HEAD']).trim();
  git(repo, ['worktree', 'add', '--quiet', '--detach', detached, head]);
});

afterAll(() => {
  for (const dir of [linked, detached, repo]) {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

const trees = (): Trees => treesGit({ repoRoot: repo, scriptDir: path.join(repo, 'scripts') });

describe('treesGit: the desks this machine holds', () => {
  it('lists every worktree and marks the FIRST as the main checkout', async () => {
    // Git lists the original clone FIRST and linked worktrees after it, which
    // is what `isMain` is derived from. `fleet.ts` reads the main entry's
    // branch to answer `masterAgentBranch`, so this position is load-bearing —
    // and it is only the first position: the linked trees come back in git's
    // own order, which is alphabetical rather than by creation, so asserting
    // the whole sequence would pin a fact no caller reads.
    const answer = await trees().list();
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.value[0]!.path).toBe(repo);
    expect([...answer.value].map((tree) => tree.path).sort()).toEqual(
      [repo, linked, detached].sort(),
    );
    expect(answer.value.filter((tree) => tree.isMain).map((t) => t.path)).toEqual([repo]);
  });

  it('reads each worktree branch, and a detached one as empty', async () => {
    const answer = await trees().list();
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    const byPath = new Map(answer.value.map((tree) => [tree.path, tree.branch]));
    expect(byPath.get(repo)).toBe('main');
    expect(byPath.get(linked)).toBe('feature/linked');
    // The `branch` record is simply absent for a detached HEAD, so the parse
    // leaves the field at its empty default rather than inventing a sha.
    expect(byPath.get(detached)).toBe('');
  });

  it('answers one checkout branch without a path comparison', async () => {
    // What `server-info.ts` asks. It could take the listing and find its own
    // entry, but that means comparing `repoRoot` against git's reported path,
    // and a temp directory is a symlink on macOS — two spellings of one path.
    expect(await trees().currentBranch(repo)).toEqual({ ok: true, value: 'main' });
    expect(await trees().currentBranch(linked)).toEqual({
      ok: true,
      value: 'feature/linked',
    });
  });

  it('answers a detached checkout with an empty branch, not a failure', async () => {
    // THE DISTINCTION THE OLD `execFileSync` COLLAPSED. `git branch
    // --show-current` exits 0 and prints nothing for a detached HEAD, so this
    // is an ANSWER of `''` — and a caller rendering nothing for it is right.
    const answer = await trees().currentBranch(detached);
    expect(answer).toEqual({ ok: true, value: '' });
  });

  it('reports a failure for a path that is not a repository', async () => {
    // The other half of the same distinction: a directory git cannot read is
    // NOT a detached HEAD. `server-info.ts` renders both as nothing, and it
    // says so — but the port keeps them apart, so a caller that must tell them
    // apart can.
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-trees-nonrepo-'));
    try {
      const answer = await trees().currentBranch(outside);
      expect(answer.ok).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('treesFixture: the same port with no machine behind it', () => {
  it('marks the first stated worktree as the main checkout', async () => {
    const answer = await treesFixture({
      worktrees: [{ path: '/repo', branch: 'main' }, { path: '/repo-wt', branch: 'feature/x' }],
    }).list();
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.value.map((tree) => tree.isMain)).toEqual([true, false]);
  });

  it('reports every unstated tree as unclean, so unlanded work stays visible', async () => {
    // The same direction `treesGit` fails in: a tree that was not checked
    // reports unclean, because absent is not false applied to a filesystem.
    const answer = await treesFixture({
      worktrees: [{ path: '/repo-wt' }],
    }).list();
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.value[0]!.clean).toBe(false);
  });

  it('answers a stated branch, and fails for a path it was not told about', async () => {
    // `''` already means DETACHED, so an unknown path cannot answer it: a
    // fixture that conflated the two could not stand in for git on the one
    // question the method exists for.
    const port = treesFixture({ branches: { '/repo': 'main', '/repo-detached': '' } });
    expect(await port.currentBranch('/repo')).toEqual({ ok: true, value: 'main' });
    expect(await port.currentBranch('/repo-detached')).toEqual({ ok: true, value: '' });
    expect((await port.currentBranch('/unknown')).ok).toBe(false);
  });

  it('finds the worktree holding a branch, and null where none does', async () => {
    const port = treesFixture({
      worktrees: [{ path: '/repo', branch: 'main' }, { path: '/repo-wt', branch: 'feature/x' }],
    });
    const found = await port.forBranch('feature/x');
    expect(found).toEqual({ ok: true, value: expect.objectContaining({ path: '/repo-wt' }) });
    expect(await port.forBranch('feature/absent')).toEqual({ ok: true, value: null });
  });

  it('filters markers by prefix, and reports none for an untold path', async () => {
    const port = treesFixture({
      markers: { '/repo-wt': ['PLOT-BLOCKED.md', 'README.md'] },
    });
    expect(await port.markers('/repo-wt', 'PLOT-BLOCKED')).toEqual({
      ok: true,
      value: ['PLOT-BLOCKED.md'],
    });
    expect(await port.markers('/elsewhere', 'PLOT-BLOCKED')).toEqual({ ok: true, value: [] });
  });
});
