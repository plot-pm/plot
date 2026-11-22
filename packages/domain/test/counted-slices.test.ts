import { describe, expect, it } from 'vitest';

import { countedSlicesByPlan, type CountedPlanFacts } from '../src/rules/counted-slices.js';

const facts = (plan: string, phase: string, type: string, slices: readonly string[]): CountedPlanFacts => ({
  plan,
  phase,
  type,
  sliceIds: slices.map((s) => `slice:${plan}\0${s}`),
  planId: `slice:${plan}\0`,
});

describe('countedSlicesByPlan', () => {
  it('groups slice items by plan', () => {
    const byPlan = countedSlicesByPlan({
      seen: [],
      slices: [
        { plan: 'a', id: 'slice:a\0One', merge: 'merged' },
        { plan: 'b', id: 'slice:b\0One', merge: 'open' },
        { plan: 'a', id: 'slice:a\0Two', merge: 'open' },
      ],
    });
    expect(byPlan.get('a')).toEqual([
      { id: 'slice:a\0One', merge: 'merged' },
      { id: 'slice:a\0Two', merge: 'open' },
    ]);
    expect(byPlan.get('b')).toEqual([{ id: 'slice:b\0One', merge: 'open' }]);
  });

  it('gives a Draft plan and a row-only plan an empty entry', () => {
    const byPlan = countedSlicesByPlan({ seen: ['draft-plan', 'row-plan'], slices: [] });
    expect(byPlan.get('draft-plan')).toEqual([]);
    expect(byPlan.get('row-plan')).toEqual([]);
  });

  it('gives an empty plan key no entry and a repeated plan key one entry', () => {
    const byPlan = countedSlicesByPlan({ seen: ['', 'row-plan', 'row-plan'], slices: [] });
    expect([...byPlan.entries()]).toEqual([['row-plan', []]]);
  });

  it('gives a plan with no slice item and no reading no entry', () => {
    const byPlan = countedSlicesByPlan({ seen: ['other'], slices: [] });
    expect(byPlan.has('unread')).toBe(false);
  });

  it('seeds a delivered docs plan with no other entry with one merged slice per slice id', () => {
    const byPlan = countedSlicesByPlan({ seen: [], slices: [], plans: [facts('d', 'delivered', 'docs', ['Docs', 'More'])] });
    expect(byPlan.get('d')).toEqual([
      { id: 'slice:d\0Docs', merge: 'merged' },
      { id: 'slice:d\0More', merge: 'merged' },
    ]);
  });

  it('seeds a delivered docs plan whose row lies outside a slice', () => {
    const byPlan = countedSlicesByPlan({ seen: ['d'], slices: [], plans: [facts('d', 'delivered', 'docs', ['Docs'])] });
    expect(byPlan.get('d')).toEqual([{ id: 'slice:d\0Docs', merge: 'merged' }]);
  });

  it("keeps the pulse's slices of a delivered infra plan", () => {
    const byPlan = countedSlicesByPlan({
      seen: ['i'],
      slices: [{ plan: 'i', id: 'slice:i\0Pulse', merge: 'open' }],
      plans: [facts('i', 'delivered', 'infra', ['Plan'])],
    });
    expect(byPlan.get('i')).toEqual([{ id: 'slice:i\0Pulse', merge: 'open' }]);
  });

  it('gives a delivered feature plan with no other entry no entry', () => {
    const byPlan = countedSlicesByPlan({ seen: [], slices: [], plans: [facts('f', 'delivered', 'feature', ['One'])] });
    expect(byPlan.has('f')).toBe(false);
  });

  it('gives an approved docs plan with no other entry no entry', () => {
    const byPlan = countedSlicesByPlan({ seen: [], slices: [], plans: [facts('a', 'approved', 'docs', ['One'])] });
    expect(byPlan.has('a')).toBe(false);
  });

  it('seeds a delivered docs plan with no slice ids with exactly its plan id', () => {
    const byPlan = countedSlicesByPlan({ seen: [], slices: [], plans: [facts('n', 'delivered', 'docs', [])] });
    expect(byPlan.get('n')).toEqual([{ id: 'slice:n\0', merge: 'merged' }]);
  });
});
