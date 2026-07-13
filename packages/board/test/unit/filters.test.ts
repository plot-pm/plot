import { describe, it, expect } from 'vitest';
import { sprintFilterOptions } from '../../src/app/lib/filters';
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
