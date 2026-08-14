import { describe, it, expect } from 'vitest';
import { PlanMetaSchema } from '../../src/contract/schema';

describe('PlanMetaSchema — waves', () => {
  const base = { file: 'docs/plans/x.md', format: 'canonical', phase: 'approved' };

  it('accepts the waves array emitted by plot-plan-meta.sh', () => {
    const parsed = PlanMetaSchema.parse({
      ...base,
      branches: ['feature/a', 'feature/b'],
      waves: [
        { name: 'Tracer', branches: [{ branch: 'feature/a', deferred: false, claimed: '' }] },
        {
          name: 'Implementation',
          branches: [{ branch: 'feature/b', deferred: true, claimed: '2026-08-14T10:22Z, s-3' }],
        },
      ],
    });
    expect(parsed.waves).toHaveLength(2);
    expect(parsed.waves[0].name).toBe('Tracer');
    expect(parsed.waves[1].branches[0].deferred).toBe(true);
    expect(parsed.waves[1].branches[0].claimed).toBe('2026-08-14T10:22Z, s-3');
  });

  it('defaults waves to empty so pre-wave helper output still validates', () => {
    // The board must keep working against an older plot-plan-meta.sh that
    // emits no waves field at all.
    const parsed = PlanMetaSchema.parse({ ...base, branches: ['feature/a'] });
    expect(parsed.waves).toEqual([]);
  });

  it('keeps the flat branches list as the whole set, independent of waves', () => {
    // waves[] groups; branches[] remains the complete, sorted set that existing
    // consumers read. One must never be derived from the other at this layer.
    const parsed = PlanMetaSchema.parse({
      ...base,
      branches: ['feature/a', 'feature/b'],
      waves: [{ name: '', branches: [{ branch: 'feature/a', deferred: false, claimed: '' }] }],
    });
    expect(parsed.branches).toEqual(['feature/a', 'feature/b']);
  });
});
