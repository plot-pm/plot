import { describe, expect, it } from 'vitest';

import type { PrIndexRow } from '../src/entities/pr-index.js';
import { mapsOfRows, prOutranks, prRecordOf, type PrRecord } from '../src/rules/pr-maps.js';

const row = (over: Partial<PrIndexRow>): PrIndexRow => ({
  number: 1,
  head: 'feature/x',
  state: 'OPEN',
  draft: false,
  checks: 'green',
  review: '',
  url: 'u',
  ...over,
});

describe('prRecordOf', () => {
  it('copies the required fields and leaves out every field the row omits', () => {
    expect(prRecordOf(row({}))).toEqual({ number: 1, head: 'feature/x', state: 'OPEN', draft: false, checks: 'green', review: '', url: 'u' });
  });

  it('copies every optional field the row holds', () => {
    const full = row({
      mergeable: 'mergeable',
      failing_checks: ['ci'],
      updatedAt: 'u1',
      author: 'a',
      headSha: 'h',
      headSince: 's',
      checksSha: 'c',
      checksLookup: 'skipped',
      mergedAt: 'm',
      plotReview: 'success',
      plotReviewSha: 'p',
      plotReviewAt: 'pa',
      ciChecks: 'green',
      plotReviewJudged: 'success',
      plotReviewCheckedSha: 'pc',
      plotReviewCheckedAt: 'pca',
    });
    expect(prRecordOf(full)).toEqual(full);
  });
});

describe('prOutranks', () => {
  const pr = (number: number, state: string): PrRecord => ({ number, head: 'h', state, draft: false, checks: '', review: '', url: '' });

  it('ranks an open PR above a closed one whatever the numbers', () => {
    expect(prOutranks(pr(1, 'OPEN'), pr(9, 'CLOSED'))).toBe(true);
    expect(prOutranks(pr(9, 'CLOSED'), pr(1, 'OPEN'))).toBe(false);
  });

  it('ranks the higher number where both stand alike', () => {
    expect(prOutranks(pr(2, 'MERGED'), pr(1, 'CLOSED'))).toBe(true);
    expect(prOutranks(pr(1, 'OPEN'), pr(2, 'OPEN'))).toBe(false);
  });
});

describe('mapsOfRows', () => {
  it('keys open PRs by head, every PR by number, and the outranking PR per head', () => {
    const maps = mapsOfRows([
      row({ number: 3, state: 'CLOSED' }),
      row({ number: 4 }),
      row({ number: 5, state: 'MERGED' }),
      row({ number: 6, head: '' }),
    ]);
    expect([...maps.prs.entries()].map(([head, pr]) => [head, pr.number])).toEqual([['feature/x', 4]]);
    expect([...maps.byNumber.keys()]).toEqual([3, 4, 5, 6]);
    expect([...maps.byHead.entries()].map(([head, pr]) => [head, pr.number])).toEqual([['feature/x', 4]]);
  });
});
