import type { HostRefusal } from '../../ports/host.js';
import type { GhIssue } from '../../rules/github-issue-row.js';
import type { GithubApi } from './github-api.js';
import { graphqlErrors } from './github-pr-listing.js';

/** The fields every `issue-list` read asks, in `gh`'s fragment syntax. */
const BASE_FIELDS =
  'number,title,url,createdAt,assignees(first:100){nodes{id,login,name,databaseId},totalCount},issueType{id,name,description,color},milestone{number,title,description,dueOn}';

/** The fields each read adds, as `plot-host.sh` asks them. */
const EXTRA_FIELDS: Readonly<Record<GithubIssueState, string>> = {
  open: '',
  closed: ',closedAt,labels(first:100){nodes{id,name,description,color},totalCount}',
  changed: ',updatedAt,state,closedAt',
};

/** `gh`'s repository listing query, after the fragment; `gh issue list` sends it with no `--search`. */
const LIST_QUERY =
  '\n\tquery IssueList($owner: String!, $repo: String!, $limit: Int, $endCursor: String, $states: [IssueState!] = OPEN, $assignee: String, $author: String, $mention: String) {\n\t\trepository(owner: $owner, name: $repo) {\n\t\t\thasIssuesEnabled\n\t\t\tissues(first: $limit, after: $endCursor, orderBy: {field: CREATED_AT, direction: DESC}, states: $states, filterBy: {assignee: $assignee, createdBy: $author, mentioned: $mention}) {\n\t\t\t\ttotalCount\n\t\t\t\tnodes {\n\t\t\t\t\t...issue\n\t\t\t\t}\n\t\t\t\tpageInfo {\n\t\t\t\t\thasNextPage\n\t\t\t\t\tendCursor\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n\t';

/** `gh`'s search query, after the fragment; `gh issue list --search` sends it. */
const SEARCH_QUERY =
  'query IssueSearch($repo: String!, $owner: String!, $type: SearchType!, $limit: Int, $after: String, $query: String!) {\n\t\t\trepository(name: $repo, owner: $owner) {\n\t\t\t\thasIssuesEnabled\n\t\t\t}\n\t\t\tsearch(type: $type, last: $limit, after: $after, query: $query) {\n\t\t\t\tissueCount\n\t\t\t\tnodes { ...issue }\n\t\t\t\tpageInfo {\n\t\t\t\t\thasNextPage\n\t\t\t\t\tendCursor\n\t\t\t\t}\n\t\t\t}\n\t\t}';

/** The introspection `gh` sends before a search, to choose the search type. */
const SEARCH_TYPES_QUERY = 'query SearchType_enumValues{SearchType: __type(name: "SearchType"){enumValues(includeDeprecated: true){name}}}';

/** The rows one GraphQL page holds at most. */
const PAGE_ROWS = 100;

/** The time `gh` exports for a GraphQL time that is null: Go's zero time. */
const ZERO_TIME = '0001-01-01T00:00:00Z';

/** The three reads `plot-host.sh issue-list` answers on GitHub that this module sends in-process. */
export type GithubIssueState = 'open' | 'closed' | 'changed';

/** One read: the state, and for `closed` and `changed` the earliest time to include. */
export type GithubIssueQuery =
  | { readonly state: 'open' }
  | { readonly state: 'closed' | 'changed'; readonly since: string };

/** What one read answered. */
export type GithubIssueAnswer =
  | {
      readonly ok: true;
      /** The issues as `gh issue list --json` exports them, in GitHub's order, cut at the limit. */
      readonly issues: readonly GhIssue[];
      /** True where the last page named no further page. */
      readonly ended: boolean;
      /** The listing pages that answered, without the search type introspection. */
      readonly pages: number;
    }
  | { readonly ok: false; readonly refusal: HostRefusal };

/** The in-process GitHub issue listing. */
export interface GithubIssueList {
  /** Lists issues. Never rejects. */
  list(query: GithubIssueQuery, limit: number): Promise<GithubIssueAnswer>;
}

/** A value read as an object, or an empty one. */
const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** A value read as an array, or an empty one. */
const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

/** A GraphQL string, or `''` for null, as `gh` exports it. */
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** A GraphQL time, or Go's zero time for null, as `gh` exports it. */
const time = (value: unknown): string => (typeof value === 'string' && value !== '' ? value : ZERO_TIME);

/**
 * One GraphQL issue node as `gh issue list --json` exports it, for the fields
 * the rule reads.
 *
 * A null string exports as `''` and a null `createdAt` or `updatedAt` as Go's
 * zero time; a null `closedAt`, `issueType` or `milestone` stays null. A field
 * the read did not ask stays absent.
 *
 * @param node - the node GitHub answered.
 * @param state - the read the node answers.
 * @returns the exported issue.
 */
export const exportedIssue = (node: unknown, state: GithubIssueState): GhIssue => {
  const issue = record(node);
  const kind = record(issue.issueType);
  const milestone = record(issue.milestone);
  const exported: Record<string, unknown> = {
    number: issue.number,
    title: text(issue.title),
    url: text(issue.url),
    createdAt: time(issue.createdAt),
    assignees: list(record(issue.assignees).nodes).map((one) => ({ login: text(record(one).login) })),
    issueType: issue.issueType === null || issue.issueType === undefined ? null : { name: text(kind.name) },
    milestone: issue.milestone === null || issue.milestone === undefined ? null : { title: text(milestone.title) },
  };
  if (state === 'closed') {
    exported.closedAt = issue.closedAt ?? null;
    exported.labels = list(record(issue.labels).nodes).map((one) => ({ name: text(record(one).name) }));
  }
  if (state === 'changed') {
    exported.updatedAt = time(issue.updatedAt);
    exported.state = text(issue.state);
    exported.closedAt = issue.closedAt ?? null;
  }
  return exported as unknown as GhIssue;
};

/**
 * Builds the in-process GitHub issue listing over one client.
 *
 * It sends the GraphQL requests `gh issue list` sends for the call
 * `plot-host.sh issue-list` makes: the repository `IssueList` query for an
 * open read, and for a closed or changed read the `IssueSearch` query with
 * `closed:>=` or `updated:>=`, preceded once per listing by `gh`'s search
 * type introspection. It pages at 100 rows up to the limit: the listing's
 * `first` shrinks to the rows still wanted, and a search keeps its `limit`
 * and sends the rows still wanted as `perPage`. It keeps a repeated number,
 * as `gh` does, and cuts the rows at the limit.
 *
 * A refused page, a GraphQL `errors` array and a repository with issues
 * disabled answer the refusal, whatever page they came on: `gh issue list`
 * prints no rows for a failed call.
 *
 * @param api - the in-process GitHub client.
 * @returns the listing.
 */
export const githubIssueList = (api: GithubApi): GithubIssueList => {
  let searchType: Promise<{ type: string } | { refusal: HostRefusal }> | null = null;

  const askSearchType = async (): Promise<{ type: string } | { refusal: HostRefusal }> => {
    const answer = await api.request({ method: 'POST', path: '/graphql', body: { query: SEARCH_TYPES_QUERY }, label: 'graphql, search types' });
    if (!answer.ok) return { refusal: answer.refusal };
    const errors = graphqlErrors(answer.reply);
    if (errors !== null) return { refusal: { kind: 'failed', said: errors } };
    const names = list(record(record(record(answer.reply.body).data).SearchType).enumValues).map((v) => text(record(v).name));
    return { type: names.includes('ISSUE_ADVANCED') ? 'ISSUE_ADVANCED' : 'ISSUE' };
  };

  const searchTypeOnce = async (): Promise<{ type: string } | { refusal: HostRefusal }> => {
    searchType ??= askSearchType();
    const asked = await searchType;
    if ('refusal' in asked) searchType = null;
    return asked;
  };

  return {
    list: async (query, limit) => {
      const slug = api.origin.slug;
      if (slug === null) return { ok: false, refusal: { kind: 'failed', said: 'the origin remote names no GitHub owner/repo' } };
      const [owner, repo] = slug.split('/');
      const fragment = `fragment issue on Issue {${BASE_FIELDS}${EXTRA_FIELDS[query.state]}}`;
      let graphqlQuery: string;
      let base: Record<string, unknown>;
      if (query.state === 'open') {
        graphqlQuery = `${fragment}${LIST_QUERY}`;
        base = { owner, repo, states: ['OPEN'] };
      } else {
        const type = await searchTypeOnce();
        if ('refusal' in type) return { ok: false, refusal: type.refusal };
        const q = query.state === 'closed'
          ? `( closed:>=${query.since} ) repo:${slug} state:closed type:issue`
          : `( updated:>=${query.since} ) repo:${slug} type:issue`;
        graphqlQuery = `${fragment}${SEARCH_QUERY}`;
        base = { owner, repo, query: q, type: type.type };
      }
      const issues: GhIssue[] = [];
      const first = Math.min(limit, PAGE_ROWS);
      let cursor: unknown = undefined;
      for (let page = 1; ; page += 1) {
        const wanted = Math.min(limit - issues.length, PAGE_ROWS);
        const variables =
          query.state === 'open'
            ? { ...base, limit: wanted, ...(cursor === undefined ? {} : { endCursor: cursor }) }
            : { ...base, limit: first, ...(cursor === undefined ? {} : { after: cursor, perPage: wanted }) };
        const answer = await api.request({ method: 'POST', path: '/graphql', body: { query: graphqlQuery, variables }, label: `graphql, page ${page}` });
        if (!answer.ok) return { ok: false, refusal: answer.refusal };
        const errors = graphqlErrors(answer.reply);
        if (errors !== null) return { ok: false, refusal: { kind: 'failed', said: errors } };
        const data = record(record(answer.reply.body).data);
        if (record(data.repository).hasIssuesEnabled === false) {
          return { ok: false, refusal: { kind: 'failed', said: `the '${slug}' repository has disabled issues` } };
        }
        const connection = query.state === 'open' ? record(record(data.repository).issues) : record(data.search);
        for (const node of list(connection.nodes)) {
          issues.push(exportedIssue(node, query.state));
          if (issues.length === limit) return { ok: true, issues, ended: false, pages: page };
        }
        const info = record(connection.pageInfo);
        if (info.hasNextPage !== true) return { ok: true, issues, ended: true, pages: page };
        cursor = info.endCursor;
      }
    },
  };
};
