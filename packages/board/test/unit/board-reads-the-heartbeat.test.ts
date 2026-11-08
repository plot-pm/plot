import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fleetdHeartbeatFile, fleetStateFile } from '@plot-pm/domain/adapters';
import { FLEETD_HEARTBEAT_VERSION, type FleetdHeartbeat } from '@plot-pm/domain';
import type { BridgedPulse } from '@plot-pm/domain/ports/fleet-state';
import { rmTree } from '../helpers.mjs';
import { buildFleet, ensureCache, freshCacheEntry, refresh, stopFleetRefresh } from '../../src/server/fleet.js';

// A board with a live heartbeat from a supervised fleetd does not run
// `plot-fleetctl.sh --status`; with a stale or absent one it runs it every beat.

const temps: string[] = [];

const beat = (beatAt: number, supervised: FleetdHeartbeat['supervised'] = 'launchd'): FleetdHeartbeat => ({
  version: FLEETD_HEARTBEAT_VERSION,
  pid: process.pid,
  startedAt: beatAt - 600_000,
  beatAt,
  generation: 1,
  bridgeAt: null,
  supervised,
  watchesWanted: 0,
  watchesArmed: 0,
  lastEventAt: null,
  lastSafetyNetAt: null,
  loops: {},
});

const fixture = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-heartbeat-board-'));
  temps.push(dir);
  const log = path.join(dir, 'ctl.log');
  fs.writeFileSync(
    path.join(dir, 'plot-fleetctl.sh'),
    `#!/usr/bin/env bash\necho x >> ${JSON.stringify(log)}\necho 'summary: supervisor=up'\nexit 0\n`,
  );
  fs.writeFileSync(path.join(dir, 'plot-host.sh'), '#!/usr/bin/env bash\ncase "$1" in backend) echo github ;; esac\nexit 0\n');
  for (const helper of ['plot-plan-meta.sh', 'plot-config.sh']) fs.writeFileSync(path.join(dir, helper), '#!/usr/bin/env bash\nexit 0\n');
  for (const f of fs.readdirSync(dir)) fs.chmodSync(path.join(dir, f), 0o755);
  execFileSync('git', ['init', '--quiet'], { cwd: dir });
  const ctlRuns = (): number => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0);
  return { dir, opts: { repoRoot: dir, scriptsDir: dir }, ctlRuns };
};

const bridge = (at: number): BridgedPulse => ({
  at,
  pulse: {
    main: 'main',
    head: 'abc1234',
    plans: [],
    summary: { plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0, waiting: 0, prereq_missing: 0, host: 'unknown' as const },
  },
  prError: null,
});

afterEach(() => {
  stopFleetRefresh();
  for (const dir of temps.splice(0)) rmTree(dir);
});

describe('the board refresh and the fleetd heartbeat', () => {
  it('runs plot-fleetctl.sh 0 times in 12 beats while the heartbeat is live', async () => {
    const { dir, opts, ctlRuns } = fixture();
    await fleetdHeartbeatFile({ repoRoot: dir }).write(beat(Date.now()));
    await fleetStateFile({ repoRoot: dir }).write(bridge(Date.now() - 2_000));
    const entry = freshCacheEntry();
    for (let i = 0; i < 12; i += 1) await refresh(opts, entry);
    expect(ctlRuns()).toBe(0);
    expect(entry.supervisor?.supervisor).toBe('up');
  });

  it('runs plot-fleetctl.sh 12 times in 12 beats while the heartbeat is stale', async () => {
    const { dir, opts, ctlRuns } = fixture();
    await fleetdHeartbeatFile({ repoRoot: dir }).write(beat(Date.now() - 120_000));
    const entry = freshCacheEntry();
    for (let i = 0; i < 12; i += 1) await refresh(opts, entry);
    expect(ctlRuns()).toBe(12);
  });

  it('runs it every beat when no heartbeat exists', async () => {
    const { opts, ctlRuns } = fixture();
    const entry = freshCacheEntry();
    for (let i = 0; i < 3; i += 1) await refresh(opts, entry);
    expect(ctlRuns()).toBe(3);
  });

  it('runs it every beat for a live heartbeat of a fleetd started by hand', async () => {
    const { dir, opts, ctlRuns } = fixture();
    await fleetdHeartbeatFile({ repoRoot: dir }).write(beat(Date.now(), 'none'));
    const entry = freshCacheEntry();
    for (let i = 0; i < 3; i += 1) await refresh(opts, entry);
    expect(ctlRuns()).toBe(3);
  });
});

describe('/api/fleet liveness facts', () => {
  it('reports the file and the channel as two facts', async () => {
    const { dir, opts } = fixture();
    await fleetdHeartbeatFile({ repoRoot: dir }).write(beat(Date.now()));
    await refresh({ ...opts, channelLink: () => 'down' }, ensureCache(opts));
    const fleet = await buildFleet({ ...opts, channelLink: () => 'down' });
    expect(fleet.fleetd).toEqual({ file: 'live', channel: 'down' });
  });

  it('reports the channel unknown where the board has no hub', async () => {
    const { opts } = fixture();
    await refresh(opts, ensureCache(opts));
    expect((await buildFleet(opts)).fleetd).toEqual({ file: 'absent', channel: 'unknown' });
  });
});
