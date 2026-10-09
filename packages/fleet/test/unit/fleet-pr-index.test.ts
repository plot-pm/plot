import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { prIndexFile } from '@plot-pm/domain/adapters';
import type { Host } from '@plot-pm/domain/ports/host';
import type { Scripts } from '@plot-pm/domain/ports/scripts';

import { fleetPrs } from '../../src/shared/fleet-clock.js';
import { freshPrState, memoryOverlay, type PrWorld } from '../../src/shared/pr-refresh.js';

const ROW = {
  number: 7, head: 'feature/a', state: 'OPEN', draft: false, checks: 'pass',
  review: 'none', url: 'https://example.test/pr/7', updatedAt: '2026-10-09T10:00:00Z',
};

const hostFake = { backend: async () => ({ ok: true as const, value: 'github' }) } as unknown as Host;

const scriptsFake = (calls: string[][], answer: () => { answer: string; stdout: string; said?: string }): Scripts => ({
  hostSaid: async (args: readonly string[]) => {
    calls.push([...args]);
    return args[0] === 'pr-list' ? answer() : { answer: 'unaskable', stdout: '' };
  },
} as unknown as Scripts);

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fleet-pr-index-'));
  process.env.PLOT_PR_INDEX_HOME = home;
});
afterEach(() => {
  delete process.env.PLOT_PR_INDEX_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

const world = (calls: string[][], answer: () => { answer: string; stdout: string; said?: string }): PrWorld => ({
  scripts: scriptsFake(calls, answer),
  host: hostFake,
  store: prIndexFile({ cwd: home }),
});

describe('the fleet writes the PR index', () => {
  it('folds the host answer into the store', async () => {
    const calls: string[][] = [];
    const w = world(calls, () => ({ answer: 'answered', stdout: JSON.stringify(ROW) }));
    await fleetPrs(w, freshPrState(), () => undefined)();
    const held = await w.store.read('github');
    expect(held.ok && held.value?.rows.map((r) => r.number)).toEqual([7]);
  });

  it('leaves the store byte-identical when the host refuses', async () => {
    const calls: string[][] = [];
    const good = world(calls, () => ({ answer: 'answered', stdout: JSON.stringify(ROW) }));
    await fleetPrs(good, freshPrState(), () => undefined)();
    const file = (await good.store.location('github'));
    const path_ = file.ok ? file.value : '';
    const before = fs.readFileSync(path_);
    const bad = world(calls, () => ({ answer: 'failed', stdout: '', said: 'HTTP 502' }));
    await fleetPrs(bad, freshPrState(), () => undefined)();
    expect(fs.readFileSync(path_).equals(before)).toBe(true);
  });

  it('holds the cadence gate: a second pass before the interval asks the host nothing', async () => {
    const calls: string[][] = [];
    const state = freshPrState();
    const run = fleetPrs(world(calls, () => ({ answer: 'answered', stdout: JSON.stringify(ROW) })), state, () => undefined);
    await run();
    const asked = calls.filter((c) => c[0] === 'pr-list').length;
    await run();
    expect(calls.filter((c) => c[0] === 'pr-list').length).toBe(asked);
  });
});

describe('a reader with no fleet writes nothing', () => {
  it('keeps its fold in memory and leaves the file alone', async () => {
    const calls: string[][] = [];
    const real = prIndexFile({ cwd: home });
    const w: PrWorld = { ...world(calls, () => ({ answer: 'answered', stdout: JSON.stringify(ROW) })), store: memoryOverlay(real) };
    await fleetPrs(w, freshPrState(), () => undefined)();
    const mine = await w.store.read('github');
    expect(mine.ok && mine.value?.rows.map((r) => r.number)).toEqual([7]);
    const onDisk = await real.read('github');
    expect(onDisk.ok && onDisk.value).toBeNull();
  });
});
