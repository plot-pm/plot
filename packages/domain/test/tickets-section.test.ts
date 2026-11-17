import { describe, expect, it } from 'vitest';
import { planItReason, ticketsSection, type TicketsSectionInput } from '../src/rules/tickets-section.js';

const rows = (n: number, from = 1): number[] => Array.from({ length: n }, (_, i) => from + i);
const input = (over: Partial<TicketsSectionInput<number>> = {}): TicketsSectionInput<number> => ({
  answer: 'answered', assigned: [], others: [], unassigned: 0, showAll: false, foldOpen: false, ...over,
});

describe('ticketsSection', () => {
  it('reads the reader\'s count and the unassigned count in the header', () => {
    const s = ticketsSection(input({ assigned: rows(3), unassigned: 7 }));

    expect(s.header).toBe('3 assigned to you with no plan · 7 more unassigned');
    expect(s.showAllControl).toBe(true);
  });

  it('omits the unassigned part where the read carries no count', () => {
    expect(ticketsSection(input({ assigned: rows(1), unassigned: null })).header).toBe('1 assigned to you with no plan');
  });

  it('shows five of six rows and folds one behind "… 1 more · show"', () => {
    const closed = ticketsSection(input({ assigned: rows(6) }));
    expect(closed.rows).toEqual(rows(5));
    expect(closed.folded).toBe(1);
    expect(closed.foldLabel).toBe('… 1 more · show');

    const open = ticketsSection(input({ assigned: rows(6), foldOpen: true }));
    expect(open.rows).toEqual(rows(6));
  });

  it('shows no fold for five rows or fewer', () => {
    const s = ticketsSection(input({ assigned: rows(5) }));
    expect(s.foldLabel).toBeNull();
    expect(s.rows).toHaveLength(5);
  });

  it('appends the others behind show all, under the same fold', () => {
    const closed = ticketsSection(input({ assigned: rows(2), others: rows(4, 10), unassigned: 4 }));
    expect(closed.rows).toEqual([1, 2]);

    const all = ticketsSection(input({ assigned: rows(2), others: rows(4, 10), unassigned: 4, showAll: true }));
    expect(all.rows).toEqual([1, 2, 10, 11, 12]);
    expect(all.foldLabel).toBe('… 1 more · show');
  });

  it('names an absent reading and carries no count of zero', () => {
    for (const [answer, state] of [['failed', 'failed'], ['unsupported', 'unsupported'], [null, 'unasked']] as const) {
      const s = ticketsSection(input({ answer }));
      expect(s.state).toBe(state);
      expect(s.header).toBeNull();
      expect(s.rows).toEqual([]);
    }
  });
});

describe('planItReason', () => {
  it('refuses a Bitbucket source as tracker-unsupported, ahead of an unavailable board', () => {
    expect(planItReason('unsupported', false)).toBe('tracker-unsupported');
  });

  it('refuses a failed read, and an unavailable board, and acts otherwise', () => {
    expect(planItReason('failed', true)).toBe('tracker-failed');
    expect(planItReason('answered', false)).toBe('unavailable');
    expect(planItReason('answered', true)).toBeNull();
  });
});
