import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { prIndexFile } from '@plot-pm/domain/adapters';
import type { Host } from '@plot-pm/domain/ports/host';
import type { Scripts } from '@plot-pm/domain/ports/scripts';

import {
  PR_PENDING_REASK_LIMIT, PR_PENDING_REASK_SLOW_MS, freshPrState, refreshPrs, type PrWorld,
} from '../../src/shared/pr-refresh.js';
import { removeTree as rmTree } from '../rm-tree.mjs';

const SHA = 'a1'.repeat(20);
const SHA2 = 'b2'.repeat(20);
const T0 = Date.parse('2026-10-10T10:00:00Z');

const base = (number: number, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  number, head: `feature/p${number}`, state: 'OPEN', draft: false, checks: 'green', review: '',
  url: `https://example.test/pr/${number}`, updatedAt: '2026-10-10T09:00:00Z', ...over,
});

const hostFake = { backend: async () => ({ ok: true as const, value: 'github' }) } as unknown as Host;

interface Fake { calls: string[][]; scripts: Scripts }

/** A host answering the primary listing with `main` and every `--state open` re-ask with `reask`. */
const fake = (main: () => Record<string, unknown>[], reask: () => Record<string, unknown>[]): Fake => {
  const calls: string[][] = [];
  const scripts = {
    hostSaid: async (args: readonly string[]) => {
      calls.push([...args]);
      if (args[0] !== 'pr-list') return { answer: 'unaskable', stdout: '' };
      const rows = args.includes('--rich') && args.includes('open') ? reask() : main();
      return { answer: 'answered', stdout: rows.map((r) => JSON.stringify(r)).join('\n') };
    },
  } as unknown as Scripts;
  return { calls, scripts };
};

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-pr-row-commit-'));
  process.env.PLOT_PR_INDEX_HOME = home;
});
afterEach(() => {
  delete process.env.PLOT_PR_INDEX_HOME;
  rmTree(home);
});

const worldOf = (f: Fake, clock: { t: number }, checksWaitMs?: number): PrWorld => ({
  scripts: f.scripts, host: hostFake, store: prIndexFile({ cwd: home }), now: () => clock.t,
  ...(checksWaitMs === undefined ? {} : { checksWaitMs }),
});

const stored = async (w: PrWorld) => {
  const held = await w.store.read('github');
  return held.ok ? held.value?.rows ?? [] : [];
};

/** One refresh, with the cadence gate opened. */
const pass = async (w: PrWorld, state: ReturnType<typeof freshPrState>) => {
  state.prNextAt = 0;
  await refreshPrs(w, state);
};

const reasks = (f: Fake) => f.calls.filter((c) => c[0] === 'pr-list' && c.includes('open') && c.includes('--rich'));

describe('the fold stores the commit fields each arm answers', () => {
  it('stores the rollup, Jenkins, plain and merged meanings', async () => {
    const clock = { t: T0 };
    const f = fake(() => [
      base(1, { checks: 'green', headSha: SHA, checksSha: SHA }),
      base(2, { checks: 'green', headSha: SHA2 }),
      base(3, { checks: 'none', headSha: SHA }),
      base(4, { state: 'MERGED', headSha: SHA, mergedAt: '2026-10-10T08:30:00Z' }),
    ], () => []);
    const w = worldOf(f, clock);
    await pass(w, freshPrState());
    const rows = await stored(w);
    const byNumber = (n: number) => rows.find((r) => r.number === n)!;
    expect(byNumber(1).headSha).toBe(SHA);
    expect(byNumber(1).checksSha).toBe(byNumber(1).headSha);
    expect(byNumber(2).headSha).toBe(SHA2);
    expect('checksSha' in byNumber(2)).toBe(false);
    expect(byNumber(3).headSha).toBe(SHA);
    expect('checksSha' in byNumber(3)).toBe(false);
    expect(byNumber(3).checks).toBe('none');
    expect(byNumber(4).mergedAt).toBe('2026-10-10T08:30:00Z');
    expect('mergedAt' in byNumber(1)).toBe(false);
  });

  it('stores no empty string where the host omitted the field', async () => {
    const f = fake(() => [base(1, { headSha: '', checksSha: '', mergedAt: '' }), base(2)], () => []);
    const w = worldOf(f, { t: T0 });
    await pass(w, freshPrState());
    for (const row of await stored(w)) {
      for (const key of ['headSha', 'headSince', 'checksSha', 'mergedAt'] as const) {
        expect(key in row).toBe(false);
      }
    }
  });

  it('keeps headSince while headSha holds and resets it when headSha moves', async () => {
    const clock = { t: T0 };
    let sha = SHA;
    const f = fake(() => [base(1, { headSha: sha })], () => []);
    const w = worldOf(f, clock);
    const state = freshPrState();
    await pass(w, state);
    const first = (await stored(w))[0].headSince;
    expect(first).toBe(new Date(T0).toISOString());
    clock.t = T0 + 120_000;
    await pass(w, state);
    expect((await stored(w))[0].headSince).toBe(first);
    sha = SHA2;
    clock.t = T0 + 240_000;
    await pass(w, state);
    expect((await stored(w))[0].headSince).toBe(new Date(T0 + 240_000).toISOString());
  });
});

describe('the re-ask is bounded by time and covers failing', () => {
  const seeded = async (checks: string, checksWaitMs = 3_600_000) => {
    const clock = { t: T0 };
    const f = fake(() => [], () => [base(1, { checks, headSha: SHA })]);
    // Seed the store with one open PR of this colour, then switch the primary
    // listing to a quiet delta.
    const seed = fake(() => [base(1, { checks, headSha: SHA })], () => []);
    const w0 = worldOf(seed, clock, checksWaitMs);
    await pass(w0, freshPrState());
    const w = worldOf(f, clock, checksWaitMs);
    return { clock, f, w, state: freshPrState() };
  };

  it('re-asks a pending PR past the count while its head is younger than Checks wait', async () => {
    const { clock, f, w, state } = await seeded('pending');
    for (let i = 0; i < PR_PENDING_REASK_LIMIT; i += 1) {
      clock.t += 60_000;
      await pass(w, state);
    }
    expect(reasks(f)).toHaveLength(PR_PENDING_REASK_LIMIT);
    // The sixth refresh: the count is spent, the head is minutes old, and the
    // cadence gap has not elapsed — no re-ask yet.
    clock.t += 60_000;
    await pass(w, state);
    expect(reasks(f)).toHaveLength(PR_PENDING_REASK_LIMIT);
    clock.t += PR_PENDING_REASK_SLOW_MS;
    await pass(w, state);
    expect(reasks(f)).toHaveLength(PR_PENDING_REASK_LIMIT + 1);
  });

  it('spaces the re-asks at least five minutes apart once the count is spent', async () => {
    const { clock, f, w, state } = await seeded('pending');
    for (let i = 0; i < PR_PENDING_REASK_LIMIT; i += 1) { clock.t += 60_000; await pass(w, state); }
    clock.t += PR_PENDING_REASK_SLOW_MS;
    await pass(w, state);
    const after = reasks(f).length;
    for (let i = 0; i < 4; i += 1) { clock.t += 60_000; await pass(w, state); }
    expect(reasks(f)).toHaveLength(after);
    clock.t += 60_000;
    await pass(w, state);
    expect(reasks(f)).toHaveLength(after + 1);
  });

  it('stops re-asking once headSince is older than Checks wait', async () => {
    const { clock, f, w, state } = await seeded('pending', 600_000);
    for (let i = 0; i < PR_PENDING_REASK_LIMIT; i += 1) { clock.t += 60_000; await pass(w, state); }
    clock.t = T0 + 600_000 + PR_PENDING_REASK_SLOW_MS;
    await pass(w, state);
    expect(reasks(f)).toHaveLength(PR_PENDING_REASK_LIMIT);
  });

  it('grows the streak for a failing PR so it is not re-asked on every refresh', async () => {
    const { clock, f, w, state } = await seeded('failing');
    for (let i = 0; i < 8; i += 1) { clock.t += 60_000; await pass(w, state); }
    // Five counted re-asks, then one per five minutes: eight minutes of
    // refreshes cannot hold more than five.
    expect(reasks(f)).toHaveLength(PR_PENDING_REASK_LIMIT);
    expect(state.prPendingReaskStreak.get(1)).toBe(PR_PENDING_REASK_LIMIT);
  });

  it('does not re-ask a draft PR', async () => {
    const clock = { t: T0 };
    const seed = fake(() => [base(1, { checks: 'pending', draft: true, headSha: SHA })], () => []);
    await pass(worldOf(seed, clock), freshPrState());
    const f = fake(() => [], () => [base(1, { checks: 'pending', draft: true, headSha: SHA })]);
    clock.t += 60_000;
    await pass(worldOf(f, clock), freshPrState());
    expect(reasks(f)).toHaveLength(0);
  });
});
