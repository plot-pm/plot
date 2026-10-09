import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rmTree } from '../helpers.mjs';
import { fleetStateFile, bridgePath } from '@plot-pm/domain/adapters';
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

const bridged = (at: number): BridgedPulse => ({
  at,
  pulse: PULSE,
  ages: new Map([['feature/a', 3]]),
  branchUrlBase: 'https://example.invalid/tree/',
  approvedAt: new Map(),
  ideaPlans: new Map(),
});

const temps: string[] = [];

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
    `#!/usr/bin/env bash\necho 'summary: install=installed'\nexit ${supervisorUp ? 0 : 1}\n`,
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
  const opts = { repoRoot: dir, scriptsDir: dir };
  const prListed = (): number => (fs.existsSync(hosts) ? fs.readFileSync(hosts, 'utf8').split('\n').filter(Boolean).length : 0);
  const spawned = (): string[] => (fs.existsSync(scans) ? fs.readFileSync(scans, 'utf8').split('\n').filter(Boolean) : []);
  return { dir, opts, spawned, prListed };
};

beforeEach(() => {
  fold.calls = 0;
});
afterEach(() => {
  stopFleetRefresh();
  vi.unstubAllEnvs();
  for (const d of temps.splice(0)) rmTree(d);
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

  it('alone, asks the host and folds in memory without writing the index', async () => {
    const { dir, opts, prListed } = fixture(false);
    await fleetStateFile({ repoRoot: dir }).write(bridged(Date.now() - 2_000));
    const entry = freshCacheEntry();
    await refresh(opts, entry);
    await maybeRefreshPrs(opts, entry);
    expect(prListed()).toBeGreaterThan(0);
    expect(entry.prsByNumber?.get(7)?.head).toBe('feature/a');
    const file = await prIndexFile({ cwd: dir }).location('github');
    expect(fs.existsSync(file.ok ? file.value : '')).toBe(false);
  });
});
