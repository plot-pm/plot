import { describe, it, expect } from 'vitest';
import type { Headroom } from '@plot-pm/domain';
import { fixerAdmission } from '@plot-pm/domain/rules/fixer-concurrency';
import { askWithHeadroom, readOnce, type MachineSlot } from '../../src/shared/machine-reading.js';

const slotReading = (headroom: Headroom, fields: Partial<MachineSlot> = {}): { slot: MachineSlot; reads: () => number } => {
  let reads = 0;
  const slot: MachineSlot = {
    held: [],
    machineOverride: false,
    headroom: async () => {
      reads += 1;
      return headroom;
    },
    ...fields,
  };
  return { slot, reads: () => reads };
};

const admit = (slot: MachineSlot, running: number) =>
  askWithHeadroom(
    slot,
    (headroom) => fixerAdmission({ running, held: slot.held, headroom, machineOverride: slot.machineOverride }),
    (answer) => answer.admit,
  );

describe('askWithHeadroom', () => {
  it('reads no machine where an earlier gate refuses the start', async () => {
    const { slot, reads } = slotReading('starved', { held: [{ hold: 'no-free-agent' } as never] });
    expect(await admit(slot, 0)).toEqual({ admit: false, why: 'no-free-agent' });
    expect(reads()).toBe(0);
  });

  it('reads no machine where a fixer already runs', async () => {
    const { slot, reads } = slotReading('starved');
    expect((await admit(slot, 99)).admit).toBe(false);
    expect(reads()).toBe(0);
  });

  it('reads no machine under Machine override', async () => {
    const { slot, reads } = slotReading('starved', { machineOverride: true });
    expect(await admit(slot, 0)).toEqual({ admit: true });
    expect(reads()).toBe(0);
  });

  it('reads the machine once where every other gate admits, and a starved machine refuses', async () => {
    const { slot, reads } = slotReading('starved');
    expect(await admit(slot, 0)).toEqual({ admit: false, why: 'starved' });
    expect(reads()).toBe(1);
  });
});

describe('readOnce', () => {
  it('runs the reading on the first call only', async () => {
    let runs = 0;
    const read = readOnce(async () => {
      runs += 1;
      return runs;
    });
    expect(await read()).toBe(1);
    expect(await read()).toBe(1);
    expect(runs).toBe(1);
  });
});
