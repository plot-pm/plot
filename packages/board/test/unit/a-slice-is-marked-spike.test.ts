import { describe, it, expect } from 'vitest';
import { PlanMetaSchema } from '../../src/contract/schema.js';
import { slicesFrom } from '../../src/server/entry/verdicts.js';
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

describe('slicesFrom — the two spike columns', () => {
  it('leaves both absent on a three-column line', () => {
    const [s] = slicesFrom('1\tapproved\topen\n');
    expect('spike' in s).toBe(false);
    expect('spikeApproved' in s).toBe(false);
  });

  it('reads four columns as a spike flag only', () => {
    const [s] = slicesFrom('1\tapproved\topen\t1\n');
    expect(s.spike).toBe(true);
    expect('spikeApproved' in s).toBe(false);
  });

  it('reads five columns as two flags', () => {
    const [a, b] = slicesFrom('1\tapproved\topen\t0\t0\n0\tapproved\tmerged\t1\t1\n');
    expect(a.spike).toBe(false);
    expect(a.spikeApproved).toBe(false);
    expect(b.spike).toBe(true);
    expect(b.spikeApproved).toBe(true);
  });
});
