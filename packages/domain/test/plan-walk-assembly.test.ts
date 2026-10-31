import { describe, expect, it } from 'vitest';

import { answered, failed } from '../src/port-result.js';
import type { PlanRecord } from '../src/ports/plan-store.js';
import type { BranchReadings, PrReading, WaitsReading } from '../src/rules/branch-state.js';
import {
  assemblePlanWalk,
  fleetReading,
  offerAnswer,
  sliceNamesOf,
  sliceNamesText,
  whyNothingText,
} from '../src/workflows/plan-walk-assembly.js';
import type { BranchStageReadings } from '../src/workflows/plan-walk-branches.js';
import type { DeskReading, DeskStageReadings } from '../src/workflows/plan-walk-desks.js';
import type { Estate } from '../src/workflows/plan-walk-estate.js';

type Line = { branch: string; waitsOn?: string[]; deferred?: boolean; spike?: boolean };

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
        ...(l.spike === undefined ? {} : { spike: l.spike }),
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

  it('reads a file with no parsed phase as a note, not a plan', () => {
    const estate = estateOf(planOf('note.md', '', [[{ branch: 'n' }]]), planOf('a.md', 'approved', [[{ branch: 'x' }]]));
    expect(sliceNamesOf(estate)).toEqual(['x']);
    const out = assemblePlanWalk(
      { estate: answered(estate), branches: answered(branchesOf(['a.md', 'x', open()])), desks: answered({ mainSha: 'm1', desks: [] }) } as never,
      { slug: '', offer: false },
    );
    expect(out.ok && out.value.plans.map((p) => p.file)).toEqual(['a.md']);
  });
});

const deskOn = (branch: string, over: Partial<DeskReading> = {}): DeskReading =>
  ({
    branch,
    worktree: `/w/${branch}`,
    desk: {},
    process: { state: 'running', pid: '42', exitCode: '', activity: 'busy' },
    locked: true,
    unpushed: ['c1', 'c2'],
    quietSeconds: 30,
    ...over,
  }) as unknown as DeskReading;

const assembled = (estate: Estate, branches: BranchStageReadings, desks: DeskStageReadings = noDesks) => {
  const result = assemblePlanWalk(
    { estate: answered(estate), branches: answered(branches), desks: answered(desks) },
    { slug: '', offer: false },
  );
  if (!result.ok) throw new Error('failed');
  return result.value;
};

const header = {
  main: 'main', readRef: 'abc', localHead: 'def', fetchFailed: false, fetchError: '',
  planDir: 'docs/plans/', host: 'github', mergeDetect: 'host', nowSeconds: 1000,
};

describe('assemblePlanWalk coverage of plan shapes', () => {
  it('counts each branch state in the summary and marks a spike plan a tracer', () => {
    const plan = { ...planOf('p.md', 'approved', [[
      { branch: 'feature/claimed', spike: true }, { branch: 'feature/def', deferred: true },
      { branch: 'feature/blocked', waitsOn: ['feature/x'] }, { branch: 'feature/waiting', waitsOn: ['feature/y'] },
    ]]), spikeApprovedRaw: 'jwloka' } as PlanRecord;
    const value = assembled(
      estateOf(plan),
      branchesOf(
        ['p.md', 'feature/claimed', open({ commitsAhead: 1, realCommitsAhead: 0 })],
        ['p.md', 'feature/def', open({ deferredByPlan: true })],
        ['p.md', 'feature/blocked', open({ waits: [wait('feature/x', 'none', false)] })],
        ['p.md', 'feature/waiting', open({ waits: [wait('feature/y', 'OPEN')] })],
      ),
    );
    expect(value.plans[0]!.tracer).toBe(true);
    expect(value.summary).toMatchObject({ claimed: 1, deferred: 1, prereqMissing: 1, waiting: 1, branches: 4 });
  });

  it('lists no plan a slug does not name, and none that left or were delivered as docs', () => {
    const estate = estateOf(
      planOf('a.md', 'released', [[{ branch: 'a' }]]),
      planOf('b.md', 'delivered', [[{ branch: 'b' }]], 'docs'),
      planOf('c.md', 'delivered', [[{ branch: 'c' }]], 'infra'),
    );
    const branches = branchesOf(['a.md', 'a', merged()], ['b.md', 'b', merged()], ['c.md', 'c', merged()]);
    expect(assembled(estate, branches).plans).toEqual([]);
    const out = assemblePlanWalk(
      { estate: answered(estate), branches: answered(branches), desks: answered(noDesks) },
      { slug: 'nothing', offer: false },
    );
    expect(out.ok && out.value.plans).toEqual([]);
  });

  it('fails the walk when a plan branch has no reading', () => {
    const estate = estateOf(planOf('p.md', 'approved', [[{ branch: 'feature/a' }]]));
    const out = assemblePlanWalk(
      { estate: answered(estate), branches: answered(branchesOf()), desks: answered(noDesks) },
      { slug: '', offer: false },
    );
    expect(out.ok).toBe(false);
  });
});

describe('offerAnswer', () => {
  const base = (over: object) => ({ claimable: [], takenInEligible: 0, ...over }) as never;

  it('is silent on an empty --next and names the taken branches on an empty --list-eligible', () => {
    expect(offerAnswer(base({}), false)).toEqual({ out: '', err: '', exit: 1 });
    expect(offerAnswer(base({ takenInEligible: 2 }), true).err).toBe('nothing claimable: 2 branch(es) in eligible waves are taken.\n');
  });

  it('prints the first claimable branch for --next and all of them for --list-eligible', () => {
    expect(offerAnswer(base({ claimable: ['a', 'b'] }), false).out).toBe('a\n');
    expect(offerAnswer(base({ claimable: ['a', 'b'] }), true).out).toBe('a\nb\n');
  });

  it('counts a started branch of an eligible slice as taken', () => {
    const value = assembled(
      estateOf(planOf('p.md', 'approved', [[{ branch: 'feature/a' }]])),
      branchesOf(['p.md', 'feature/a', open({ pr: 'OPEN', commitsAhead: 1, realCommitsAhead: 1 })]),
    );
    expect(value.takenInEligible).toBe(1);
    expect(offerAnswer(value, true).err).toContain('1 branch(es)');
  });
});

describe('fleetReading', () => {
  it('prints a branch with a desk, a held worktree and a running worker', () => {
    const estate = estateOf(planOf('docs/plans/p.md', 'approved', [[{ branch: 'feature/a', spike: true }]]));
    const doc = fleetReading(
      assembled(estate, branchesOf(['docs/plans/p.md', 'feature/a', open()]), { mainSha: 'm1', desks: [deskOn('feature/a')] }),
      header,
    ) as any;
    expect(doc.plans[0]).toMatchObject({ file: 'p.md', tracer: true });
    expect(doc.plans[0].waves[0].branches[0]).toMatchObject({
      held: true, local_locked: true, local_worktree: '/w/feature/a', local_ahead: 2,
      changed_ago_seconds: 30, changed_at: 970, worker: 'running', worker_pid: '42', worker_activity: 'busy',
    });
    expect(doc.summary).toMatchObject({ waves: 1, host: 'github', merge_detect: 'host' });
  });

  it('prints a branch with no desk as elsewhere, and reads unknown unpushed and no quiet time as zero and null', () => {
    const estate = estateOf(planOf('p.md', 'approved', [[{ branch: 'feature/a' }, { branch: 'feature/b' }]]));
    const branches = branchesOf(['p.md', 'feature/a', open()], ['p.md', 'feature/b', open()]);
    const idle = deskOn('feature/b', {
      unpushed: 'unknown', quietSeconds: null,
      process: { state: 'finished', pid: '', exitCode: '0', activity: 'idle' } as never,
    });
    const doc = fleetReading(assembled(estate, branches, { mainSha: 'm1', desks: [idle] }), header) as any;
    const [none, desk] = doc.plans[0].waves[0].branches;
    expect(doc.plans[0].file).toBe('p.md');
    expect(doc.plans[0].tracer).toBeUndefined();
    expect(none).toMatchObject({ held: false, worker: 'elsewhere', worker_pid: '', worker_exit: '', worker_activity: '', local_ahead: 0, changed_at: null });
    expect(desk).toMatchObject({ local_ahead: 0, changed_at: null, worker: 'finished', worker_exit: '0', worker_activity: '' });
  });

  it('marks a branch merged on its subject alone, and not one the host confirmed', () => {
    const estate = estateOf(planOf('p.md', 'approved', [[{ branch: 'feature/s' }, { branch: 'feature/h' }]]));
    const branches = branchesOf(
      ['p.md', 'feature/s', open({ refTip: null, mergeSubjectFound: true })],
      ['p.md', 'feature/h', open({ refTip: null, mergeSubjectFound: true, pr: 'MERGED' })],
    );
    const doc = fleetReading(assembled(estate, branches), header) as any;
    const [bySubject, byHost] = doc.plans[0].waves[0].branches;
    expect(bySubject.evidence).toBe('subject');
    expect(byHost.evidence).toBeUndefined();
  });
});
