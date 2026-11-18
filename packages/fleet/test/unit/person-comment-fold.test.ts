import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { prIndexFile } from '@plot-pm/domain/adapters';
import type { Host } from '@plot-pm/domain/ports/host';
import type { Scripts } from '@plot-pm/domain/ports/scripts';

import { freshPrState, refreshPrs, type PrWorld } from '../../src/shared/pr-refresh.js';
import { removeTree as rmTree } from '../rm-tree.mjs';
import { withSaidListing } from './listing-over-said.js';

const SHA = 'a1'.repeat(20);
const T0 = Date.parse('2026-11-18T10:00:00Z');
const AT = '2026-11-18T09:30:00Z';

const pr = (number: number): Record<string, unknown> => ({
  number, head: `feature/p${number}`, state: 'OPEN', draft: false, checks: 'green', review: '',
  url: `https://example.test/pr/${number}`, updatedAt: '2026-11-18T09:00:00Z', headSha: SHA,
});

const hostFake = { backend: async () => ({ ok: true as const, value: 'github' }) } as unknown as Host;

type Holds = Map<number, { head: string; at: string; reason: string }>;

let home: string;
let calls: string[][];
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-person-comment-'));
  process.env.PLOT_PR_INDEX_HOME = home;
  calls = [];
});
afterEach(() => {
  delete process.env.PLOT_PR_INDEX_HOME;
  rmTree(home);
});

const worldOf = (holds: Holds | undefined, clock: { t: number }): PrWorld => {
  const scripts = {
    hostSaid: async (args: readonly string[]) => {
      calls.push([...args]);
      if (args[0] !== 'pr-list') return { answer: 'unaskable', stdout: '' };
      return { answer: 'answered', stdout: [pr(1), pr(2)].map((r) => JSON.stringify(r)).join('\n') };
    },
  } as unknown as Scripts;
  return {
    scripts,
    host: withSaidListing(hostFake, scripts.hostSaid),
    store: prIndexFile({ cwd: home }),
    now: () => clock.t,
    ...(holds === undefined ? {} : { conversationHolds: () => holds }),
  };
};

const pass = async (w: PrWorld, state: ReturnType<typeof freshPrState>) => {
  state.prNextAt = 0;
  await refreshPrs(w, state);
};

const stored = async (w: PrWorld) => {
  const held = await w.store.read('github');
  return held.ok ? held.value?.rows ?? [] : [];
};

describe('the PR pass folds fleetd’s held human-comment-open answer', () => {
  it('writes personComment on the OPEN row that names its head commit, and on no other', async () => {
    const holds: Holds = new Map([[1, { head: SHA, at: AT, reason: 'human-comment-open' }]]);
    const w = worldOf(holds, { t: T0 });
    await pass(w, freshPrState());
    const rows = await stored(w);
    expect(rows.find((r) => r.number === 1)?.personComment).toEqual({ head: SHA, at: AT });
    expect(rows.find((r) => r.number === 2)).not.toHaveProperty('personComment');
  });

  it('writes nothing for a human-comment-unread hold', async () => {
    const holds: Holds = new Map([[1, { head: SHA, at: AT, reason: 'human-comment-unread' }]]);
    const w = worldOf(holds, { t: T0 });
    await pass(w, freshPrState());
    expect((await stored(w)).some((r) => 'personComment' in r)).toBe(false);
  });

  it('writes nothing where the hold names the branch rather than the commit', async () => {
    const holds: Holds = new Map([[1, { head: 'feature/p1', at: AT, reason: 'human-comment-open' }]]);
    const w = worldOf(holds, { t: T0 });
    await pass(w, freshPrState());
    expect((await stored(w)).some((r) => 'personComment' in r)).toBe(false);
  });

  it('keeps the field after a second pass that names the PR again', async () => {
    const holds: Holds = new Map([[1, { head: SHA, at: AT, reason: 'human-comment-open' }]]);
    const w = worldOf(holds, { t: T0 });
    const state = freshPrState();
    await pass(w, state);
    await pass(w, state);
    expect((await stored(w)).find((r) => r.number === 1)?.personComment).toEqual({ head: SHA, at: AT });
  });

  it('reaches a stored row no later answer names, with the same host calls as a pass with no holds', async () => {
    const holds: Holds = new Map();
    const w = worldOf(holds, { t: T0 });
    const state = freshPrState();
    await pass(w, state);
    holds.set(2, { head: SHA, at: AT, reason: 'human-comment-open' });
    const before = calls.length;
    await pass(w, state);
    expect((await stored(w)).find((r) => r.number === 2)?.personComment).toEqual({ head: SHA, at: AT });
    const withHold = calls.slice(before);

    calls = [];
    const bare = worldOf(undefined, { t: T0 });
    const bareState = freshPrState();
    await pass(bare, bareState);
    const bareBefore = calls.length;
    await pass(bare, bareState);
    expect(withHold).toEqual(calls.slice(bareBefore));
  });

  it('writes no field where no merge pass runs', async () => {
    const w = worldOf(undefined, { t: T0 });
    await pass(w, freshPrState());
    expect((await stored(w)).some((r) => 'personComment' in r)).toBe(false);
  });
});
