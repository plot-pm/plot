import { describe, expect, it } from 'vitest';
import { slicesFromPulse } from '../../src/server/board.js';
import type { FleetReading, PlanMeta } from '../../src/contract/schema.js';

type Slice = FleetReading['plans'][number]['slices'][number];
type Branch = Slice['branches'][number];

const branch = (name: string, state: Branch['state'], over: Partial<Branch> = {}): Branch =>
  ({ branch: name, state, deferred: false, deferred_reason: '', waits_on: [], claimed: '', local_dirty: false, ...over }) as Branch;

const meta = { file: '/repo/docs/plans/2026-11-06-p.md', slices: [{}, {}] } as unknown as PlanMeta;

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
