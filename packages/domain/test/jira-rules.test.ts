import { describe, expect, it } from 'vitest';

import { jiraIssueRow } from '../src/rules/jira-issue-row.js';
import { jiraPageSize, jiraProjects, jiraQuery, jiraRelativeMinutes } from '../src/rules/jira-jql.js';

const BASE = 'https://example.atlassian.net';

describe('jiraIssueRow', () => {
  it('projects an issue with every field present', () => {
    const row = jiraIssueRow(
      {
        key: 'PLOT-1',
        fields: {
          summary: 'Title',
          created: '2026-11-01T10:00:00.000+0000',
          updated: '2026-11-02T10:00:00.000+0000',
          status: { name: 'Done', statusCategory: { name: 'Done' } },
          assignee: { emailAddress: 'a@example.test', accountId: 'acc-1' },
          issuetype: { name: 'Bug' },
          fixVersions: [{ name: '1.0' }, {}],
        },
      },
      BASE,
      'open',
    );
    expect(row).toEqual({
      number: 'PLOT-1',
      title: 'Title',
      url: `${BASE}/browse/PLOT-1`,
      createdAt: '2026-11-01T10:00:00.000+0000',
      status: 'Done',
      statusCategory: 'Done',
      assignees: ['a@example.test'],
      releases: ['1.0', null],
      type: 'Bug',
      updatedAt: '2026-11-02T10:00:00.000+0000',
    });
  });

  it('falls back to the account id where Jira returns no e-mail address', () => {
    const row = jiraIssueRow({ key: 'PLOT-2', fields: { assignee: { accountId: 'acc-2' } } }, BASE, 'open');
    expect(row.assignees).toEqual(['acc-2']);
  });

  it('reads an assignee with neither address nor id as unassigned', () => {
    const row = jiraIssueRow({ key: 'PLOT-3', fields: { assignee: {} } }, BASE, 'open');
    expect(row.assignees).toEqual([]);
  });

  it('reads an issue with no fields as empty strings and no optional keys', () => {
    expect(jiraIssueRow({ key: 'PLOT-4' }, BASE, 'open')).toEqual({
      number: 'PLOT-4',
      title: '',
      url: `${BASE}/browse/PLOT-4`,
      createdAt: '',
      status: '',
      statusCategory: '',
      assignees: [],
      releases: [],
    });
    expect(jiraIssueRow({ key: 'PLOT-5', fields: null }, BASE, 'open').assignees).toEqual([]);
  });

  it('adds closedAt on every closed row and on a Done changed row only', () => {
    const done = { key: 'PLOT-6', fields: { status: { statusCategory: { name: 'Done' } }, resolutiondate: '2026-11-03' } };
    const open = { key: 'PLOT-7', fields: { status: { statusCategory: { name: 'To Do' } } } };
    expect(jiraIssueRow(done, BASE, 'closed').closedAt).toBe('2026-11-03');
    expect(jiraIssueRow(open, BASE, 'closed').closedAt).toBe('');
    expect(jiraIssueRow(done, BASE, 'changed').closedAt).toBe('2026-11-03');
    expect(jiraIssueRow({ key: 'PLOT-8', fields: { status: { statusCategory: { name: 'Done' } } } }, BASE, 'changed').closedAt).toBe('');
    expect(jiraIssueRow(open, BASE, 'changed')).not.toHaveProperty('closedAt');
    expect(jiraIssueRow(done, BASE, 'inbox')).not.toHaveProperty('closedAt');
  });
});

describe('jiraQuery', () => {
  const nowMs = Date.parse('2026-11-12T12:00:00Z');

  it('refuses a closed or changed read with no since as a since refusal', () => {
    expect(jiraQuery({ state: 'closed', projects: ['A'], override: '', nowMs })).toEqual({ ok: false, refusal: 'since' });
    expect(jiraQuery({ state: 'changed', projects: ['A'], override: '', nowMs })).toEqual({ ok: false, refusal: 'since' });
  });

  it('refuses an unscoped closed or changed read', () => {
    expect(jiraQuery({ state: 'closed', since: '2026-11-01', projects: [], override: '', nowMs })).toEqual({ ok: false, refusal: 'unscoped' });
  });
});

describe('jiraProjects', () => {
  it('trims keys and drops empties', () => {
    expect(jiraProjects(' A, ,B ,')).toEqual(['A', 'B']);
  });
});

describe('jiraRelativeMinutes', () => {
  it('adds the skew and never answers under it', () => {
    expect(jiraRelativeMinutes('2026-11-12T11:00', Date.parse('2026-11-12T12:00:00Z'))).toBe(65);
    expect(jiraRelativeMinutes('2026-11-13', Date.parse('2026-11-12T12:00:00Z'))).toBe(5);
  });
});

describe('jiraPageSize', () => {
  it('asks the rows wanted up to one page', () => {
    expect(jiraPageSize(30)).toBe(30);
    expect(jiraPageSize(100)).toBe(100);
    expect(jiraPageSize(250)).toBe(100);
  });
});
