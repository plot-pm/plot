import { describe, expect, it } from 'vitest';
import { filteredEstateTotals } from '../src/rules/filtered-estate-totals.js';
import type { PlanStatus } from '../src/rules/phase.js';

const ESTATE: PlanStatus[] = [
  ...Array(3).fill('draft'),
  ...Array(2).fill('open'),
  ...Array(5).fill('approved'),
  ...Array(4).fill('in-progress'),
  ...Array(3).fill('deliverable'),
  ...Array(2).fill('proven'),
  ...Array(10).fill('delivered'),
  ...Array(6).fill('released'),
  ...Array(2).fill('withdrawn'),
] as PlanStatus[];

describe('filteredEstateTotals', () => {
  it('counts the whole estate when nothing has filtered it', () => {
    const actual = filteredEstateTotals(ESTATE);
    expect(actual).toEqual({ total: 37, open: 10, wip: 9, done: 16, withdrawn: 2 });
  });

  it('shrinks once a filter narrows what is visible — it must not report the estate\'s totals', () => {
    // Simulates "This sprint" hiding every plan not in the sprint: only 5 of
    // 37 remain visible. A rule that silently recomputed from the full estate
    // would still report 37 here, which is exactly the defect this fixture
    // exists to catch.
    const visible = ESTATE.filter((_s, i) => i % 7 === 0);
    const actual = filteredEstateTotals(visible);
    expect(actual.total).toBeLessThan(ESTATE.length);
    expect(actual.total).toBe(visible.length);
  });

  it('holds total = open + wip + done + withdrawn for every filter combination', () => {
    for (const visible of [ESTATE, ESTATE.filter((s) => s !== 'withdrawn'), ESTATE.slice(0, 1), []]) {
      const actual = filteredEstateTotals(visible);
      expect(actual.total).toBe(actual.open + actual.wip + actual.done + actual.withdrawn);
    }
  });

  it('returns all-zero counts when the filters leave nothing visible', () => {
    expect(filteredEstateTotals([])).toEqual({ total: 0, open: 0, wip: 0, done: 0, withdrawn: 0 });
  });
});
