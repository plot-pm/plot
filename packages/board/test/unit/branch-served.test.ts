// What the server reports as the branch it is serving — the DECISION, pinned
// against a real repo without a page.
//
// The header names the worktree the artifact was built in so a reader with 22+
// worktrees can tell one branch's board from another's. This file owns the two
// halves of that which are pure server logic: that a branch on HEAD is
// reported, and that a DETACHED HEAD reports EMPTY — asserted as an absent
// value, because a happy-path-only test would pass an implementation that
// printed `unknown` (or a fabricated SHA) forever.
//
// The read is memoised for the life of the process — one `git` fork at startup,
// never per request. Each case here therefore resets the module so its own
// repo, not a neighbour's cached answer, is what `serverInfo` reads.
import { afterEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { BuildBoardOptions } from '../../src/server/board.js';

const dirs: string[] = [];

/** A repo on a named branch, or detached, per `opts`. */
function repo(opts: { branch?: string; detach?: boolean } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-branch-'));
  dirs.push(dir);
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'ignore'] });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one');
  git('add', '-A');
  git('commit', '-qm', 'first');
  if (opts.branch) git('checkout', '-qb', opts.branch);
  if (opts.detach) {
    // A second commit so there is a SHA to detach ONTO that is not the branch
    // tip's own name — a detached HEAD is exactly what several worktrees here
    // are, and `--show-current` prints nothing for one.
    fs.writeFileSync(path.join(dir, 'a.txt'), 'two');
    git('add', '-A');
    git('commit', '-qm', 'second');
    const sha = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    git('checkout', '-q', sha);
  }
  return dir;
}

/** Fresh module (memo cleared), pointed at `repoRoot`, returns its serverInfo. */
async function serverInfoIn(repoRoot: string) {
  vi.resetModules();
  const mod = await import('../../src/server/server-info.js');
  const opts = { repoRoot, scriptsDir: repoRoot } as unknown as BuildBoardOptions;
  return mod.serverInfo(opts, 7777);
}

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('the server names the branch it is serving', () => {
  it('reports the branch HEAD is on', async () => {
    const info = await serverInfoIn(repo({ branch: 'feature/the-board-says-which-branch-it-serves' }));
    expect(info.branch).toBe('feature/the-board-says-which-branch-it-serves');
  });

  it('reports EMPTY for a detached HEAD — asserted as absence, not a SHA', async () => {
    // The load-bearing case. `--show-current` prints nothing detached, and the
    // header renders no element for that empty. An implementation that printed
    // a short SHA — or the word `unknown` — would fail here and pass a
    // happy-path-only test, which is why this is pinned separately.
    const info = await serverInfoIn(repo({ detach: true }));
    expect(info.branch).toBe('');
  });

  it('reports EMPTY where the cwd is not a git repo — cannot-say is the same silence', async () => {
    const notARepo = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-nonrepo-'));
    dirs.push(notARepo);
    const info = await serverInfoIn(notARepo);
    expect(info.branch).toBe('');
  });

  it('reads the branch ONCE — a later checkout does not change what it reports', async () => {
    // The memo is the contract: the process serves one worktree for its life,
    // so the branch is fixed at first read. This also proves the fork is not
    // repeated per call — the request path pays nothing.
    vi.resetModules();
    const mod = await import('../../src/server/server-info.js');
    const dir = repo({ branch: 'feature/first' });
    const opts = { repoRoot: dir, scriptsDir: dir } as unknown as BuildBoardOptions;
    expect(mod.serverInfo(opts, 7777).branch).toBe('feature/first');
    execFileSync('git', ['-C', dir, 'checkout', '-qb', 'feature/second']);
    expect(mod.serverInfo(opts, 7777).branch).toBe('feature/first');
  });
});
