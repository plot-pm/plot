import { describe, it, expect } from 'vitest';
import { measureMachine } from '@plot-pm/domain';
import { machineReader, MACHINE_REFRESH_MS } from '../../src/server/machine-reading.js';

const reading = (spawnCostMs: number | null) =>
  measureMachine({ spawnCostMs, measuredAt: 0, sampleMs: 5, loadAverage: [2.1, 3, 4], cores: 10 });

const setup = (measures: Array<ReturnType<typeof reading> | null> = [reading(2)]) => {
  const calls = { measure: 0, budgets: [] as string[] };
  let at = 1_000_000;
  const read = machineReader({
    measure: async () => measures[Math.min(calls.measure++, measures.length - 1)] ?? null,
    budgets: async (connector) => { calls.budgets.push(connector); return [{ bucket: 'api', limit: 1000, remaining: 900, resetAt: null }]; },
    now: () => at,
  });
  return { read, calls, advance: (ms: number) => { at += ms; } };
};

describe('machineReader', () => {
  it('measures once for two reads inside 60 s, and again after', async () => {
    const t = setup();
    await t.read('github');
    t.advance(MACHINE_REFRESH_MS - 1);
    await t.read('github');
    expect(t.calls.measure).toBe(1);
    t.advance(1);
    await t.read('github');
    expect(t.calls.measure).toBe(2);
  });

  it('shares one measurement between concurrent reads', async () => {
    const t = setup();
    await Promise.all([t.read('github'), t.read('github')]);
    expect(t.calls.measure).toBe(1);
  });

  it('serves a failed measurement as unmeasured and measures again after the window', async () => {
    const t = setup([null, reading(2)]);
    const failed = await t.read('github');
    expect(failed.headroom).toBe('unmeasured');
    expect(failed.load1).toBeNull();
    t.advance(MACHINE_REFRESH_MS);
    expect((await t.read('github')).headroom).toBe('clear');
  });

  it('carries headroom, the 1-minute load, cores and the connector\'s buckets', async () => {
    const t = setup([reading(80)]);
    expect(await t.read('bitbucket')).toEqual({
      headroom: 'starved', load1: 2.1, cores: 10,
      host: { connector: 'bitbucket', buckets: [{ bucket: 'api', limit: 1000, remaining: 900, resetAt: null }] },
    });
  });

  it('reads no budget where no connector is named', async () => {
    const t = setup();
    expect((await t.read(null)).host).toBeNull();
    expect(t.calls.budgets).toEqual([]);
  });
});
