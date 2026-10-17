import { describe, it, expect } from 'vitest';
import type { Issue } from '../src/entities/issue.js';
import { findOpenReviewIssue, reviewIssueTitle } from '../src/rules/review-issue.js';

const issue = (id: string, title: string): Issue => ({
  id, title, url: '', createdAt: null, body: null, status: 'open', statusCategory: 'To Do', closedAt: null,
} as Issue);

describe('reviewIssueTitle', () => {
  it('names the HIGH count, singular and plural', () => {
    expect(reviewIssueTitle(7, { high: 1, medium: 0, low: 0 })).toBe('plot-review: 1 HIGH finding on PR #7');
    expect(reviewIssueTitle(7, { high: 2, medium: 1, low: 0 })).toBe('plot-review: 2 HIGH findings on PR #7');
  });

  it('names MEDIUM and LOW when there is no HIGH', () => {
    expect(reviewIssueTitle(7, { high: 0, medium: 1, low: 3 })).toBe('plot-review: MEDIUM 1, LOW 3 on PR #7');
  });
});

describe('findOpenReviewIssue', () => {
  it('matches both title shapes, so counts that change between heads still match', () => {
    const issues = [issue('5', reviewIssueTitle(7, { high: 0, medium: 0, low: 1 }))];
    expect(findOpenReviewIssue(issues, 7)?.id).toBe('5');
    expect(findOpenReviewIssue([issue('6', reviewIssueTitle(7, { high: 2, medium: 0, low: 0 }))], 7)?.id).toBe('6');
  });

  it('does not match PR #1 against PR #12', () => {
    expect(findOpenReviewIssue([issue('5', reviewIssueTitle(12, { high: 0, medium: 0, low: 1 }))], 1)).toBeNull();
    expect(findOpenReviewIssue([issue('5', reviewIssueTitle(1, { high: 0, medium: 0, low: 1 }))], 12)).toBeNull();
  });

  it('does not match a title without the plot-review prefix', () => {
    expect(findOpenReviewIssue([issue('5', 'follow up on PR #7')], 7)).toBeNull();
  });

  it('answers null for no issues', () => {
    expect(findOpenReviewIssue([], 7)).toBeNull();
  });
});
