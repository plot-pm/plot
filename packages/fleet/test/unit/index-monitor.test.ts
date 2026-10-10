import { describe, expect, it } from 'vitest';

import type { Finding, MonitorName } from '@plot-pm/domain/entities/finding';
import type { PrIndex, PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import { startFleetChannel } from '../../src/server/entry/registryd-main.js';
import { runIndexMonitor, type IndexMonitorWorld } from '../../src/shared/index-monitor.js';

const NOW = '2026-10-10T12:00:00Z';

const row = (over: Partial<PrIndexRow> = {}): PrIndexRow => ({
  number: 1,
  head: 'feature/one',
  state: 'OPEN',
  draft: false,
  checks: 'green',
  review: 'none',
  url: 'https://example.test/pull/1',
  headSha: 'aaa',
  headSince: '2026-10-10T09:00:00Z',
  checksSha: 'aaa',
  ...over,
});

const indexOf = (rows: PrIndexRow[]): PrIndex =>
  ({ v: 4, connector: 'github', watermark: null, complete: true, at: NOW, wholeAt: NOW, rows }) as PrIndex;

/** A channel that holds what it is given the way the real one does: one slot per monitor and branch. */
const fakeChannel = () => {
  const slots = new Map<string, Finding>();
  const seen: MonitorName[] = [];
  const published: Finding[] = [];
  return {
    slots,
    seen,
    published,
    channel: {
      findings: (): readonly Finding[] => [...slots.values()],
      publish: (f: Finding): void => {
        published.push(f);
        if (f.finding === 'clear') slots.delete(`${f.monitor} ${f.branch}`);
        else slots.set(`${f.monitor} ${f.branch}`, f);
      },
      seen: (m: MonitorName): void => {
        seen.push(m);
      },
    },
  };
};

const world = (
  channel: IndexMonitorWorld['channel'],
  over: Partial<IndexMonitorWorld> = {},
): { world: IndexMonitorWorld; lines: string[] } => {
  const lines: string[] = [];
  return {
    lines,
    world: {
      index: async () => indexOf([row()]),
      defaultBranch: async () => null,
      sliceBranches: async () => new Set(['feature/one']),
      channel,
      now: () => NOW,
      log: (l) => lines.push(l),
      ...over,
    },
  };
};

describe('runIndexMonitor', () => {
  it('publishes once for an identical index, logs the publish, and still calls `seen` on the second fold', async () => {
    const c = fakeChannel();
    const w = world(c.channel);
    await runIndexMonitor(w.world);
    await runIndexMonitor(w.world);
    expect(c.published).toHaveLength(1);
    expect(w.lines).toHaveLength(1);
    expect(w.lines[0]).toContain('index-monitor publish IndexMonitor feature/one: checks green');
    expect(c.seen).toEqual(['IndexMonitor', 'IndexMonitor']);
  });

  it('logs a clear when a pending PR retracts a held `checks green`', async () => {
    const c = fakeChannel();
    await runIndexMonitor(world(c.channel).world);
    const w = world(c.channel, { index: async () => indexOf([row({ checks: 'pending' })]) });
    await runIndexMonitor(w.world);
    expect(c.slots.size).toBe(0);
    expect(w.lines).toHaveLength(1);
    expect(w.lines[0]).toContain('index-monitor clear');
  });

  it('publishes and clears nothing, and does not call `seen`, when the index is unreadable', async () => {
    const c = fakeChannel();
    await runIndexMonitor(world(c.channel).world);
    c.seen.length = 0;
    const w = world(c.channel, { index: async () => null });
    await runIndexMonitor(w.world);
    expect(c.published).toHaveLength(1);
    expect(c.slots.size).toBe(1);
    expect(c.seen).toEqual([]);
    expect(w.lines).toEqual([]);
  });

  it('treats a plan store that cannot be read as unreadable and retracts nothing', async () => {
    const c = fakeChannel();
    await runIndexMonitor(world(c.channel).world);
    c.seen.length = 0;
    await runIndexMonitor(world(c.channel, { sliceBranches: async () => null }).world);
    expect(c.slots.size).toBe(1);
    expect(c.seen).toEqual([]);
  });

  it('does not call `seen` after a fold whose read threw, so a failed fold never reads as a measurement', async () => {
    const c = fakeChannel();
    const w = world(c.channel, { defaultBranch: async () => { throw new Error('disk gone'); } });
    await expect(runIndexMonitor(w.world)).rejects.toThrow('disk gone');
    expect(c.seen).toEqual([]);
    expect(c.published).toEqual([]);
  });
});

describe('startFleetChannel', () => {
  it('warns once and returns null when the bind fails, so the tick goes on', async () => {
    const warnings: string[] = [];
    const channel = await startFleetChannel(
      '/repo',
      (s) => warnings.push(s),
      async () => { throw new Error('EADDRINUSE'); },
    );
    expect(channel).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('running without it');
    expect(warnings[0]).toContain('EADDRINUSE');
  });

  it('binds `.plot/fleet.sock` under the checkout', async () => {
    let address = '';
    await startFleetChannel('/repo', () => {}, async (o) => {
      address = o.address;
      return {} as never;
    });
    expect(address).toBe('/repo/.plot/fleet.sock');
  });
});
