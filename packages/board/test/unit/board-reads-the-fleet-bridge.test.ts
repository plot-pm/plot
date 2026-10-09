import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rmTree } from '../helpers.mjs';
import { fleetStateFile, bridgePath } from '@plot-pm/domain/adapters';
import type { BridgedPulse } from '@plot-pm/domain/ports/fleet-state';
import type { FleetReading } from '@plot-pm/domain/entities/fleet';

const dispatch = vi.hoisted(() => vi.fn((_o: unknown, _p: unknown, _c: unknown, _a: unknown, inFlight: Set<string>) => inFlight));
const deliver = vi.hoisted(() => vi.fn((_o: unknown, _p: unknown, inFlight: Set<string>) => inFlight));
vi.mock('../../src/server/auto-dispatch.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/server/auto-dispatch.js')>()),
  maybeAutoDispatch: dispatch,
}));
vi.mock('../../src/server/auto-deliver.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/server/auto-deliver.js')>()),
  maybeAutoDeliver: deliver,
}));

import { freshCacheEntry, refresh, stopFleetRefresh } from '../../src/server/fleet.js';

// While a fleet runs it owns the scan: the board reads the pulse the fleet
// bridged, spawns no scan, writes no bridge, and still auto-dispatches — once
// per new bridged pulse. Every spawn is a REAL script that appends to a log.

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
  for (const helper of ['plot-plan-meta.sh', 'plot-config.sh', 'plot-host.sh']) {
    fs.writeFileSync(path.join(dir, helper), '#!/usr/bin/env bash\nexit 0\n');
  }
  for (const f of fs.readdirSync(dir)) fs.chmodSync(path.join(dir, f), 0o755);
  execFileSync('git', ['init', '--quiet'], { cwd: dir });
  fs.mkdirSync(path.join(dir, 'pr-index'));
  vi.stubEnv('PLOT_PR_INDEX_HOME', path.join(dir, 'pr-index'));
  const opts = { repoRoot: dir, scriptsDir: dir };
  const spawned = (): string[] => (fs.existsSync(scans) ? fs.readFileSync(scans, 'utf8').split('\n').filter(Boolean) : []);
  return { dir, opts, spawned };
};

beforeEach(() => {
  dispatch.mockClear();
  deliver.mockClear();
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

  it('shows the bridged pulse after a restart without scanning, and does not dispatch from it again', async () => {
    const { dir, opts, spawned } = fixture(true);
    await fleetStateFile({ repoRoot: dir }).write(bridged(Date.now() - 2_000));
    const entry = freshCacheEntry();
    await refresh(opts, entry);
    expect(entry.at).not.toBeNull();
    expect(spawned()).toEqual([]);
    expect(dispatch).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it('auto-dispatches once per new bridged pulse and not on one already acted on', async () => {
    const { dir, opts } = fixture(true);
    const state = fleetStateFile({ repoRoot: dir });
    const entry = freshCacheEntry();
    entry.at = 1; // a warm entry: the restart preload is not under test here
    await state.write(bridged(Date.now() - 3_000));
    await refresh(opts, entry);
    await refresh(opts, entry);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledTimes(1);
    await state.write(bridged(Date.now() - 1_000));
    await refresh(opts, entry);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenCalledTimes(2);
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
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('scans in place of a fleet whose bridge went stale', async () => {
    const { dir, opts, spawned } = fixture(true);
    await fleetStateFile({ repoRoot: dir, now: () => Date.now() }).write(bridged(Date.now() - 400_000));
    const entry = freshCacheEntry();
    await refresh(opts, entry);
    expect(spawned()).toEqual(['0']);
  });
});
