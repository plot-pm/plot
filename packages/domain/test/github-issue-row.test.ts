import { describe, expect, it } from 'vitest';

import { githubIssueRow } from '../src/rules/github-issue-row.js';
import { runsForShaOf } from '../src/rules/runs-for-sha.js';

describe('githubIssueRow projects an exported issue as the issue-list arm prints it', () => {
  it('an open read takes the asked state, and carries no closedAt, labels, updatedAt or type', () => {
    expect(
      githubIssueRow(
        { number: 7, title: 'T', url: 'u', createdAt: 'c', assignees: [{ login: 'ada' }, {}], issueType: null, milestone: null },
        'open',
      ),
    ).toEqual({ number: 7, title: 'T', url: 'u', createdAt: 'c', status: 'open', statusCategory: 'To Do', assignees: ['ada', null], releases: [] });
  });

  it('a closed read adds closedAt, an empty one where GitHub said null, and the label names', () => {
    expect(githubIssueRow({ number: 1, title: 'T', closedAt: null, labels: [{ name: 'bug' }, {}] }, 'closed')).toEqual({
      number: 1, title: 'T', url: '', createdAt: '', status: 'closed', statusCategory: 'Done', assignees: [], releases: [], closedAt: '', labels: ['bug', null],
    });
    expect(githubIssueRow({ number: 1, title: 'T', closedAt: 'z', labels: null }, 'closed').closedAt).toBe('z');
  });

  it("a changed read reads each row's own state, in lower case, and keeps updatedAt", () => {
    const open = githubIssueRow({ number: 2, title: 'T', state: 'OPEN', updatedAt: 'u', closedAt: null }, 'changed');
    expect(open).toMatchObject({ status: 'open', statusCategory: 'To Do', updatedAt: 'u' });
    expect(open).not.toHaveProperty('closedAt');
    expect(githubIssueRow({ number: 3, title: 'T', state: 'CLOSED', updatedAt: null, closedAt: 'c' }, 'changed')).toMatchObject({ status: 'closed', closedAt: 'c' });
  });

  it('an empty state is kept, as jq keeps an empty string, and reads Done', () => {
    expect(githubIssueRow({ number: 4, title: 'T', state: '' }, 'changed')).toMatchObject({ status: '', statusCategory: 'Done' });
  });

  it('a milestone title and an issue type name are taken where jq reads them as true', () => {
    expect(githubIssueRow({ number: 5, title: 'T', milestone: { title: 'v1' }, issueType: { name: 'Bug' } }, 'open')).toMatchObject({ releases: ['v1'], type: 'Bug' });
    const empty = githubIssueRow({ number: 5, title: 'T', milestone: { title: '' }, issueType: { name: '' } }, 'open');
    expect(empty).toMatchObject({ releases: [''], type: '' });
    const none = githubIssueRow({ number: 5, title: 'T', milestone: { title: null }, issueType: { name: false } }, 'open');
    expect(none.releases).toEqual([]);
    expect(none).not.toHaveProperty('type');
  });
});

describe('runsForShaOf picks every run for one commit, newest first', () => {
  const run = (headSha: string, conclusion: string | null, workflowName?: string | null) => ({
    headSha, conclusion, status: 'completed', startedAt: 's', url: `u-${headSha}`, databaseId: 1, ...(workflowName === undefined ? {} : { workflowName }),
  });

  it('keeps the listing order and drops a run for any other commit', () => {
    expect(runsForShaOf([run('a', 'success', 'CI'), run('b', 'failure', 'CI'), run('a', 'failure', 'Board')], 'a')).toEqual([
      { sha: 'a', workflow: 'CI', status: 'completed', conclusion: 'success', url: 'u-a', startedAt: 's' },
      { sha: 'a', workflow: 'Board', status: 'completed', conclusion: 'failure', url: 'u-a', startedAt: 's' },
    ]);
  });

  it('reads an empty or null conclusion as null, and a missing workflow name as empty', () => {
    expect(runsForShaOf([run('a', ''), run('a', null, null)], 'a').map((one) => [one.conclusion, one.workflow])).toEqual([[null, ''], [null, '']]);
  });

  it('answers [] where no run names the commit', () => {
    expect(runsForShaOf([run('b', 'success')], 'a')).toEqual([]);
  });
});
