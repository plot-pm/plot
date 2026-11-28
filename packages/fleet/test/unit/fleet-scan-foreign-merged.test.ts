import { afterEach, describe, expect, it, vi } from 'vitest';

import { planRecord, planStoreFixture } from '@plot-pm/domain/adapters/plan-store/plan-store-fixture';
import type { Refs } from '@plot-pm/domain/ports/refs';
import type { Scripts } from '@plot-pm/domain/ports/scripts';
import { FOREIGN_PR_REFRESH_MS, freshWalkCache } from '@plot-pm/domain/workflows/plan-walk-cache';

import { walkOnce, type ScanWorld } from '../../src/shared/fleet-scan.js';
import { emptyWalk, withWalkRefs } from './walk-fake.js';

const ok = <T>(value: T) => ({ ok: true as const, value });

const PLAN = 'docs/plans/2026-11-25-a-plan.md';
const FOREIGN = 'feature/invoice-views';
const LISTING = '.branches\t0\t-\t-\n.list-complete\t1\t-\t-\n.list-arrived\t1\t-\t-\n';

const claim = (branch: string, line?: string) => ({ branch, deferred: false, deferredReason: '', claimed: '', waitsOn: [], ...(line === undefined ? {} : { line }) });

/** Two waves: a foreign slice `→ other/portal#55`, then a slice of this repository. */
const worldWith = (answer: 'MERGED' | 'OPEN' | 'fail', asked: unknown[]): ScanWorld => ({
  repoRoot: '/repo',
  scripts: { config: async (key: string, fallback: string) => ok(key === 'Main branch' ? 'main' : fallback) } as unknown as Scripts,
  refs: withWalkRefs({
    listBlobs: async () => ok([{ mode: '100644', sha: 'p1', path: PLAN }]),
    remoteUrl: async () => ok('git@bitbucket.org:ws/layer.git'),
  } as unknown as Partial<Refs>),
  backend: async () => 'bitbucket',
  walk: emptyWalk({
    host: {
      backend: async () => ok('bitbucket'),
      prList: async () => ok([]),
      lastRefusal: () => ({ kind: 'failed', said: '' }),
      prState: async (ref: string | number, opts?: { repo?: string }) => {
        asked.push({ ref, repo: opts?.repo });
        if (answer === 'fail') return { ok: false, kind: 'failed' };
        return ok({
          number: Number(ref), repo: opts?.repo ?? '', head: FOREIGN, base: 'main', state: answer,
          mergedAt: answer === 'MERGED' ? '2026-11-27T10:00:00Z' : null, mergeCommit: '', draft: false,
          mergeable: 'unknown', review: 'none', checks: 'none', failingChecks: [], url: '', author: '',
        });
      },
    } as never,
    plans: () =>
      planStoreFixture({
        plans: [planRecord({
          file: PLAN,
          phase: 'approved',
          slices: [
            { name: 'Implementation', branches: [claim(FOREIGN, `- \`${FOREIGN}\` — portal (Bitbucket): the views → other/portal#55`)] },
            { name: 'Wave 3', branches: [claim('feature/next')] },
          ],
        })],
      }),
  }),
});

afterEach(() => {
  vi.useRealTimers();
});

describe('walkOnce reads a foreign slice from its own host (#3762)', () => {
  it('reads a merged foreign PR merged, so its wave completes and the next one opens', async () => {
    const asked: unknown[] = [];
    const reading = await walkOnce(worldWith('MERGED', asked), LISTING);
    const [first, second] = reading.plans[0]!.slices;
    expect(first!.branches[0]).toMatchObject({ branch: FOREIGN, state: 'merged', foreign_repo: 'other/portal' });
    expect([first!.verdict, second!.verdict]).toEqual(['complete', 'eligible']);
    expect(asked).toEqual([{ ref: 55, repo: 'other/portal' }]);
  });

  it('keeps an open foreign PR foreign and its wave eligible, and reads a failing foreign host unknown', async () => {
    const open = await walkOnce(worldWith('OPEN', []), LISTING);
    expect(open.plans[0]!.slices.map((s) => [s.verdict, s.branches[0]!.state])).toEqual([['eligible', 'foreign'], ['blocked', 'open']]);
    const failing = await walkOnce(worldWith('fail', []), LISTING);
    expect(failing.plans[0]!.slices.map((s) => [s.verdict, s.branches[0]!.state])).toEqual([['eligible', 'unknown'], ['blocked', 'open']]);
  });

  it('asks a merged foreign PR once across beats that share a walk cache', async () => {
    const asked: unknown[] = [];
    const cache = freshWalkCache();
    const world = worldWith('MERGED', asked);
    await walkOnce(world, LISTING, '', cache);
    await walkOnce(world, LISTING, '', cache);
    expect(asked).toHaveLength(1);
  });

  it('asks an open foreign PR again only after the refresh interval, and a merged one never again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    const openAsked: unknown[] = [];
    const mergedAsked: unknown[] = [];
    const openCache = freshWalkCache();
    const mergedCache = freshWalkCache();
    const beat = async () => {
      await walkOnce(worldWith('OPEN', openAsked), LISTING, '', openCache);
      await walkOnce(worldWith('MERGED', mergedAsked), LISTING, '', mergedCache);
    };
    await beat();
    vi.setSystemTime(1_800_000_000_000 + FOREIGN_PR_REFRESH_MS - 1);
    await beat();
    expect([openAsked.length, mergedAsked.length]).toEqual([1, 1]);
    vi.setSystemTime(1_800_000_000_000 + FOREIGN_PR_REFRESH_MS);
    await beat();
    expect([openAsked.length, mergedAsked.length]).toEqual([2, 1]);
  });
});
