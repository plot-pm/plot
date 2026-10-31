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
vi.mock('../../src/shared/auto-fixer.js', () => ({
  runAutoFixerPass: () => { calls.push('fixer'); },
}));
vi.mock('../../src/shared/auto-review.js', () => ({
  runAutoReviewPass: () => { calls.push('review'); },
}));
vi.mock('../../src/shared/auto-ticket.js', () => ({
  runAutoTicketPass: () => { calls.push('ticket'); },
}));
vi.mock('../../src/shared/auto-merge.js', () => ({
  runAutoMergePass: () => { calls.push('merge'); },
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
  it('dispatches, delivers, starts fixers, starts reviews, then merges, on one pulse', async () => {
    calls.length = 0;
    await fleetAutoWrites({ repoRoot: '/nowhere', scriptsDir: '/nowhere' }, () => {})(PULSE);
    expect(calls).toEqual(['dispatch', 'deliver', 'fixer', 'review', 'ticket', 'merge']);
  });

  it('starts no agent, no fixer and no review once a stop is requested, and still delivers and merges', async () => {
    calls.length = 0;
    await fleetAutoWrites({ repoRoot: '/nowhere', scriptsDir: '/nowhere' }, () => {}, () => null, () => true)(PULSE);
    expect(calls).toEqual(['deliver', 'ticket', 'merge']);
  });

  it('reads the stop request after the pass starts, not when it is built', async () => {
    calls.length = 0;
    let stop = false;
    const pass = fleetAutoWrites({ repoRoot: '/nowhere', scriptsDir: '/nowhere' }, () => {}, () => null, () => stop);
    stop = true;
    await pass(PULSE);
    expect(calls).toEqual(['deliver', 'ticket', 'merge']);
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
