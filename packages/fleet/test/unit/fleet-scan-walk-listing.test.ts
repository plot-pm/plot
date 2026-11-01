import { describe, expect, it } from 'vitest';

import { planRecord } from '@plot-pm/domain/adapters/plan-store/plan-store-fixture';
import type { Host } from '@plot-pm/domain/ports/host';
import type { PlanStore } from '@plot-pm/domain/ports/plan-store';
import type { HostAnswer, Scripts } from '@plot-pm/domain/ports/scripts';

import { emptyWalk, withWalkRefs } from './walk-fake.js';
import { freshScanState, REFRESH_MS, scanOnce, type ScanOptions, type ScanWorld } from '../../src/shared/fleet-scan.js';

/**
 * THE PROPERTY THIS FILE EXISTS FOR: the in-process walk reads PR states from
 * the listing `scanOnce` carries and never calls `Host.prList`, so the listing
 * read is the beat's only host spend and a held back-off asks the host nothing.
 */

const ok = <T>(value: T) => ({ ok: true as const, value });
const OPTIONS: ScanOptions = { record: false };
const PLAN = 'docs/plans/2026-10-01-a-plan.md';

/** A host whose `prList` counts its calls and answers an empty list. */
const countingHost = () => {
  const calls = { prList: 0 };
  const host = {
    backend: async () => ok('github'),
    prList: async () => {
      calls.prList += 1;
      return ok([]);
    },
    lastRefusal: () => null,
  } as unknown as Host;
  return { host, calls };
};

/** One OPEN row for the open call and one MERGED row for the all call, each page claimed whole. */
const githubListing = (seen: string[][]): Scripts['hostSaid'] => async (args) => {
  seen.push([...args]);
  const open = args.includes('open');
  const row = open
    ? { head: 'feature/open', state: 'OPEN', updatedAt: '2026-10-01T00:00:00Z' }
    : { head: 'feature/gone', state: 'MERGED', updatedAt: '2026-10-01T00:00:00Z' };
  const answer: HostAnswer = {
    answer: 'answered',
    stdout: `${JSON.stringify(row)}\n`,
    stderr: `plot-host: github pr-list state=${open ? 'open' : 'all'} page complete (1 rows below requested limit 3000) — this page holds every pull request the host has in this state`,
  };
  return answer;
};

/** One plan on main naming `feature/gone`, which has no remote ref. */
const oneBranchWorld = (host: Host, hostSaid: Scripts['hostSaid']): ScanWorld => {
  const plans = {
    readPlansAt: async () => ok([
      planRecord({
        file: PLAN,
        phase: 'approved',
        slices: [{ name: 'only', branches: [{ branch: 'feature/gone', deferred: false, deferredReason: '', claimed: '', waitsOn: [] }] }],
      }),
    ]),
  } as unknown as PlanStore;
  return {
    repoRoot: '/repo',
    scripts: {
      hostSaid,
      config: async (_key: string, fallback: string) => ok(fallback),
      planMeta: async () => ok(''),
    } as unknown as Scripts,
    refs: withWalkRefs({
      listBlobs: async (ref: string) => ok(ref === 'abc1234def5678' ? [{ path: PLAN, sha: 'p1', mode: '100644' }] : []) as never,
      branchDates: async () => ok([]),
      listBranches: async () => ok([]),
    } as never),
    backend: async () => 'github',
    walk: emptyWalk({ host, plans: () => plans }),
  };
};

const branchOf = (reading: Awaited<ReturnType<typeof scanOnce>>['reading']) =>
  reading.plans.flatMap((p) => p.slices.flatMap((s) => s.branches)).find((b) => b.branch === 'feature/gone');

describe('the in-process walk reads the carried listing', () => {
  it('makes no prList call across several beats; only the due beat spends on the listing', async () => {
    const { host, calls } = countingHost();
    const seen: string[][] = [];
    const world = oneBranchWorld(host, githubListing(seen));
    const state = freshScanState();
    for (let beat = 0; beat < 4; beat += 1) {
      await scanOnce(world, state, OPTIONS);
      if (state.listingAt !== null) state.listingAt -= REFRESH_MS;
    }
    expect(calls.prList).toBe(0);
    expect(seen.filter((args) => args[0] === 'pr-list')).toHaveLength(2);
    expect(state.calls).toBe(2);
  });

  it('answers a branch from the carried listing: a merged PR reads as merged', async () => {
    const { host } = countingHost();
    const result = await scanOnce(oneBranchWorld(host, githubListing([])), freshScanState(), OPTIONS);
    expect(branchOf(result.reading)?.state).toBe('merged');
  });

  it('asks the host nothing while a listing back-off is held, and reads the PR as unknown', async () => {
    const { host, calls } = countingHost();
    const seen: string[][] = [];
    const state = freshScanState();
    state.backoffUntil = Date.now() + 60_000;
    state.backoffMs = 60_000;
    const result = await scanOnce(oneBranchWorld(host, githubListing(seen)), state, OPTIONS);
    expect(calls.prList).toBe(0);
    expect(seen).toEqual([]);
    expect(branchOf(result.reading)?.state).toBe('unknown');
  });
});
