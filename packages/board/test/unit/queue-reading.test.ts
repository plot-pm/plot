import { describe, it, expect } from 'vitest';
import { queueOfPlan, readQueue, type QueueWorld } from '../../src/server/queue-reading.js';
import type { PlanRecord } from '@plot-pm/domain';

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
    mergedBranches: async () => new Set(['feature/one']),
    briefPresent: async () => true,
    sliceHasMerged: async () => false,
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
        return new Set(['feature/one']);
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
      mergedBranches: async () => new Set<string>(),
    }));

    expect(readings.slices.find((s) => s.branch === 'feature/two')?.claimable).toBe(false);
  });
});
