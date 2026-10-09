import { describe, it, expect, vi } from 'vitest';
import type { FleetReading } from '@plot-pm/domain';

const calls = vi.hoisted(() => [] as string[]);
vi.mock('../../src/shared/auto-dispatch.js', () => ({
  maybeAutoDispatch: (_o: unknown, _p: unknown, _c: unknown, _a: unknown, own: Set<string>) => {
    calls.push('dispatch');
    return own;
  },
}));
vi.mock('../../src/shared/auto-deliver.js', () => ({
  runAutoDeliverPass: () => { calls.push('deliver'); },
}));
vi.mock('../../src/shared/machine-reading.js', () => ({ readMachine: async () => undefined }));
vi.mock('../../src/shared/fleet-settings-store.js', () => ({
  readFleetSettings: async () => ({ autoDispatch: true, parallelAgents: 2, machineOverride: false }),
}));
vi.mock('../../src/shared/registry.js', () => ({
  bashCleanliness: async () => [],
  readAgentRegistryWithInfo: async () => ({ entries: [], info: {} }),
}));

import { fleetAutoWrites } from '../../src/shared/auto-writes.js';

const PULSE = { main: 'main', head: 'abc', plans: [], summary: {} } as unknown as FleetReading;

describe('fleetAutoWrites', () => {
  it('dispatches, then delivers, on one pulse', async () => {
    calls.length = 0;
    await fleetAutoWrites({ repoRoot: '/nowhere', scriptsDir: '/nowhere' }, () => {})(PULSE);
    expect(calls).toEqual(['dispatch', 'deliver']);
  });

  it('contains a throw and reports it', async () => {
    calls.length = 0;
    const warned: string[] = [];
    const pass = fleetAutoWrites({ repoRoot: '/nowhere', scriptsDir: '/nowhere' }, (l) => warned.push(l));
    // A pulse that makes the dispatch mock fail is unnecessary: a rejecting
    // settings read is the same shape. Re-mock for this one call.
    const mod = await import('../../src/shared/fleet-settings-store.js');
    vi.spyOn(mod, 'readFleetSettings').mockRejectedValueOnce(new Error('settings gone'));
    await pass(PULSE);
    expect(calls).toEqual([]);
    expect(warned[0]).toContain('settings gone');
  });
});
