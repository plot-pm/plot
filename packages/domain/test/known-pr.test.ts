import { describe, expect, it } from 'vitest';
import type { PrIndexRow } from '../src/entities/pr-index.js';
import {
  VIEWS_PER_PASS,
  blockingBranches,
  knownPrFor,
  landedSource,
  viewLanded,
} from '../src/rules/known-pr.js';

const row = (number: number, head: string, state: string, draft = false): PrIndexRow => ({
  number,
  head,
  state,
  draft,
  checks: 'none',
  review: '',
  url: '',
});

describe('knownPrFor', () => {
  it('knows nothing about a branch the index does not hold', () => {
    expect(knownPrFor([row(1, 'feature/other', 'MERGED')], 'feature/a')).toEqual({
      indexMerged: false,
      number: null,
    });
  });

  it('reads a merged row as merged, in either case', () => {
    expect(knownPrFor([row(4, 'feature/a', 'merged')], 'feature/a')).toEqual({
      indexMerged: true,
      number: 4,
    });
  });

  it('does not read a draft row as merged', () => {
    expect(knownPrFor([row(4, 'feature/a', 'MERGED', true)], 'feature/a').indexMerged).toBe(false);
  });

  it('names the newest number among several PRs for one head', () => {
    const rows = [row(7, 'feature/a', 'CLOSED'), row(12, 'feature/a', 'OPEN'), row(9, 'feature/a', 'CLOSED')];
    expect(knownPrFor(rows, 'feature/a')).toEqual({ indexMerged: false, number: 12 });
  });
});

describe('landedSource', () => {
  it('reads the listing whenever it answered, whatever else is known', () => {
    expect(landedSource(true, { indexMerged: true, number: 3 })).toBe('listing');
    expect(landedSource(true, { indexMerged: false, number: null })).toBe('listing');
  });

  it('reads a merged index row before asking by number', () => {
    expect(landedSource(false, { indexMerged: true, number: 3 })).toBe('index');
  });

  it('asks by number where the listing failed and a number is known', () => {
    expect(landedSource(false, { indexMerged: false, number: 3 })).toBe('number');
  });

  it('has no source where the listing failed and no number is known', () => {
    expect(landedSource(false, { indexMerged: false, number: null })).toBe('none');
  });
});

describe('viewLanded', () => {
  it('says landed where the host reports the PR merged', () => {
    expect(viewLanded({ state: 'MERGED', mergedAt: null })).toBe('landed');
    expect(viewLanded({ state: 'CLOSED', mergedAt: '2026-10-01T12:00:00Z' })).toBe('landed');
  });

  it('says not-landed where the PR is open or closed unmerged', () => {
    expect(viewLanded({ state: 'OPEN', mergedAt: null })).toBe('not-landed');
    expect(viewLanded({ state: 'CLOSED', mergedAt: null })).toBe('not-landed');
  });

  it('says not-landed where the host holds no PR by that number', () => {
    expect(viewLanded(null)).toBe('not-landed');
  });

  it('says unknown, never landed, where the lookup did not answer', () => {
    expect(viewLanded('unanswered')).toBe('unknown');
  });
});

describe('blockingBranches', () => {
  const line = (branch: string, deferred = false) => ({ branch, deferred });
  const none = () => false;

  it('names the unsettled branches of the first slice that is not complete', () => {
    const slices = [[line('feature/a')], [line('feature/b'), line('feature/c')], [line('feature/d')]];
    expect(blockingBranches('approved', slices, (b) => b === 'feature/a' || b === 'feature/c')).toEqual([
      'feature/b',
    ]);
  });

  it('skips deferred branches', () => {
    expect(blockingBranches('approved', [[line('feature/a', true), line('feature/b')]], none)).toEqual([
      'feature/b',
    ]);
  });

  it('names nothing for a plan whose slices are all complete', () => {
    expect(blockingBranches('approved', [[line('feature/a')]], () => true)).toEqual([]);
  });

  it('names nothing for an unapproved plan', () => {
    expect(blockingBranches('draft', [[line('feature/a')], [line('feature/b')]], none)).toEqual([]);
  });

  it('names nothing where the first incomplete slice names no branch', () => {
    expect(blockingBranches('approved', [[], [line('feature/b')]], none)).toEqual([]);
  });

  it('names nothing for a finished plan', () => {
    expect(blockingBranches('delivered', [[line('feature/a')]], none)).toEqual([]);
  });
});

describe('VIEWS_PER_PASS', () => {
  it('bounds a pass to five lookups by number', () => {
    expect(VIEWS_PER_PASS).toBe(5);
  });
});
