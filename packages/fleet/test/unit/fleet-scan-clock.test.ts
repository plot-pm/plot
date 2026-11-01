import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { clockManual, fleetStateFile } from '@plot-pm/domain/adapters';
import type { FleetReading } from '@plot-pm/domain/entities/fleet';
import type { Refs } from '@plot-pm/domain/ports/refs';
import type { Scripts } from '@plot-pm/domain/ports/scripts';

import { fleetScan, startFleetClock } from '../../src/shared/fleet-clock.js';
import { freshScanState, REFRESH_MS, type ScanWorld } from '../../src/shared/fleet-scan.js';
import { emptyWalk, withWalkRefs } from './walk-fake.js';
import { removeTree as rmTree } from '../rm-tree.mjs';

const ok = <T>(value: T) => ({ ok: true as const, value });

const refsFake = withWalkRefs({
  branchDates: async () => ok([{ branch: 'feature/a', committedAt: Date.now() / 1000 - 600 }]),
  remoteUrl: async () => ok('git@github.com:plot-pm/plot.git'),
} as unknown as Partial<Refs>);

const scriptsFake = (): Scripts => ({
  stream: async () => { throw new Error('plot-fleet-scan.sh must not run'); },
  hostSaid: async () => ({ answer: 'unaskable', stdout: '' }),
  config: async () => ok('docs/plans/'),
  planMeta: async () => ok(JSON.stringify({ file: '2026-10-09-a-plan.md', approved_raw: '2026-10-08' })),
} as unknown as Scripts);


let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fleet-scan-clock-'));
});
afterEach(() => {
  rmTree(repo);
});

const worldOver = (refs: Refs = refsFake): ScanWorld => ({
  repoRoot: repo,
  scripts: scriptsFake(),
  refs,
  backend: async () => 'github',
  walk: emptyWalk(),
});

/** Refs whose default-branch resolve fails, so the estate stage — and the beat — fails. */
const brokenRefs = withWalkRefs({ resolve: async () => ({ ok: false as const }) } as unknown as Partial<Refs>);

const scan = (state: ReturnType<typeof fleetStateFile>, opts: { refs?: Refs; now?: () => number; warn?: (l: string) => void; prError?: () => string | null; after?: (pulse: FleetReading) => Promise<void> } = {}) =>
  fleetScan(worldOver(opts.refs), state, freshScanState(), opts.now ?? (() => Date.now()), opts.warn ?? (() => {}), opts.prError ?? (() => null), opts.after);

describe('the fleet writes the whole bridge', () => {
  it('carries the pulse, the branch ages and the URL base, non-empty', async () => {
    const state = fleetStateFile({ repoRoot: repo });
    await scan(state)();
    const read = await state.read();
    expect(read.ok && read.value).toBeTruthy();
    if (!read.ok || read.value === null) return;
    expect(read.value.pulse.head).toBe('abc1234');
    expect(read.value.ages.get('feature/a')).toBeGreaterThanOrEqual(9);
    expect(read.value.branchUrlBase).toContain('github.com/plot-pm/plot');
    expect(read.value.at).toBeGreaterThan(0);
  });

  it('keeps the previous pulse and records the failed attempt when the walk throws', async () => {
    const state = fleetStateFile({ repoRoot: repo });
    await scan(state)();
    const first = await state.read();
    const warned: string[] = [];
    const startedAt = Date.now() + 9;
    await scan(state, { refs: brokenRefs, now: () => startedAt, warn: (l) => warned.push(l) })();
    const after = await state.read();
    expect(first.ok && after.ok && first.value !== null && after.value !== null).toBe(true);
    if (!first.ok || !after.ok || first.value === null || after.value === null) return;
    expect(after.value.at).toBe(first.value.at);
    expect(after.value.pulse).toEqual(first.value.pulse);
    expect(after.value.attempt).toEqual({ startedAt, endedAt: startedAt, outcome: 'failed', error: 'fleet scan: the estate stage failed' });
    expect(warned).toHaveLength(1);
  });

  it('records a started attempt on the last good bridge before the scan returns', async () => {
    const state = fleetStateFile({ repoRoot: repo });
    await scan(state)();
    const startedAt = Date.now();
    let during: unknown;
    const watching = withWalkRefs({
      ...refsFake,
      resolve: async () => {
        const read = await state.read();
        during = read.ok ? read.value?.attempt : undefined;
        return ok('abc1234def5678');
      },
    } as unknown as Partial<Refs>);
    await scan(state, { refs: watching, now: () => startedAt })();
    expect(during).toEqual({ startedAt, endedAt: null, outcome: 'running', error: null });
    const done = await state.read();
    expect(done.ok && done.value?.attempt).toEqual({ startedAt, endedAt: startedAt, outcome: 'ok', error: null });
  });
});

describe('the fleet bridges its PR reader\'s last failure', () => {
  it('writes the sentence a failing PR reader holds beside the pulse', async () => {
    const state = fleetStateFile({ repoRoot: repo });
    await scan(state, { prError: () => 'gh: HTTP 502' })();
    const read = await state.read();
    expect(read.ok && read.value?.prError).toBe('gh: HTTP 502');
  });

  it('writes null once the PR reader holds no failure', async () => {
    const state = fleetStateFile({ repoRoot: repo });
    let held: string | null = 'gh: HTTP 502';
    const again = scan(state, { prError: () => held });
    await again();
    held = null;
    await again();
    const read = await state.read();
    expect(read.ok && read.value !== null && read.value.prError).toBeNull();
  });
});

describe('the automatic writes run on the scan the fleet just wrote', () => {
  it('hands the pass the pulse the scan wrote, after the bridge write', async () => {
    const state = fleetStateFile({ repoRoot: repo });
    const seen: Array<{ head: string; bridged: boolean }> = [];
    await scan(state, {
      after: async (pulse) => {
        const read = await state.read();
        seen.push({ head: pulse.head, bridged: read.ok && read.value !== null });
      },
    })();
    expect(seen).toEqual([{ head: 'abc1234', bridged: true }]);
  });

  it('never runs the pass when the scan threw', async () => {
    const state = fleetStateFile({ repoRoot: repo });
    let passes = 0;
    await scan(state, { refs: brokenRefs, after: async () => { passes += 1; } })();
    expect(passes).toBe(0);
  });

  it('runs inside the scan subscriber, so the in-flight guard covers the pass', async () => {
    const clock = clockManual(0);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    let started = 0;
    startFleetClock(clock, { scan: async () => { started += 1; await gate; } });
    clock.advance(1);
    clock.advance(1);
    expect(started).toBe(1);
    release();
  });
});

describe('the fleet clock', () => {
  it('does not start a second scan while one runs, and a beat never waits on it', async () => {
    const clock = clockManual(0);
    let started = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const pulse = startFleetClock(clock, { scan: async () => { started += 1; await gate; } });
    clock.advance(1);
    clock.advance(1);
    clock.advance(1);
    expect(started).toBe(1);
    release();
    await gate;
    await new Promise((r) => setImmediate(r));
    clock.advance(1);
    expect(started).toBe(2);
    pulse.stop();
    expect(clock.scheduled()).toBe(0);
  });

  it('runs the PR reader at every twelfth beat of the base interval', async () => {
    const clock = clockManual(0);
    let prs = 0;
    let scans = 0;
    startFleetClock(clock, {
      scan: async () => { scans += 1; },
      prs: async () => { prs += 1; },
    });
    for (let i = 0; i < 24; i += 1) {
      clock.advance(1);
      await new Promise((r) => setImmediate(r));
    }
    expect(scans).toBe(24);
    expect(prs).toBe(2);
    expect(REFRESH_MS).toBe(5000);
  });

  it('settles idle only after a scan that started before the stop has ended', async () => {
    const clock = clockManual(0);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    let ended = false;
    const pulse = startFleetClock(clock, { scan: async () => { await gate; ended = true; } });
    clock.advance(1);
    pulse.stop();
    let idled = false;
    const idle = pulse.idle().then(() => { idled = true; });
    await new Promise((r) => setImmediate(r));
    expect(idled).toBe(false);
    release();
    await idle;
    expect(ended).toBe(true);
  });

  it('settles idle at once when no run is in flight', async () => {
    const pulse = startFleetClock(clockManual(0), { scan: async () => undefined });
    pulse.stop();
    await expect(pulse.idle()).resolves.toBeUndefined();
  });
});
