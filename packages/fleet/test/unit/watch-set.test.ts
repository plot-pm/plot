import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clockManual, deskFingerprint, readWatchLayout, refsGit, watchFs } from '@plot-pm/domain/adapters';
import { answered, decodeFleetdHeartbeat, encodeFleetdHeartbeat, type SnapshotChange } from '@plot-pm/domain';
import type { FleetdHeartbeatStore } from '@plot-pm/domain/ports/fleetd-heartbeat';
import { readRefSnapshot } from '@plot-pm/domain/workflows/plan-walk-cache';

import { startFleetdHeartbeat } from '../../src/shared/fleetd-heartbeat.js';
import { startWatchSet, type RunningWatchSet } from '../../src/shared/watch-set.js';
import { removeTree } from '../rm-tree.mjs';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

const until = async (ok: () => boolean, ms = 5000): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
};
const quiet = (ms = 400): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('fleetd watch set', () => {
  let root: string;
  let repo: string;
  let desk: string;
  let registry: string;
  let set: RunningWatchSet | undefined;
  let changes: SnapshotChange[];
  let raised: SnapshotChange[];

  const start = async (layoutOverride?: () => ReturnType<typeof readWatchLayout>): Promise<RunningWatchSet> => {
    const refs = refsGit({ repoRoot: repo, scriptDir: repo });
    const common = join(repo, '.git');
    set = startWatchSet({
      watch: watchFs(),
      layout: layoutOverride ?? (() => readWatchLayout({ repoRoot: repo, commonDir: common, registryDir: registry })),
      now: () => Date.now(),
      refsDigest: async () => {
        const snapshot = await readRefSnapshot(refs);
        return snapshot.ok ? snapshot.value.digest : null;
      },
      deskFingerprint,
      onRaised: (change) => raised.push(change),
      onChange: (change) => changes.push(change),
    });
    await set.sync();
    // fs.watch returns before the platform watch is live; let it settle, then forget what the setup wrote.
    await quiet(600);
    set.drain();
    changes.length = 0;
    raised.length = 0;
    return set;
  };

  beforeEach(() => {
    changes = [];
    raised = [];
    root = realpathSync(mkdtempSync(join(tmpdir(), 'plot-watchset-')));
    repo = join(root, 'repo');
    registry = join(root, 'agents');
    mkdirSync(registry);
    git(root, 'init', '-q', '-b', 'main', repo);
    writeFileSync(join(repo, 'CLAUDE.md'), 'x');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'first');
    desk = join(root, 'desk');
    git(repo, 'worktree', 'add', '-q', '-b', 'feature/x', desk);
  });

  afterEach(async () => {
    set?.stop();
    set = undefined;
    await removeTree(root);
  });

  it('raises desk-git for each of two commits in one desk', async () => {
    await start();
    for (const n of [1, 2]) {
      const before = raised.filter((c) => c.kind === 'desk-git').length;
      writeFileSync(join(desk, 'f.txt'), String(n));
      git(desk, 'add', 'f.txt');
      git(desk, 'commit', '-q', '-m', `c${n}`);
      await until(() => raised.filter((c) => c.kind === 'desk-git').length > before);
      expect(raised.filter((c) => c.kind === 'desk-git').length).toBeGreaterThan(before);
      await quiet();
    }
    expect(changes.filter((c) => c.kind === 'desk-git' && c.desk === desk).length).toBeGreaterThanOrEqual(2);
    expect(set!.pending()).toContainEqual({ key: 'desks', desk });
  }, 30_000);

  it('raises refs for git pack-refs and nothing for a FETCH_HEAD write', async () => {
    git(repo, 'branch', 'feature/y');
    await start();
    writeFileSync(join(repo, '.git', 'FETCH_HEAD'), 'abc\n');
    await quiet();
    expect(raised).toEqual([]);
    expect(set!.pending()).toEqual([]);

    // Packing moves no ref, so the event is raised and the content check drops it.
    git(repo, 'pack-refs', '--all');
    await until(() => raised.length > 0);
    expect(raised).toContainEqual({ kind: 'refs' });
    await quiet();
    expect(set!.pending()).toEqual([]);

    // A ref that moves is a change, and a refs change names plans too.
    git(repo, 'branch', 'feature/z');
    await until(() => set!.pending().length > 0);
    expect(set!.pending()).toContainEqual({ key: 'refs' });
    expect(set!.pending()).toContainEqual({ key: 'plans' });
  }, 30_000);

  it('leaves the pending set empty after its own git status and git fetch with no ref moved', async () => {
    const remote = join(root, 'remote.git');
    git(root, 'init', '-q', '--bare', remote);
    git(repo, 'remote', 'add', 'origin', remote);
    git(repo, 'push', '-q', 'origin', 'main');
    git(repo, 'fetch', '-q', 'origin');
    await start();
    git(desk, '--no-optional-locks', 'status', '--porcelain');
    git(repo, 'fetch', '-q', '--prune', 'origin');
    git(repo, '--no-optional-locks', 'status', '--porcelain');
    await quiet(800);
    expect(set!.pending()).toEqual([]);
    expect(changes).toEqual([]);
  }, 30_000);

  it('raises a registry change, a config change, and a desk-files change', async () => {
    await start();
    writeFileSync(join(registry, 'a.json'), '{}');
    writeFileSync(join(repo, 'CLAUDE.md'), 'y');
    writeFileSync(join(desk, 'PLOT-BLOCKED'), 'q');
    writeFileSync(join(desk, '.plot-worker.log'), 'l');
    await until(() => ['registry', 'config', 'desk-files', 'worker-log'].every((k) => changes.some((c) => c.kind === k)));
    for (const kind of ['registry', 'config', 'desk-files', 'worker-log']) expect(changes.some((c) => c.kind === kind)).toBe(true);
  }, 30_000);

  it('arms a desk added later and closes the watches of a desk removed', async () => {
    await start();
    const before = set!.wanted();
    const second = join(root, 'desk2');
    git(repo, 'worktree', 'add', '-q', '-b', 'feature/z', second);
    await set!.sync();
    expect(set!.wanted()).toBe(before + 2);
    expect(set!.armed()).toBe(set!.wanted());
    git(repo, 'worktree', 'remove', '--force', second);
    await set!.sync();
    expect(set!.wanted()).toBe(before);
  }, 30_000);

  it('reads degraded when a desk root cannot be armed, and the heartbeat shows armed below wanted', async () => {
    const layout = () => {
      const real = readWatchLayout({ repoRoot: repo, commonDir: join(repo, '.git'), registryDir: registry });
      return { ...real, desks: [...real.desks, { path: join(root, 'missing'), admin: join(root, 'missing-admin') }] };
    };
    await start(layout);
    expect(set!.wanted()).toBe(8);
    expect(set!.armed()).toBe(6);

    const clock = clockManual(1_000);
    let seen: unknown = null;
    const store: FleetdHeartbeatStore = { read: async () => answered(null), write: async (h) => ((seen = h), answered(undefined)) };
    const stop = startFleetdHeartbeat(
      clock,
      store,
      {
        pid: 1,
        startedAt: 0,
        supervised: 'none',
        generation: () => 0,
        bridgeAt: () => null,
        passes: () => ({}),
        observer: () => ({ watchesWanted: set!.wanted(), watchesArmed: set!.armed(), lastEventAt: set!.lastEventAt() }),
      },
      () => undefined,
    );
    await quiet(50);
    const beat = decodeFleetdHeartbeat(encodeFleetdHeartbeat(seen as never));
    expect(beat?.watchesWanted).toBe(8);
    expect(beat?.watchesArmed).toBe(6);
    await stop();
  }, 30_000);

  it('moves lastEventAt on an event, and ignores events after stop', async () => {
    await start();
    await quiet(300);
    const before = set!.lastEventAt() ?? 0;
    writeFileSync(join(registry, 'b.json'), '{}');
    await until(() => (set!.lastEventAt() ?? 0) > before);
    expect(set!.lastEventAt()).toBeGreaterThan(before);
    expect(set!.drain()).toContainEqual({ key: 'registry' });
    expect(set!.pending()).toEqual([]);
    set!.stop();
    set!.stop();
    writeFileSync(join(registry, 'c.json'), '{}');
    await quiet();
    expect(set!.pending()).toEqual([]);
    await set!.sync();
    expect(set!.wanted()).toBeGreaterThan(0);
  }, 30_000);

  it('reports the observer fields as 0, 0 and null where fleetd arms none', async () => {
    const clock = clockManual(1_000);
    let seen: unknown = null;
    const stop = startFleetdHeartbeat(
      clock,
      { read: async () => answered(null), write: async (h) => ((seen = h), answered(undefined)) },
      { pid: 1, startedAt: 0, supervised: 'none', generation: () => 0, bridgeAt: () => null, passes: () => ({}) },
      () => undefined,
    );
    await quiet(50);
    expect(seen).toMatchObject({ watchesWanted: 0, watchesArmed: 0, lastEventAt: null });
    await stop();
  });
});
