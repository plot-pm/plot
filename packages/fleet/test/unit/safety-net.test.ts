import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { deskFingerprint, readWatchLayout, refsGit, watchFs } from '@plot-pm/domain/adapters';
import { SAFETY_NET_MS, type StaleReading } from '@plot-pm/domain';
import type { Watch } from '@plot-pm/domain/ports/watch';
import { readRefSnapshot } from '@plot-pm/domain/workflows/plan-walk-cache';

import { startSafetyNet, type SafetyNet } from '../../src/shared/safety-net.js';
import { createSnapshotHolder, readOf, type SnapshotHolder } from '../../src/shared/snapshot-fill.js';
import { startWatchSet, type RunningWatchSet } from '../../src/shared/watch-set.js';
import { removeTree } from '../rm-tree.mjs';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

const quiet = (ms = 400): Promise<void> => new Promise((r) => setTimeout(r, ms));

const fakeSet = (pending: readonly StaleReading[] = [], after: readonly StaleReading[] = []): RunningWatchSet & { order: string[] } => {
  const order: string[] = [];
  return {
    order,
    wanted: () => 0,
    armed: () => 0,
    lastEventAt: () => null,
    pending: () => after,
    drain: () => (order.push('drain'), pending),
    sync: async () => void order.push('sync'),
    stop: () => undefined,
  };
};

const netOver = (holder: SnapshotHolder, lines: string[], clock: { at: number }): SafetyNet =>
  startSafetyNet({ held: holder.current, record: holder.record, now: () => clock.at, write: (line) => lines.push(line) });

describe('the safety net over a real watch set', () => {
  let root: string;
  let repo: string;
  let desk: string;
  let registry: string;
  let set: RunningWatchSet | undefined;

  /** Arms every directory through `watchFs` except `closed`, whose watch never delivers. */
  const startSet = async (closed: string | null): Promise<RunningWatchSet> => {
    const real = watchFs();
    const watch: Watch = {
      arm: (dir, options, onEvent) => (dir === closed ? { degraded: false, close: () => undefined } : real.arm(dir, options, onEvent)),
    };
    const refs = refsGit({ repoRoot: repo, scriptDir: repo });
    set = startWatchSet({
      watch,
      layout: () => readWatchLayout({ repoRoot: repo, commonDir: join(repo, '.git'), registryDir: registry }),
      now: () => Date.now(),
      refsDigest: async () => {
        const snapshot = await readRefSnapshot(refs);
        return snapshot.ok ? snapshot.value.digest : null;
      },
      deskFingerprint,
    });
    await set.sync();
    await quiet(600);
    set.drain();
    return set;
  };

  /** A full read of the two sources this test changes: the desk's `PLOT-BLOCKED` and `CLAUDE.md`. */
  const fullRead = (net: SafetyNet) => async (): Promise<void> => {
    const marker = join(desk, 'PLOT-BLOCKED');
    const question = existsSync(marker) ? readFileSync(marker, 'utf8') : '';
    net.record('deskFiles', readOf({ [desk]: { question, markers: [], pid: '', exit: null } }));
    net.record('config', readOf({ claude: readFileSync(join(repo, 'CLAUDE.md'), 'utf8') }));
  };

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'plot-safetynet-')));
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

  it('writes one line naming the key and the desk for a reading changed with its watch closed', async () => {
    const watched = await startSet(desk);
    const holder = createSnapshotHolder();
    const lines: string[] = [];
    const net = netOver(holder, lines, { at: 1_000 });
    await net.scan(watched, fullRead(net))();
    writeFileSync(join(desk, 'PLOT-BLOCKED'), 'which way?');
    await quiet();
    await net.scan(watched, fullRead(net))();
    expect(lines).toEqual([`plot-fleetd: safety net: deskFiles ${desk} changed with no trigger\n`]);
    expect(net.missed()).toBe(1);
  });

  it('writes no line for a change a trigger named', async () => {
    const watched = await startSet(null);
    const holder = createSnapshotHolder();
    const lines: string[] = [];
    const net = netOver(holder, lines, { at: 1_000 });
    await net.scan(watched, fullRead(net))();
    writeFileSync(join(desk, 'PLOT-BLOCKED'), 'which way?');
    writeFileSync(join(repo, 'CLAUDE.md'), 'y');
    await quiet();
    await net.scan(watched, fullRead(net))();
    expect(holder.current().readings.config).toMatchObject({ state: 'read', value: { claude: 'y' } });
    expect(lines).toEqual([]);
    expect(net.missed()).toBe(0);
  });
});

describe('the safety net around one scan', () => {
  it('syncs the desk set and drains the pending set before the scan, which still runs', async () => {
    const watched = fakeSet();
    const holder = createSnapshotHolder();
    const net = netOver(holder, [], { at: 0 });
    await net.scan(watched, async () => void watched.order.push('scan'))();
    expect(watched.order).toEqual(['sync', 'drain', 'scan']);
  });

  it('runs the scan and compares nothing where fleetd arms no watch', async () => {
    const holder = createSnapshotHolder();
    const lines: string[] = [];
    const net = netOver(holder, lines, { at: 0 });
    let scans = 0;
    const scan = async (): Promise<void> => {
      scans += 1;
      net.record('config', readOf({ n: String(scans) }));
    };
    await net.scan(null, scan)();
    await net.scan(null, scan)();
    expect(scans).toBe(2);
    expect(lines).toEqual([]);
  });

  it('counts an event pending when the scan ends as named', async () => {
    const holder = createSnapshotHolder();
    const lines: string[] = [];
    const net = netOver(holder, lines, { at: 0 });
    let n = 0;
    const scan = async (): Promise<void> => {
      n += 1;
      net.record('config', readOf({ n: String(n) }));
    };
    await net.scan(fakeSet(), scan)();
    await net.scan(fakeSet([], [{ key: 'config' }]), scan)();
    expect(lines).toEqual([]);
    await net.scan(fakeSet(), scan)();
    expect(lines).toEqual(['plot-fleetd: safety net: config changed with no trigger\n']);
  });

  it('compares only what the scan recorded, not a reading another loop recorded meanwhile', async () => {
    const holder = createSnapshotHolder();
    const lines: string[] = [];
    const net = netOver(holder, lines, { at: 0 });
    holder.record('prs', readOf([]));
    await net.scan(fakeSet(), async () => undefined)();
    holder.record('prs', readOf([{ number: 1 }] as never));
    await net.scan(fakeSet(), async () => undefined)();
    expect(lines).toEqual([]);
  });

  it('leaves the scan\'s rejection to its caller and compares nothing', async () => {
    const holder = createSnapshotHolder();
    const lines: string[] = [];
    const net = netOver(holder, lines, { at: 0 });
    holder.record('config', readOf({ a: '1' }));
    const failing = async (): Promise<void> => {
      net.record('config', readOf({ a: '2' }));
      throw new Error('scan broke');
    };
    await expect(net.scan(fakeSet(), failing)()).rejects.toThrow('scan broke');
    expect(lines).toEqual([]);
    net.record('config', readOf({ a: '3' }));
    expect(lines).toEqual([]);
  });

  it('stamps lastAt on the first full read, again 10 minutes later and after a wake, and not in between', async () => {
    const holder = createSnapshotHolder();
    const clock = { at: 1_000 };
    const net = netOver(holder, [], clock);
    const scan = net.scan(fakeSet(), async () => undefined);
    expect(net.lastAt()).toBeNull();
    await scan();
    expect(net.lastAt()).toBe(1_000);
    clock.at = 1_000 + SAFETY_NET_MS - 1;
    await scan();
    expect(net.lastAt()).toBe(1_000);
    clock.at = 1_000 + SAFETY_NET_MS;
    await scan();
    expect(net.lastAt()).toBe(1_000 + SAFETY_NET_MS);
    clock.at += 5_000;
    net.woke();
    await scan();
    expect(net.lastAt()).toBe(clock.at);
    clock.at += 5_000;
    await scan();
    expect(net.lastAt()).toBe(clock.at - 5_000);
  });
});
