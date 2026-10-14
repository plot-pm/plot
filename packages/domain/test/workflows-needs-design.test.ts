import { describe, it, expect } from 'vitest';
import { decided, refused, type Write } from '../src/workflows/decision.js';
import {
  planNeedsDesign,
  SPEC_PLACEHOLDER,
  specOf,
  type NeedsDesignReadings,
} from '../src/workflows/needs-design.js';

const ready = (over: Partial<NeedsDesignReadings> = {}): NeedsDesignReadings => ({
  slug: 'a-plan',
  file: 'docs/plans/2026-10-12-a-plan.md',
  parsed: true,
  phase: 'draft',
  review: 'pr',
  impl: 'own-branches',
  spec: '',
  pr: { number: 42, state: 'OPEN', head: 'idea/a-plan' },
  ...over,
});
const on = { on: '2026-10-12', who: 'jwloka', channel: 'board' };
const kinds = (writes: readonly Write[]) => writes.map((w) => w.kind);

describe('planNeedsDesign write targets', () => {
  it('commits onto the head branch of an open plan PR and pushes that branch', () => {
    const out = planNeedsDesign(ready(), on);
    if (!decided(out)) throw new Error('expected a decision');
    expect(out.detail).toEqual({ slug: 'a-plan', target: 'plan-pr', branch: 'idea/a-plan', pr: 42 });
    expect(kinds(out.writes)).toEqual(['plan-phase', 'plan-record', 'plan-section', 'commit', 'push']);
    expect(out.writes).toContainEqual({ kind: 'push', branch: 'idea/a-plan', onto: '' });
    expect(out.writes).toContainEqual({
      kind: 'plan-record',
      file: 'docs/plans/2026-10-12-a-plan.md',
      field: 'Design',
      value: '2026-10-12, jwloka, board',
    });
    expect(out.writes).toContainEqual({
      kind: 'plan-section',
      file: 'docs/plans/2026-10-12-a-plan.md',
      heading: 'Spec',
      body: SPEC_PLACEHOLDER,
    });
  });

  it('treats a plan with no recorded review as pr', () => {
    const out = planNeedsDesign(ready({ review: 'NONE' }), on);
    expect(decided(out) && out.detail.target).toBe('plan-pr');
  });

  it('writes in the caller checkout and pushes nothing under Impl: same-branch', () => {
    const out = planNeedsDesign(ready({ impl: 'same-branch' }), on);
    if (!decided(out)) throw new Error('expected a decision');
    expect(out.detail.target).toBe('caller-checkout');
    expect(kinds(out.writes)).not.toContain('push');
    expect(kinds(out.writes)).toContain('commit');
  });

  it.each(['in-session', 'ballot'])('books on plot/needs-design-<slug> for Review: %s', (review) => {
    const out = planNeedsDesign(ready({ review, pr: { number: 0, state: 'NONE', head: '' } }), on);
    if (!decided(out)) throw new Error('expected a decision');
    expect(out.detail).toEqual({ slug: 'a-plan', target: 'booking', branch: 'plot/needs-design-a-plan', pr: 0 });
    expect(out.writes).toContainEqual({ kind: 'push', branch: 'plot/needs-design-a-plan', onto: 'default' });
  });

  it.each(['in-session', 'ballot'])('writes in the caller checkout and pushes nothing for Review: %s under Impl: same-branch', (review) => {
    const out = planNeedsDesign(ready({ review, impl: 'same-branch', pr: { number: 0, state: 'NONE', head: '' } }), on);
    if (!decided(out)) throw new Error('expected a decision');
    expect(out.detail).toEqual({ slug: 'a-plan', target: 'caller-checkout', branch: '', pr: 0 });
    expect(kinds(out.writes)).toEqual(['plan-phase', 'plan-record', 'plan-section', 'commit']);
  });

  it.each([
    ['NONE', 'has no plan PR'],
    ['CLOSED', 'is closed'],
    ['MERGED', 'is merged'],
  ] as const)('refuses plan-pr-absent for Review: pr with a %s PR and writes nothing', (state, text) => {
    const out = planNeedsDesign(ready({ pr: { number: 42, state, head: 'idea/a-plan' } }), on);
    expect(refused(out)).toBe(true);
    expect(out).toMatchObject({ outcome: 'refused', reason: 'plan-pr-absent' });
    expect((out as { detail: string }).detail).toContain(text);
    expect('writes' in out).toBe(false);
  });

  it('leaves an existing Spec section alone', () => {
    const out = planNeedsDesign(ready({ spec: 'Real content.' }), on);
    if (!decided(out)) throw new Error('expected a decision');
    expect(kinds(out.writes)).not.toContain('plan-section');
  });
});

describe('planNeedsDesign refusals', () => {
  it.each([
    [{ file: '' }, 'plan-not-found'],
    [{ parsed: false }, 'plan-unparseable'],
    [{ phase: 'approved' }, 'state-wrong'],
    [{ phase: 'design' }, 'state-wrong'],
    [{ phase: 'delivered' }, 'state-terminal'],
    [{ phase: 'NONE' }, 'state-unreadable'],
    [{ review: 'carrier-pigeon' }, 'review-unrecognised'],
  ] as const)('refuses %j as %s', (over, reason) => {
    expect(planNeedsDesign(ready(over), on)).toMatchObject({ outcome: 'refused', reason });
  });

  it('refuses review-human without a who', () => {
    expect(planNeedsDesign(ready(), { ...on, who: '' })).toMatchObject({ reason: 'review-human' });
  });
});

describe('specOf', () => {
  const fence = '```';

  it('returns the trimmed body of the Spec section up to the next heading', () => {
    const text = ['# Plan', '', '## Spec', '', 'Body line.', '### Sub', 'More.', '', '## Slices', 'x'].join('\n');
    expect(specOf(text)).toBe('Body line.\n### Sub\nMore.');
  });

  it('returns an empty string where the plan has no Spec section', () => {
    expect(specOf('# Plan\n\n## Slices\nx')).toBe('');
  });

  it('ignores a Spec heading inside a fence that opens before the section', () => {
    const text = ['# Plan', fence, '## Spec', 'not the spec', fence, '## Slices'].join('\n');
    expect(specOf(text)).toBe('');
  });

  it('keeps fenced lines in the body and does not end the section on a heading inside a fence', () => {
    const text = ['## Spec', 'Before.', fence, '## Not a heading', fence, 'After.', '## Slices', 'x'].join('\n');
    expect(specOf(text)).toBe(['Before.', fence, '## Not a heading', fence, 'After.'].join('\n'));
  });
});
