import { describe, it, expect } from 'vitest';
import { reviewIssueUrl } from '../src/adapters/tracker/tracker-issue-url.js';

describe('reviewIssueUrl', () => {
  it('composes a Jira key against the tracker address', () => {
    expect(reviewIssueUrl('jira', 'https://j.example/', 'PROJ-12', 'https://github.com/o/r/pull/3')).toBe(
      'https://j.example/browse/PROJ-12',
    );
  });

  it('composes a GitHub issue from the PR URL', () => {
    expect(reviewIssueUrl('github-issues', '', '41', 'https://github.com/o/r/pull/3')).toBe(
      'https://github.com/o/r/issues/41',
    );
  });

  it('answers null where nothing composes', () => {
    expect(reviewIssueUrl('jira', '', 'PROJ-12', 'https://github.com/o/r/pull/3')).toBeNull();
    expect(reviewIssueUrl('github-issues', '', 'abc', 'https://github.com/o/r/pull/3')).toBeNull();
    expect(reviewIssueUrl('github-issues', '', '41', '')).toBeNull();
  });
});
