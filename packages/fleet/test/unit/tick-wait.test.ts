import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { clockManual } from '@plot-pm/domain/adapters';
import type { WatchListener } from '@plot-pm/domain/ports/watch';

import { run, type RunSeams, type StopFlag } from '../../src/server/entry/registryd-main.js';
import type { TickReport } from '../../src/server/entry/registryd.js';

const HOUR = 3_600_000;
const settle = async (turns = 8): Promise<void> => {
  for (let i = 0; i < turns; i += 1) await new Promise((r) => setImmediate(r));
};

const until = async (done: () => boolean): Promise<void> => {
  for (let waited = 0; !done() && waited < 10_000; waited += 20) await new Promise((r) => setTimeout(r, 20));
};

const completedTick = (): TickReport => ({
  startedAt: 0,
  costMs: 1,
  agents: 0,
  incomplete: '',
  handOver: null,
  decision: {
    outcome: 'decided',
    workflow: 'supervise',
    writes: [],
    detail: { agents: [], left: [], reaping: [], correcting: [], needingAPerson: [], deferred: [], unclaimed: [] },
  },
});

describe('run — the tick waits on triggers and a deadline', () => {
  let dir = '';
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'tick-wait-')));
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    mkdirSync(join(dir, '.plot', 'agents'), { recursive: true });
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const start = (overrides: Partial<RunSeams> = {}) => {
    const clock = clockManual(1_700_000_000_000);
    const listeners: { dir: string; listener: WatchListener }[] = [];
    let ticks = 0;
    let scans = 0;
    let stopped = false;
    let release: () => void = () => undefined;
    const requested = new Promise<void>((resolve) => (release = resolve));
    const stop: StopFlag = Object.assign(() => stopped, { requested });
    const lines: string[] = [];
    const finished = run(
      [],
      dir,
      (line) => void lines.push(line),
      async () => {
        throw new Error('an armed watch never sleeps');
      },
      stop,
      () => undefined,
      dir,
      {
        clock,
        tick: async () => (ticks += 1, completedTick()),
        scan: async () => void (scans += 1),
        readPrs: async () => undefined,
        readDefaultBranch: async () => undefined,
        readIssues: async () => undefined,
        readIssueWrites: async () => undefined,
        openChannel: (async () => ({ stop: async () => undefined })) as never,
        overChannel: () => ({ indexMonitor: null, deskRelay: async () => undefined }),
        watch: {
          arm: (armed, _options, listener) => {
            listeners.push({ dir: armed, listener });
            return { degraded: false, close: () => undefined };
          },
        },
        ...overrides,
      },
    );
    return {
      clock,
      listeners,
      ticks: () => ticks,
      scans: () => scans,
      lines,
      end: async () => {
        stopped = true;
        release();
        await finished;
      },
    };
  };

  it('runs one tick at start and a full scan, and no further tick while the watches are armed and nothing is pending', async () => {
    const world = start();
    await until(() => world.ticks() >= 1);
    await new Promise((r) => setTimeout(r, 500));
    world.clock.advance(120);
    await settle();
    expect(world.ticks()).toBe(1);
    expect(world.scans()).toBeGreaterThanOrEqual(1);
    await world.end();
  });

  it('runs one tick for a registry change, once the next beat\'s scan drains it, and none before', async () => {
    const world = start();
    await until(() => world.ticks() >= 1);
    await new Promise((r) => setTimeout(r, 500));
    const scans = world.scans();
    const registry = world.listeners.find((l) => l.dir === join(dir, '.plot', 'agents'));
    expect(registry).toBeDefined();
    registry!.listener({ dir: registry!.dir, name: 'a.json', kind: 'change' });
    await settle();
    expect(world.ticks()).toBe(1);
    // The clock advances one beat at a time until the scan drains the change.
    for (let steps = 0; world.ticks() < 2 && steps < 100; steps += 1) {
      world.clock.advance(1);
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(world.scans()).toBeGreaterThan(scans);
    expect(world.ticks()).toBe(2);
    await new Promise((r) => setTimeout(r, 300));
    expect(world.ticks()).toBe(2);
    await world.end();
  });

  it('runs a tick when a slice passes its idle bound, with no event and no trigger', async () => {
    const at = 1_700_000_000_000 + 2 * HOUR;
    const world = start({ tickDeadline: async () => ({ at, rule: 'slice-idle' }) });
    await until(() => world.ticks() >= 1);
    // The clock advances in steps until the tick runs: the wait begins after real reads, so no fixed pause is safe under load.
    for (let steps = 0; world.ticks() < 2 && steps < 1_000; steps += 1) {
      world.clock.advance(60);
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(world.ticks()).toBe(2);
    const now = world.clock.now();
    expect(now.ok && now.value >= at).toBe(true);
    await world.end();
  });
});
