import { describe, it, expect, vi } from 'vitest';
import type { FleetReading } from '@plot-pm/domain';

const calls = vi.hoisted(() => [] as string[]);
const fixerSlots = vi.hoisted(() => [] as { headroom: () => Promise<string>; machineOverride: boolean; held: unknown }[]);
const dispatchMachines = vi.hoisted(() => [] as unknown[]);
const machineReads = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../src/shared/auto-dispatch.js', () => ({
  maybeAutoDispatch: (_o: unknown, _p: unknown, _c: unknown, _a: unknown, own: Set<string>, machine: unknown) => {
    calls.push('dispatch');
    dispatchMachines.push(machine);
    return own;
  },
}));
vi.mock('../../src/shared/auto-deliver.js', () => ({
  runAutoDeliverPass: () => { calls.push('deliver'); },
}));
vi.mock('../../src/shared/auto-fixer.js', () => ({
  runAutoFixerPass: (_o: unknown, _l: unknown, _n: unknown, _w: unknown, _r: unknown, slot: (typeof fixerSlots)[number]) => {
    calls.push('fixer');
    fixerSlots.push(slot);
  },
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
vi.mock('../../src/shared/machine-reading.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/shared/machine-reading.js')>()),
  readMachine: async () => {
    machineReads.count += 1;
    return { headroom: 'starved' };
  },
}));
vi.mock('../../src/shared/fleet-settings-store.js', () => ({
  readFleetSettings: async () => ({ autoDispatch: true, parallelAgents: 2, machineOverride: false }),
}));
vi.mock('../../src/shared/registry.js', () => ({
  deskCleanliness: async () => [],
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

  it('hands the fixer pass the machine headroom, the override and the queue hold, so a fixer takes a slot', async () => {
    calls.length = 0;
    fixerSlots.length = 0;
    await fleetAutoWrites({ repoRoot: '/nowhere', scriptsDir: '/nowhere' }, () => {}, () => [])(PULSE);
    expect(fixerSlots).toEqual([{ headroom: expect.any(Function), machineOverride: false, held: [] }]);
    expect(await fixerSlots[0]!.headroom()).toBe('starved');
  });

  it('hands the fixer pass a null hold while no queue pass has been read', async () => {
    fixerSlots.length = 0;
    await fleetAutoWrites({ repoRoot: '/nowhere', scriptsDir: '/nowhere' }, () => {}, () => null)(PULSE);
    expect(fixerSlots).toEqual([{ headroom: expect.any(Function), machineOverride: false, held: null }]);
  });

  it('measures the machine for no pass that starts nothing, and hands dispatch no reading without an eligible slice', async () => {
    dispatchMachines.length = 0;
    machineReads.count = 0;
    await fleetAutoWrites({ repoRoot: '/nowhere', scriptsDir: '/nowhere' }, () => {}, () => [])(PULSE);
    expect(dispatchMachines).toEqual([undefined]);
    expect(machineReads.count).toBe(0);
  });

  it('measures the machine once for an eligible slice, and the fixer reads the same measurement', async () => {
    dispatchMachines.length = 0;
    fixerSlots.length = 0;
    machineReads.count = 0;
    const eligible = {
      ...PULSE,
      plans: [{ file: 'docs/plans/x.md', phase: 'approved', slices: [{ verdict: 'eligible', branches: [] }] }],
    } as unknown as FleetReading;
    await fleetAutoWrites({ repoRoot: '/nowhere', scriptsDir: '/nowhere' }, () => {}, () => [])(eligible);
    expect(dispatchMachines).toEqual([{ headroom: 'starved' }]);
    expect(await fixerSlots[0]!.headroom()).toBe('starved');
    expect(machineReads.count).toBe(1);
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
