import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { clockManual, defaultBranchFile } from '@plot-pm/domain/adapters';
import { DEFAULT_BRANCH_VERSION, type DefaultBranchReading } from '@plot-pm/domain/entities/default-branch';

import {
  bindChannelSlot,
  prsBeat,
  queueWorldForRepo,
  relayBeat,
  stopOnSignals,
  type ChannelSlot,
} from '../../src/server/entry/registryd-main.js';
import { startFleetClock } from '../../src/shared/fleet-clock.js';

import type { RunningChannel } from '../../src/shared/channel-socket.js';

const emptySlot = (): ChannelSlot => ({ channel: null, indexMonitor: null, deskRelay: null });
const fakeChannel = (): RunningChannel => ({ stop: async () => undefined }) as unknown as RunningChannel;

describe('the prs beat', () => {
  it('reads the PRs, then the default branch, then runs the monitor', async () => {
    const order: string[] = [];
    const slot: ChannelSlot = {
      channel: fakeChannel(),
      indexMonitor: async () => { order.push('indexMonitor'); },
      deskRelay: null,
    };
    await prsBeat(
      { readPrs: async () => { order.push('readPrs'); }, readDefaultBranch: async () => { order.push('readDefaultBranch'); } },
      slot,
    )();
    expect(order).toEqual(['readPrs', 'readDefaultBranch', 'indexMonitor']);
  });

  it('completes with no channel and no retry, running both reads', async () => {
    const order: string[] = [];
    await prsBeat(
      { readPrs: async () => { order.push('readPrs'); }, readDefaultBranch: async () => { order.push('readDefaultBranch'); } },
      emptySlot(),
    )();
    expect(order).toEqual(['readPrs', 'readDefaultBranch']);
  });

  it('retries the bind after the reads and serves the monitor of the channel it bound', async () => {
    const order: string[] = [];
    const slot = emptySlot();
    const published: string[] = [];
    const retry = () =>
      bindChannelSlot(slot, async () => { order.push('open'); return fakeChannel(); }, () => ({
        indexMonitor: async () => { published.push('monitor-over-new-channel'); },
        deskRelay: async () => { published.push('relay-over-new-channel'); },
      }));
    const beat = prsBeat(
      { readPrs: async () => { order.push('readPrs'); }, readDefaultBranch: async () => { order.push('readDefaultBranch'); } },
      slot,
      retry,
    );
    await beat();
    expect(order).toEqual(['readPrs', 'readDefaultBranch', 'open']);
    expect(slot.channel).not.toBeNull();
    // THE RETRY REPLACED THE LIVE BINDING: the monitor of the new channel ran in the same beat.
    expect(published).toEqual(['monitor-over-new-channel']);
    await relayBeat(slot, () => undefined);
    expect(published).toEqual(['monitor-over-new-channel', 'relay-over-new-channel']);
  });

  it('keeps retrying while the bind fails, and stops once it holds a channel', async () => {
    const slot = emptySlot();
    let opens = 0;
    const retry = () =>
      bindChannelSlot(slot, async () => { opens += 1; return opens < 3 ? null : fakeChannel(); }, () => ({
        indexMonitor: null,
        deskRelay: null,
      }));
    const beat = prsBeat({ readPrs: async () => undefined, readDefaultBranch: async () => undefined }, slot, retry);
    await beat();
    await beat();
    expect(slot.channel).toBeNull();
    await beat();
    await beat();
    expect(opens).toBe(3);
    expect(slot.channel).not.toBeNull();
  });
});

describe('the desk relay beat', () => {
  it('warns where the relay throws and returns', async () => {
    const warnings: string[] = [];
    await relayBeat({ deskRelay: async () => { throw new Error('socket gone'); } }, (s) => warnings.push(s));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('desk relay failed: socket gone');
  });

  it('does nothing with no relay', async () => {
    const warnings: string[] = [];
    await relayBeat({ deskRelay: null }, (s) => warnings.push(s));
    expect(warnings).toEqual([]);
  });
});

describe('stopping on a signal', () => {
  it.each(['SIGTERM', 'SIGINT'])('flips stop() when %s arrives', (signal) => {
    const handlers = new Map<string, () => void>();
    const stop = stopOnSignals({ on: ((name: string, fn: () => void) => { handlers.set(name, fn); }) as never });
    expect(stop()).toBe(false);
    handlers.get(signal)?.();
    expect(stop()).toBe(true);
  });
});

describe('a swallowed subscriber throw', () => {
  it('warns with the subscriber name and the reason, and the clock keeps running', async () => {
    const clock = clockManual(0);
    const warnings: string[] = [];
    let scans = 0;
    startFleetClock(
      clock,
      { scan: async () => { scans += 1; }, prs: async () => { throw new Error('monitor blew up'); } },
      (s) => warnings.push(s),
    );
    for (let i = 0; i < 12; i += 1) {
      clock.advance(1);
      await new Promise((r) => setImmediate(r));
    }
    expect(scans).toBe(12);
    expect(warnings).toEqual(['plot-fleetd: pr-reader failed: monitor blew up']);
  });
});

describe('the queue world holds on a settled-red default branch', () => {
  const reading = (askedAt: string): DefaultBranchReading => ({
    v: DEFAULT_BRANCH_VERSION,
    branch: 'main',
    headSha: 'abc',
    head: 'red',
    settled: { sha: 'abc', state: 'red' },
    failingRuns: [],
    headSince: askedAt,
    askedAt,
    at: askedAt,
  });
  const iso = (agoMs: number) => new Date(Date.now() - agoMs).toISOString();
  const held = async (file: DefaultBranchReading | null): Promise<boolean> => {
    const dir = mkdtempSync(join(tmpdir(), 'registryd-wiring-'));
    try {
      if (file !== null) await defaultBranchFile(dir).write(file);
      return await queueWorldForRepo(dir, dir, { calls: 0 }).defaultBranchRed();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('holds on a red reading within Checks wait (default 3600 s)', async () => {
    expect(await held(reading(iso(60_000)))).toBe(true);
  });

  it('holds nothing on a red reading older than Checks wait', async () => {
    expect(await held(reading(iso(2 * 3_600_000)))).toBe(false);
  });

  it('holds nothing with no file', async () => {
    expect(await held(null)).toBe(false);
  });
});
