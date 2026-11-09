import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { removeTree } from '../rm-tree.mjs';
import os from 'node:os';
import path from 'node:path';
import { FleetReadingSchema } from '@plot-pm/domain/entities/fleet';
import { FLEETD_HEARTBEAT_VERSION, type FleetdHeartbeat } from '@plot-pm/domain/entities/fleetd-heartbeat';
import { fleetStateFile } from '@plot-pm/domain/adapters/fleet-state/fleet-state-file';
import { fleetdHeartbeatFile } from '@plot-pm/domain/adapters/fleetd-heartbeat/fleetd-heartbeat-file';
import { bridgedPulse } from '../../src/server/entry/dispatch-command.js';

// The dispatch, continue, restart and restart-stopped commands each read the
// bridge through `fleetStateVouched`; this proves the vouch through dispatch's
// default reader, the one with an exported seam.

let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-cli-vouch-'));
});
afterEach(() => {
  removeTree(repo);
});

const reading = FleetReadingSchema.parse({
  main: 'main',
  head: 'abc',
  fetch_failed: false,
  summary: { plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
  plans: [],
});

const beat = (bridgeAt: number | null, beatAt: number): FleetdHeartbeat => ({
  version: FLEETD_HEARTBEAT_VERSION, pid: 1, startedAt: beatAt - 1_000_000, beatAt, generation: 1, bridgeAt,
  supervised: 'none', watchesWanted: 0, watchesArmed: 0, lastEventAt: null, lastSafetyNetAt: null, loops: {},
});

/** Writes a bridge `bridgeAgeMs` old and a heartbeat naming `named` at `beatAgeMs` old. */
const seed = async (bridgeAgeMs: number, named: 'same' | 'other', beatAgeMs: number): Promise<void> => {
  const at = Date.now() - bridgeAgeMs;
  await fleetStateFile({ repoRoot: repo, now: () => at }).write({
    at, pulse: reading, ages: new Map(), branchUrlBase: '', approvedAt: new Map(), ideaPlans: new Map(), prError: null,
  });
  await fleetdHeartbeatFile({ repoRoot: repo }).write(beat(named === 'same' ? at : at + 1, Date.now() - beatAgeMs));
};

describe('the CLI controllers read the heartbeat', () => {
  it('accepts a 20-minute-old bridge while the live heartbeat names its at', async () => {
    await seed(20 * 60_000, 'same', 1_000);
    expect(bridgedPulse(repo)).not.toBeNull();
  });

  it('refuses the same bridge with a stale heartbeat', async () => {
    await seed(20 * 60_000, 'same', 60_000);
    expect(bridgedPulse(repo)).toBeNull();
  });

  it('refuses a bridge the heartbeat does not name', async () => {
    await seed(20 * 60_000, 'other', 1_000);
    expect(bridgedPulse(repo)).toBeNull();
  });

  it('accepts a young bridge with no heartbeat, as before', async () => {
    await seed(60_000, 'same', 1_000);
    fs.rmSync(path.join(repo, '.plot', 'state', 'fleetd.json'));
    expect(bridgedPulse(repo)).not.toBeNull();
  });
});
