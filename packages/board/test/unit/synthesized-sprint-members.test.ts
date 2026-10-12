import { describe, it, expect } from 'vitest';
import { parsePhaseMap, phaseOfPlan, planStatus, type PhaseMap } from '@plot-pm/domain';
import type { Card } from '../../src/contract/schema.js';
import { synthesizedSprintMembers } from '../../src/app/lib/sprint.js';

// A map that puts delivered and released plans in ONE column with a
// non-default name — the acceptance map of the-phases-are-declared. The
// column name `Done` says nothing about which of its cards is released.
const parsed = parsePhaseMap(
  'Idea = story:*; Design = plan:draft, plan:design; Build = plan:approved; Done = plan:delivered, plan:released',
);
if (!parsed.ok) throw new Error(parsed.refusal.reason);
const map: PhaseMap = parsed.map;

const cardIn = (slug: string, state: string): Pick<Card, 'slug' | 'title' | 'status' | 'phase'> => ({
  slug,
  title: slug,
  phase: phaseOfPlan(map, { state }) ?? '',
  status: planStatus({ phase: state, review: 'none', started: true, landed: 'merged', anyClaimed: false }),
});

describe('synthesizedSprintMembers', () => {
  it('checks a released plan whose column is not named Released', () => {
    const released = cardIn('shipped', 'released');
    expect(released.phase).toBe('Done');
    expect(synthesizedSprintMembers([released])).toEqual([
      { slug: 'shipped', text: 'shipped', tier: 'could', checked: true, known: true },
    ]);
  });

  it('leaves a delivered plan in the same column unchecked', () => {
    const delivered = cardIn('landed', 'delivered');
    expect(delivered.phase).toBe('Done');
    expect(synthesizedSprintMembers([delivered])[0]?.checked).toBe(false);
  });

  it('never checks a card by a column literal named Released', () => {
    const named = { slug: 'x', title: 'X', phase: 'Released', status: 'delivered' as const };
    expect(synthesizedSprintMembers([named])[0]?.checked).toBe(false);
  });
});
