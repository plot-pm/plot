import { describe, it, expect } from 'vitest';
import type { Issue } from '../src/entities/issue.js';
import { findOpenReviewIssue, reviewIssue, reviewIssueTitle } from '../src/rules/review-issue.js';

const issue = (id: string, title: string): Issue => ({
  id, title, url: '', createdAt: null, body: null, status: 'open', statusCategory: 'To Do', closedAt: null,
} as Issue);

describe('reviewIssue', () => {
  it.each([
    ['HIGH alone', { high: 1, medium: 0, low: 0 }],
    ['MEDIUM alone', { high: 0, medium: 1, low: 0 }],
    ['LOW alone', { high: 0, medium: 0, low: 1 }],
    ['a mix of all three', { high: 2, medium: 1, low: 3 }],
    ['all zero', { high: 0, medium: 0, low: 0 }],
  ])('answers none for %s', (_name, counts) => {
    expect(reviewIssue(counts)).toBe('none');
  });
});

describe('reviewIssueTitle', () => {
  it('names the PR and no counts, so a later head cannot contradict it', () => {
    expect(reviewIssueTitle(7)).toBe('plot-review: findings on PR #7');
  });
});

describe('findOpenReviewIssue', () => {
  it('matches the current title and the counted titles of issues opened before it', () => {
    expect(findOpenReviewIssue([issue('5', reviewIssueTitle(7))], 7)?.id).toBe('5');
    expect(findOpenReviewIssue([issue('6', 'plot-review: 2 HIGH findings on PR #7')], 7)?.id).toBe('6');
    expect(findOpenReviewIssue([issue('8', 'plot-review: MEDIUM 0, LOW 1 on PR #7')], 7)?.id).toBe('8');
  });

  it('does not match PR #1 against PR #12', () => {
    expect(findOpenReviewIssue([issue('5', reviewIssueTitle(12))], 1)).toBeNull();
    expect(findOpenReviewIssue([issue('5', reviewIssueTitle(1))], 12)).toBeNull();
  });

  it('does not match a title without the plot-review prefix', () => {
    expect(findOpenReviewIssue([issue('5', 'follow up on PR #7')], 7)).toBeNull();
  });

  it('answers null for no issues', () => {
    expect(findOpenReviewIssue([], 7)).toBeNull();
  });
});
