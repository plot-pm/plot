// `plot-state-sync.mjs` against real repositories: a bare origin, a clone that
// runs the tick, and a second clone that moves the default branch. Only the
// host and the push are stand-ins; the push is a plain `git push` where the
// real one takes the push lock, which the tick test of the lock covers apart.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import { stateSyncFile } from '@plot-pm/domain/adapters/state-sync/state-sync-file';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import type { StateSyncRecord } from '@plot-pm/domain/ports/state-sync-record';
import { readRecordFindings } from '@plot-pm/domain/workflows/record-listing';
import { forwardOnce, prOnce, run, type StateSyncDeps } from '../../src/server/entry/state-sync.js';

const SCRIPT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills/plot/scripts');
const PLAN = 'docs/plans/2026-11-01-p.md';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

const planText = (state: string, note = 'one'): string => `# P\n\n## Status\n\n- **State:** ${state}\n\n## Notes\n\n- ${note}\n`;

interface Fixture {
  root: string;
  origin: string;
  repo: string;
  other: string;
  deps: StateSyncDeps;
  created: string[];
  commented: number[];
  pushes: string[];
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const fixture = (key: string, over: Partial<StateSyncDeps> = {}, prs: unknown[] = []): Fixture => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'plot-state-sync-entry-')));
  roots.push(root);
  const origin = path.join(root, 'origin.git');
  const repo = path.join(root, 'repo');
  const other = path.join(root, 'other');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'init', '-q', '-b', 'main', repo);
  mkdirSync(path.join(repo, 'docs/plans'), { recursive: true });
  writeFileSync(path.join(repo, PLAN), planText('Approved'));
  writeFileSync(path.join(repo, 'CLAUDE.md'), `# P\n\n## Plot Config\n\n- **Plan directory:** docs/plans/\n${key === '' ? '' : `- **State branch:** ${key}\n`}`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'remote', 'set-head', 'origin', 'main');
  if (key !== '') git(repo, 'push', '-q', 'origin', `main:${key.startsWith('refs/') ? key : `refs/heads/${key}`}`);
  git(root, 'clone', '-q', origin, other);

  const context = { repoRoot: repo, scriptDir: SCRIPT_DIR };
  const scripts = scriptsShell(context);
  const trees = treesGit(context);
  const created: string[] = [];
  const commented: number[] = [];
  const pushes: string[] = [];
  const deps: StateSyncDeps = {
    repoRoot: repo,
    ctx: { repoRoot: repo, scripts, trees },
    trees,
    refs: refsGit(context),
    host: {
      backend: async () => ({ ok: true, value: 'github' }),
      prList: async () => ({ ok: true, value: prs as never }),
      prCreate: async (req) => {
        created.push(req.head);
        return { ok: true, value: 'https://host/pr/1' };
      },
      prComment: async (pr) => {
        commented.push(pr);
        return { ok: true, value: undefined as never };
      },
    },
    record: stateSyncFile({ home: path.join(repo, '.git') }),
    lock: { heartbeats: async () => ({ ok: true, value: [] }) },
    now: Date.now,
    tmpWorktree: () => path.join(root, `wt-${Date.now()}-${Math.random().toString(16).slice(2)}`),
    pushFrom: async (tree, pushRef) => {
      pushes.push(pushRef);
      try {
        git(tree, 'push', 'origin', `HEAD:${pushRef}`);
        return { code: 0, stdout: '', stderr: '' };
      } catch (error) {
        return { code: 1, stdout: '', stderr: String(error) };
      }
    },
    config: async (k, fallback) => {
      const read = await scripts.config(k, fallback);
      return read.ok ? read.value.trim() : fallback;
    },
    ...over,
  };
  return { root, origin, repo, other, deps, created, commented, pushes };
};

/** Commits a file on the default branch from the second clone. */
const moveMain = (f: Fixture, file: string, text: string): string => {
  git(f.other, 'pull', '-q', 'origin', 'main');
  mkdirSync(path.dirname(path.join(f.other, file)), { recursive: true });
  writeFileSync(path.join(f.other, file), text);
  git(f.other, 'add', '-A');
  git(f.other, 'commit', '-q', '-m', `main moves ${file}`);
  git(f.other, 'push', '-q', 'origin', 'main');
  return git(f.other, 'rev-parse', 'HEAD');
};

const originTip = (f: Fixture, ref: string): string => git(f.origin, 'rev-parse', ref);

describe('the forward sync', () => {
  it('merges a state ref behind the default branch on one tick with no writer active', async () => {
    const f = fixture('plot/state');
    const main = moveMain(f, 'docs/note.md', 'n\n');
    const done = await forwardOnce(f.deps);
    expect(done?.report).toMatchObject({ done: 'merged' });
    expect(git(f.origin, 'merge-base', '--is-ancestor', main, 'refs/heads/plot/state') === '').toBe(true);
    expect((await forwardOnce(f.deps))?.report).toEqual({ done: 'idle', reason: 'in-sync' });
    expect(readdirSync(f.root).filter((n) => n.startsWith('wt-'))).toEqual([]);
  });

  it('merges and pushes nothing when the lock is held', async () => {
    const f = fixture('plot/state', { record: { ...stateSyncFile({ home: 'x' }), lockHeld: async () => true } as StateSyncRecord });
    const before = originTip(f, 'refs/heads/plot/state');
    moveMain(f, 'docs/note.md', 'n\n');
    expect((await forwardOnce(f.deps))?.report).toEqual({ done: 'wait', reason: 'writer-holds-lock' });
    expect(originTip(f, 'refs/heads/plot/state')).toBe(before);
    expect(f.pushes).toEqual([]);
  });

  it('names a conflict, writes nothing, and does not retry past it', async () => {
    const f = fixture('plot/state');
    git(f.repo, 'checkout', '-q', '-b', 'edit', 'origin/plot/state');
    writeFileSync(path.join(f.repo, PLAN), planText('Delivered', 'state side'));
    git(f.repo, 'commit', '-q', '-am', 'state edit');
    git(f.repo, 'push', '-q', 'origin', 'edit:refs/heads/plot/state');
    git(f.repo, 'checkout', '-q', 'main');
    moveMain(f, PLAN, planText('Approved', 'main side'));
    const before = originTip(f, 'refs/heads/plot/state');

    const first = await forwardOnce(f.deps);
    expect(first?.report).toMatchObject({ done: 'refused', files: [PLAN] });
    expect(originTip(f, 'refs/heads/plot/state')).toBe(before);
    const pushed = f.pushes.length;

    const second = await forwardOnce(f.deps);
    expect(second?.report).toMatchObject({ done: 'refused', files: [PLAN] });
    expect(f.pushes.length).toBe(pushed);
    expect(readdirSync(f.root).filter((n) => n.startsWith('wt-'))).toEqual([]);

    moveMain(f, 'docs/other.md', 'o\n');
    expect((await forwardOnce(f.deps))?.report).toMatchObject({ done: 'refused', files: [PLAN] });
  });

  it('forward-merges a refs/plot/state key and opens no pull request', async () => {
    const f = fixture('refs/plot/state');
    moveMain(f, 'docs/note.md', 'n\n');
    expect((await forwardOnce(f.deps))?.report).toMatchObject({ done: 'merged' });
    expect((await prOnce(f.deps, 'fleetd'))?.report).toEqual({ done: 'none', reason: 'no-branch' });
    expect(f.created).toEqual([]);
  });

  it('does nothing with no key', async () => {
    const f = fixture('');
    expect(await forwardOnce(f.deps)).toBeNull();
    expect(await prOnce(f.deps, 'fleetd')).toBeNull();
    const lines: string[] = [];
    expect(await run(['--forward'], f.repo, SCRIPT_DIR, (s) => lines.push(s), () => undefined, f.deps)).toBe(4);
    expect(lines).toEqual([]);
    expect(f.created).toEqual([]);
  });
});

describe('the sync pull request through the entry', () => {
  const deliver = (f: Fixture): void => {
    git(f.repo, 'checkout', '-q', '-b', 'edit', 'origin/plot/state');
    writeFileSync(path.join(f.repo, PLAN), planText('Delivered'));
    git(f.repo, 'commit', '-q', '-am', 'deliver');
    git(f.repo, 'push', '-q', 'origin', 'edit:refs/heads/plot/state');
    git(f.repo, 'checkout', '-q', 'main');
  };

  it('opens one pull request after Delivered, and a second Delivered refreshes it', async () => {
    const f = fixture('plot/state');
    deliver(f);
    expect((await prOnce(f.deps, 'fleetd'))?.report).toMatchObject({ done: 'opened' });
    expect(f.created).toEqual(['plot/state']);

    const g = fixture('plot/state', {}, [{ number: 5, head: 'plot/state', base: 'main', state: 'OPEN' }]);
    deliver(g);
    expect((await prOnce(g.deps, 'fleetd'))?.report).toEqual({ done: 'refreshed', pr: 5 });
    expect(g.created).toEqual([]);
    expect(g.commented).toEqual([5]);
  });

  it('opens it from /plot-deliver with no fleet heartbeat and not with one', async () => {
    const f = fixture('plot/state');
    deliver(f);
    expect((await prOnce(f.deps, 'command'))?.report).toMatchObject({ done: 'opened' });

    const g = fixture('plot/state', { lock: { heartbeats: async () => ({ ok: true, value: [{ name: 'fleetd', at: Date.now() }] }) } });
    deliver(g);
    expect((await prOnce(g.deps, 'command'))?.report).toEqual({ done: 'none', reason: 'fleet-owns-it' });
    expect(g.created).toEqual([]);
  });

  it('reads a state ref the default branch already holds as nothing to open', async () => {
    const f = fixture('plot/state');
    expect((await prOnce(f.deps, 'fleetd'))?.report).toMatchObject({ done: 'none' });
    expect(f.created).toEqual([]);
  });
});

describe('after the sync PR is squash-merged', () => {
  it('reads 0 ahead with no open PR, and the next forward merge is clean', async () => {
    const f = fixture('plot/state');
    // The state branch gains a Delivered record; the host squash-merges it into main.
    git(f.other, 'fetch', '-q', 'origin');
    git(f.other, 'checkout', '-q', '-B', 'work', 'origin/plot/state');
    writeFileSync(path.join(f.other, PLAN), planText('Delivered'));
    git(f.other, 'commit', '-q', '-am', 'deliver');
    git(f.other, 'push', '-q', 'origin', 'work:plot/state');
    git(f.other, 'checkout', '-q', 'main');
    git(f.other, 'merge', '-q', '--squash', 'origin/plot/state');
    git(f.other, 'commit', '-q', '-m', 'plot: sync records (squash)');
    git(f.other, 'push', '-q', 'origin', 'main');

    const outcome = await forwardOnce(f.deps);
    expect(outcome?.report).toMatchObject({ done: 'merged' });
    git(f.repo, 'fetch', '-q', 'origin');
    const found = await readRecordFindings(refsGit({ repoRoot: f.repo, scriptDir: SCRIPT_DIR }), { stateBranch: 'plot/state', defaultBranch: 'main' });
    expect(found.recordLag?.text).toBe('Records: 0 ahead of main · sync PR: none');
    expect(git(f.origin, 'rev-parse', 'plot/state^{tree}')).toBe(git(f.origin, 'rev-parse', 'main^{tree}'));
    // Nothing is behind now, so the next tick is idle rather than a conflict.
    expect((await forwardOnce(f.deps))?.report).toEqual({ done: 'idle', reason: 'in-sync' });
  }, 120_000);
});
