import { describe, it, expect } from 'vitest';
import { PlanMetaSchema } from '../../src/contract/schema.js';
import { run, slicesFrom } from '../../src/server/entry/verdicts.js';
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

describe('slicesFrom — exactly three columns', () => {
  it('parses a three-column line', () => {
    expect(slicesFrom('1\tapproved\topen\n')).toEqual([
      { outstanding: 1, phase: 'approved', states: ['open'], branches: 1 },
    ]);
  });

  it('parses a line whose states field is empty', () => {
    expect(slicesFrom('0\tapproved\t\n')).toEqual([
      { outstanding: 0, phase: 'approved', states: [], branches: 0 },
    ]);
  });

  it('refuses a six-column line', () => {
    expect(() => slicesFrom('1\tdesign\topen\t1\t1\t1\n')).toThrow(/line 1: expected/);
  });

  it('refuses the whole batch through the bundle when one line has extra columns', () => {
    let out = '';
    expect(run('1\tapproved\topen\n1\tdesign\topen\t1\t1\t1\n', (s) => { out += s; })).toBe(2);
    expect(out).toBe('');
  });
});
