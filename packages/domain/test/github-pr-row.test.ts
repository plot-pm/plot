import { describe, expect, it } from 'vitest';

import { checkWord, checksOf, ciChecksOf, colourOf, jqOr } from '../src/rules/checks-of.js';
import { githubPlainRow, githubRichRow, isTerminalRow, withAbsentVerdicts } from '../src/rules/github-pr-row.js';
import { mergeableOf } from '../src/rules/mergeable-of.js';

describe('checkWord', () => {
  it('reads a finished item by its conclusion', () => {
    expect(checkWord({ status: 'COMPLETED', conclusion: 'SUCCESS' })).toBe('ok');
    expect(checkWord({ conclusion: 'SKIPPED' })).toBe('ok');
    expect(checkWord({ status: 'COMPLETED', conclusion: 'ACTION_REQUIRED' })).toBe('bad');
  });

  it('reads an unfinished status, or else state, as wait', () => {
    expect(checkWord({ status: 'IN_PROGRESS', conclusion: 'SUCCESS' })).toBe('wait');
    expect(checkWord({ state: 'EXPECTED' })).toBe('wait');
    expect(checkWord({})).toBe('wait');
  });

  it('reads a status context by its state', () => {
    expect(checkWord({ state: 'SUCCESS' })).toBe('ok');
    expect(checkWord({ state: 'ERROR' })).toBe('bad');
    expect(checkWord({ status: 'COMPLETED' })).toBe('bad');
  });

  it('reads null and false as jq does, as absent', () => {
    expect(jqOr(false, 'x')).toBe('x');
    expect(jqOr(null, 'x')).toBe('x');
    expect(jqOr('', 'x')).toBe('');
    expect(checkWord({ status: null, conclusion: false, state: 'SUCCESS' })).toBe('ok');
  });
});

describe('colourOf, checksOf and ciChecksOf', () => {
  it('folds no item to none, a bad one to failing, a waiting one to pending, and the rest to green', () => {
    expect(colourOf([])).toBe('none');
    expect(colourOf([{ state: 'SUCCESS' }, { state: 'ERROR' }, { state: 'PENDING' }])).toBe('failing');
    expect(colourOf([{ state: 'SUCCESS' }, { state: 'PENDING' }])).toBe('pending');
    expect(colourOf([{ state: 'SUCCESS' }])).toBe('green');
    expect(checksOf(null)).toBe('none');
    expect(checksOf(undefined)).toBe('none');
  });

  it('leaves the plot/review item out of ciChecks by context or by name', () => {
    expect(ciChecksOf([{ context: 'plot/review', state: 'FAILURE' }, { state: 'SUCCESS', context: 'ci' }])).toBe('green');
    expect(ciChecksOf([{ name: 'plot/review', status: 'COMPLETED', conclusion: 'FAILURE' }])).toBe('none');
    expect(ciChecksOf(null)).toBe('none');
  });
});

describe('mergeableOf', () => {
  it('reads conflicting from either transport, then mergeable, then unknown', () => {
    expect(mergeableOf({ mergeable: 'CONFLICTING' })).toBe('conflicting');
    expect(mergeableOf({ mergeable: false })).toBe('conflicting');
    expect(mergeableOf({ mergeable: 'MERGEABLE', mergeStateStatus: 'DIRTY' })).toBe('conflicting');
    expect(mergeableOf({ mergeable: true, mergeable_state: 'dirty' })).toBe('conflicting');
    expect(mergeableOf({ mergeable: 'MERGEABLE' })).toBe('mergeable');
    expect(mergeableOf({ mergeable: true })).toBe('mergeable');
    expect(mergeableOf({ mergeable: 'UNKNOWN' })).toBe('unknown');
    expect(mergeableOf({})).toBe('unknown');
  });
});

const PR = {
  number: 7,
  title: 'Seven',
  state: 'OPEN',
  headRefName: 'feature/seven',
  isDraft: false,
  url: 'https://github.com/o/r/pull/7',
  updatedAt: '2026-11-01T00:00:00Z',
  author: { login: 'dev' },
  headRefOid: 'abc',
  mergedAt: null,
};

describe('githubPlainRow', () => {
  it('projects the plain fields and reads absent ones as jq does', () => {
    expect(githubPlainRow(PR)).toEqual({
      number: 7, title: 'Seven', state: 'OPEN', head: 'feature/seven', draft: false, url: PR.url,
      updatedAt: '2026-11-01T00:00:00Z', headSha: 'abc', mergedAt: '', author: 'dev',
    });
    expect(githubPlainRow({ author: null })).toEqual({
      number: null, title: null, state: null, head: null, draft: null, url: null, updatedAt: '', headSha: '', mergedAt: '', author: '',
    });
  });
});

describe('githubRichRow', () => {
  it('adds the verdicts, the failing names and the plot/review fields', () => {
    const row = githubRichRow({
      ...PR,
      mergeable: 'MERGEABLE',
      reviewDecision: 'APPROVED',
      statusCheckRollup: [
        { name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' },
        { name: '', status: 'COMPLETED', conclusion: 'FAILURE' },
        { context: 'deploy', state: 'ERROR' },
        { context: 'plot/review', state: 'SUCCESS', startedAt: '2026-11-02T00:00:00Z' },
        { context: 'plot/review', state: 'PENDING' },
      ],
    });
    expect(row).toMatchObject({
      checks: 'failing', ciChecks: 'failing', mergeable: 'mergeable', review: 'APPROVED', checksSha: 'abc',
      failing_checks: ['test', 'deploy'], plotReview: 'success', plotReviewSha: 'abc', plotReviewAt: '2026-11-02T00:00:00Z',
    });
  });

  it('answers plotReview absent where no item names plot/review, and empty words where the item carries none', () => {
    expect(githubRichRow({ ...PR, statusCheckRollup: null, reviewDecision: null })).toMatchObject({
      checks: 'none', ciChecks: 'none', review: '', failing_checks: [], plotReview: 'absent', mergeable: 'unknown',
    });
    expect(githubRichRow({ ...PR, headRefOid: null, statusCheckRollup: [{ context: 'plot/review' }] })).toMatchObject({
      plotReview: '', plotReviewSha: '', plotReviewAt: '', checksSha: '',
    });
  });
});

describe('the terminal rows of a rich-open listing', () => {
  it('reads MERGED and CLOSED as terminal and adds the absent verdicts', () => {
    expect([isTerminalRow({ state: 'MERGED' }), isTerminalRow({ state: 'CLOSED' }), isTerminalRow({ state: 'OPEN' })]).toEqual([true, true, false]);
    expect(withAbsentVerdicts({ number: 1 })).toEqual({ number: 1, checks: 'unknown', mergeable: 'unknown', review: '', failing_checks: [] });
  });
});
