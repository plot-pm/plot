// The wiring, unmocked. `auto-writes.test.ts` replaces `auto-deliver.js`, so it
// cannot notice a rename or a signature change on either side of the call. This
// file mocks everything `fleetAutoWrites` imports EXCEPT `auto-deliver.js`, and
// asserts the real `runAutoDeliverPass` is what runs: it reads the in-flight
// record under `repoRoot`, which only the real function does.
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FleetReading } from '@plot-pm/domain';
import { removeTree as rmTree } from '../rm-tree.mjs';

vi.mock('../../src/shared/auto-dispatch.js', () => ({
  maybeAutoDispatch: (_o: unknown, _p: unknown, _c: unknown, _a: unknown, own: Set<string>) => own,
}));
vi.mock('../../src/shared/machine-reading.js', () => ({ readMachine: async () => undefined }));
vi.mock('../../src/shared/fleet-settings-store.js', () => ({
  readFleetSettings: async () => ({ autoDispatch: false, parallelAgents: 2, machineOverride: false }),
}));
vi.mock('../../src/shared/registry.js', () => ({
  bashCleanliness: async () => [],
  readAgentRegistryWithInfo: async () => ({ entries: [], info: {} }),
}));

import { fleetAutoWrites } from '../../src/shared/auto-writes.js';
import * as real from '../../src/shared/auto-deliver.js';
import { inFlightPath } from '../../src/shared/in-flight-store.js';

const PULSE = { main: 'main', head: 'abc', plans: [], summary: {} } as unknown as FleetReading;

describe('fleetAutoWrites wiring', () => {
  it('calls the real runAutoDeliverPass', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-autowire-'));
    try {
      expect(typeof real.runAutoDeliverPass).toBe('function');
      // An unreadable record is the real function's own refusal: it logs and
      // starts nothing. A stand-in with the same name would not log it.
      fs.mkdirSync(path.dirname(inFlightPath(repoRoot, 'deliver')), { recursive: true });
      fs.writeFileSync(inFlightPath(repoRoot, 'deliver'), '{not json');
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      await fleetAutoWrites({ repoRoot, scriptsDir: repoRoot }, () => {})(PULSE);
      const said = log.mock.calls.map((c) => String(c[0]));
      log.mockRestore();
      expect(said.some((l) => l.includes('auto-deliver: cannot read the in-flight record'))).toBe(true);
    } finally {
      rmTree(repoRoot);
    }
  });
});
