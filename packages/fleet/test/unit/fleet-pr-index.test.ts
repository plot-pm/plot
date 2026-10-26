import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { prIndexFile, readerLockFixture } from '@plot-pm/domain/adapters';
import type { ReaderLock } from '@plot-pm/domain/ports/reader-lock';
import type { Host } from '@plot-pm/domain/ports/host';
import type { Scripts } from '@plot-pm/domain/ports/scripts';

import { fleetPrs, type PrLock } from '../../src/shared/fleet-clock.js';
import { freshPrState, memoryOverlay, type PrWorld } from '../../src/shared/pr-refresh.js';
import { removeTree as rmTree } from '../rm-tree.mjs';

const freshLock = (lock: ReaderLock = readerLockFixture()): PrLock => ({ lock });

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
  rmTree(home);
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
    await fleetPrs(w, freshPrState(), freshLock(), () => undefined)();
    const held = await w.store.read('github');
    expect(held.ok && held.value?.rows.map((r) => r.number)).toEqual([7]);
  });

  it('leaves the store byte-identical when the host refuses', async () => {
    const calls: string[][] = [];
    const good = world(calls, () => ({ answer: 'answered', stdout: JSON.stringify(ROW) }));
    await fleetPrs(good, freshPrState(), freshLock(), () => undefined)();
    const file = (await good.store.location('github'));
    const path_ = file.ok ? file.value : '';
    const before = fs.readFileSync(path_);
    const bad = world(calls, () => ({ answer: 'failed', stdout: '', said: 'HTTP 502' }));
    await fleetPrs(bad, freshPrState(), freshLock(), () => undefined)();
    expect(fs.readFileSync(path_).equals(before)).toBe(true);
  });

  it('holds the cadence gate: a second pass before the interval asks the host nothing', async () => {
    const calls: string[][] = [];
    const state = freshPrState();
    const run = fleetPrs(
      world(calls, () => ({ answer: 'answered', stdout: JSON.stringify(ROW) })),
      state,
      freshLock(),
      () => undefined,
    );
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
    await fleetPrs(w, freshPrState(), freshLock(), () => undefined)();
    const mine = await w.store.read('github');
    expect(mine.ok && mine.value?.rows.map((r) => r.number)).toEqual([7]);
    const onDisk = await real.read('github');
    expect(onDisk.ok && onDisk.value).toBeNull();
  });
});

describe('the PR pass elects a reader', () => {
  it('a beat that loses the election asks the host nothing and touches no store', async () => {
    const calls: string[][] = [];
    const lock = readerLockFixture({ isAlive: () => true });
    // A live other pid takes the lock first; this pass's own election then reads `held`.
    await lock.elect('github', { generation: 0, pid: process.pid + 1, startedAt: null, at: Date.now() });
    const w = world(calls, () => ({ answer: 'answered', stdout: JSON.stringify(ROW) }));
    await fleetPrs(w, freshPrState(), { lock }, () => undefined)();
    expect(calls.filter((c) => c[0] === 'pr-list').length).toBe(0);
    const held = await w.store.read('github');
    expect(held.ok && held.value).toBeNull();
  });

  it('a newly electing process adopts the holder-published cadence once, at cold start', async () => {
    const lock = readerLockFixture();
    const future = Date.now() + 999_000;
    await lock.writeReaderState('github', {
      v: 1, prError: 'HTTP 502', prNextAt: future, prNextIsBackoff: true, prFullReadFailedAt: 123, at: Date.now(),
    });
    const calls: string[][] = [];
    const w = world(calls, () => ({ answer: 'answered', stdout: JSON.stringify(ROW) }));
    await fleetPrs(w, freshPrState(), { lock }, () => undefined)();
    // The adopted backoff held the gate shut, so the host was never asked this pass.
    expect(calls.filter((c) => c[0] === 'pr-list').length).toBe(0);
  });

  it('a lock that cannot be written skips the pass and warns once per cause, not once per beat', async () => {
    const lock = readerLockFixture({ broken: true });
    const calls: string[][] = [];
    const warnings: string[] = [];
    const run = fleetPrs(world(calls, () => ({ answer: 'answered', stdout: JSON.stringify(ROW) })), freshPrState(), { lock }, (line) => warnings.push(line));
    await run();
    await run();
    await run();
    expect(calls.filter((c) => c[0] === 'pr-list').length).toBe(0);
    expect(warnings.length).toBe(1);
  });

  it('fences the fold: a takeover mid-pass skips only the write, and still serves this pass own answer', async () => {
    // This process's own pid reads as dead, so a same-moment `elect` by another
    // pid takes the lock over rather than reading `held` against a live claim.
    const lock = readerLockFixture({ isAlive: (pid) => pid !== process.pid });
    const state = freshPrState();
    const calls: string[][] = [];
    const scripts: Scripts = {
      hostSaid: async (args: readonly string[]) => {
        calls.push([...args]);
        if (args[0] !== 'pr-list') return { answer: 'unaskable', stdout: '' };
        // The host call is awaited before the fold's fence check; a takeover
        // landing here simulates another process electing between this
        // pass's host read and the write that fence guards.
        await lock.elect('github', { generation: 0, pid: process.pid + 1, startedAt: null, at: Date.now() });
        return { answer: 'answered', stdout: JSON.stringify(ROW) };
      },
    } as unknown as Scripts;
    const w: PrWorld = { scripts, host: hostFake, store: prIndexFile({ cwd: home }) };
    await fleetPrs(w, state, { lock }, () => undefined)();
    expect(state.prs?.get('feature/a')?.number).toBe(7);
    const onDisk = await prIndexFile({ cwd: home }).read('github');
    expect(onDisk.ok && onDisk.value).toBeNull();
  });

  it('publishes this reader cadence and a fleetd heartbeat at the end of a pass that held the lock', async () => {
    const lock = readerLockFixture();
    const calls: string[][] = [];
    const w = world(calls, () => ({ answer: 'answered', stdout: JSON.stringify(ROW) }));
    await fleetPrs(w, freshPrState(), { lock }, () => undefined)();
    const published = await lock.readerState('github');
    expect(published.ok && published.value?.prError).toBeNull();
    const beats = await lock.heartbeats('github');
    expect(beats.ok && beats.value.map((b) => b.name)).toContain('fleetd');
  });
});
