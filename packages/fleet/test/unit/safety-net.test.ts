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
import type { ScanPlan } from '@plot-pm/domain';
import { startWatchSet, type RunningWatchSet } from '../../src/shared/watch-set.js';
import { removeTree } from '../rm-tree.mjs';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

const quiet = (ms = 400): Promise<void> => new Promise((r) => setTimeout(r, ms));

const fakeSet = (
  named: readonly StaleReading[] = [],
  after: readonly StaleReading[] = [],
  remote = false,
  degraded = false,
): RunningWatchSet & { order: string[]; requeued: readonly StaleReading[] } => {
  const order: string[] = [];
  let current = named;
  const set = {
    order,
    requeued: [] as readonly StaleReading[],
    wanted: () => (degraded ? 2 : 0),
    armed: () => 0,
    lastEventAt: () => null,
    pending: () => current,
    remotePending: () => remote,
    drain: () => {
      order.push('drain');
      const drained = current;
      current = after;
      return drained;
    },
    requeue: (readings: readonly StaleReading[]) => {
      set.requeued = readings;
    },
    raise: () => undefined,
    sync: async () => void order.push('sync'),
    stop: () => undefined,
  };
  return set;
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
  const fullRead = (net: SafetyNet) => async (): Promise<boolean> => {
    const marker = join(desk, 'PLOT-BLOCKED');
    const question = existsSync(marker) ? readFileSync(marker, 'utf8') : '';
    net.record('deskFiles', readOf({ [desk]: { question, markers: [], pid: '', exit: null } }));
    net.record('config', readOf({ claude: readFileSync(join(repo, 'CLAUDE.md'), 'utf8') }));
    return true;
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
    const clock = { at: 1_000 };
    const net = netOver(holder, lines, clock);
    await net.scan(watched, fullRead(net))();
    writeFileSync(join(desk, 'PLOT-BLOCKED'), 'which way?');
    await quiet();
    clock.at = 1_000 + SAFETY_NET_MS;
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
    await net.scan(watched, async () => (watched.order.push('scan'), true))();
    expect(watched.order).toEqual(['sync', 'drain', 'scan']);
  });

  it('runs the scan and compares nothing where fleetd arms no watch', async () => {
    const holder = createSnapshotHolder();
    const lines: string[] = [];
    const net = netOver(holder, lines, { at: 0 });
    let scans = 0;
    const scan = async (): Promise<boolean> => {
      scans += 1;
      net.record('config', readOf({ n: String(scans) }));
      return true;
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
    const scan = async (): Promise<boolean> => {
      n += 1;
      net.record('config', readOf({ n: String(n) }));
      return true;
    };
    await net.scan(fakeSet(), scan)();
    await net.scan(fakeSet([{ key: 'config' }]), scan)();
    expect(lines).toEqual([]);
    await net.scan(fakeSet([{ key: 'prs' }]), scan)();
    expect(lines).toEqual(['plot-fleetd: safety net: config changed with no trigger\n']);
  });

  it('compares only what the scan recorded, not a reading another loop recorded meanwhile', async () => {
    const holder = createSnapshotHolder();
    const lines: string[] = [];
    const net = netOver(holder, lines, { at: 0 });
    holder.record('prs', readOf([]));
    await net.scan(fakeSet(), async () => true)();
    holder.record('prs', readOf([{ number: 1 }] as never));
    await net.scan(fakeSet([{ key: 'issues' }]), async () => true)();
    expect(lines).toEqual([]);
  });

  it('leaves the scan\'s rejection to its caller and compares nothing', async () => {
    const holder = createSnapshotHolder();
    const lines: string[] = [];
    const net = netOver(holder, lines, { at: 0 });
    holder.record('config', readOf({ a: '1' }));
    const failing = async (): Promise<boolean> => {
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
    const scan = net.scan(fakeSet(), async () => true);
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

  it('starts no scan on an idle beat run 120 times, and none of them fetches', async () => {
    const holder = createSnapshotHolder();
    const clock = { at: 1_000 };
    const net = netOver(holder, [], clock);
    const plans: ScanPlan[] = [];
    const scan = net.scan(fakeSet(), async (plan) => (plans.push(plan), true));
    await scan();
    expect(plans).toHaveLength(1);
    for (let beat = 0; beat < 120; beat += 1) {
      clock.at += 4_999;
      await scan();
    }
    expect(plans).toHaveLength(1);
  });

  it('runs no fetch for a CI-only change and a fetch for a remote one', async () => {
    const holder = createSnapshotHolder();
    const net = netOver(holder, [], { at: 0 });
    await net.scan(fakeSet(), async () => true)();
    const plans: ScanPlan[] = [];
    const take = async (plan: ScanPlan): Promise<boolean> => (plans.push(plan), true);
    await net.scan(fakeSet([{ key: 'prs' }]), take)();
    await net.scan(fakeSet([{ key: 'prs' }, { key: 'refs' }], [], true), take)();
    expect(plans.map((plan) => plan.fetch)).toEqual([false, true]);
  });

  it('leaves the readings pending when the scan throws, and when it does not land', async () => {
    const holder = createSnapshotHolder();
    const net = netOver(holder, [], { at: 0 });
    await net.scan(fakeSet(), async () => true)();
    const thrown = fakeSet([{ key: 'prs' }]);
    await expect(net.scan(thrown, async () => { throw new Error('boom'); })()).rejects.toThrow('boom');
    expect(thrown.requeued).toEqual([{ key: 'prs' }]);
    const refused = fakeSet([{ key: 'config' }]);
    await net.scan(refused, async () => false)();
    expect(refused.requeued).toEqual([{ key: 'config' }]);
  });

  it('scans on every beat while one watch is degraded', async () => {
    const holder = createSnapshotHolder();
    const clock = { at: 1_000 };
    const net = netOver(holder, [], clock);
    let scans = 0;
    const scan = net.scan(fakeSet([], [], false, true), async () => (scans += 1, true));
    for (let beat = 0; beat < 5; beat += 1) {
      clock.at += 5_000;
      await scan();
    }
    expect(scans).toBe(5);
  });

  it('reads everything on the safety net and stamps it, where a named scan stamps nothing', async () => {
    const holder = createSnapshotHolder();
    const clock = { at: 1_000 };
    const net = netOver(holder, [], clock);
    const plans: ScanPlan[] = [];
    const take = async (plan: ScanPlan): Promise<boolean> => (plans.push(plan), true);
    await net.scan(fakeSet(), take)();
    clock.at += 5_000;
    await net.scan(fakeSet([{ key: 'prs' }]), take)();
    expect(net.lastAt()).toBe(1_000);
    clock.at = 1_000 + SAFETY_NET_MS;
    await net.scan(fakeSet(), take)();
    expect(plans.map((plan) => plan.readings === 'all')).toEqual([true, false, true]);
    expect(plans[2]).toMatchObject({ reason: 'safety-net', fetch: true });
    expect(net.lastAt()).toBe(clock.at);
  });
});
