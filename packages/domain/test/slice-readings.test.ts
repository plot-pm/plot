import { describe, expect, it } from 'vitest';
import { answered } from '../src/port-result.js';
import type { PlanRecord } from '../src/ports/plan-store.js';
import { planQueue } from '../src/rules/queue.js';
import { blockingBranches } from '../src/rules/known-pr.js';
import { sliceReadingsOf } from '../src/rules/slice-readings.js';
import type { SliceReadings } from '../src/rules/eligible.js';
import { assemblePlanWalk } from '../src/workflows/plan-walk-assembly.js';
import type { BranchReadings } from '../src/rules/branch-state.js';
import type { Estate } from '../src/workflows/plan-walk-estate.js';
import type { BranchStageReadings } from '../src/workflows/plan-walk-branches.js';
import type { DeskStageReadings } from '../src/workflows/plan-walk-desks.js';

/**
 * Both the registry's queue and the fleet scan build `SliceReadings` from a
 * `PlanRecord`. Before `sliceReadingsOf` they disagreed on exactly one case:
 * an approved spike of a Design plan read `eligible` to the scan and
 * `not-claimable` to the queue, because only the scan passed `spike` and
 * `spikeApproved`. This file holds the agreement.
 */

type Branch = { branch: string; deferred?: boolean; spike?: boolean };

const planOf = (phase: string, slices: Branch[][], spikeApprovedRaw = ''): PlanRecord =>
  ({
    file: 'docs/plans/2026-11-03-a-plan.md',
    phase,
    spikeApprovedRaw,
    slices: slices.map((branches) => ({
      branches: branches.map((b) => ({
        branch: b.branch,
        deferred: b.deferred ?? false,
        waitsOn: [],
        ...(b.spike === undefined ? {} : { spike: b.spike }),
      })),
    })),
  }) as unknown as PlanRecord;

describe('the queue admits the approved spike', () => {
  it('claims only the spike branch — 0 claimable before the fix', () => {
    const plan = planOf(
      'design',
      [[{ branch: 'feature/spike', spike: true }], [{ branch: 'feature/after' }]],
      '2026-11-03, jwloka, in-session, feature/spike',
    );
    const queued = planQueue(plan, new Set(), new Set(), true);
    expect(queued.find((q) => q.branch === 'feature/spike')?.claimable).toBe(true);
    expect(queued.filter((q) => q.claimable).map((q) => q.branch)).toEqual(['feature/spike']);
    expect(queued.find((q) => q.branch === 'feature/after')?.claimable).toBe(false);
  });
});

describe('the queue admits nothing — the admission stays closed', () => {
  it('names nothing for two marked branches', () => {
    const plan = planOf(
      'design',
      [[{ branch: 'feature/a', spike: true }], [{ branch: 'feature/b', spike: true }]],
      '2026-11-03',
    );
    expect(planQueue(plan, new Set(), new Set(), true).some((q) => q.claimable)).toBe(false);
  });

  it('names nothing for a marked branch with no approval record', () => {
    const plan = planOf('design', [[{ branch: 'feature/a', spike: true }]]);
    expect(planQueue(plan, new Set(), new Set(), true).some((q) => q.claimable)).toBe(false);
  });

  it('names nothing for a Draft plan with a marked branch and a record', () => {
    const plan = planOf('draft', [[{ branch: 'feature/a', spike: true }]], '2026-11-03');
    expect(planQueue(plan, new Set(), new Set(), true).some((q) => q.claimable)).toBe(false);
  });

  it('names nothing where the spike slice also names a second branch', () => {
    const plan = planOf(
      'design',
      [[{ branch: 'feature/a', spike: true }, { branch: 'feature/b' }]],
      '2026-11-03',
    );
    expect(planQueue(plan, new Set(), new Set(), true).some((q) => q.claimable)).toBe(false);
  });

  it('names nothing where the second branch is deferred', () => {
    const plan = planOf(
      'design',
      [[{ branch: 'feature/a', spike: true }, { branch: 'feature/b', deferred: true }]],
      '2026-11-03',
    );
    expect(planQueue(plan, new Set(), new Set(), true).some((q) => q.claimable)).toBe(false);
  });

  it('names nothing once the approved spike has merged — slice 2 reads unapproved', () => {
    const plan = planOf(
      'design',
      [[{ branch: 'feature/spike', spike: true }], [{ branch: 'feature/after' }]],
      '2026-11-03, jwloka, in-session, feature/spike',
    );
    const queued = planQueue(plan, new Set(), new Set(['feature/spike']), true);
    expect(queued.some((q) => q.claimable)).toBe(false);
  });
});

describe('blockingBranches asks about the approved spike', () => {
  const none = () => false;

  it('answers the spike branch for an approved, unsettled spike', () => {
    const plan = planOf(
      'design',
      [[{ branch: 'feature/spike', spike: true }], [{ branch: 'feature/after' }]],
      '2026-11-03, jwloka, in-session, feature/spike',
    );
    expect(blockingBranches(plan, none)).toEqual(['feature/spike']);
  });

  it('answers nothing without the approval record', () => {
    const plan = planOf('design', [[{ branch: 'feature/spike', spike: true }]]);
    expect(blockingBranches(plan, none)).toEqual([]);
  });
});

describe('sliceReadingsOf — the builder, every branch for the 100% gate', () => {
  it('reads outstanding and branches through, deferred included', () => {
    const plan = planOf('approved', [[{ branch: 'feature/a' }, { branch: 'feature/b', deferred: true }]]);
    expect(sliceReadingsOf(plan, [1])).toEqual<SliceReadings[]>([
      { outstanding: 1, phase: 'approved', branches: 2, spike: false, spikeApproved: false },
    ]);
  });

  it('names no spike for zero markers', () => {
    const plan = planOf('design', [[{ branch: 'feature/a' }]]);
    expect(sliceReadingsOf(plan, [0])[0]!.spike).toBe(false);
  });

  it('names the marked slice for one marker in slice 0', () => {
    const plan = planOf('design', [[{ branch: 'feature/a', spike: true }], [{ branch: 'feature/b' }]]);
    const readings = sliceReadingsOf(plan, [0, 0]);
    expect(readings[0]!.spike).toBe(true);
    expect(readings[1]!.spike).toBe(false);
  });

  it('names the marked slice for one marker in slice 1', () => {
    const plan = planOf('design', [[{ branch: 'feature/a' }], [{ branch: 'feature/b', spike: true }]]);
    const readings = sliceReadingsOf(plan, [0, 0]);
    expect(readings[0]!.spike).toBe(false);
    expect(readings[1]!.spike).toBe(true);
  });

  it('names no slice for two markers', () => {
    const plan = planOf(
      'design',
      [[{ branch: 'feature/a', spike: true }], [{ branch: 'feature/b', spike: true }]],
    );
    const readings = sliceReadingsOf(plan, [0, 0]);
    expect(readings.every((r) => r.spike === false)).toBe(true);
  });

  it('reads spikeApproved false for an undefined spikeApprovedRaw', () => {
    const plan = { file: 'p.md', phase: 'design', slices: [{ branches: [] }] } as unknown as PlanRecord;
    expect(sliceReadingsOf(plan, [0])[0]!.spikeApproved).toBe(false);
  });

  it('reads spikeApproved false for an empty spikeApprovedRaw', () => {
    const plan = planOf('design', [[{ branch: 'feature/a' }]], '');
    expect(sliceReadingsOf(plan, [0])[0]!.spikeApproved).toBe(false);
  });

  it('reads spikeApproved true for a record', () => {
    const plan = planOf('design', [[{ branch: 'feature/a', spike: true }]], '2026-11-03, jwloka, in-session, feature/a');
    expect(sliceReadingsOf(plan, [0])[0]!.spikeApproved).toBe(true);
  });

  it('reads spikeApproved false for a record that licenses no branch', () => {
    const marked = [[{ branch: 'feature/a' }], [{ branch: 'feature/b', spike: true }]];
    for (const record of ['2026-11-03', '2026-11-03, jwloka, in-session, feature/a', '2026-11-03, jwloka, in-session, feature/c']) {
      expect(sliceReadingsOf(planOf('design', marked, record), [0, 0]).map((r) => r.spikeApproved)).toEqual([false, false]);
    }
    const renamed = planOf('design', [[{ branch: 'feature/c', spike: true }]], '2026-11-03, jwloka, in-session, feature/a');
    expect(sliceReadingsOf(renamed, [0])[0]!.spikeApproved).toBe(false);
  });

  it('answers unapproved for a moved marker, a renamed branch and a date-only record', () => {
    const marked = [[{ branch: 'feature/a' }], [{ branch: 'feature/b', spike: true }]];
    for (const record of ['2026-11-03, jwloka, in-session, feature/a', '2026-11-03']) {
      const plan = planOf('design', marked, record);
      expect(planQueue(plan, new Set(), new Set(), true).find((q) => q.branch === 'feature/b')?.claimable).toBe(false);
    }
  });
});

describe('the queue agrees with the walk', () => {
  const open = (): BranchReadings =>
    ({
      deferredByPlan: false,
      refTip: 't1',
      mainTip: 'm1',
      mergeSubjectFound: false,
      hostReach: 'ok',
      pr: 'none',
      prListComplete: true,
      commitsAhead: 0,
      realCommitsAhead: 0,
      waits: [],
    }) as unknown as BranchReadings;

  const merged = (): BranchReadings => ({ ...open(), refTip: null, pr: 'MERGED' }) as unknown as BranchReadings;

  const walkClaimable = (plan: PlanRecord, allMerged: boolean): readonly string[] => {
    const estate = {
      mainSha: 'm1',
      plans: [{ blob: 'b', record: plan }],
      indexes: [],
      dangling: [],
    } as unknown as Estate;
    const branches: BranchStageReadings = {
      mainSha: 'm1',
      backend: 'github',
      origin: '',
      merges: [],
      added: new Map(),
      branches: plan.slices.flatMap((slice) =>
        slice.branches.map((b) => ({
          plan: plan.file,
          branch: b.branch,
          readings: allMerged ? merged() : open(),
          landed: [],
          changedPaths: [],
        })),
      ),
    } as unknown as BranchStageReadings;
    const desks: DeskStageReadings = { mainSha: 'm1', desks: [] };
    const result = assemblePlanWalk(
      { estate: answered(estate), branches: answered(branches), desks: answered(desks) },
      { slug: '', offer: true },
    );
    if (!result.ok) throw new Error('walk failed');
    return result.value.claimable;
  };

  const queueClaimable = (plan: PlanRecord, allMerged: boolean): readonly string[] => {
    const allBranches = plan.slices.flatMap((slice) => slice.branches.map((b) => b.branch));
    const merged_ = new Set(allMerged ? allBranches : []);
    return planQueue(plan, new Set(), merged_, true)
      .filter((q) => q.claimable)
      .map((q) => q.branch);
  };

  const agree = (plan: PlanRecord, allMerged: boolean) => {
    expect(queueClaimable(plan, allMerged).slice().sort()).toEqual(walkClaimable(plan, allMerged).slice().sort());
  };

  const PHASES = ['draft', 'design', 'approved', 'delivered'];

  for (const phase of PHASES) {
    for (const withRecord of [false, true]) {
      it(`agrees for phase ${phase}, ${withRecord ? 'with' : 'without'} a record, open`, () => {
        const plan = planOf(phase, [[{ branch: 'feature/a' }], [{ branch: 'feature/b' }]], withRecord ? '2026-11-03' : '');
        agree(plan, false);
      });

      it(`agrees for phase ${phase}, ${withRecord ? 'with' : 'without'} a record, merged`, () => {
        const plan = planOf(phase, [[{ branch: 'feature/a' }], [{ branch: 'feature/b' }]], withRecord ? '2026-11-03' : '');
        agree(plan, true);
      });
    }
  }

  it('agrees for design with a record and the spike in slice 0 — fails on main', () => {
    const plan = planOf(
      'design',
      [[{ branch: 'feature/spike', spike: true }], [{ branch: 'feature/after' }]],
      '2026-11-03',
    );
    agree(plan, false);
  });

  it('agrees for design with a record and the spike in slice 1 behind an open slice 0', () => {
    const plan = planOf(
      'design',
      [[{ branch: 'feature/before' }], [{ branch: 'feature/spike', spike: true }]],
      '2026-11-03',
    );
    agree(plan, false);
  });

  it('agrees for design with a record and two markers', () => {
    const plan = planOf(
      'design',
      [[{ branch: 'feature/a', spike: true }], [{ branch: 'feature/b', spike: true }]],
      '2026-11-03',
    );
    agree(plan, false);
  });
});
