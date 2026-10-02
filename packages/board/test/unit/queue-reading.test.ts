import { describe, it, expect } from 'vitest';
import { queueOfPlan, readQueue, type QueueWorld } from '../../src/server/queue-reading.js';
import type { PlanRecord } from '@plot-pm/domain';
import type { PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import type { LandedAnswer } from '@plot-pm/domain/rules/landed';
import { whyNotReady } from '@plot-pm/domain/rules/queue';
import { VIEWS_PER_PASS } from '@plot-pm/domain/rules/known-pr';

/**
 * A MERGED BRANCH HAS NO REF, AND THE QUEUE COUNTED THAT AS UNSTARTED.
 *
 * Measured 2026-09-06: eight briefed, eligible slices were dispatched and every
 * one was held `not-claimable` against five free agents. `outstanding` counted
 * a slice's branches as those with no remote ref — true of a branch nobody has
 * begun, false of one that merged, because merging deletes the ref and
 * `plot-release-refs.sh` deletes the rest deliberately.
 *
 * So slice 1 never reached `complete`, and `priorComplete &&= verdict ===
 * 'complete'` blocked every slice behind it. The board rendered the same slices
 * as eligible because it asks the host.
 */
const plan = (slices: string[][], phase = 'approved'): PlanRecord =>
  ({
    file: 'docs/plans/2026-09-04-a-plan.md',
    phase,
    slices: slices.map((branches) => ({
      branches: branches.map((branch) => ({ branch, deferred: false })),
    })),
  }) as unknown as PlanRecord;

describe('a slice whose branches merged does not block the slices behind it', () => {
  it('reads the second slice as claimable when the first one merged', () => {
    // THE REPORTED ESTATE, at its smallest: slice 1 merged (no ref, because
    // merging deleted it), slice 2 unstarted and briefed.
    const queued = queueOfPlan(
      plan([['feature/one'], ['feature/two']]),
      new Set<string>(),
      new Set(['feature/one']),
    );

    const two = queued.find((q) => q.branch === 'feature/two');
    expect(two?.claimable).toBe(true);
  });

  it('still blocks the second slice when the first is merely unstarted', () => {
    // THE PROPERTY THE FIX MUST NOT BREAK. An unstarted slice 1 and a merged
    // slice 1 both have no ref; only the host separates them, and ordering
    // still holds for the first.
    const queued = queueOfPlan(
      plan([['feature/one'], ['feature/two']]),
      new Set<string>(),
      new Set<string>(),
    );

    expect(queued.find((q) => q.branch === 'feature/two')?.claimable).toBe(false);
    expect(queued.find((q) => q.branch === 'feature/one')?.claimable).toBe(true);
  });

  it('needs every branch of a slice merged, not just one', () => {
    const queued = queueOfPlan(
      plan([['feature/a', 'feature/b'], ['feature/two']]),
      new Set<string>(),
      new Set(['feature/a']),
    );
    expect(queued.find((q) => q.branch === 'feature/two')?.claimable).toBe(false);
  });

  it('leaves a merged branch out of the queue entirely', () => {
    // It is finished work: it must not be offered to anybody, and `landed`
    // already exists to say so for a branch that IS offered.
    const queued = queueOfPlan(
      plan([['feature/one'], ['feature/two']]),
      new Set<string>(),
      new Set(['feature/one']),
    );
    expect(queued.map((q) => q.branch)).not.toContain('feature/one');
  });
});

describe('the host is asked once per branch, and only where the answer decides', () => {
  const world = (over: Partial<QueueWorld> = {}): QueueWorld => ({
    plans: async () => [plan([['feature/one'], ['feature/two']])],
    claimedBranches: async () => new Set<string>(),
    mergedBranches: async () => ({ merged: new Set(['feature/one']), whole: true }),
    prIndexRows: async () => [],
    viewLanded: async () => 'unknown',
    briefPresent: async () => true,
    sliceHasMerged: async () => false,
    subjectProven: async () => null,
    queuedHasLanded: async () => 'not-landed',
    workerAlive: async () => true,
    blocked: async () => false,
    ...over,
  });

  it('asks the host for merged branches exactly once per pass', async () => {
    // THE RATE LIMIT IS WHY THIS TEST EXISTS. The first fix asked `prMerged`
    // per branch: correct, and it took the tick from 25 s to 357 s across 426
    // branches. One bundled call is the contract, and a regression to per
    // branch would not fail a correctness test — only this one.
    let calls = 0;
    await readQueue([], world({
      mergedBranches: async () => {
        calls += 1;
        return { merged: new Set(['feature/one']), whole: true };
      },
    }));

    expect(calls).toBe(1);
  });

  it('promotes the slice behind a merged one', async () => {
    const readings = await readQueue([], world());
    expect(readings.slices.find((s) => s.branch === 'feature/two')?.claimable).toBe(true);
  });

  it('holds every slice when the host cannot be asked at all', async () => {
    // SILENCE MUST NOT PROMOTE WORK. An unreachable host yields an empty set,
    // so slice 1 stays outstanding and slice 2 stays blocked — the opposite of
    // the reaper's direction, where silence KEEPS a checkout.
    const readings = await readQueue([], world({
      mergedBranches: async () => ({ merged: new Set<string>(), whole: false }),
    }));

    expect(readings.slices.find((s) => s.branch === 'feature/two')?.claimable).toBe(false);
  });
});

/**
 * A KNOWN PR NUMBER IS ASKED BY NUMBER WHEN THE LISTING FAILS (#1140).
 *
 * Measured 2026-10-01 on Bitbucket: `bb pr list` answered HTTP 429 from about
 * 12:30 to past 14:10, while `bb pr view <n>` answered in the same window. The
 * queue read the failed listing as *nothing merged*, so every slice behind a
 * merged one held `not-claimable` (#1094).
 */
describe('a known PR number is asked by number when the listing fails', () => {
  const indexRow = (number: number, head: string, state: string): PrIndexRow => ({
    number,
    head,
    state,
    draft: false,
    checks: 'none',
    review: '',
    url: '',
  });

  /** A world whose listing failed, and which counts every host call. */
  const failing = (
    plans: PlanRecord[],
    rows: PrIndexRow[],
    view: (n: number) => LandedAnswer,
    queued: (branch: string) => LandedAnswer = () => 'not-landed',
  ) => {
    const asked = { listing: 0, views: [] as number[], branches: [] as string[] };
    const world: QueueWorld = {
      plans: async () => plans,
      claimedBranches: async () => new Set<string>(),
      mergedBranches: async () => {
        asked.listing += 1;
        return { merged: new Set<string>(), whole: false };
      },
      prIndexRows: async () => rows,
      viewLanded: async (n) => {
        asked.views.push(n);
        return view(n);
      },
      briefPresent: async () => true,
      sliceHasMerged: async () => false,
      subjectProven: async () => null,
      queuedHasLanded: async (branch) => {
        asked.branches.push(branch);
        return queued(branch);
      },
      workerAlive: async () => true,
      blocked: async () => false,
    };
    return { world, asked };
  };

  const hold = (readings: Awaited<ReturnType<typeof readQueue>>, branch: string) =>
    whyNotReady(readings.slices.find((s) => s.branch === branch)!);

  it('offers the next slice when the view by number says the first merged', async () => {
    const { world, asked } = failing(
      [plan([['feature/one'], ['feature/two']])],
      [indexRow(12, 'feature/one', 'OPEN')],
      () => 'landed',
    );
    const readings = await readQueue([], world);

    expect(hold(readings, 'feature/two')).toBeNull();
    expect(readings.slices.map((s) => s.branch)).not.toContain('feature/one');
    expect(asked.views).toEqual([12]);
  });

  it('keeps the next slice held when the view does not answer', async () => {
    const { world } = failing(
      [plan([['feature/one'], ['feature/two']])],
      [indexRow(12, 'feature/one', 'OPEN')],
      () => 'unknown',
    );
    const readings = await readQueue([], world);

    expect(hold(readings, 'feature/two')).toBe('not-claimable');
    expect(hold(readings, 'feature/one')).toBe('merge-unknown');
  });

  it('keeps the next slice held when the view says the PR did not merge', async () => {
    const { world, asked } = failing(
      [plan([['feature/one'], ['feature/two']])],
      [indexRow(12, 'feature/one', 'CLOSED')],
      () => 'not-landed',
    );
    const readings = await readQueue([], world);

    expect(hold(readings, 'feature/two')).toBe('not-claimable');
    // The view already answered feature/one, so it is not asked again by branch.
    expect(asked.branches).not.toContain('feature/one');
  });

  it('reads a merged index row for no host call', async () => {
    const { world, asked } = failing(
      [plan([['feature/one'], ['feature/two']])],
      [indexRow(12, 'feature/one', 'MERGED')],
      () => 'unknown',
    );
    const readings = await readQueue([], world);

    expect(hold(readings, 'feature/two')).toBeNull();
    expect(asked.views).toEqual([]);
  });

  it('asks nothing by number for a branch no PR number names', async () => {
    const { world, asked } = failing([plan([['feature/one'], ['feature/two']])], [], () => 'landed');
    const readings = await readQueue([], world);

    expect(asked.views).toEqual([]);
    expect(hold(readings, 'feature/two')).toBe('not-claimable');
  });

  it('walks every merged slice of a plan in one pass', async () => {
    const { world, asked } = failing(
      [plan([['feature/a'], ['feature/b'], ['feature/c'], ['feature/d']])],
      [indexRow(1, 'feature/a', 'MERGED'), indexRow(2, 'feature/b', 'OPEN'), indexRow(3, 'feature/c', 'OPEN')],
      () => 'landed',
    );
    const readings = await readQueue([], world);

    expect(hold(readings, 'feature/d')).toBeNull();
    expect(asked.views).toEqual([2, 3]);
  });

  it('reads the index and asks nothing by number when the listing answered', async () => {
    let read = 0;
    const { world, asked } = failing([plan([['feature/one'], ['feature/two']])], [], () => 'landed');
    const readings = await readQueue([], {
      ...world,
      mergedBranches: async () => ({ merged: new Set(['feature/one']), whole: true }),
      prIndexRows: async () => {
        read += 1;
        return [];
      },
    });

    expect(read).toBe(0);
    expect(asked.views).toEqual([]);
    expect(hold(readings, 'feature/two')).toBeNull();
  });

  it('bounds the lookups by number in one pass, on an estate of 40 refless branches', async () => {
    // TEN PLANS, each with three merged, refless slices whose PRs the index
    // holds only as stale OPEN rows, and a fourth slice nobody has started.
    // Before #1140 this pass made 11 host calls (the failed listing, then one
    // per-branch question for each plan's first slice) and held all ten fourth
    // slices `not-claimable`.
    const plans = Array.from({ length: 10 }, (_, p) =>
      ({
        ...plan([[`feature/p${p}-a`], [`feature/p${p}-b`], [`feature/p${p}-c`], [`feature/p${p}-d`]]),
        file: `docs/plans/2026-10-01-plan-${p}.md`,
      }) as PlanRecord,
    );
    const rows = plans.flatMap((_, p) =>
      ['a', 'b', 'c'].map((s, i) => indexRow(100 + p * 3 + i, `feature/p${p}-${s}`, 'OPEN')),
    );
    const { world, asked } = failing(plans, rows, () => 'landed');
    const readings = await readQueue([], world);

    expect(asked.listing).toBe(1);
    expect(asked.views).toHaveLength(VIEWS_PER_PASS);
    // Plan 0 settled in three views; its fourth slice is asked once by branch.
    expect(asked.branches).toEqual(['feature/p0-d']);
    expect(hold(readings, 'feature/p0-d')).toBeNull();
    // Plan 1 spent the last two views; its third slice is past the cap and
    // reads `unknown` without a per-branch question into the failed listing.
    expect(hold(readings, 'feature/p1-c')).toBe('merge-unknown');
    expect(hold(readings, 'feature/p1-d')).toBe('not-claimable');
    expect(hold(readings, 'feature/p9-a')).toBe('merge-unknown');
    // 1 listing + 5 views + 1 per-branch question = 7 host calls in the pass.
    expect(asked.listing + asked.views.length + asked.branches.length).toBe(7);
  });
});
