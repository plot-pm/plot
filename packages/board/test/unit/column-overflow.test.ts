import { describe, it, expect } from 'vitest';
import { COLUMN_LIMIT, truncateColumn } from '../../src/app/components/Board.js';
import { phaseDateOf, leadingDate } from '../../src/server/board.js';
import { PlanMetaSchema, type Card, type Phase } from '../../src/contract/schema.js';

const card = (slug: string, phaseDate = '', phase: Phase = 'Released'): Card => ({
  slug, title: slug, type: 'feature', phase, path: `docs/plans/${slug}.md`,
  prs: [], phaseDate,
});

const meta = (over: Record<string, unknown> = {}) =>
  PlanMetaSchema.parse({ file: 'docs/plans/x.md', format: 'canonical', phase: 'released', ...over });

describe('truncateColumn — what a long column shows', () => {
  it('shows every card in a column at or under the limit, hiding none', () => {
    const cards = Array.from({ length: COLUMN_LIMIT }, (_, i) => card(`p${i}`, `2026-08-0${i + 1}`));
    const view = truncateColumn(cards);
    expect(view.visible).toHaveLength(COLUMN_LIMIT);
    expect(view.hidden).toBe(0);
  });

  it('cuts a longer column to the limit and COUNTS the rest', () => {
    // The `Released` column as it stands: thirteen plans, and the reason this
    // exists at all.
    const cards = Array.from({ length: 13 }, (_, i) =>
      card(`p${i}`, `2026-08-${String(i + 1).padStart(2, '0')}`));
    const view = truncateColumn(cards);
    expect(view.visible).toHaveLength(COLUMN_LIMIT);
    expect(view.hidden).toBe(13 - COLUMN_LIMIT);
  });

  it('reports the WHOLE column as the total, not the visible slice', () => {
    // The load-bearing assertion the plan names: `Released (13)` with five cards
    // says eight are hidden, while a header counting the five reads as *there
    // are five*. A truncation that also shrank the count would pass every test
    // about which cards are shown and would be the exact failure this prevents.
    const cards = Array.from({ length: 13 }, (_, i) =>
      card(`p${i}`, `2026-08-${String(i + 1).padStart(2, '0')}`));
    const view = truncateColumn(cards);
    expect(view.total).toBe(13);
    expect(view.total).not.toBe(view.visible.length);
    // And the two numbers a reader combines must actually add up.
    expect(view.visible.length + view.hidden).toBe(view.total);
  });

  it('keeps the MOST RECENT cards, by date, when file order disagrees', () => {
    // The other assertion the plan names, and the one a naive implementation
    // passes by coincidence. These arrive OLDEST-first — the order
    // `collectPlanFiles` produces, since plan filenames are date-prefixed and
    // sorted — so a `slice(0, 5)` over the arrival order keeps exactly the wrong
    // five, and every test that only counts cards still passes.
    const cards = [
      card('ancient', '2026-01-01'),
      card('old', '2026-03-01'),
      card('middling', '2026-05-01'),
      card('recent', '2026-07-01'),
      card('newer', '2026-08-01'),
      card('newest', '2026-08-16'),
    ];
    const view = truncateColumn(cards, { limit: 3 });
    expect(view.visible.map((c) => c.slug)).toEqual(['newest', 'newer', 'recent']);
    // Named explicitly: the first card in the array must NOT survive the cut.
    expect(view.visible.map((c) => c.slug)).not.toContain('ancient');
  });

  it('orders a short column by date too, so the cut is not what introduces order', () => {
    // Sorting only past the limit would make a column reorder itself the moment
    // one more card arrived — the newest card jumping from bottom to top.
    const view = truncateColumn([card('old', '2026-01-01'), card('new', '2026-08-01')]);
    expect(view.visible.map((c) => c.slug)).toEqual(['new', 'old']);
    expect(view.hidden).toBe(0);
  });

  it('keeps same-day cards in the order they arrived', () => {
    // Plot records DATES, not timestamps, and five plans were delivered on one
    // day this month. An unstable comparator would shuffle them between polls —
    // the board re-renders every few seconds, and cards swapping under the
    // cursor is more visible than any ordering subtlety.
    const sameDay = ['a', 'b', 'c', 'd'].map((s) => card(s, '2026-08-16'));
    expect(truncateColumn(sameDay).visible.map((c) => c.slug)).toEqual(['a', 'b', 'c', 'd']);
    // Twice, because a stable result once could be luck.
    expect(truncateColumn(sameDay).visible.map((c) => c.slug)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('sorts a dateless card LAST rather than first', () => {
    // "" means the plan records no date for its phase. Unknown must not
    // displace a known date out of the visible set — the same rule the fleet's
    // row sort follows for a null age: *we do not know* is not *newest*.
    const view = truncateColumn([card('nodate', ''), card('dated', '2026-01-01')], { limit: 1 });
    expect(view.visible.map((c) => c.slug)).toEqual(['dated']);
    expect(view.hidden).toBe(1);
  });

  it('sorts an unparseable date last as well, rather than coercing it', () => {
    // Date.parse is lenient enough to turn a typo into a confident wrong
    // position. A record that does not read as a date is treated as no date.
    const view = truncateColumn([card('junk', 'soon'), card('dated', '2026-01-01')], { limit: 1 });
    expect(view.visible.map((c) => c.slug)).toEqual(['dated']);
  });

  it('shows everything and hides nothing once expanded', () => {
    const cards = Array.from({ length: 13 }, (_, i) => card(`p${i}`, `2026-08-${i + 1}`));
    const view = truncateColumn(cards, { expanded: true });
    expect(view.visible).toHaveLength(13);
    expect(view.hidden).toBe(0);
    expect(view.total).toBe(13);
  });

  it('handles an empty column without inventing a control', () => {
    expect(truncateColumn([])).toEqual({ visible: [], hidden: 0, total: 0 });
  });

  it('never drops a card — visible plus hidden accounts for the whole column', () => {
    // The partition invariant, the same one `buildLanes` is pinned on. A card
    // neither shown nor counted is work that has silently vanished from the
    // board, which is worse than a column that is too long.
    for (const n of [0, 1, COLUMN_LIMIT, COLUMN_LIMIT + 1, 13, 40]) {
      const cards = Array.from({ length: n }, (_, i) => card(`p${i}`, `2026-08-${(i % 28) + 1}`));
      const view = truncateColumn(cards);
      expect(view.visible.length + view.hidden).toBe(n);
      expect(view.total).toBe(n);
    }
  });
});

describe('truncateColumn — a highlighted card is never hidden', () => {
  const thirteen = Array.from({ length: 13 }, (_, i) =>
    card(`p${i}`, `2026-08-${String(i + 1).padStart(2, '0')}`));

  it('shows a card the cut would otherwise have removed', () => {
    // Reachable today: the plan modal's *Show in board* sets `?plan=<slug>` and
    // the board scrolls to `#plan-<slug>`. Truncated away, the element does not
    // exist, `getElementById` returns null, and the arrival lands nowhere —
    // silently, which is the part that makes it a bug rather than a limitation.
    const view = truncateColumn(thirteen, { highlight: 'p0' });
    expect(view.visible.map((c) => c.slug)).toContain('p0');
  });

  it('keeps it IN ADDITION to the newest, so a link costs no other card', () => {
    const plain = truncateColumn(thirteen);
    const linked = truncateColumn(thirteen, { highlight: 'p0' });
    for (const slug of plain.visible.map((c) => c.slug)) {
      expect(linked.visible.map((c) => c.slug)).toContain(slug);
    }
    expect(linked.visible).toHaveLength(plain.visible.length + 1);
  });

  it('still counts what is genuinely not on screen', () => {
    const view = truncateColumn(thirteen, { highlight: 'p0' });
    expect(view.visible.length + view.hidden).toBe(13);
    expect(view.hidden).toBe(13 - COLUMN_LIMIT - 1);
  });

  it('adds nothing for a card already visible, or for one in another column', () => {
    // The highlight is board-wide while truncation is per column, so most
    // columns are handed a slug they do not hold. Duplicating or padding on
    // that would be a card counted twice.
    const already = truncateColumn(thirteen, { highlight: 'p12' });
    expect(already.visible).toHaveLength(COLUMN_LIMIT);
    expect(already.visible.filter((c) => c.slug === 'p12')).toHaveLength(1);
    const elsewhere = truncateColumn(thirteen, { highlight: 'a-card-in-endgame' });
    expect(elsewhere.visible).toHaveLength(COLUMN_LIMIT);
    expect(elsewhere.hidden).toBe(13 - COLUMN_LIMIT);
  });
});

describe('phaseDateOf — each column measures recency on its own clock', () => {
  const dates = {
    approved_raw: '2026-01-01, jwloka, plan-PR #146 merged',
    delivered_raw: '2026-05-05',
    released_raw: '2026-08-08, v2.3.0',
  };

  it('reads Released by its RELEASE date and Endgame by its DELIVERY date', () => {
    // The mapping is the load-bearing half. One record for every column would
    // sort at least three of them by a date that is not theirs — and the result
    // looks sorted, which is why it needs pinning rather than eyeballing.
    expect(phaseDateOf('Released', meta(dates))).toBe('2026-08-08');
    expect(phaseDateOf('Endgame', meta(dates))).toBe('2026-05-05');
  });

  it('reads both approved columns by the approval date', () => {
    expect(phaseDateOf('Design', meta(dates))).toBe('2026-01-01');
    expect(phaseDateOf('Development', meta(dates))).toBe('2026-01-01');
  });

  it('gives Discovery no date at all', () => {
    // Correct rather than a gap: a Draft plan has recorded no transition, so
    // there is nothing it is recent BY. Asserted with every other record
    // present, so a fallback chain would fail here.
    expect(phaseDateOf('Discovery', meta(dates))).toBe('');
  });

  it('never falls back to another phase\'s record', () => {
    // A delivered-not-released plan is the state of five plans today. Reading
    // its release date must yield "" rather than borrowing the delivery date —
    // a plausible order that answers a different question.
    expect(phaseDateOf('Released', meta({ delivered_raw: '2026-05-05' }))).toBe('');
    expect(phaseDateOf('Endgame', meta({ approved_raw: '2026-01-01' }))).toBe('');
  });
});

describe('leadingDate — only the date, and only a real one', () => {
  it('takes the date off the head of a record that carries a tail', () => {
    // Both shapes this repo actually writes.
    expect(leadingDate('2026-08-08, v2.3.0')).toBe('2026-08-08');
    expect(leadingDate('2026-08-16, jwloka, plan-PR #146 merged')).toBe('2026-08-16');
  });

  it('accepts a bare date, which is how most Delivered records are written', () => {
    expect(leadingDate('2026-08-15')).toBe('2026-08-15');
    expect(leadingDate('  2026-08-15  ')).toBe('2026-08-15');
  });

  it('returns "" for an empty record — the phase without the date', () => {
    // A plan can carry `Phase: Delivered` with `Delivered:` blank; that is a
    // bookkeeping fault, not a delivery at an unknown time, and the contract
    // says so. It must not become a guessed position in a column.
    expect(leadingDate('')).toBe('');
    expect(leadingDate('   ')).toBe('');
  });

  it('returns "" rather than coercing something that is not a date', () => {
    expect(leadingDate('soon')).toBe('');
    expect(leadingDate('v2.3.0, 2026-08-08')).toBe('');
    expect(leadingDate('2026-8-8')).toBe('');
    // Not a longer number that happens to start like a date.
    expect(leadingDate('2026-08-088')).toBe('');
  });
});
