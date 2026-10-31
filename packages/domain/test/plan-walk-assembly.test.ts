import { describe, expect, it } from 'vitest';

import { answered, failed } from '../src/port-result.js';
import type { PlanRecord } from '../src/ports/plan-store.js';
import type { BranchReadings, PrReading, WaitsReading } from '../src/rules/branch-state.js';
import {
  assemblePlanWalk,
  offerAnswer,
  sliceNamesOf,
  sliceNamesText,
  whyNothingText,
} from '../src/workflows/plan-walk-assembly.js';
import type { BranchStageReadings } from '../src/workflows/plan-walk-branches.js';
import type { DeskStageReadings } from '../src/workflows/plan-walk-desks.js';
import type { Estate } from '../src/workflows/plan-walk-estate.js';

type Line = { branch: string; waitsOn?: string[]; deferred?: boolean };

const planOf = (file: string, phase: string, slices: Line[][], type = 'feature'): PlanRecord =>
  ({
    file,
    phase,
    type,
    slices: slices.map((lines, i) => ({
      name: `slice-${i + 1}`,
      branches: lines.map((l) => ({
        branch: l.branch,
        deferred: l.deferred ?? false,
        deferredReason: '',
        claimed: '',
        waitsOn: l.waitsOn ?? [],
      })),
    })),
  }) as unknown as PlanRecord;

const estateOf = (...plans: PlanRecord[]): Estate =>
  ({ mainSha: 'm1', plans: plans.map((record) => ({ blob: 'b', record })), indexes: [], dangling: [] }) as unknown as Estate;

const open = (over: Partial<BranchReadings> = {}): BranchReadings => ({
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
  ...over,
});

const wait = (branch: string, pr: PrReading, namedSlice = true): WaitsReading => ({ branch, pr, namedSlice });

const merged = (): BranchReadings => open({ refTip: null, pr: 'MERGED' });

const branchesOf = (...rows: Array<[string, string, BranchReadings]>): BranchStageReadings =>
  ({
    mainSha: 'm1',
    backend: 'github',
    origin: '',
    merges: [],
    added: new Map(),
    branches: rows.map(([plan, branch, readings]) => ({ plan, branch, readings, landed: [], changedPaths: [] })),
  }) as unknown as BranchStageReadings;

const noDesks: DeskStageReadings = { mainSha: 'm1', desks: [] };

const walk = (estate: Estate, branches: BranchStageReadings, input = { slug: '', offer: true }) =>
  assemblePlanWalk({ estate: answered(estate), branches: answered(branches), desks: answered(noDesks) }, input);

describe('assemblePlanWalk', () => {
  it('offers the open branch of an approved plan and nothing behind an unfinished slice', () => {
    const estate = estateOf(planOf('p.md', 'approved', [[{ branch: 'feature/a' }], [{ branch: 'feature/b' }]]));
    const result = walk(estate, branchesOf(['p.md', 'feature/a', open()], ['p.md', 'feature/b', open()]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.claimable).toEqual(['feature/a']);
    expect(result.value.plans[0]!.slices.map((s) => s.verdict)).toEqual(['eligible', 'blocked']);
    expect(offerAnswer(result.value, false)).toEqual({ out: 'feature/a\n', err: '', exit: 0 });
  });

  it('opens the second slice once the first has merged', () => {
    const estate = estateOf(planOf('p.md', 'approved', [[{ branch: 'feature/a' }], [{ branch: 'feature/b' }]]));
    const result = walk(estate, branchesOf(['p.md', 'feature/a', merged()], ['p.md', 'feature/b', open()]));
    if (!result.ok) throw new Error('failed');
    expect(result.value.claimable).toEqual(['feature/b']);
  });

  it('holds a branch on a prerequisite in another plan, and releases it when that merges', () => {
    const estate = estateOf(
      planOf('a.md', 'approved', [[{ branch: 'feature/a' }]]),
      planOf('b.md', 'approved', [[{ branch: 'feature/b', waitsOn: ['feature/a'] }]]),
    );
    const held = walk(
      estate,
      branchesOf(['a.md', 'feature/a', open({ pr: 'OPEN', commitsAhead: 1, realCommitsAhead: 1 })], [
        'b.md', 'feature/b', open({ waits: [wait('feature/a', 'OPEN')] }),
      ]),
    );
    if (!held.ok) throw new Error('failed');
    expect(held.value.plans[1]!.slices[0]!.branches[0]!.state).toBe('waiting');
    expect(held.value.claimable).toEqual([]);
    expect(offerAnswer(held.value, true).err).toContain('nothing claimable');

    const freed = walk(
      estate,
      branchesOf(['a.md', 'feature/a', merged()], ['b.md', 'feature/b', open({ waits: [wait('feature/a', 'MERGED')] })]),
    );
    if (!freed.ok) throw new Error('failed');
    expect(freed.value.claimable).toEqual(['feature/b']);
  });

  it('reads a prerequisite in the same plan from that branch landing', () => {
    const estate = estateOf(planOf('p.md', 'approved', [[{ branch: 'feature/a' }, { branch: 'feature/b', waitsOn: ['feature/a'] }]]));
    const result = walk(
      estate,
      branchesOf(['p.md', 'feature/a', merged()], ['p.md', 'feature/b', open({ waits: [wait('feature/a', 'none')] })]),
    );
    if (!result.ok) throw new Error('failed');
    expect(result.value.plans[0]!.slices[0]!.branches[1]!.state).toBe('open');
  });

  it('fails the walk when the desk stage failed', () => {
    const estate = estateOf(planOf('p.md', 'approved', [[{ branch: 'feature/a' }]]));
    const result = assemblePlanWalk(
      { estate: answered(estate), branches: answered(branchesOf(['p.md', 'feature/a', open()])), desks: failed<DeskStageReadings>() },
      { slug: '', offer: true },
    );
    expect(result.ok).toBe(false);
  });

  it('fails the walk when the branch or estate stage failed', () => {
    const estate = estateOf(planOf('p.md', 'approved', [[{ branch: 'feature/a' }]]));
    const branches = branchesOf(['p.md', 'feature/a', open()]);
    expect(assemblePlanWalk({ estate: answered(estate), branches: failed(), desks: answered(noDesks) }, { slug: '', offer: true }).ok).toBe(false);
    expect(assemblePlanWalk({ estate: failed(), branches: answered(branches), desks: answered(noDesks) }, { slug: '', offer: true }).ok).toBe(false);
  });

  it('leaves terminal plans out of an offer and names a delivered plan when its slug asks', () => {
    const estate = estateOf(planOf('2026-01-01-done.md', 'delivered', [[{ branch: 'feature/d' }]]));
    const branches = branchesOf(['2026-01-01-done.md', 'feature/d', merged()]);
    const offer = walk(estate, branches);
    if (!offer.ok) throw new Error('failed');
    expect(offer.value.plans).toEqual([]);
    const named = walk(estate, branches, { slug: 'done', offer: true });
    if (!named.ok) throw new Error('failed');
    expect(named.value.plans.map((p) => p.file)).toEqual(['2026-01-01-done.md']);
  });

  it('names no work when every branch merged', () => {
    const estate = estateOf(planOf('p.md', 'approved', [[{ branch: 'feature/a' }]]));
    const result = walk(estate, branchesOf(['p.md', 'feature/a', merged()]));
    if (!result.ok) throw new Error('failed');
    expect(whyNothingText(result.value)).toBe('none\n');
    expect(offerAnswer(result.value, true)).toEqual({
      out: '',
      err: 'nothing claimable: no eligible wave holds a startable branch.\n',
      exit: 1,
    });
  });
});

describe('sliceNamesOf', () => {
  it('lists non-deferred branches of live plans once each', () => {
    const estate = estateOf(
      planOf('a.md', 'approved', [[{ branch: 'x' }, { branch: 'y', deferred: true }], [{ branch: 'x' }]]),
      planOf('b.md', 'delivered', [[{ branch: 'z' }]]),
    );
    expect(sliceNamesOf(estate)).toEqual(['x']);
    expect(sliceNamesText(['x', 'w'])).toBe('x\nw\n');
    expect(sliceNamesText([])).toBe('');
  });
});
