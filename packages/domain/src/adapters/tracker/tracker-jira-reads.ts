import { ISSUE_PAGE_ROWS } from '../../entities/issue-index.js';
import type { Issue } from '../../entities/issue.js';
import { answered, failed, unaskable, type PortResult } from '../../port-result.js';
import type { ClosedIssues, IssueRead } from '../../ports/tracker.js';
import { jiraIssueRow, type JiraIssue } from '../../rules/jira-issue-row.js';
import { jiraPageSize, jiraQuery, type JiraReadState } from '../../rules/jira-jql.js';
import { JIRA_NO_BASE_URL, JIRA_NO_CREDENTIALS, type JiraApi } from './jira-api.js';
import { issueOf, newestCloseFirst } from './tracker-shell.js';

/** The reads {@link trackerJira} sends in-process where it is given a client. */
export interface JiraInProcessReads {
  issueListOpen(limit: number): Promise<PortResult<IssueRead>>;
  issueListClosed(since: string, limit: number): Promise<PortResult<ClosedIssues>>;
  issueListChanged(since: string, limit: number): Promise<PortResult<IssueRead>>;
  issueListInbox(limit: number): Promise<PortResult<IssueRead>>;
}

/** What {@link jiraInProcessReads} reads besides the client. */
export interface JiraInProcessInput {
  /** The in-process client. */
  readonly api: JiraApi;
  /** The `Ticket prefixes` project keys, already split. */
  readonly projects: readonly string[];
  /** The value of `PLOT_JIRA_JQL`, or `''` where unset. */
  readonly override: string;
  /** The clock, epoch milliseconds. */
  readonly now: () => number;
  /** Keeps the refusal of the read: a sentence, or null where the read answered or cannot be asked. */
  readonly refuse: (said: string | null) => void;
}

/** One page of the search endpoint's answer. */
interface SearchPage {
  readonly issues?: readonly JiraIssue[] | null;
  readonly nextPageToken?: string | null;
}

/** The sentence of a closed or changed read with no project declared. */
const unscopedSentence = (state: JiraReadState): string =>
  `${state} Jira issues need 'Ticket prefixes' declared; an unscoped ${state} query reads the whole instance`;

/**
 * The four Jira issue reads over the in-process client.
 *
 * Each answers what `trackerReads` answers from `plot-host.sh issue-list` for
 * the same call, and `corpus/jira-issue-reads.corpus.test.ts` holds the two to
 * one answer: the query through `jiraQuery`, one `GET /rest/api/2/search/jql`
 * per page, the rows through `jiraIssueRow` and `issueOf`, and the page loop
 * of the shell's `walk`. A read with no base URL or no credentials answers
 * `failed` and sends nothing, and a closed or changed read with no project
 * answers `unaskable` and sends nothing. A refused page fails the whole read,
 * because the rows before it would pass for the end of the list. An empty list
 * is an answer.
 *
 * @param input - the client, the projects, the override, the clock and the refusal sink.
 * @returns the four reads.
 */
export const jiraInProcessReads = (input: JiraInProcessInput): JiraInProcessReads => {
  const { api, projects, override, now, refuse } = input;

  const configRefusal = (): string | null => {
    if (api.base === '') return JIRA_NO_BASE_URL;
    if (api.credentialSource() === null) return JIRA_NO_CREDENTIALS;
    return null;
  };

  const read = async (state: JiraReadState, since: string | undefined, limit: number): Promise<PortResult<IssueRead>> => {
    const query = jiraQuery({ state, ...(since === undefined ? {} : { since }), projects, override, nowMs: now() });
    if (!query.ok && query.refusal === 'since') {
      refuse(`--since must be an ISO-8601 date or time, got '${since ?? ''}'`);
      return failed();
    }
    const config = configRefusal();
    if (config !== null) {
      refuse(config);
      return failed();
    }
    if (!query.ok) {
      refuse(null);
      return unaskable(unscopedSentence(state));
    }
    const issues: Issue[] = [];
    const seen = new Set<string>();
    let token: string | null = null;
    let calls = 0;
    while (issues.length < limit) {
      const page = await api.request({
        method: 'GET',
        path: '/rest/api/2/search/jql',
        query: {
          jql: query.jql,
          fields: query.fields,
          maxResults: String(jiraPageSize(limit - issues.length)),
          ...(token === null ? {} : { nextPageToken: token }),
        },
        label: `${state} issues${calls === 0 ? '' : `, page ${calls + 1}`}`,
      });
      calls += 1;
      if (!page.ok) {
        refuse(page.refusal.said);
        return failed();
      }
      const body = (typeof page.reply.body === 'object' && page.reply.body !== null ? page.reply.body : {}) as SearchPage;
      const rows = (body.issues ?? []).map((one) => issueOf(jiraIssueRow(one, api.base, state) as Parameters<typeof issueOf>[0], false));
      issues.push(...rows);
      token = typeof body.nextPageToken === 'string' && body.nextPageToken !== '' ? body.nextPageToken : null;
      if (token === null || rows.length === 0 || seen.has(token)) break;
      seen.add(token);
    }
    refuse(null);
    const kept = issues.slice(0, limit);
    return answered({
      issues: kept,
      complete: token === null && issues.length < limit,
      pages: Math.max(1, calls, Math.ceil(kept.length / ISSUE_PAGE_ROWS)),
    });
  };

  return {
    issueListOpen: (limit) => read('open', undefined, limit),
    issueListClosed: async (since, limit) => {
      const closed = await read('closed', since, limit);
      return closed.ok ? answered({ ...closed.value, issues: newestCloseFirst(closed.value.issues) }) : closed;
    },
    issueListChanged: (since, limit) => read('changed', since, limit),
    issueListInbox: (limit) => read('inbox', undefined, limit),
  };
};
