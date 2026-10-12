import { describe, it, expect } from 'vitest';
import { PlanMetaSchema } from '../../src/contract/schema.js';
import { answer, slicesFrom } from '../../src/server/entry/verdicts.js';
import { PlanSchema } from '@plot-pm/domain';

describe('PlanMetaSchema — spike readings', () => {
  const base = { file: 'docs/plans/x.md', format: 'canonical', phase: 'approved' };

  it('validates pre-spike JSON with none of the three keys', () => {
    const parsed = PlanMetaSchema.parse({
      ...base,
      branches: ['feature/a'],
      waves: [{ name: 'Only', branches: [{ branch: 'feature/a', deferred: false, claimed: '' }] }],
    });
    expect(parsed.tracer).toBe(false);
    expect(parsed.spike_approved_raw).toBe('');
    expect(parsed.slices[0].branches[0].spike).toBe(false);
  });

  it('carries the three readings when the helper emits them', () => {
    const parsed = PlanMetaSchema.parse({
      ...base,
      branches: ['feature/a'],
      tracer: true,
      spike_approved_raw: '2026-10-12, jwloka',
      waves: [{ name: 'Only', branches: [{ branch: 'feature/a', spike: true }] }],
    });
    expect(parsed.tracer).toBe(true);
    expect(parsed.spike_approved_raw).toBe('2026-10-12, jwloka');
    expect(parsed.slices[0].branches[0].spike).toBe(true);
  });
});

describe('PlanSchema — tracer', () => {
  it('defaults to false for a pulse written before the field', () => {
    expect(PlanSchema.parse({ file: 'x.md', phase: 'approved', slices: [] }).tracer).toBe(false);
  });
});

describe('slicesFrom — the three spike columns', () => {
  it('leaves both absent on a three-column line', () => {
    const [s] = slicesFrom('1\tapproved\topen\n');
    expect('spike' in s).toBe(false);
    expect('spikeApproved' in s).toBe(false);
  });

  it('leaves spike unread without the plan count, so a bare 1 admits nothing', () => {
    const [a] = slicesFrom('1\tdesign\topen\t1\t1\n');
    expect('spike' in a).toBe(false);
    expect(a.spikeApproved).toBe(true);
  });

  it('reads six columns as the plan\'s spike slice and the approval', () => {
    const [a, b] = slicesFrom('1\tapproved\topen\t0\t0\t1\n0\tapproved\tmerged\t1\t0\t1\n');
    expect(a.spike).toBe(false);
    expect(a.spikeApproved).toBe(false);
    expect(b.spike).toBe(true);
    expect(b.spikeApproved).toBe(false);
  });

  it('marks no slice where the plan holds two annotations', () => {
    const slices = slicesFrom('1\tdesign\topen\t1\t1\t2\n1\tdesign\topen\t1\t1\t2\n');
    expect(slices.map((s) => s.spike)).toEqual([false, false]);
  });
});

describe('answer — what the scan offers for a Design plan with an approved spike', () => {
  it('offers the spike when it stands alone in its slice', () => {
    expect(answer('1\tdesign\topen\t1\t1\t1\n1\tdesign\topen\t0\t1\t1\n'))
      .toBe('eligible\t1\nunapproved\t0\n');
  });

  it('offers neither branch of a slice holding the spike and a sibling', () => {
    expect(answer('2\tdesign\topen|open\t1\t1\t1\n')).toBe('unapproved\t00\n');
  });

  it('offers nothing where the plan holds two annotations', () => {
    expect(answer('1\tdesign\topen\t1\t1\t2\n1\tdesign\topen\t1\t1\t2\n'))
      .toBe('unapproved\t0\nunapproved\t0\n');
  });

  it('offers nothing where the second annotation sits in a slice the scan does not show', () => {
    expect(answer('1\tdesign\topen\t1\t1\t2\n')).toBe('unapproved\t0\n');
  });
});
