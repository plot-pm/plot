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
  // THE FILTER OFFERS ACTIVE SPRINTS, AND ONLY THOSE.
  //
  // It used to union in every distinct `card.sprint`, so any sprint slug written
  // on any plan became an option. Measured 2026-08-26, hours after the W35
  // sprint closed: three options, all Closed, while the Agents header read *No
  // active sprint*. A plan's `Sprint:` field is history and never clears.

  it('offers the sprints in the directory', () => {
    const opts = sprintFilterOptions(
      mkBoard([], [{ slug: 'beta-week', title: 'Beta week' }, { slug: 'alpha-week', title: 'Alpha week' }]),
    );
    expect(opts).toEqual([
      { value: 'alpha-week', label: 'Alpha week' },
      { value: 'beta-week', label: 'Beta week' },
    ]);
  });

  it('does NOT offer a sprint that only a plan mentions', () => {
    // THE ANTI-CONTRACT, and the whole defect. `collectSprints` reads
    // `<sprintDir>/active/`, so a closed sprint has no entry — but the plans
    // that shipped in it still carry its slug. Deriving from those made a
    // finished sprint indistinguishable from a running one.
    const opts = sprintFilterOptions(mkBoard(['closed-last-week', 'closed-last-week']));
    expect(opts).toEqual([]);
  });

  it('is empty when no sprint is active, whatever the plans say', () => {
    // Accepted deliberately: an empty control beats a list nobody can act on.
    const opts = sprintFilterOptions(mkBoard(['a', 'b', 'c'], []));
    expect(opts).toEqual([]);
  });

  it('uses the directory title, never the raw slug', () => {
    const opts = sprintFilterOptions(mkBoard(['alpha-week'], [{ slug: 'alpha-week', title: 'Alpha week' }]));
    expect(opts).toEqual([{ value: 'alpha-week', label: 'Alpha week' }]);
  });

  it('handles a null board', () => {
    expect(sprintFilterOptions(null)).toEqual([]);
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
