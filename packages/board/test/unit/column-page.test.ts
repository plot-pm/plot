// The pager every card column in the Board and Discovery tabs shares.
import { describe, it, expect } from 'vitest';
import { COLUMN_STEP, pageColumn, recencyOf, showNext } from '../../src/app/lib/column-page.js';

interface Item {
  id: string;
  at: string | null;
}

const items = (n: number): Item[] =>
  Array.from({ length: n }, (_, i) => ({ id: `i${i}`, at: `2026-10-${String(i + 1).padStart(2, '0')}` }));

const ids = (list: readonly Item[]) => list.map((item) => item.id);
const dateOf = (item: Item) => item.at;

describe('pageColumn', () => {
  it('shows the five newest first and offers the next five', () => {
    const page = pageColumn(items(23), { dateOf });
    expect(ids(page.visible)).toEqual(['i22', 'i21', 'i20', 'i19', 'i18']);
    expect(page).toMatchObject({ hidden: 18, total: 23, next: 5, collapsible: false });
  });

  it('adds five per step and offers only what is left on the last step', () => {
    const second = pageColumn(items(23), { dateOf, shown: showNext(undefined) });
    expect(second.visible).toHaveLength(10);
    expect(second).toMatchObject({ hidden: 13, next: 5, collapsible: true });
    const last = pageColumn(items(23), { dateOf, shown: 20 });
    expect(last).toMatchObject({ hidden: 3, next: 3, collapsible: true });
    const all = pageColumn(items(23), { dateOf, shown: 25 });
    expect(all).toMatchObject({ hidden: 0, next: 0, collapsible: true });
  });

  it('offers nothing for a column of five or fewer', () => {
    expect(pageColumn(items(COLUMN_STEP), { dateOf })).toMatchObject({ hidden: 0, next: 0, collapsible: false });
    expect(pageColumn(items(3), { dateOf, shown: 10 })).toMatchObject({ hidden: 0, collapsible: false });
  });

  it('sorts an item with no date or an unparsable date last, and keeps input order within a date', () => {
    const list: Item[] = [
      { id: 'none', at: null },
      { id: 'a', at: '2026-10-01' },
      { id: 'junk', at: 'soon' },
      { id: 'b', at: '2026-10-01' },
      { id: 'new', at: '2026-11-01T08:00:00Z' },
    ];
    expect(ids(pageColumn(list, { dateOf }).visible)).toEqual(['new', 'a', 'b', 'none', 'junk']);
  });

  it('shows a pinned item outside the cut in addition to the five', () => {
    const page = pageColumn(items(23), { dateOf, pinned: (item) => item.id === 'i0' });
    expect(ids(page.visible)).toEqual(['i22', 'i21', 'i20', 'i19', 'i18', 'i0']);
    expect(page.hidden).toBe(17);
  });

  it('never drops an item: visible plus hidden is the whole column', () => {
    for (const n of [0, 1, 5, 6, 23]) {
      for (const shown of [5, 10, 30]) {
        const page = pageColumn(items(n), { dateOf, shown });
        expect(page.visible.length + page.hidden).toBe(n);
      }
    }
  });
});

describe('recencyOf', () => {
  it('reads a date and a date-time, and reads absence as oldest', () => {
    expect(recencyOf('2026-10-01')).toBe(Date.parse('2026-10-01T00:00:00Z'));
    expect(recencyOf('2026-10-01T08:00:00Z')).toBe(Date.parse('2026-10-01T08:00:00Z'));
    expect(recencyOf('')).toBe(-Infinity);
    expect(recencyOf(null)).toBe(-Infinity);
    expect(recencyOf('soon')).toBe(-Infinity);
  });
});
