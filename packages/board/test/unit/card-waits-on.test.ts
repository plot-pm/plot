import { describe, expect, it } from 'vitest';
import { slicesFromPulse } from '../../src/server/board.js';
import type { FleetReading, PlanMeta } from '../../src/contract/schema.js';

type Slice = FleetReading['plans'][number]['slices'][number];
type Branch = Slice['branches'][number];

const branch = (name: string, state: Branch['state'], over: Partial<Branch> = {}): Branch =>
  ({ branch: name, state, deferred: false, deferred_reason: '', waits_on: [], claimed: '', local_dirty: false, ...over }) as Branch;

const meta = { file: '/repo/docs/plans/2026-11-06-p.md', slices: [{ branches: ['a'] }, { branches: ['b'] }] } as unknown as PlanMeta;

const pulse = (slices: Slice[]): FleetReading =>
  ({ plans: [{ file: '2026-11-06-p.md', slices }] }) as unknown as FleetReading;

const prs = new Map([['feature/prereq', 3105], ['feature/a', 7]]);

describe('slicesFromPulse: what Start work waits on', () => {
  it('names the branch a waiting branch declares it waits on, never the branch itself', () => {
    const read = slicesFromPulse(meta, pulse([
      { name: 'One', verdict: 'eligible', branches: [branch('feature/a', 'waiting', { waits_on: ['feature/prereq'] })] },
      { name: 'Two', verdict: 'blocked', branches: [branch('feature/b', 'open')] },
    ]), prs);
    expect(read?.eligible).toBe(0);
    expect(read?.waitsOn).toEqual([{ branch: 'feature/prereq', pr: 3105 }]);
  });

  it('names the prerequisite slice\'s unmerged branches when the pulse holds no per-branch wait', () => {
    // Slice Two is blocked behind slice One; what it waits for is One's
    // unmerged work, never Two's own open branch.
    const read = slicesFromPulse(meta, pulse([
      { name: 'One', verdict: 'eligible', branches: [branch('feature/a', 'claimed'), branch('feature/done', 'merged')] },
      { name: 'Two', verdict: 'blocked', branches: [branch('feature/b', 'open')] },
    ]), prs);
    expect(read?.waitsOn).toEqual([{ branch: 'feature/a', pr: 7 }]);
  });

  it('a waiting branch with no waits_on reading falls back to naming itself', () => {
    const read = slicesFromPulse(meta, pulse([
      { name: 'One', verdict: 'eligible', branches: [branch('feature/a', 'waiting')] },
    ]), prs);
    expect(read?.waitsOn).toEqual([{ branch: 'feature/a', pr: 7 }]);
  });

  it('names an in-flight branch, which is what the slice waits on landing', () => {
    const read = slicesFromPulse(meta, pulse([
      { name: 'One', verdict: 'eligible', branches: [branch('feature/a', 'claimed'), branch('feature/m', 'merged')] },
    ]), prs);
    expect(read?.waitsOn).toEqual([{ branch: 'feature/a', pr: 7 }]);
  });
});

describe('slicesFromPulse: a slice that names no branch', () => {
  const metaWith = { file: '/repo/docs/plans/2026-11-06-p.md', slices: [{ branches: ['a'] }, { branches: [] }, { branches: ['b'] }] } as unknown as PlanMeta;

  it('is left out of the total, so a fully merged plan reads done == total', () => {
    const read = slicesFromPulse(metaWith, pulse([
      { name: 'One', verdict: 'complete', branches: [branch('feature/a', 'merged')] },
      { name: 'Prose', verdict: 'empty', branches: [] },
      { name: 'Two', verdict: 'complete', branches: [branch('feature/b', 'merged')] },
    ]), prs);
    expect(read).toMatchObject({ total: 2, complete: 2 });
  });

  it('is left out of the total with no pulse too', () => {
    expect(slicesFromPulse(metaWith, null, prs)).toMatchObject({ total: 2, complete: null });
  });

  it('a plan whose slices all name no branch has no work to count', () => {
    const prose = { file: '/repo/docs/plans/2026-11-06-p.md', slices: [{ branches: [] }] } as unknown as PlanMeta;
    expect(slicesFromPulse(prose, null, prs)).toBeNull();
  });
});

describe('a plan card counts its slices done from the pulse', () => {
  const metaOf = (phase: string) =>
    ({ file: '/repo/docs/plans/2026-11-06-p.md', phase, slices: [{ branches: ['a'] }, { branches: ['b'] }] }) as unknown as PlanMeta;

  it('a plan the pulse reads has done.value, never progress unknown', async () => {
    const { planFactsOf } = await import('../../src/server/plan-facts.js');
    const slices = slicesFromPulse(metaOf('approved'), pulse([
      { name: 'One', verdict: 'complete', branches: [branch('feature/a', 'merged')] },
      { name: 'Two', verdict: 'eligible', branches: [branch('feature/b', 'open')] },
    ]), prs);
    const facts = planFactsOf({
      slug: 'p', title: 'P', type: 'feature', phase: 'Development', path: 'docs/plans/2026-11-06-p.md',
      prs: [], issues: [], phaseDate: '',
      controls: { approve: false, needsDesign: false, interrogate: false, roundsBadge: false, dispatch: true, readyToStart: false, approveSpike: false, confirmSlices: false, spikeState: null },
    }, { slices, state: 'approved' });
    expect(facts.progress.work).toEqual({ unit: 'slices', done: { value: 1 }, total: 2 });
  });

  it('a delivered or released plan the scan leaves out reads every slice complete', () => {
    expect(slicesFromPulse(metaOf('released'), ({ plans: [] }) as unknown as FleetReading, prs)).toMatchObject({ total: 2, complete: 2 });
    expect(slicesFromPulse(metaOf('delivered'), null, prs)).toMatchObject({ total: 2, complete: 2 });
  });

  it('an approved plan the scan has not reached stays unknown', () => {
    expect(slicesFromPulse(metaOf('approved'), ({ plans: [] }) as unknown as FleetReading, prs)).toMatchObject({ total: 2, complete: null });
  });
});
