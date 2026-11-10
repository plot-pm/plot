import type { HostRefusal, PrListing, PrListingCompleteness, PrListingQuery, PrListingRow } from '../../ports/host.js';
import type { RollupItem } from '../../rules/checks-of.js';
import { githubPlainRow, githubRichRow, isTerminalRow, withAbsentVerdicts, type GhPullRequest } from '../../rules/github-pr-row.js';
import { GH_PAGE_ROWS } from '../../rules/listing-page.js';
import type { GithubApi, GithubReply } from './github-api.js';

/** The `gh` version whose GraphQL requests this adapter sends, as recorded in the corpus fixtures. */
export const GH_QUERIES_FROM = 'gh version 2.103.3 (2026-10-26)';

/** The rows `gh pr list` returns where no `--limit` is given. */
export const GH_DEFAULT_LIMIT = 30;

/** `gh`'s fragment for `--json number,title,state,headRefName,isDraft,url,updatedAt,author,headRefOid,mergedAt`. */
const PLAIN_FRAGMENT =
  'fragment pr on PullRequest{number,title,state,headRefName,isDraft,url,updatedAt,author{login,...on User{id,name}},headRefOid,mergedAt}';

/** `gh`'s fragment for the rich field list `plot-host.sh` asks. */
const RICH_FRAGMENT =
  'fragment pr on PullRequest{number,title,state,headRefName,isDraft,statusCheckRollup: commits(last: 1) {nodes {commit {statusCheckRollup {contexts(first:100) {nodes {__typename...on StatusContext {context,state,targetUrl,createdAt,description},...on CheckRun {name,checkSuite{workflowRun{workflow{name}}},status,conclusion,startedAt,completedAt,detailsUrl}},pageInfo{hasNextPage,endCursor}}}}}},mergeable,mergeStateStatus,reviewDecision,url,updatedAt,author{login,...on User{id,name}},headRefOid,mergedAt}';

/** `gh`'s repository listing query, after the fragment. */
const LIST_QUERY =
  '\n\t\tquery PullRequestList(\n\t\t\t$owner: String!,\n\t\t\t$repo: String!,\n\t\t\t$limit: Int!,\n\t\t\t$endCursor: String,\n\t\t\t$baseBranch: String,\n\t\t\t$headBranch: String,\n\t\t\t$state: [PullRequestState!] = OPEN\n\t\t) {\n\t\t\trepository(owner: $owner, name: $repo) {\n\t\t\t\tpullRequests(\n\t\t\t\t\tstates: $state,\n\t\t\t\t\tbaseRefName: $baseBranch,\n\t\t\t\t\theadRefName: $headBranch,\n\t\t\t\t\tfirst: $limit,\n\t\t\t\t\tafter: $endCursor,\n\t\t\t\t\torderBy: {field: CREATED_AT, direction: DESC}\n\t\t\t\t) {\n\t\t\t\t\ttotalCount\n\t\t\t\t\tnodes {\n\t\t\t\t\t\t...pr\n\t\t\t\t\t}\n\t\t\t\t\tpageInfo {\n\t\t\t\t\t\thasNextPage\n\t\t\t\t\t\tendCursor\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}';

/** `gh`'s search query, after the fragment; `gh pr list --search` sends it. */
const SEARCH_QUERY =
  '\n\t\tquery PullRequestSearch(\n\t\t\t$q: String!,\n\t\t\t$type: SearchType!,\n\t\t\t$limit: Int!,\n\t\t\t$endCursor: String,\n\t\t) {\n\t\t\tsearch(query: $q, type: $type, first: $limit, after: $endCursor) {\n\t\t\t\tissueCount\n\t\t\t\tnodes {\n\t\t\t\t\t...pr\n\t\t\t\t}\n\t\t\t\tpageInfo {\n\t\t\t\t\thasNextPage\n\t\t\t\t\tendCursor\n\t\t\t\t}\n\t\t\t}\n\t\t}';

/** The introspection `gh` sends before a search, to choose the search type. */
const SEARCH_TYPES_QUERY = 'query SearchType_enumValues{SearchType: __type(name: "SearchType"){enumValues(includeDeprecated: true){name}}}';

/** The GraphQL states `gh pr list --state` asks for. */
const LIST_STATES: Readonly<Record<string, readonly string[]>> = {
  open: ['OPEN'],
  merged: ['MERGED'],
  all: ['OPEN', 'CLOSED', 'MERGED'],
};

/** The search qualifiers `gh` adds around `repo:` for each state, in its order. */
const SEARCH_STATE: Readonly<Record<string, { before: string; after: string }>> = {
  open: { before: '', after: 'state:open ' },
  merged: { before: 'is:merged ', after: '' },
  all: { before: '', after: '' },
};

/** The time `gh` exports for a GraphQL time that is null: Go's zero time. */
const ZERO_TIME = '0001-01-01T00:00:00Z';

/** A GraphQL string, or `''` for null, as `gh` exports it. */
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** A GraphQL time, or Go's zero time for null, as `gh` exports it. */
const time = (value: unknown): string => (typeof value === 'string' && value !== '' ? value : ZERO_TIME);

/** A value read as an object, or an empty one. */
const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** A value read as an array, or an empty one. */
const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

/**
 * One rollup context as `gh` exports it: a `CheckRun` with its name, workflow,
 * status, conclusion and times; anything else as a status context.
 */
const exportedContext = (node: unknown): RollupItem & Record<string, unknown> => {
  const c = record(node);
  if (c.__typename === 'CheckRun') {
    return {
      __typename: 'CheckRun',
      name: text(c.name),
      workflowName: text(record(record(record(c.checkSuite).workflowRun).workflow).name),
      status: text(c.status),
      conclusion: text(c.conclusion),
      startedAt: time(c.startedAt),
      completedAt: time(c.completedAt),
      detailsUrl: text(c.detailsUrl),
    };
  }
  return { __typename: text(c.__typename), context: text(c.context), state: text(c.state), targetUrl: text(c.targetUrl), startedAt: time(c.createdAt) };
};

/**
 * One GraphQL pull-request node as `gh pr list --json` exports it.
 *
 * The rollup is the head commit's contexts, `[]` for a commit with no rollup,
 * and null for a pull request with no commit. An author with no user `id`
 * (a bot, or a deleted account) exports its login as `app/<login>`.
 *
 * @param node - the node GitHub answered.
 * @returns the exported pull request.
 */
export const exportedPullRequest = (node: unknown): GhPullRequest => {
  const pr = record(node);
  const author = record(pr.author);
  const login = text(author.login);
  const exported: Record<string, unknown> = {
    number: pr.number,
    title: pr.title,
    state: pr.state,
    headRefName: pr.headRefName,
    isDraft: pr.isDraft,
    url: pr.url,
    updatedAt: pr.updatedAt,
    author: text(author.id) === '' ? { is_bot: true, login: `app/${login}` } : { id: author.id, is_bot: false, login, name: text(author.name) },
    headRefOid: pr.headRefOid,
    mergedAt: pr.mergedAt ?? null,
  };
  if ('statusCheckRollup' in pr) {
    const commits = list(record(pr.statusCheckRollup).nodes);
    exported.statusCheckRollup = commits.length === 0
      ? null
      : list(record(record(record(record(commits[0]).commit).statusCheckRollup).contexts).nodes).map(exportedContext);
    exported.mergeable = text(pr.mergeable);
    exported.mergeStateStatus = text(pr.mergeStateStatus);
    exported.reviewDecision = text(pr.reviewDecision);
  }
  return exported as GhPullRequest;
};

/** What one walk over a listing's pages answered. */
interface Walk {
  /** The pull requests read, deduplicated by number and cut at the limit. */
  readonly prs: readonly GhPullRequest[];
  /** True where the last page read named no further page and the walk did not stop at the limit. */
  readonly ended: boolean;
  /** How many pages answered. */
  readonly pages: number;
  /** Why the walk stopped early, or null. */
  readonly refusal: HostRefusal | null;
}

/** The GraphQL errors of a reply, as `gh` prints them, or null where it carries none. */
const graphqlErrors = (reply: GithubReply): string | null => {
  const errors = list(record(reply.body).errors);
  if (errors.length === 0) return null;
  return `GraphQL: ${errors.map((e) => text(record(e).message)).join(', ')}`;
};

/**
 * The in-process GitHub PR listing: answers {@link Host.prListing} over the
 * GitHub GraphQL API with the requests `gh pr list` sends for the same
 * `plot-host.sh pr-list` call.
 */
export interface GithubPrListing {
  /** Lists pull requests; see {@link Host.prListing}. Never rejects. */
  prListing(query: PrListingQuery): Promise<PrListing>;
  /** The refusal of the last call, or null where it answered in full. */
  lastRefusal(): HostRefusal | null;
}

/**
 * Builds the in-process GitHub PR listing over one client.
 *
 * It sends `gh pr list`'s GraphQL queries: the repository listing, or the
 * `updated:>` search with `since`, preceded once per listing by `gh`'s search
 * type introspection. It pages at 100 rows up to the limit (30 where none is
 * given), drops a repeated number, and projects each pull request with
 * `githubRichRow` or `githubPlainRow`. `richOpen` over a state other than
 * `open` lists the open pull requests rich, then the state plain, and keeps
 * the terminal plain rows with the absent verdicts.
 *
 * A state is `whole` only where the caller gave a limit, every page answered,
 * the last page named no further page, and the rows number at least one and
 * fewer than the limit. A walk refused on a page answers the rows of the pages
 * read, `possibly-truncated` for that state and every state not yet read, the
 * refusal, and `partial`; refused on its first page it answers `failed`.
 *
 * @param api - the in-process GitHub client.
 * @returns the listing.
 */
export const githubPrListing = (api: GithubApi): GithubPrListing => {
  let refusal: HostRefusal | null = null;
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

  const walk = async (state: string, rich: boolean, limit: number, since: string | undefined, slug: string): Promise<Walk> => {
    const fragment = rich ? RICH_FRAGMENT : PLAIN_FRAGMENT;
    let base: Record<string, unknown>;
    let query: string;
    if (since === undefined) {
      const [owner, repo] = slug.split('/');
      base = { owner, repo, state: LIST_STATES[state] };
      query = `${fragment}${LIST_QUERY}`;
    } else {
      const type = await searchTypeOnce();
      if ('refusal' in type) return { prs: [], ended: false, pages: 0, refusal: type.refusal };
      const qualifiers = SEARCH_STATE[state];
      base = { q: `( updated:>${since} ) ${qualifiers.before}repo:${slug} ${qualifiers.after}type:pr`, type: type.type };
      query = `${fragment}${SEARCH_QUERY}`;
    }
    const prs: GhPullRequest[] = [];
    const seen = new Set<unknown>();
    let pageLimit = Math.min(limit, GH_PAGE_ROWS);
    let cursor: unknown = undefined;
    for (let page = 1; ; page += 1) {
      const variables = { ...base, limit: pageLimit, ...(cursor === undefined ? {} : { endCursor: cursor }) };
      const answer = await api.request({ method: 'POST', path: '/graphql', body: { query, variables }, label: `graphql, page ${page}` });
      if (!answer.ok) return { prs, ended: false, pages: page - 1, refusal: answer.refusal };
      const errors = graphqlErrors(answer.reply);
      if (errors !== null) return { prs, ended: false, pages: page - 1, refusal: { kind: 'failed', said: errors } };
      const data = record(record(answer.reply.body).data);
      const connection = since === undefined ? record(record(data.repository).pullRequests) : record(data.search);
      for (const node of list(connection.nodes)) {
        const number = record(node).number;
        if (typeof number === 'number' && number > 0 && seen.has(number)) continue;
        seen.add(number);
        prs.push(exportedPullRequest(node));
        if (prs.length === limit) return { prs, ended: false, pages: page, refusal: null };
      }
      const info = record(connection.pageInfo);
      if (info.hasNextPage !== true) return { prs, ended: true, pages: page, refusal: null };
      cursor = info.endCursor;
      pageLimit = Math.min(pageLimit, limit - prs.length);
    }
  };

  const wordOf = (walked: Walk, query: PrListingQuery): PrListingCompleteness =>
    query.limit !== undefined && walked.refusal === null && walked.ended && walked.prs.length > 0 && walked.prs.length < query.limit
      ? 'whole'
      : 'possibly-truncated';

  const listing = async (query: PrListingQuery): Promise<PrListing> => {
    const unclaimed: Record<string, PrListingCompleteness> = { [query.state]: 'possibly-truncated' };
    const slug = api.origin.slug;
    if (slug === null) {
      return { answer: 'failed', rows: [], complete: unclaimed, refusal: { kind: 'failed', said: 'the origin remote names no GitHub owner/repo' } };
    }
    const limit = query.limit ?? GH_DEFAULT_LIMIT;
    const split = query.richOpen === true && query.state !== 'open';
    const rich = query.rich === true || query.richOpen === true;
    const rows: PrListingRow[] = [];
    const complete: Record<string, PrListingCompleteness> = split ? { open: 'possibly-truncated', ...unclaimed } : { ...unclaimed };
    let pages = 0;
    if (split) {
      const open = await walk('open', true, limit, query.since, slug);
      pages += open.pages;
      rows.push(...open.prs.map(githubRichRow));
      complete.open = wordOf(open, query);
      if (open.refusal !== null) return { answer: pages === 0 ? 'failed' : 'partial', rows: pages === 0 ? [] : rows, complete, refusal: open.refusal };
    }
    const asked = await walk(query.state, rich && !split, limit, query.since, slug);
    pages += asked.pages;
    const projected = asked.prs.map(split ? githubPlainRow : rich ? githubRichRow : githubPlainRow);
    rows.push(...(split ? projected.filter(isTerminalRow).map(withAbsentVerdicts) : projected));
    complete[query.state] = wordOf(asked, query);
    if (asked.refusal !== null) return { answer: pages === 0 ? 'failed' : 'partial', rows: pages === 0 ? [] : rows, complete, refusal: asked.refusal };
    return { answer: 'answered', rows, complete, refusal: null };
  };

  return {
    prListing: async (query) => {
      const answered = await listing(query);
      refusal = answered.refusal;
      return answered;
    },
    lastRefusal: () => refusal,
  };
};
