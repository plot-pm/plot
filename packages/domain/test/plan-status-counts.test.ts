import { describe, expect, it } from 'vitest';
import { bucketOf, planStatusCounts } from '../src/rules/plan-status-counts.js';
import type { PlanStatus } from '../src/rules/phase.js';

describe('bucketOf', () => {
  it('folds draft, open and approved into open', () => {
    expect(bucketOf('draft')).toBe('open');
    expect(bucketOf('open')).toBe('open');
    expect(bucketOf('approved')).toBe('open');
  });

  it('folds in-progress, deliverable and proven into wip', () => {
    expect(bucketOf('in-progress')).toBe('wip');
    expect(bucketOf('deliverable')).toBe('wip');
    expect(bucketOf('proven')).toBe('wip');
  });

  it('folds delivered and released into done', () => {
    expect(bucketOf('delivered')).toBe('done');
    expect(bucketOf('released')).toBe('done');
  });

  it('maps withdrawn to its own bucket', () => {
    expect(bucketOf('withdrawn')).toBe('withdrawn');
  });
});

describe('planStatusCounts', () => {
  it('tallies every bucket, with total equal to their sum', () => {
    const statuses: PlanStatus[] = [
      'draft', 'open', 'approved',
      'in-progress', 'deliverable', 'proven',
      'delivered', 'released',
      'withdrawn',
    ];
    const actual = planStatusCounts(statuses);
    expect(actual).toEqual({ total: 9, open: 3, wip: 3, done: 2, withdrawn: 1 });
    expect(actual.total).toBe(actual.open + actual.wip + actual.done + actual.withdrawn);
  });

  it('returns all-zero counts for an empty collection', () => {
    expect(planStatusCounts([])).toEqual({ total: 0, open: 0, wip: 0, done: 0, withdrawn: 0 });
  });

  it('keeps the arithmetic holding for a single-bucket collection', () => {
    const actual = planStatusCounts(['withdrawn', 'withdrawn']);
    expect(actual).toEqual({ total: 2, open: 0, wip: 0, done: 0, withdrawn: 2 });
  });
});
