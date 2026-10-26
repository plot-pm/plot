import { describe, expect, it } from 'vitest';
import { PR_INDEX_VERSION, decodePrIndex, type PrIndex, type PrIndexRow } from '../src/entities/pr-index.js';
import {
  MERGED_DELTA_OVERLAP_MS,
  VIEWS_PER_PASS,
  blockingBranches,
  indexMergedHeads,
  knownPrFor,
  landedSource,
  mergedSetWindowFor,
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

const store = (over: Partial<PrIndex> = {}): PrIndex =>
  ({
    v: PR_INDEX_VERSION,
    connector: 'github',
    watermark: '2026-10-20T12:34:56Z',
    complete: true,
    at: '2026-10-20T12:35:00Z',
    wholeAt: '2026-10-20T11:00:00Z',
    rows: [],
    ...over,
  }) as PrIndex;

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

describe('indexMergedHeads', () => {
  it('names every head with a merged row, in either case', () => {
    const rows = [row(661, 'bug/a', 'MERGED'), row(695, 'feature/b', 'merged')];
    expect([...indexMergedHeads(rows)]).toEqual(['bug/a', 'feature/b']);
  });

  it('names no head whose rows are open, closed or a merged draft', () => {
    const rows = [row(1, 'feature/a', 'OPEN'), row(2, 'feature/b', 'CLOSED'), row(3, 'feature/c', 'MERGED', true)];
    expect([...indexMergedHeads(rows)]).toEqual([]);
  });

  it('names a head once a merged row exists beside its other rows', () => {
    const rows = [row(7, 'feature/a', 'CLOSED'), row(9, 'feature/a', 'MERGED')];
    expect([...indexMergedHeads(rows)]).toEqual(['feature/a']);
  });
});

describe('mergedSetWindowFor', () => {
  it('answers delta with since = watermark - 60s for a current, complete, version-5 store', () => {
    expect(mergedSetWindowFor(store())).toEqual({ kind: 'delta', since: '2026-10-20T12:33:56Z' });
    expect(MERGED_DELTA_OVERLAP_MS).toBe(60_000);
  });

  it('answers full for a null store', () => {
    expect(mergedSetWindowFor(null)).toEqual({ kind: 'full' });
  });

  it('answers full for a store marked incomplete', () => {
    expect(mergedSetWindowFor(store({ complete: false }))).toEqual({ kind: 'full' });
  });

  it('answers full for a null watermark', () => {
    expect(mergedSetWindowFor(store({ watermark: null }))).toEqual({ kind: 'full' });
  });

  it('answers full for an empty watermark', () => {
    expect(mergedSetWindowFor(store({ watermark: '' }))).toEqual({ kind: 'full' });
  });

  it('answers full for an unparseable watermark', () => {
    expect(mergedSetWindowFor(store({ watermark: 'not-a-stamp' }))).toEqual({ kind: 'full' });
  });

  it('treats an old-version store as nothing to start from, via the caller\'s own decode', () => {
    // Mirrors the actual v4 shape fleetd's live store held on this estate —
    // not a hand-rolled null. `decodePrIndex`'s `.strict()` literal on `v`
    // fails this file's parse before the rule ever sees it, so the caller
    // always hands the rule a null here, same as a missing file.
    const v4Text = JSON.stringify({ ...store(), v: 4 });
    expect(mergedSetWindowFor(decodePrIndex(v4Text))).toEqual({ kind: 'full' });
  });

  it('treats an unparseable store file as nothing to start from, via the caller\'s own decode', () => {
    expect(mergedSetWindowFor(decodePrIndex('{not json'))).toEqual({ kind: 'full' });
  });
});

describe('landedSource', () => {
  it('reads a merged index row even where the listing answered whole', () => {
    // #1454: the whole listing is one page of 500 merged PRs, so a branch
    // merged further back is missing from it. The merged row is terminal.
    expect(landedSource(true, { indexMerged: true, number: 3 })).toBe('index');
  });

  it('reads the listing where it answered and the index holds no merged row', () => {
    expect(landedSource(true, { indexMerged: false, number: 3 })).toBe('listing');
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
