// A lifecycle write against a real repository that declares a `State branch`:
// a bare `origin` whose pre-receive hook records every push and refuses each
// push at the default branch. Real `treesGit`, real `plot-push-main.sh`.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import { commitAndPush, cutBooking, Refused, type LadderContext } from '../../src/server/entry/ladder.js';

const SCRIPT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills/plot/scripts');
const noWait = async (): Promise<void> => {};
let written = 0;

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });

const isAncestor = (cwd: string, ancestor: string, descendant: string): boolean => {
  try {
    git(cwd, 'merge-base', '--is-ancestor', ancestor, descendant);
    return true;
  } catch {
    return false;
  }
};

describe('a lifecycle write in a repository that declares a State branch', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  /** A bare origin that refuses every push at `main` and logs every push it sees. */
  const estate = (key: string) => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'plot-state-branch-')));
    roots.push(root);
    const origin = path.join(root, 'origin.git');
    const repo = path.join(root, 'repo');
    const other = path.join(root, 'other');
    const wt = path.join(root, 'wt');
    const log = path.join(root, 'pushes.log');
    git(root, 'init', '-q', '--bare', '-b', 'main', origin);
    writeFileSync(
      path.join(origin, 'hooks', 'pre-receive'),
      `#!/bin/sh\nwhile read old new ref; do echo "$ref" >> '${log}'; [ "$ref" = refs/heads/main ] && [ -s '${log}.open' ] && { echo "remote: main is protected" >&2; exit 1; }; done\nexit 0\n`,
    );
    chmodSync(path.join(origin, 'hooks', 'pre-receive'), 0o755);
    git(root, 'init', '-q', '-b', 'main', repo);
    git(repo, 'config', 'user.email', 't@t');
    mkdirSync(path.join(repo, 'docs/plans'), { recursive: true });
    writeFileSync(path.join(repo, 'docs/plans/p.md'), '# P\n\n## Status\n\n- **State:** Draft\n\n## Notes\n\n- one\n');
    writeFileSync(path.join(repo, 'CLAUDE.md'), `## Plot Config\n\n- **Main branch:** main\n${key === '' ? '' : `- **State branch:** ${key}\n`}`);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    git(repo, 'remote', 'add', 'origin', origin);
    git(repo, 'push', '-q', 'origin', 'main');
    git(repo, 'remote', 'set-head', 'origin', 'main');
    git(root, 'clone', '-q', origin, other);
    // From here on the origin protects `main`.
    writeFileSync(`${log}.open`, 'x');
    writeFileSync(log, '');
    const context = { repoRoot: repo, scriptDir: SCRIPT_DIR };
    const ctx: LadderContext = { repoRoot: repo, scripts: scriptsShell(context), trees: treesGit(context) };
    const pushes = (): string[] => readFileSync(log, 'utf8').split('\n').filter((l) => l !== '');
    return { repo, origin, other, wt, ctx, pushes };
  };

  /** Cuts a booking, writes `ours.md`, and runs the ladder. */
  const book = async (ctx: LadderContext, wt: string) => {
    const cut = await cutBooking(ctx, wt, 'plot/book', 'main', 'add');
    expect(cut.ok).toBe(true);
    const reapply = async (at: string): Promise<void> => {
      written += 1;
      writeFileSync(path.join(at, 'ours.md'), `record ${written}\n`);
      await ctx.trees.stage(at, ['ours.md']);
    };
    await reapply(wt);
    const lines: string[] = [];
    const result = await commitAndPush(ctx, wt, 'plot/book', 'main', 'jw', 'plot: record', 'approval', 'nothing', reapply, (s) => lines.push(s), 5, noWait);
    return { result, out: lines.join('') };
  };

  it('creates the state branch from the default branch and pushes nothing at the default branch', async () => {
    const { repo, origin, wt, ctx, pushes } = estate('plot/state');
    const { result, out } = await book(ctx, wt);
    expect(result).toEqual({ pushed: 'clean' });
    expect(out).toContain('refs/heads/plot/state');
    expect(pushes()).toEqual(['refs/heads/plot/state']);
    git(repo, 'fetch', '-q', 'origin');
    expect(git(origin, 'show', 'refs/heads/plot/state:ours.md')).toMatch(/^record \d+\n$/);
    expect(isAncestor(repo, 'origin/main', 'origin/plot/state')).toBe(true);
  });

  it('cuts from the state tip and merges a moved default branch in, so the state branch stays a descendant', async () => {
    const { repo, other, wt, ctx, pushes } = estate('plot/state');
    await book(ctx, wt);
    git(repo, 'worktree', 'remove', '--force', wt);
    // The default branch moves on a path the state branch did not touch.
    writeFileSync(path.join(other, 'later.md'), 'later\n');
    git(other, 'add', '-A');
    git(other, 'commit', '-q', '-m', 'main moves');
    writeFileSync(`${path.dirname(other)}/pushes.log.open`, '');
    git(other, 'push', '-q', 'origin', 'HEAD:main');
    writeFileSync(`${path.dirname(other)}/pushes.log.open`, 'x');
    const before = pushes().length;
    const again = await book(ctx, path.join(path.dirname(wt), 'wt2'));
    expect(again.result).toEqual({ pushed: 'clean' });
    expect(pushes().slice(before)).toEqual(['refs/heads/plot/state']);
    git(repo, 'fetch', '-q', 'origin');
    expect(isAncestor(repo, 'origin/main', 'origin/plot/state')).toBe(true);
    expect(git(repo, 'show', 'origin/plot/state:later.md')).toBe('later\n');
  });

  it('refuses on a forward-merge conflict, names the file and leaves the state branch where it was', async () => {
    const { repo, other, wt, ctx } = estate('plot/state');
    await book(ctx, wt);
    git(repo, 'worktree', 'remove', '--force', wt);
    git(repo, 'fetch', '-q', 'origin');
    const stateTip = git(repo, 'rev-parse', 'origin/plot/state');
    // Both sides edit the same line of the plan.
    const edit = (cwd: string, text: string, ref: string) => {
      git(cwd, 'fetch', '-q', 'origin');
      git(cwd, 'checkout', '-q', '-B', 'work', ref);
      writeFileSync(path.join(cwd, 'docs/plans/p.md'), text);
      git(cwd, 'commit', '-q', '-am', 'edit');
    };
    edit(other, '# P\n\n## Status\n\n- **State:** Approved\n\n## Notes\n\n- one\n', 'origin/main');
    writeFileSync(`${path.dirname(other)}/pushes.log.open`, '');
    git(other, 'push', '-q', 'origin', 'work:main');
    edit(other, '# P\n\n## Status\n\n- **State:** Design\n\n## Notes\n\n- one\n', 'origin/plot/state');
    git(other, 'push', '-q', 'origin', 'work:plot/state');
    writeFileSync(`${path.dirname(other)}/pushes.log.open`, 'x');
    git(repo, 'fetch', '-q', 'origin');
    const movedTip = git(repo, 'rev-parse', 'origin/plot/state');
    expect(movedTip).not.toBe(stateTip);
    await expect(book(ctx, path.join(path.dirname(wt), 'wt3'))).rejects.toThrow(/docs\/plans\/p\.md/);
    await expect(book(ctx, path.join(path.dirname(wt), 'wt4'))).rejects.toBeInstanceOf(Refused);
    git(repo, 'fetch', '-q', 'origin');
    expect(git(repo, 'rev-parse', 'origin/plot/state')).toBe(movedTip);
  });

  it('writes a ref outside refs/heads/ the same way', async () => {
    const { repo, origin, wt, ctx, pushes } = estate('refs/plot/state');
    const { result } = await book(ctx, wt);
    expect(result).toEqual({ pushed: 'clean' });
    expect(pushes()).toEqual(['refs/plot/state']);
    expect(git(origin, 'show', 'refs/plot/state:ours.md')).toMatch(/^record \d+\n$/);
    expect(git(origin, 'for-each-ref', '--format=%(refname)', 'refs/heads/')).toBe('refs/heads/main\n');
    expect(isAncestor(origin, 'refs/heads/main', 'refs/plot/state')).toBe(true);
    expect(repo).toBeTruthy();
  });

  it('with no key, cuts from and pushes at the default branch as before', async () => {
    const { repo, wt, ctx } = estate('');
    // No key, so the protected origin refuses the push at `main`: the write is not redirected.
    const { result, out } = await book(ctx, wt);
    expect(result).toEqual({ rejected: true });
    expect(out).toContain('push: rejected');
    expect(git(repo, 'rev-parse', '--verify', 'plot/book')).not.toBe('');
  });

  it('refuses an invalid key before writing anything', async () => {
    const { wt, ctx, pushes } = estate('a..b');
    await expect(cutBooking(ctx, wt, 'plot/book', 'main', 'add')).rejects.toThrow(/State branch key is refused/);
    expect(pushes()).toEqual([]);
  });
});
