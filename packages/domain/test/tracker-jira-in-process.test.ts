import { describe, expect, it } from 'vitest';

import { JIRA_NO_CREDENTIALS, type JiraApi, type JiraRequest } from '../src/adapters/tracker/jira-api.js';
import { trackerJira } from '../src/adapters/tracker/tracker-jira.js';
import { jiraIssueRow } from '../src/rules/jira-issue-row.js';
import { jiraProjects, jiraQuery, jiraRelativeMinutes } from '../src/rules/jira-jql.js';

/** Every script path is absent: a read that started a process would fail, so an answer proves none started. */
const context = { repoRoot: '/nonexistent', scriptDir: '/nonexistent' };

const NOW = Date.parse('2026-11-12T12:00:00Z');

type Reply = { ok: true; body: unknown } | { ok: false; said: string };

/** A client answering each request from the next reply; the last reply repeats. */
const fakeApi = (replies: Reply[], over: Partial<JiraApi> = {}): { api: JiraApi; requests: JiraRequest[] } => {
  const requests: JiraRequest[] = [];
  const api: JiraApi = {
    base: 'https://jira.example',
    credentialSource: () => ({ kind: 'environment' }),
    account: () => 'jira:0123456789ab',
    request: async (request) => {
      requests.push(request);
      const reply = replies[Math.min(requests.length - 1, replies.length - 1)] as Reply;
      if (!reply.ok) return { ok: false, refusal: { kind: 'failed', said: reply.said }, reply: null };
      return { ok: true, reply: { status: 200, headers: {}, body: reply.body } };
    },
    ...over,
  };
  return { api, requests };
};

const issue = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  fields: { summary: `title ${key}`, created: '2026-11-01T00:00:00.000+0000', status: { name: 'To Do', statusCategory: { name: 'To Do' } }, ...extra },
});

const tracker = (api: JiraApi, ticketPrefixes: string, env: Record<string, string> = {}) =>
  trackerJira(context, 'https://jira.example', { api, ticketPrefixes, env, now: () => NOW });

describe('jiraProjects', () => {
  it('splits on commas, trims and drops empty keys', () => {
    expect(jiraProjects(' AB , ,CD,')).toEqual(['AB', 'CD']);
    expect(jiraProjects(',')).toEqual([]);
    expect(jiraProjects('')).toEqual([]);
  });
});

describe('jiraQuery', () => {
  const base = { projects: ['AB', 'CD'], override: '', nowMs: NOW } as const;

  it('scopes the open read and drops the person clause once a scope exists', () => {
    expect(jiraQuery({ ...base, state: 'open' })).toMatchObject({ jql: 'resolution = EMPTY AND project IN (AB, CD) ORDER BY created DESC' });
    expect(jiraQuery({ ...base, projects: [], state: 'open' })).toMatchObject({
      jql: 'assignee = currentUser() AND resolution = EMPTY ORDER BY created DESC',
    });
  });

  it('keeps the person clause on the inbox', () => {
    expect(jiraQuery({ ...base, state: 'inbox' })).toMatchObject({
      jql: 'assignee = currentUser() AND resolution = EMPTY AND project IN (AB, CD) ORDER BY created DESC',
    });
  });

  it('lets PLOT_JIRA_JQL replace the open and inbox queries and no other', () => {
    const override = 'project = X';
    expect(jiraQuery({ ...base, state: 'open', override })).toMatchObject({ jql: override });
    expect(jiraQuery({ ...base, state: 'inbox', override })).toMatchObject({ jql: override });
    expect(jiraQuery({ ...base, state: 'closed', since: '2026-11-01', override })).toMatchObject({
      jql: 'resolved >= "2026-11-01" AND project IN (AB, CD) ORDER BY resolved DESC',
    });
    expect(jiraQuery({ ...base, state: 'changed', since: '2026-11-12T11:00:00Z', override })).toMatchObject({
      jql: 'updated >= "-65m" AND project IN (AB, CD) ORDER BY updated DESC',
    });
  });

  it('sends the closed time to the minute, and the date alone for a date-only since', () => {
    expect(jiraQuery({ ...base, state: 'closed', since: '2026-11-01T08:30:45Z' })).toMatchObject({
      jql: 'resolved >= "2026-11-01 08:30" AND project IN (AB, CD) ORDER BY resolved DESC',
      fields: 'summary,created,status,assignee,issuetype,fixVersions,resolutiondate',
    });
  });

  it('refuses an unscoped closed or changed read', () => {
    expect(jiraQuery({ ...base, projects: [], state: 'closed', since: '2026-11-01' })).toEqual({ ok: false, refusal: 'unscoped' });
    expect(jiraQuery({ ...base, projects: [], state: 'changed', since: '2026-11-01' })).toEqual({ ok: false, refusal: 'unscoped' });
  });

  it('refuses a since outside the date shape', () => {
    expect(jiraQuery({ ...base, state: 'closed', since: 'yesterday' })).toEqual({ ok: false, refusal: 'since' });
  });

  it('computes relative minutes with the skew and the floor', () => {
    expect(jiraRelativeMinutes('2026-11-12T11:00:00Z', NOW)).toBe(65);
    expect(jiraRelativeMinutes('2026-11-12T11:59:30Z', NOW)).toBe(6);
    expect(jiraRelativeMinutes('2026-11-12T13:00:00Z', NOW)).toBe(5);
    expect(jiraRelativeMinutes('2026-11-12', NOW)).toBe(12 * 60 + 5);
  });
});

describe('jiraIssueRow', () => {
  it('prefers the e-mail address and falls back to the account id', () => {
    const row = (assignee: unknown) => jiraIssueRow({ key: 'AB-1', fields: { assignee } as never }, 'https://j', 'open').assignees;
    expect(row({ emailAddress: 'a@b.c', accountId: 'x' })).toEqual(['a@b.c']);
    expect(row({ accountId: 'x' })).toEqual(['x']);
    expect(row(null)).toEqual([]);
  });

  it('adds closedAt to a closed row, and to a changed row only when Done', () => {
    const done = { key: 'AB-1', fields: { status: { name: 'Done', statusCategory: { name: 'Done' } }, resolutiondate: 'R' } };
    expect(jiraIssueRow(done, 'https://j', 'closed').closedAt).toBe('R');
    expect(jiraIssueRow(done, 'https://j', 'changed').closedAt).toBe('R');
    expect(jiraIssueRow(issue('AB-2'), 'https://j', 'changed').closedAt).toBeUndefined();
    expect(jiraIssueRow(issue('AB-2'), 'https://j', 'open').closedAt).toBeUndefined();
  });
});

describe('trackerJira with a client', () => {
  it('answers the spender and the project scope with no process', async () => {
    const { api, requests } = fakeApi([{ ok: true, body: { issues: [] } }]);
    const jira = tracker(api, 'AB, CD');
    const spender = await jira.spender();
    expect(spender).toEqual({ ok: true, value: { connector: 'jira', account: 'jira:0123456789ab' } });
    const changed = await jira.issueListChanged('2026-11-12T11:00:00Z', 10);
    expect(changed.ok).toBe(true);
    expect(requests[0]?.query?.jql).toBe('updated >= "-65m" AND project IN (AB, CD) ORDER BY updated DESC');
  });

  it('reads PLOT_TICKET_PREFIXES over the config value', async () => {
    const { api, requests } = fakeApi([{ ok: true, body: { issues: [] } }]);
    await tracker(api, 'AB', { PLOT_TICKET_PREFIXES: 'ZZ' }).issueListOpen(10);
    expect(requests[0]?.query?.jql).toContain('project IN (ZZ)');
  });

  it('keeps an empty list, a failed request and unaskable apart', async () => {
    const empty = await tracker(fakeApi([{ ok: true, body: { issues: [] } }]).api, 'AB').issueListOpen(10);
    expect(empty).toEqual({ ok: true, value: { issues: [], complete: true, pages: 1 } });

    const refused = tracker(fakeApi([{ ok: false, said: 'HTTP 500: boom' }]).api, 'AB');
    expect(await refused.issueListOpen(10)).toEqual({ ok: false, why: 'failed' });
    expect(refused.lastRefusal()).toBe('HTTP 500: boom');

    const unscoped = tracker(fakeApi([]).api, '');
    const closed = await unscoped.issueListClosed('2026-11-01', 10);
    expect(closed).toMatchObject({ ok: false, why: 'unaskable' });
    expect(JSON.stringify(closed)).toContain('closed Jira issues need');
    expect(unscoped.lastRefusal()).toBeNull();
  });

  it('refuses an unscoped closed or changed read before any request, and answers a scoped one', async () => {
    const none = fakeApi([{ ok: true, body: { issues: [] } }]);
    const unscoped = tracker(none.api, '');
    expect((await unscoped.issueListClosed('2026-11-01', 10)).ok).toBe(false);
    expect((await unscoped.issueListChanged('2026-11-01', 10)).ok).toBe(false);
    expect(none.requests).toHaveLength(0);

    const scoped = fakeApi([{ ok: true, body: { issues: [issue('AB-1')] } }]);
    const closed = await tracker(scoped.api, 'AB').issueListClosed('2026-11-01', 10);
    expect(closed.ok).toBe(true);
    expect(scoped.requests[0]?.query?.jql).toBe('resolved >= "2026-11-01" AND project IN (AB) ORDER BY resolved DESC');
  });

  it('answers failed, not an empty list, where no credentials resolve', async () => {
    const { api, requests } = fakeApi([{ ok: true, body: { issues: [] } }], { credentialSource: () => null });
    const jira = tracker(api, 'AB');
    expect(await jira.issueListOpen(10)).toEqual({ ok: false, why: 'failed' });
    expect(jira.lastRefusal()).toBe(JIRA_NO_CREDENTIALS);
    expect(requests).toHaveLength(0);
  });

  it('follows nextPageToken and reports the pages', async () => {
    const { api, requests } = fakeApi([
      { ok: true, body: { issues: [issue('AB-1'), issue('AB-2')], nextPageToken: 'T2' } },
      { ok: true, body: { issues: [issue('AB-3')] } },
    ]);
    const read = await tracker(api, 'AB').issueListOpen(10);
    expect(read).toMatchObject({ ok: true, value: { complete: true, pages: 2 } });
    expect(read.ok && read.value.issues.map((one) => one.id)).toEqual(['AB-1', 'AB-2', 'AB-3']);
    expect(requests[0]?.query?.nextPageToken).toBeUndefined();
    expect(requests[1]?.query?.nextPageToken).toBe('T2');
    expect(requests[1]?.query?.maxResults).toBe('8');
  });

  it('is incomplete at the limit and stops on a repeated token', async () => {
    const atLimit = await tracker(fakeApi([{ ok: true, body: { issues: [issue('AB-1'), issue('AB-2')], nextPageToken: 'T' } }]).api, 'AB').issueListOpen(2);
    expect(atLimit).toMatchObject({ ok: true, value: { complete: false } });

    const looping = fakeApi([{ ok: true, body: { issues: [issue('AB-1')], nextPageToken: 'T' } }]);
    const read = await tracker(looping.api, 'AB').issueListOpen(50);
    expect(read).toMatchObject({ ok: true, value: { complete: false } });
    expect(looping.requests).toHaveLength(2);
  });

  it('fails the whole read where a later page is refused', async () => {
    const { api } = fakeApi([
      { ok: true, body: { issues: [issue('AB-1')], nextPageToken: 'T2' } },
      { ok: false, said: 'HTTP 400: bad token' },
    ]);
    expect(await tracker(api, 'AB').issueListOpen(10)).toEqual({ ok: false, why: 'failed' });
  });

  it('sends PLOT_JIRA_JQL for the open read when set, and the built query when unset', async () => {
    const set = fakeApi([{ ok: true, body: { issues: [] } }]);
    await tracker(set.api, 'AB', { PLOT_JIRA_JQL: 'project = X' }).issueListOpen(10);
    expect(set.requests[0]?.query?.jql).toBe('project = X');
    const unset = fakeApi([{ ok: true, body: { issues: [] } }]);
    await tracker(unset.api, 'AB').issueListOpen(10);
    expect(unset.requests[0]?.query?.jql).toBe('resolution = EMPTY AND project IN (AB) ORDER BY created DESC');
  });

  it('keeps the inbox gate on a declared project', async () => {
    const { api, requests } = fakeApi([{ ok: true, body: { issues: [] } }]);
    expect(await tracker(api, '').issueListInbox(10)).toMatchObject({ ok: false, why: 'unaskable' });
    expect(requests).toHaveLength(0);
    await tracker(api, 'AB').issueListInbox(10);
    expect(requests[0]?.query?.jql).toBe('assignee = currentUser() AND resolution = EMPTY AND project IN (AB) ORDER BY created DESC');
  });
});
