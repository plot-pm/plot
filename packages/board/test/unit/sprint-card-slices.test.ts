// The sprint card's plan key comes out of a slice item's id, not out of a payload field.
import { describe, it, expect } from 'vitest';
import { countedSlicesByPlan, sliceItemId } from '../../src/app/lib/agent-rows/delivery-readings.js';

describe('countedSlicesByPlan', () => {
  it('groups slice items by the plan before the NUL and reads delivered as merged', () => {
    const items = [
      { id: sliceItemId('plan-a', 'One'), kind: 'slice' as const, ownership: 'mine' as const, delivered: true },
      { id: sliceItemId('plan-a', 'Two'), kind: 'slice' as const, ownership: 'mine' as const },
      { id: 'branch:x', kind: 'branch' as const, ownership: 'mine' as const },
    ];
    const by = countedSlicesByPlan(items);
    expect([...by.keys()]).toEqual(['plan-a']);
    expect(by.get('plan-a')!.map((s) => s.merge)).toEqual(['merged', 'open']);
  });
  it('has no entry for a plan with no slice item', () => {
    expect(countedSlicesByPlan([]).get('plan-z')).toBeUndefined();
  });
});
