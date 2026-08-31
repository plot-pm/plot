import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildBoard, resetGitCache, resetConfigCache } from '../../src/server/board.js';

/**
 * Two git answers are asked once per repo, because they cannot change.
 *
 * ## Why this exists, measured 2026-08-31
 *
 * `git()` is `execFileSync` — synchronous, on the request path, unable to yield.
 * A `sample` of a wedged board caught `node::SyncProcessRunner::Spawn` on the
 * main thread in 4258 of 4262 samples while a static file timed out at 15 s.
 *
 * Measured per call: `rev-parse --show-toplevel` **89 ms**,
 * `symbolic-ref --short refs/remotes/origin/HEAD` **44 ms**, and
 * `defaultBranchOf` has five call sites.
 *
 * ## What these tests are FOR
 *
 * The cache is trivial; the claim that these two answers *cannot change* is
 * not. So the tests are about the boundary rather than the mechanism: the
 * cached answers must be right, they must not leak between repositories, and —
 * the one that matters most — **caching them must not freeze anything that
 * reads repository CONTENT**, which changes on every commit.
 */

const CONFIG = `# Repo

## Plot Config

- **Plan directory:** docs/plans/
`;

const PLAN = (title: string) => `# ${title}

## Status

- **Phase:** Approved
- **Type:** feature
`;

const SCRIPTS = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../../../skills/plot/scripts',
);

/** A real git repo with one plan — the smallest thing `buildBoard` can read. */
function makeRepo(title: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-git-cache-'));
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), CONFIG, 'utf8');
  fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'plans', '2026-01-01-a.md'), PLAN(title), 'utf8');
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q');
  git('-c', 'user.email=a@b', '-c', 'user.name=a', 'add', '-A');
  git('-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', 'init');
  return root;
}

const build = (repoRoot: string) =>
  buildBoard({ repoRoot, scriptsDir: SCRIPTS } as unknown as Parameters<typeof buildBoard>[0]);

let repos: string[] = [];

beforeEach(() => {
  resetGitCache();
  resetConfigCache();
  repos = [];
});

afterEach(() => {
  for (const r of repos) fs.rmSync(r, { recursive: true, force: true, maxRetries: 3 });
  resetGitCache();
  resetConfigCache();
});

describe('the cached answers are the right ones', () => {
  it('builds a board that finds the repo plan', () => {
    // The `--show-toplevel` answer gates the branch walk: a wrong one makes the
    // board decide it is not in the repository it was pointed at and return
    // nothing. So a card appearing at all is the cache being correct.
    const repo = makeRepo('Ship the widget');
    repos.push(repo);
    const board = build(repo);
    const titles = board.columns.flatMap((c) => c.cards.map((card) => card.title));
    expect(titles).toContain('Ship the widget');
  });

  it('gives the same answer on a second build', () => {
    const repo = makeRepo('Ship the widget');
    repos.push(repo);
    const first = build(repo).columns.flatMap((c) => c.cards.map((card) => card.title));
    const second = build(repo).columns.flatMap((c) => c.cards.map((card) => card.title));
    expect(second).toEqual(first);
  });
});

describe('caching a repo answer does not freeze repo CONTENT', () => {
  it('sees a plan added after the first build', () => {
    // THE TEST THIS CACHE MUST SURVIVE, and the reason only two questions are
    // cached. `ls-tree`, `for-each-ref` and `show` answer differently on every
    // commit; caching THOSE would make the board show an estate that no longer
    // exists. Here the static answers are cached and the content is not, so a
    // plan written after the first build appears in the second.
    const repo = makeRepo('First plan');
    repos.push(repo);
    expect(build(repo).columns.flatMap((c) => c.cards.map((k) => k.title)))
      .toContain('First plan');

    fs.writeFileSync(
      path.join(repo, 'docs', 'plans', '2026-01-02-b.md'),
      PLAN('Second plan'),
      'utf8',
    );

    const titles = build(repo).columns.flatMap((c) => c.cards.map((k) => k.title));
    expect(titles).toContain('Second plan');
    expect(titles).toContain('First plan');
  });
});

describe('one repo answer never becomes another repo answer', () => {
  it('keys on the repository, not on the question alone', () => {
    // The board serves one repo, but a test suite and any future multi-repo
    // caller do not. A cache keyed on the question alone would hand the second
    // repo the first one's toplevel — and the toplevel check is what stops a
    // board from staging plans out of an unrelated checkout.
    const a = makeRepo('Plan in A');
    const b = makeRepo('Plan in B');
    repos.push(a, b);

    expect(build(a).columns.flatMap((c) => c.cards.map((k) => k.title)))
      .toContain('Plan in A');
    const titlesB = build(b).columns.flatMap((c) => c.cards.map((k) => k.title));
    expect(titlesB).toContain('Plan in B');
    expect(titlesB).not.toContain('Plan in A');
  });
});

describe('the reset seam works, because a test suite needs it', () => {
  it('re-asks after a reset', () => {
    // Not a property of production — nothing there resets — but the seam has to
    // be real, or a suite that changes repos mid-file gets a stale answer and
    // the failure looks like a board bug.
    const repo = makeRepo('Ship the widget');
    repos.push(repo);
    build(repo);
    resetGitCache();
    expect(build(repo).columns.flatMap((c) => c.cards.map((k) => k.title)))
      .toContain('Ship the widget');
  });
});
