import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

/**
 * This repository's OWN `skills/plot/scripts`, not a stub in the fixture repo.
 *
 * `dirtyPaths` sources `plot_worker_dirty` rather than reimplementing its three
 * exclusions, so the thing under test IS that shell function — a stub would
 * assert only that the adapter can call a file it wrote itself.
 */
const scriptDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../skills/plot/scripts',
);

const treesWithScripts = (): Trees => treesGit({ repoRoot: repo, scriptDir });

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

  it('lists the dirty paths, where isClean only says whether there are any', async () => {
    // The reading `monitor_tree_fingerprint` needs and `isClean` throws away.
    // Both run the same `git status --porcelain`; only one returns the paths,
    // and a fingerprint built from a boolean cannot see a rename at all.
    fs.writeFileSync(path.join(linked, 'work.ts'), 'export const x = 1;\n');
    const answer = await treesWithScripts().dirtyPaths(linked);
    expect(answer).toEqual({ ok: true, value: ['work.ts'] });
    expect(await treesWithScripts().isClean(linked)).toEqual({ ok: true, value: false });
  });

  it("drops the monitor's own record, so two quiet passes can agree", async () => {
    // THE PROPERTY THE FILTER EXISTS FOR. `plot-worker-monitor.sh` appends its
    // findings to `.plot-worker.monitor.worker.jsonl` INSIDE the worktree it
    // watches, so an unfiltered listing changes every time the monitor
    // publishes and `idle` — which needs the fingerprint equal across two
    // passes — could never hold.
    fs.writeFileSync(path.join(linked, '.plot-worker.monitor.worker.jsonl'), '{}\n');
    fs.writeFileSync(path.join(linked, 'draft.ts.tmp1'), 'scratch\n');

    const answer = await treesWithScripts().dirtyPaths(linked);
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    // `work.ts` from the previous case survives: the exclusions are narrow, and
    // an uncommitted source file is exactly what the reading is for.
    expect(answer.value).toEqual(['work.ts']);
  });

  it('excludes a TRACKED scratch path, which `markers` cannot see at all', async () => {
    // Why this is not `markers` with a different prefix, in the one shape that
    // separates them. `markers` runs `ls -1 <path> | grep "^<prefix>"` over the
    // worktree ROOT: it lists no dotfiles and descends into nothing, so it
    // answers `[]` here. `PLOT_TOOL_SCRATCH` matches the nested path.
    //
    // TRACKED, and that is the whole setup. `git status --porcelain` collapses
    // an untracked directory to `.plot/`, which the pattern does not match —
    // recorded as `plot-worker-state.sh:252`'s behaviour rather than fixed
    // here, since the shell is the one implementation and three callers share
    // it.
    const scratch = path.join(linked, '.plot', 'state');
    fs.mkdirSync(scratch, { recursive: true });
    fs.writeFileSync(path.join(scratch, 'run.json'), '{}\n');
    git(linked, ['add', '-f', '.plot/state/run.json']);
    git(linked, ['commit', '--quiet', '-m', 'scratch']);
    fs.writeFileSync(path.join(scratch, 'run.json'), '{"moved":true}\n');

    expect(await treesWithScripts().dirtyPaths(linked)).toEqual({ ok: true, value: ['work.ts'] });
    expect(await treesWithScripts().markers(linked, '.plot')).toEqual({ ok: true, value: [] });
  });

  it('reports a failure for a path that holds no repository', async () => {
    // `answered([])` would say the desk is clean. A tree that cannot be read
    // has not been measured, and the port keeps the two apart — collapsing
    // them is how a monitor reports an unchanged fingerprint for a worktree
    // that was removed underneath it.
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-trees-dirty-'));
    try {
      expect((await treesWithScripts().dirtyPaths(outside)).ok).toBe(true);
      const answer = await treesWithScripts().dirtyPaths(path.join(outside, 'absent'));
      expect(answer).toEqual({ ok: true, value: [] });
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

  it('answers stated dirty paths, and none for an untold desk', async () => {
    // Stated ALREADY FILTERED, as the port returns them. A fixture cannot
    // stand in for the filter itself — that lives in the shell, so proving it
    // needs `treesGit` and the real script.
    const port = treesFixture({ dirty: { '/repo-wt': ['work.ts'] } });
    expect(await port.dirtyPaths('/repo-wt')).toEqual({ ok: true, value: ['work.ts'] });
    expect(await port.dirtyPaths('/elsewhere')).toEqual({ ok: true, value: [] });
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

/**
 * The four operations that WRITE or read synchronously, against the same real
 * repository. `add` and `prune` change the estate, so each works in a directory
 * it creates and removes, and nothing here touches the fixtures the reads above
 * depend on.
 */
describe('treesGit: adding, pruning, and the synchronous reads', () => {
  it('adds a detached worktree at a start point, and git sees it', async () => {
    const at = path.join(repo, '..', `${path.basename(repo)}-added`);
    const head = git(repo, ['rev-parse', 'HEAD']).trim();
    try {
      expect(await trees().add(at, head)).toEqual({ ok: true, value: undefined });
      // Asked of git rather than of the adapter that just wrote it: the
      // question is whether the checkout exists, not whether the call returned.
      expect(fs.existsSync(path.join(at, 'a.txt'))).toBe(true);
      expect(git(repo, ['worktree', 'list', '--porcelain'])).toContain(fs.realpathSync(at));
    } finally {
      git(repo, ['worktree', 'remove', '--force', at]);
    }
  });

  it('reports a failure for a start point git cannot resolve', async () => {
    const at = path.join(repo, '..', `${path.basename(repo)}-nostart`);
    expect((await trees().add(at, 'refs/heads/no-such-branch')).ok).toBe(false);
    expect(fs.existsSync(at)).toBe(false);
  });

  it('prunes the record of a checkout whose directory is gone', async () => {
    // THE STATE PRUNE EXISTS FOR, and it cannot be reached by removing a
    // worktree properly: `git worktree remove` takes the record with it. A
    // directory deleted from underneath git leaves the record behind, which is
    // what a reaped desk looks like when something removed it by hand.
    const at = path.join(repo, '..', `${path.basename(repo)}-orphan`);
    const head = git(repo, ['rev-parse', 'HEAD']).trim();
    git(repo, ['worktree', 'add', '--quiet', '--detach', at, head]);
    fs.rmSync(at, { recursive: true, force: true });
    expect(git(repo, ['worktree', 'list', '--porcelain'])).toContain('prunable');

    expect(await trees().prune()).toEqual({ ok: true, value: undefined });
    expect(git(repo, ['worktree', 'list', '--porcelain'])).not.toContain('prunable');
  });

  it('reads a clean checkout as empty porcelain, and a dirty one as its lines', () => {
    // ITS OWN CHECKOUT, not `linked`. The read tests above leave scratch and
    // state files there on purpose — one of them proves a TRACKED scratch path
    // is excluded — so `linked` is never clean and asserting emptiness on it
    // would be asserting the other tests had not run yet.
    const own = path.join(repo, '..', `${path.basename(repo)}-status`);
    git(repo, ['worktree', 'add', '--quiet', '--detach', own, git(repo, ['rev-parse', 'HEAD']).trim()]);
    try {
      const clean = trees().statusSync(own);
      expect(clean.ok).toBe(true);
      expect(clean.ok && clean.value.trim()).toBe('');

      fs.writeFileSync(path.join(own, 'dirty.txt'), 'work\n');
      const dirty = trees().statusSync(own);
      expect(dirty.ok).toBe(true);
      expect(dirty.ok && dirty.value).toContain('dirty.txt');
    } finally {
      git(repo, ['worktree', 'remove', '--force', own]);
    }
  });

  it('reports a failure for a synchronous status on a path that is no repository', () => {
    // `git -C <path>` rather than a spawn that chdirs, so an unreadable
    // checkout arrives as git's own exit code and names the path it failed on.
    expect(trees().statusSync(os.tmpdir()).ok).toBe(false);
  });

  it('lists the same worktrees synchronously as the async read does', async () => {
    const sync = trees().listSync();
    const async_ = await trees().list();
    expect(sync.ok).toBe(true);
    expect(async_.ok).toBe(true);
    if (!sync.ok || !async_.ok) return;
    // THE PROPERTY THAT MATTERS: two emissions of one question. A caller
    // choosing the synchronous form because it is on a startup path must not
    // get a different estate from one that awaited.
    expect(sync.value).toEqual(async_.value);
  });
});
