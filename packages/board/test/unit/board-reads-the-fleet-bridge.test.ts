import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rmTree } from '../helpers.mjs';
import { fleetStateFile, bridgePath, readerLockFile, readerLockKey } from '@plot-pm/domain/adapters';
import type { BridgedPulse } from '@plot-pm/domain/ports/fleet-state';
import type { FleetReading } from '@plot-pm/domain/entities/fleet';

const fold = vi.hoisted(() => ({ calls: 0 }));
vi.mock('@plot-pm/domain', async (importOriginal) => {
  const real = await importOriginal<typeof import('@plot-pm/domain')>();
  return {
    ...real,
    foldPrIndex: (...args: Parameters<typeof real.foldPrIndex>) => {
      fold.calls += 1;
      return real.foldPrIndex(...args);
    },
  };
});

import { freshCacheEntry, maybeRefreshPrs, pulseFor, refresh, stopFleetRefresh } from '../../src/server/fleet.js';
import { prIndexFile } from '@plot-pm/domain/adapters';

// While a fleet runs it owns the scan: the board reads the pulse the fleet
// bridged, spawns no scan, writes no bridge, and acts on no pulse. Every spawn is a REAL script that appends to a log.

const PULSE: FleetReading = {
  main: 'main',
  head: 'abc1234',
  plans: [],
  summary: {
    plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0,
    waiting: 0, prereq_missing: 0, host: 'unknown' as const,
  },
};

const bridged = (at: number, prError: string | null = null): BridgedPulse => ({
  at,
  pulse: PULSE,
  ages: new Map([['feature/a', 3]]),
  branchUrlBase: 'https://example.invalid/tree/',
  approvedAt: new Map(),
  ideaPlans: new Map(),
  prError,
});

const temps: string[] = [];
const children: ChildProcess[] = [];

/** The marks an automatic write leaves under `.plot/state/`; a board that acts leaves one. */
const autoWrites = (dir: string): string[] => {
  const state = path.join(dir, '.plot', 'state');
  return fs.existsSync(state) ? fs.readdirSync(state).filter((f) => f.startsWith('auto-')) : [];
};

/** A repository whose scripts directory counts scan spawns and answers `supervisor: up` or down. */
const fixture = (supervisorUp: boolean) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-bridge-read-'));
  temps.push(dir);
  const scans = path.join(dir, 'scans.log');
  const scan = JSON.stringify({ kind: 'reading', reading: PULSE });
  fs.writeFileSync(
    path.join(dir, 'plot-fleet-scan.sh'),
    `#!/usr/bin/env bash\necho "$PLOT_SCAN_RECORD" >> ${JSON.stringify(scans)}\nprintf '%s\\n' ${JSON.stringify(scan)}\n`,
  );
  fs.writeFileSync(
    path.join(dir, 'plot-fleetctl.sh'),
    `#!/usr/bin/env bash\necho x >> ${JSON.stringify(path.join(dir, 'ctl.log'))}\necho 'summary: install=installed'\nexit ${supervisorUp ? 0 : 1}\n`,
  );
  const hosts = path.join(dir, 'hosts.log');
  const row = JSON.stringify({
    number: 7, head: 'feature/a', state: 'OPEN', draft: false, checks: 'pass', review: 'none', url: 'https://example.invalid/pr/7',
  });
  fs.writeFileSync(
    path.join(dir, 'plot-host.sh'),
    `#!/usr/bin/env bash\ncase "$1" in\n  backend) echo github ;;\n  pr-list) echo pr-list >> ${JSON.stringify(hosts)}; printf '%s\\n' ${JSON.stringify(row)} ;;\nesac\nexit 0\n`,
  );
  for (const helper of ['plot-plan-meta.sh', 'plot-config.sh']) {
    fs.writeFileSync(path.join(dir, helper), '#!/usr/bin/env bash\nexit 0\n');
  }
  for (const f of fs.readdirSync(dir)) fs.chmodSync(path.join(dir, f), 0o755);
  execFileSync('git', ['init', '--quiet'], { cwd: dir });
  fs.mkdirSync(path.join(dir, 'pr-index'));
  vi.stubEnv('PLOT_PR_INDEX_HOME', path.join(dir, 'pr-index'));
  // Isolates the reader-election lock from the operator's own `~/.plot/state`
  // and from every other test — a shared lock directory would let two
  // fixtures elect against the same key and read each other's writes.
  vi.stubEnv('PLOT_BUDGET_HOME', path.join(dir, 'budget-home'));
  const opts = { repoRoot: dir, scriptsDir: dir };
  const prListed = (): number => (fs.existsSync(hosts) ? fs.readFileSync(hosts, 'utf8').split('\n').filter(Boolean).length : 0);
  const spawned = (): string[] => (fs.existsSync(scans) ? fs.readFileSync(scans, 'utf8').split('\n').filter(Boolean) : []);
  const supervisorReads = (): number => (fs.existsSync(path.join(dir, 'ctl.log')) ? fs.readFileSync(path.join(dir, 'ctl.log'), 'utf8').split('\n').filter(Boolean).length : 0);
  return { dir, opts, spawned, prListed, supervisorReads };
};

beforeEach(() => {
  fold.calls = 0;
});
afterEach(() => {
  stopFleetRefresh();
  vi.unstubAllEnvs();
  for (const d of temps.splice(0)) rmTree(d);
  for (const child of children.splice(0)) child.kill();
});

describe('the board while a fleet runs', () => {
  it('spawns no scan, writes no bridge, and shows the bridged pulse', async () => {
    const { dir, opts, spawned } = fixture(true);
    await fleetStateFile({ repoRoot: dir }).write(bridged(Date.now() - 2_000));
    const before = fs.readFileSync(bridgePath(dir));
    const entry = freshCacheEntry();
    await refresh(opts, entry);
    expect(spawned()).toEqual([]);
    expect(fs.readFileSync(bridgePath(dir)).equals(before)).toBe(true);
    expect(entry.pulse?.head).toBe('abc1234');
    expect(entry.ages.get('feature/a')).toBe(3);
    expect(entry.error).toBeNull();
  });

  it('shows the bridged pulse after a restart without scanning, and acts on nothing', async () => {
    const { dir, opts, spawned } = fixture(true);
    await fleetStateFile({ repoRoot: dir }).write(bridged(Date.now() - 2_000));
    // The first synchronous access seeds the cache from the bridge, as a
    // restarted process does, and starts its own first refresh.
    expect(pulseFor(opts)?.head).toBe('abc1234');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(spawned()).toEqual([]);
    expect(autoWrites(dir)).toEqual([]);
  });

  it('acts on no bridged pulse: the fleet daemon makes the automatic writes', async () => {
    const { dir, opts } = fixture(true);
    const state = fleetStateFile({ repoRoot: dir });
    const entry = freshCacheEntry();
    entry.at = 1; // a warm entry: the restart preload is not under test here
    await state.write(bridged(Date.now() - 3_000));
    await refresh(opts, entry);
    await refresh(opts, entry);
    await state.write(bridged(Date.now() - 1_000));
    await refresh(opts, entry);
    expect(autoWrites(dir)).toEqual([]);
  });
});

describe('the board alone', () => {
  it('scans for display, records nothing, and leaves last-pulse.json unchanged', async () => {
    const { dir, opts, spawned } = fixture(false);
    await fleetStateFile({ repoRoot: dir }).write(bridged(Date.now() - 2_000));
    const before = fs.readFileSync(bridgePath(dir));
    const entry = freshCacheEntry();
    await refresh(opts, entry);
    expect(spawned()).toEqual(['0']);
    expect(fs.readFileSync(bridgePath(dir)).equals(before)).toBe(true);
    expect(autoWrites(dir)).toEqual([]);
  });

  it('scans in place of a fleet whose bridge went stale', async () => {
    const { dir, opts, spawned } = fixture(true);
    await fleetStateFile({ repoRoot: dir, now: () => Date.now() }).write(bridged(Date.now() - 400_000));
    const entry = freshCacheEntry();
    await refresh(opts, entry);
    expect(spawned()).toEqual(['0']);
  });
});

const heldRow = {
  number: 9, head: 'feature/held', state: 'OPEN', draft: false, checks: 'pass', review: 'none', url: 'https://example.invalid/pr/9',
};

describe('the PR side of the board', () => {
  it('while a fleet runs, serves the index and makes no host read and no fold', async () => {
    const { dir, opts, prListed } = fixture(true);
    const index = prIndexFile({ cwd: dir });
    const { foldPrIndex } = await vi.importActual<typeof import('@plot-pm/domain')>('@plot-pm/domain');
    await index.write('github', foldPrIndex(null, { connector: 'github', rows: [heldRow], kind: 'whole', at: new Date().toISOString() }));
    const file = await index.location('github');
    const path_ = file.ok ? file.value : '';
    const before = fs.readFileSync(path_);
    await fleetStateFile({ repoRoot: dir }).write(bridged(Date.now() - 2_000));
    const entry = freshCacheEntry();
    await refresh(opts, entry);
    fold.calls = 0;
    await maybeRefreshPrs(opts, entry);
    expect(prListed()).toBe(0);
    expect(fold.calls).toBe(0);
    expect(entry.prsByNumber?.get(9)?.head).toBe('feature/held');
    expect(fs.readFileSync(path_).equals(before)).toBe(true);
  });

  it('alone, asks the host, elects itself, and writes the index', async () => {
    const { dir, opts, prListed } = fixture(false);
    await fleetStateFile({ repoRoot: dir }).write(bridged(Date.now() - 2_000));
    const entry = freshCacheEntry();
    await refresh(opts, entry);
    await maybeRefreshPrs(opts, entry);
    expect(prListed()).toBeGreaterThan(0);
    expect(entry.prsByNumber?.get(7)?.head).toBe('feature/a');
    // Alone, no peer holds the reader lock, so this process wins the election
    // and folds into the REAL store — the fix for the regression the plan
    // names: a solo fleet-less board is also the first (and only) reader, and
    // its answer must be published for the next process to converge on.
    const file = await prIndexFile({ cwd: dir }).location('github');
    expect(fs.existsSync(file.ok ? file.value : '')).toBe(true);
  });

  it('a losing reader makes no host call and serves what the holder published', async () => {
    // THE REGRESSION THE PLAN NAMES: before this slice, every fleet-less
    // process folded into its own `memoryOverlay` and never converged, so two
    // processes on one machine meant two host calls, forever. Proving that at
    // this level needs a genuinely SEPARATE pid holding the lock — this
    // process's own pid would read as a renewal (same holder, come back), not
    // a second reader — so a real child process holds the lock the way a real
    // second board process would, while this test calls `maybeRefreshPrs`
    // directly, the same call a losing process makes.
    const { dir, opts, prListed } = fixture(false);
    await fleetStateFile({ repoRoot: dir }).write(bridged(Date.now() - 2_000));
    const held = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    children.push(held);
    await new Promise<void>((resolve) => held.once('spawn', () => resolve()));
    const lock = readerLockFile({ home: path.join(dir, 'budget-home') });
    const key = readerLockKey('github', 'unknown', path.basename(dir));
    const claim = { pid: held.pid, startedAt: null, at: Date.now() };
    const elected = await lock.elect(key, claim);
    expect(elected.ok && elected.value).toBe('elected');

    // The holder has published nothing yet — the losing reader must say so
    // rather than invent a result, the same guard a holder's own first pass keeps.
    const entryBeforePublish = freshCacheEntry();
    await refresh(opts, entryBeforePublish);
    await maybeRefreshPrs(opts, entryBeforePublish);
    expect(prListed()).toBe(0);
    expect(entryBeforePublish.prError).toBe('no PR reader has published to the store yet');

    // Now the "holder" publishes — standing in for the winner's own refresh
    // pass completing — and a second losing reader must read that answer
    // rather than asking the host itself.
    const index = (await import('@plot-pm/domain/adapters')).prIndexFile({ cwd: dir });
    const { foldPrIndex } = await vi.importActual<typeof import('@plot-pm/domain')>('@plot-pm/domain');
    await index.write('github', foldPrIndex(null, { connector: 'github', rows: [heldRow], kind: 'whole', at: new Date().toISOString() }));

    const entry = freshCacheEntry();
    await refresh(opts, entry);
    await maybeRefreshPrs(opts, entry);
    expect(prListed()).toBe(0);
    expect(entry.prsByNumber?.get(9)?.head).toBe('feature/held');
  });
});

describe('the PR reader while a fleet runs', () => {
  const seedStore = async (dir: string) => {
    const index = prIndexFile({ cwd: dir });
    const { foldPrIndex } = await vi.importActual<typeof import('@plot-pm/domain')>('@plot-pm/domain');
    await index.write('github', foldPrIndex(null, { connector: 'github', rows: [heldRow], kind: 'whole', at: new Date().toISOString() }));
  };

  it('shows the fleet\'s last PR error beside the maps it served', async () => {
    const { dir, opts } = fixture(true);
    await seedStore(dir);
    await fleetStateFile({ repoRoot: dir }).write(bridged(Date.now() - 2_000, 'gh: HTTP 502'));
    const entry = freshCacheEntry();
    await refresh(opts, entry);
    await maybeRefreshPrs(opts, entry);
    expect(entry.prError).toBe('gh: HTTP 502');
  });

  it('clears the error once the fleet bridges none', async () => {
    const { dir, opts } = fixture(true);
    await seedStore(dir);
    const entry = freshCacheEntry();
    entry.prError = 'old';
    await fleetStateFile({ repoRoot: dir }).write(bridged(Date.now() - 2_000));
    await refresh(opts, entry);
    await maybeRefreshPrs(opts, entry);
    expect(entry.prError).toBeNull();
  });

  it('names an unreadable index instead of leaving the reader looking healthy', async () => {
    const { dir, opts } = fixture(true);
    await fleetStateFile({ repoRoot: dir }).write(bridged(Date.now() - 2_000));
    const entry = freshCacheEntry();
    await refresh(opts, entry);
    expect(entry.prError).toBeNull();
    await maybeRefreshPrs(opts, entry);
    expect(entry.prError).not.toBeNull();
  });
});

describe('an owned refresh', () => {
  it('skips the display reads while the bridge `at` is unchanged, and redoes them when it advances', async () => {
    const { dir, opts, supervisorReads } = fixture(true);
    const state = fleetStateFile({ repoRoot: dir });
    const at = Date.now() - 2_000;
    await state.write(bridged(at));
    const entry = freshCacheEntry();
    await refresh(opts, entry);
    const first = supervisorReads();
    expect(first).toBe(1);
    entry.versions = new Map([['sentinel', '1']]);
    entry.unmerged = new Set(['sentinel']);
    entry.questions = new Map([['sentinel', { firstLine: 'x', askedAt: 'y' }]]);
    await refresh(opts, entry);
    expect(supervisorReads()).toBe(first + 1);
    expect(entry.versions.has('sentinel')).toBe(true);
    expect(entry.unmerged.has('sentinel')).toBe(true);
    expect(entry.questions.has('sentinel')).toBe(true);
    await state.write(bridged(at + 1_000));
    await refresh(opts, entry);
    expect(supervisorReads()).toBe(first + 2);
    expect(entry.versions.has('sentinel')).toBe(false);
    expect(entry.unmerged.has('sentinel')).toBe(false);
    expect(entry.questions.has('sentinel')).toBe(false);
  });

  it('never skips when the board scans for itself', async () => {
    const { dir, opts, supervisorReads } = fixture(false);
    await fleetStateFile({ repoRoot: dir }).write(bridged(Date.now() - 2_000));
    const entry = freshCacheEntry();
    await refresh(opts, entry);
    await refresh(opts, entry);
    expect(supervisorReads()).toBe(2);
  });
});

describe('a fleet that stops between two bridge writes', () => {
  it('reads the supervisor again and takes the scan over on the next tick', async () => {
    const { dir, opts, spawned, supervisorReads } = fixture(true);
    await fleetStateFile({ repoRoot: dir }).write(bridged(Date.now() - 2_000));
    const entry = freshCacheEntry();
    await refresh(opts, entry);
    expect(spawned()).toEqual([]);
    // The operator stops the fleet: the supervisor reads down, and the bridge
    // keeps the `at` the last owned tick applied.
    fs.writeFileSync(
      path.join(dir, 'plot-fleetctl.sh'),
      `#!/usr/bin/env bash\necho x >> ${JSON.stringify(path.join(dir, 'ctl.log'))}\necho 'summary: install=installed'\nexit 1\n`,
    );
    await refresh(opts, entry);
    expect(supervisorReads()).toBe(2);
    expect(spawned()).toEqual(['0']);
  });
});
