import { describe, expect, it } from 'vitest';
import { sprintLineCounts } from '../src/rules/sprint-line.js';
import type { PlanStatus } from '../src/rules/phase.js';

describe('sprintLineCounts', () => {
  it('counts the sprint\'s own items only, ignoring how many other plans exist in the estate', () => {
    // The fixture asserts the rule never widens its scope: it is handed only
    // the sprint's 9 members and must never reach for a 491st plan it was not
    // given, even though real estates carry hundreds more.
    const sprintItems: PlanStatus[] = [
      'delivered', 'delivered', 'released', 'released', 'delivered', 'delivered',
      'in-progress', 'deliverable',
      'draft',
    ];
    const actual = sprintLineCounts(sprintItems);
    expect(actual).toEqual({ total: 9, open: 1, wip: 2, done: 6, withdrawn: 0 });
  });

  it('holds the bucket-arithmetic invariant for a mixed sprint', () => {
    const actual = sprintLineCounts(['draft', 'in-progress', 'delivered', 'withdrawn']);
    expect(actual.total).toBe(actual.open + actual.wip + actual.done + actual.withdrawn);
  });
});
