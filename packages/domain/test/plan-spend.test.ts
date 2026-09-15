import { describe, expect, it } from 'vitest';

import { encodeSliceSpend, type SliceSpend } from '../src/entities/slice-spend.js';
import { planSpend, planSpendSummary } from '../src/rules/plan-spend.js';

/**
 * ONE RECORD LINE, as the worker writes it at `seal_declaration`.
 *
 * @param branch - the branch the record is about.
 * @param over - fields to vary; `tokens` is replaced wholesale.
 */
const line = (branch: string, over: Partial<SliceSpend> = {}): string =>
  encodeSliceSpend({
    branch,
    at: '2026-09-15T10:00:00.000Z',
    tokens: {
      inputTokens: 1,
      outputTokens: 10,
      cacheCreationTokens: 100,
      cacheReadTokens: 1000,
    },
    turns: 1,
    models: ['claude-opus-5'],
    ...over,
  });

describe('planSpend sums the measured slices', () => {
  it('sums each counter across a plan whose slices were all measured', () => {
    const actual = planSpend(
      [
        line('feature/a'),
        line('feature/b', {
          tokens: {
            inputTokens: 2,
            outputTokens: 20,
            cacheCreationTokens: 200,
            cacheReadTokens: 2000,
          },
        }),
      ],
      ['feature/a', 'feature/b'],
    );

    expect(actual.tokens).toEqual({
      inputTokens: 3,
      outputTokens: 30,
      cacheCreationTokens: 300,
      cacheReadTokens: 3000,
    });
    expect(actual.measured).toBe(2);
    expect(actual.absent).toBe(0);
    expect(actual.unreadable).toBe(0);
  });

  it('writes NO combined fifth total — asserted on the key set, not on prose', () => {
    // THE GATE THAT PROSE CANNOT CARRY. A helpful `total` beside the four passes
    // every value test above and defeats the design: cache reads are 99.36% of a
    // naive four-counter sum, so a total is a cache-read count wearing a cost's
    // name. The slice record pins its key set for this reason and the rollup
    // inherits the rule rather than restating it.
    const actual = planSpend([line('feature/a')], ['feature/a']);

    expect(Object.keys(actual.tokens!).sort()).toEqual([
      'cacheCreationTokens',
      'cacheReadTokens',
      'inputTokens',
      'outputTokens',
    ]);
    expect(Object.keys(actual).sort()).toEqual([
      'absent',
      'measured',
      'slices',
      'tokens',
      'unreadable',
    ]);
  });

  it('takes the NEWEST record for a branch that ran twice', () => {
    // A second run writes a second line rather than mutating the first, so a
    // branch re-dispatched after a correction carries several. Summing the
    // history would charge one slice twice.
    const actual = planSpend(
      [
        line('feature/a'),
        line('feature/a', {
          at: '2026-09-15T12:00:00.000Z',
          tokens: {
            inputTokens: 7,
            outputTokens: 70,
            cacheCreationTokens: 700,
            cacheReadTokens: 7000,
          },
        }),
      ],
      ['feature/a'],
    );

    expect(actual.tokens?.inputTokens).toBe(7);
    expect(actual.measured).toBe(1);
  });
});

describe('planSpend refuses to report a zero', () => {
  it('reports NO total for a plan with zero measured slices', () => {
    // `reduce(…, 0)` is correct arithmetic and a lie — it reports a plan nobody
    // measured as a free one. This is the property the plan says to pin first.
    const actual = planSpend([], ['feature/a', 'feature/b']);

    expect(actual.tokens).toBeNull();
    expect(actual.measured).toBe(0);
    expect(actual.absent).toBe(2);
  });

  it('reports every slice absent when the record file is missing entirely', () => {
    // A COLD START IS NOT AN ERROR. `lines()` answers `answered([])` for a
    // missing file, so a checkout that has measured nothing yet reports
    // absences rather than failing.
    const actual = planSpend([], ['feature/a']);

    expect(actual.tokens).toBeNull();
    expect(actual.slices).toEqual([{ branch: 'feature/a', state: 'absent', tokens: null }]);
  });

  it('reports every slice unreadable when the record itself could not be read', () => {
    // Only `failed` becomes `unreadable`; a missing file is an empty record.
    const actual = planSpend(null, ['feature/a', 'feature/b']);

    expect(actual.tokens).toBeNull();
    expect(actual.unreadable).toBe(2);
    expect(actual.absent).toBe(0);
  });
});

describe('planSpend keeps absent and unreadable apart', () => {
  it('reports the sum plus BOTH counts separately for a mixed plan', () => {
    // THE COLLAPSE THIS REPO HAS SHIPPED TWICE. `cannot answer` is not `no`, so
    // one count for both is the failure `DeclarationReading` names. The fixture
    // holds one of each.
    const actual = planSpend(
      [line('feature/measured'), 'not json at all'],
      ['feature/measured', 'feature/never-ran'],
    );

    expect(actual.tokens).toEqual({
      inputTokens: 1,
      outputTokens: 10,
      cacheCreationTokens: 100,
      cacheReadTokens: 1000,
    });
    expect(actual.measured).toBe(1);
    expect(actual.absent).toBe(1);
    expect(actual.unreadable).toBe(0);
  });

  it('names every branch the plan named, in plan order, whatever its state', () => {
    const actual = planSpend([line('feature/b')], ['feature/a', 'feature/b']);

    expect(actual.slices.map((slice) => [slice.branch, slice.state])).toEqual([
      ['feature/a', 'absent'],
      ['feature/b', 'measured'],
    ]);
  });
});

describe('planSpend sums the plan’s branches and no others', () => {
  it('IGNORES a record naming a branch the plan does not list', () => {
    // Catches a rollup that globs the record instead of reading the plan. One
    // file holds every branch the machine has measured, and a record whose
    // branch no plan names is not this plan's cost.
    const actual = planSpend(
      [
        line('feature/mine'),
        line('feature/somebody-elses', {
          tokens: {
            inputTokens: 999_999,
            outputTokens: 999_999,
            cacheCreationTokens: 999_999,
            cacheReadTokens: 999_999,
          },
        }),
      ],
      ['feature/mine'],
    );

    expect(actual.tokens?.inputTokens).toBe(1);
    expect(actual.measured).toBe(1);
    expect(actual.slices).toHaveLength(1);
  });

  it('reports no total for a plan that names no branches at all', () => {
    const actual = planSpend([line('feature/a')], []);

    expect(actual.tokens).toBeNull();
    expect(actual.measured).toBe(0);
    expect(actual.slices).toEqual([]);
  });
});

describe('planSpendSummary', () => {
  it('never renders a number where nothing was measured', () => {
    // The honesty the plan calls the deliverable, one level up from the slice.
    expect(planSpendSummary(planSpend([], ['feature/a']))).toBe(
      'not measured here (1 not measured here)',
    );
  });

  it('names an unreadable record as unreadable rather than absent', () => {
    expect(planSpendSummary(planSpend(null, ['feature/a']))).toBe(
      'not measured here (1 unreadable)',
    );
  });

  it('says so for a plan that names no branches', () => {
    expect(planSpendSummary(planSpend([], []))).toBe('not measured here (no slices)');
  });

  it('carries the counts beside the sum, and prints no total', () => {
    const actual = planSpendSummary(planSpend([line('feature/a')], ['feature/a']));

    expect(actual).toBe('in 1, out 10, cache-write 100, cache-read 1000 over 1 of 1 slices measured');
    // 1 + 10 + 100 + 1000 — the number a fifth field would carry.
    expect(actual).not.toContain('1111');
  });

  it('names what was not measured beside a partial sum', () => {
    // A reader given a bare total cannot tell a cheap plan from a half-recorded
    // one, and on this estate the missing slices are the expensive ones.
    const actual = planSpendSummary(
      planSpend([line('feature/a'), 'torn'], ['feature/a', 'feature/b']),
    );

    expect(actual).toContain('1 of 2 slices measured');
    expect(actual).toContain('1 not measured here');
  });

  it('names both kinds of absence when a plan has one of each', () => {
    const mixed = {
      ...planSpend([line('feature/a')], ['feature/a', 'feature/b']),
      unreadable: 1,
    };

    expect(planSpendSummary(mixed)).toContain('1 not measured here, 1 unreadable');
  });
});
