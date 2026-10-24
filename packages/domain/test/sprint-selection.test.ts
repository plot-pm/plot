import { describe, expect, it } from 'vitest';
import {
  NO_SPRINT,
  rowInSprintSelection,
  rowIsSprintExempt,
  sanitizeSelection,
  showsSprintSlug,
  slugPassesSprintFilter,
} from '../src/rules/sprint-selection.js';

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

  // THE AGENTS TAB'S SHAPE — #1145. Its «Sprint only» selection is an in-memory
  // Set of sprint slugs, and its options are the ACTIVE sprints of the moment.
  // When one selected sprint closes it leaves `fleet.sprints`, and the selection
  // must keep filtering on the sprint that is still active rather than on both.
  it('keeps the still-active sprint when a second selected one closes', () => {
    const active = [{ slug: 'alpha', title: 'Alpha' }];
    const stillFilters = sanitizeSelection(
      ['alpha', 'beta'],
      active.map((s) => ({ value: s.slug, label: s.title })),
    );
    expect(stillFilters).toEqual(['alpha']);
  });

  // The regression this guards (council c006 / plan "validated against known
  // slugs"): a stale slug like ?sprint=typo must NOT blank the board. Sanitizing
  // to [] makes slugPassesSprintFilter treat it as "no filter" and every row shows.
  it('a stale selected slug reads as all Active sprints, not as an empty result', () => {
    const membership = new Map([['alpha', new Set(['plan-a'])], ['beta', new Set(['plan-b'])]]);
    const raw = ['typo'];
    // Without sanitizing, nothing passes:
    expect(slugPassesSprintFilter('plan-a', raw, membership)).toBe(false);
    // After sanitizing, the invalid selection falls away and every plan passes:
    const clean = sanitizeSelection(raw, options);
    expect(slugPassesSprintFilter('plan-a', clean, membership)).toBe(true);
    expect(slugPassesSprintFilter('plan-b', clean, membership)).toBe(true);
  });
});

describe('rowIsSprintExempt', () => {
  it('exempts the release row and a PR row that names no plan', () => {
    expect(rowIsSprintExempt({ kind: 'release', plan: '' })).toBe(true);
    expect(rowIsSprintExempt({ kind: 'pr', plan: '' })).toBe(true);
  });

  it('asks membership of a PR row that names a plan', () => {
    expect(rowIsSprintExempt({ kind: 'pr', plan: 'a-plan' })).toBe(false);
  });

  it('does not exempt a plan-less row of any other kind', () => {
    for (const kind of ['branch', 'plan', 'wave', 'ticket', 'build', 'agent']) {
      expect(rowIsSprintExempt({ kind, plan: '' })).toBe(false);
    }
  });
});

describe('slugPassesSprintFilter', () => {
  it('passes every slug when nothing is selected (0 Active sprints or none chosen)', () => {
    const membership = new Map<string, Set<string>>();
    expect(slugPassesSprintFilter('plan-a', [], membership)).toBe(true);
  });

  it('matches the NO_SPRINT sentinel for a slug in no sprint', () => {
    const membership = new Map([['alpha', new Set(['plan-a'])]]);
    expect(slugPassesSprintFilter('plan-b', [NO_SPRINT], membership)).toBe(true);
    expect(slugPassesSprintFilter('plan-a', [NO_SPRINT], membership)).toBe(false);
  });
});

describe('rowInSprintSelection', () => {
  const membership = new Map([
    ['alpha', new Set(['plan-a'])],
    ['beta', new Set(['plan-b'])],
  ]);

  it('0 Active sprints: every row is in the selection', () => {
    expect(rowInSprintSelection({ kind: 'branch', plan: 'plan-a' }, [], new Map())).toBe(true);
    expect(rowInSprintSelection({ kind: 'branch', plan: 'plan-z' }, [], new Map())).toBe(true);
  });

  it('1 Active sprint, no selection: empty selection is no filter, so every row is in', () => {
    const oneSprint = new Map([['alpha', new Set(['plan-a'])]]);
    expect(rowInSprintSelection({ kind: 'branch', plan: 'plan-a' }, [], oneSprint)).toBe(true);
    expect(rowInSprintSelection({ kind: 'branch', plan: 'plan-z' }, [], oneSprint)).toBe(true);
  });

  // TWO ACTIVE SPRINTS, SELECTION OF ONE: rows of the other sprint have
  // inSprint false. A rule that reads only "any Active sprint" passes the
  // 0-selection case and fails here.
  it('2 Active sprints, selection of one: rows of the other sprint are excluded', () => {
    expect(rowInSprintSelection({ kind: 'branch', plan: 'plan-a' }, ['alpha'], membership)).toBe(true);
    expect(rowInSprintSelection({ kind: 'branch', plan: 'plan-b' }, ['alpha'], membership)).toBe(false);
  });

  it('2 Active sprints, no selection: rows of either sprint are in the selection', () => {
    expect(rowInSprintSelection({ kind: 'branch', plan: 'plan-a' }, [], membership)).toBe(true);
    expect(rowInSprintSelection({ kind: 'branch', plan: 'plan-b' }, [], membership)).toBe(true);
  });

  it('a subset of two selected sprints admits members of either', () => {
    const threeSprints = new Map([
      ['alpha', new Set(['plan-a'])],
      ['beta', new Set(['plan-b'])],
      ['gamma', new Set(['plan-c'])],
    ]);
    expect(rowInSprintSelection({ kind: 'branch', plan: 'plan-a' }, ['alpha', 'beta'], threeSprints)).toBe(true);
    expect(rowInSprintSelection({ kind: 'branch', plan: 'plan-b' }, ['alpha', 'beta'], threeSprints)).toBe(true);
    expect(rowInSprintSelection({ kind: 'branch', plan: 'plan-c' }, ['alpha', 'beta'], threeSprints)).toBe(false);
  });

  // STALE SLUG: a selection of one slug no longer Active reads as all Active
  // sprints, not as an empty result. This catches a rule that tests membership
  // before sanitizing — the caller must sanitize first.
  it('a sanitized-to-empty stale selection behaves like never selected', () => {
    const sanitized: string[] = []; // what sanitizeSelection returns for a stale-only selection
    expect(rowInSprintSelection({ kind: 'branch', plan: 'plan-a' }, sanitized, membership)).toBe(true);
    expect(rowInSprintSelection({ kind: 'branch', plan: 'plan-b' }, sanitized, membership)).toBe(true);
  });

  it('an exempt row is always in the selection, whatever the selection excludes', () => {
    expect(rowInSprintSelection({ kind: 'release', plan: '' }, ['alpha'], membership)).toBe(true);
    expect(rowInSprintSelection({ kind: 'pr', plan: '' }, ['alpha'], membership)).toBe(true);
  });
});

describe('showsSprintSlug', () => {
  // ROW SLUG WITH 1 ACTIVE SPRINT: false in every selection.
  it('is false with one Active sprint, selected or not', () => {
    expect(showsSprintSlug(1, [])).toBe(false);
    expect(showsSprintSlug(1, ['alpha'])).toBe(false);
  });

  it('is true with several Active sprints and no selection narrowing to one', () => {
    expect(showsSprintSlug(2, [])).toBe(true);
    expect(showsSprintSlug(3, ['alpha', 'beta'])).toBe(true);
  });

  // ROW SLUG WITH EXACTLY ONE SELECTED: false even with two Active sprints.
  // This catches a rule that reads only the Active count.
  it('is false once the selection narrows to exactly one sprint', () => {
    expect(showsSprintSlug(2, ['alpha'])).toBe(false);
  });
});
