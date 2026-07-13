import { describe, it, expect } from 'vitest';
import {
  NO_SPRINT,
  passesFilter,
  sanitizeSelection,
  sprintFilterOptions,
  withCounts,
} from '../../src/app/lib/filters';
import type { Board, Card } from '../../src/contract/schema';

/** Minimal Board with the given cards (one Draft column) and sprint directory. */
function mkBoard(
  cardSprints: Array<string | undefined>,
  dir: Array<{ slug: string; title: string }> = [],
): Board {
  const cards: Card[] = cardSprints.map((sprint, i) => ({
    slug: `plan-${i}`,
    title: `Plan ${i}`,
    type: 'feature',
    phase: 'Draft',
    path: `docs/plans/plan-${i}.md`,
    ...(sprint ? { sprint } : {}),
  }));
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    columns: [{ phase: 'Draft', cards }],
    sprints: dir.map((s) => ({ ...s, phase: 'Active' })),
    stories: [],
  };
}

describe('sprintFilterOptions', () => {
  it('derives options from inline card.sprint values when the directory is empty', () => {
    // The bug-(b) case: no sprint directory, but plans carry inline sprints.
    const opts = sprintFilterOptions(mkBoard(['beta', 'alpha', undefined]));
    expect(opts).toEqual([
      { value: 'alpha', label: 'alpha' },
      { value: 'beta', label: 'beta' },
    ]);
  });

  it('prefers the directory title when a slug appears in both sources', () => {
    const opts = sprintFilterOptions(
      mkBoard(['alpha-week'], [{ slug: 'alpha-week', title: 'Alpha week' }]),
    );
    expect(opts).toEqual([{ value: 'alpha-week', label: 'Alpha week' }]);
  });

  it('unions directory sprints with inline-only sprints', () => {
    const opts = sprintFilterOptions(
      mkBoard(['inline-only'], [{ slug: 'dir-only', title: 'Directory only' }]),
    );
    expect(opts).toEqual([
      { value: 'dir-only', label: 'Directory only' },
      { value: 'inline-only', label: 'inline-only' },
    ]);
  });

  it('de-duplicates a sprint referenced by several plans', () => {
    const opts = sprintFilterOptions(mkBoard(['shared', 'shared', 'shared']));
    expect(opts).toEqual([{ value: 'shared', label: 'shared' }]);
  });

  it('returns [] for a null board and a board with no sprints anywhere', () => {
    expect(sprintFilterOptions(null)).toEqual([]);
    expect(sprintFilterOptions(mkBoard([undefined, undefined]))).toEqual([]);
  });
});

describe('withCounts', () => {
  it('counts cards per bucket, including the none sentinel', () => {
    const cards = mkBoard(['a', 'a', 'b', undefined]).columns[0].cards;
    const opts = withCounts(
      [
        { value: NO_SPRINT, label: 'No sprint' },
        { value: 'a', label: 'a' },
        { value: 'b', label: 'b' },
      ],
      cards,
      'sprint',
      NO_SPRINT,
    );
    expect(opts).toEqual([
      { value: NO_SPRINT, label: 'No sprint', count: 1 },
      { value: 'a', label: 'a', count: 2 },
      { value: 'b', label: 'b', count: 1 },
    ]);
  });

  it('yields zero counts against an empty card set', () => {
    const opts = withCounts([{ value: NO_SPRINT, label: 'No sprint' }], [], 'sprint', NO_SPRINT);
    expect(opts).toEqual([{ value: NO_SPRINT, label: 'No sprint', count: 0 }]);
  });
});

describe('sanitizeSelection', () => {
  const options = [
    { value: NO_SPRINT, label: 'No sprint' },
    { value: 'alpha', label: 'alpha' },
    { value: 'beta', label: 'beta' },
  ];

  it('keeps known slugs and the none sentinel, drops unknown ones', () => {
    expect(sanitizeSelection(['alpha', 'typo', NO_SPRINT], options)).toEqual(['alpha', NO_SPRINT]);
  });

  it('collapses an all-unknown selection to empty (→ no filter)', () => {
    expect(sanitizeSelection(['typo', 'stale'], options)).toEqual([]);
  });

  it('is a no-op when every selection is valid', () => {
    expect(sanitizeSelection(['beta', 'alpha'], options)).toEqual(['beta', 'alpha']);
  });

  // The regression this guards (council c006 / plan "validated against known
  // slugs"): a URL like ?sprint=typo must NOT blank the board. Sanitizing to []
  // makes passesFilter treat it as "no filter" and every card shows.
  it('an unknown URL slug no longer hides every card', () => {
    const cards = mkBoard(['alpha', 'beta', undefined]).columns[0].cards;
    const raw = ['typo']; // what readList would return for ?sprint=typo
    // Without sanitizing, nothing passes:
    expect(cards.filter((c) => passesFilter(c, raw, 'sprint', NO_SPRINT))).toHaveLength(0);
    // After sanitizing, the invalid filter falls away and all cards pass:
    const clean = sanitizeSelection(raw, options);
    expect(cards.filter((c) => passesFilter(c, clean, 'sprint', NO_SPRINT))).toHaveLength(3);
  });
});
