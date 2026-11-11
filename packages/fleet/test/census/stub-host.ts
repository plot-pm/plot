import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';

/**
 * The `PATH` stubs the census sandbox puts in front of the host CLIs.
 *
 * Each stub is a bash script that answers from fixture files and starts no
 * process: it parses its argv with builtins, prints the fixture with a `read`
 * loop, and appends its argv to `$CENSUS_STUB_LOG` with `printf`. So an
 * `execve` count holds the stub's own image, which stands in for the real CLI's
 * image, and nothing more.
 *
 * Fixture lookup, under `$CENSUS_FIXTURES/<cli>/`:
 *
 * - the key is the first two positional words, joined by `-`, with `/`
 *   replaced by `_` (`pr list` -> `pr-list`, `api graphql` -> `api-graphql`);
 * - `--state <s>` appends `-<s>`, `--head <b>` appends `-head-<b>`;
 * - `--jq`/`-q` reads `<key>.jq.txt` instead of `<key>.json`;
 * - `--include` prints an HTTP status line and a blank line before the body;
 * - `<file>.rc` holds an exit code; absent means 0;
 * - a missing file answers `[]`, except a `--head` query, which answers `[]`
 *   too: a head that has no fixture has no pull request.
 */

const STUB_HEADER = `#!/bin/bash
# Census stub: answers from fixture files, starts no process.
`;

/** Prints a fixture file with builtins only: no \`cat\`, no subshell. */
const EMIT = `emit() { # $1 = file
  local line
  while IFS= read -r line || [ -n "$line" ]; do printf '%s\\n' "$line"; done < "$1"
}
`;

/**
 * `bb api <path>`: the key is `api-<last path segment>`, then `-<STATE>` from
 * a `state=` parameter or a `state="…"` filter and `-branch-<name>` from a `source.branch.name="…"`
 * filter, both read from the percent-encoded query. A missing file answers an
 * empty page envelope.
 */
const BB_API_KEY = `if [ "\${words[0]:-}" = api ]; then
  p="\${words[1]:-}"; base="\${p%%\\?*}"; base="\${base##*/}"; q=''
  case "$p" in *\\?*) q="\${p#*\\?}" ;; esac
  st=''; case "$q" in *state=*) st="\${q#*state=}"; st="\${st#%22}"; st="\${st%%%22*}"; st="\${st%%&*}"; st="\${st%%%20*}" ;; esac
  br=''; case "$q" in *source.branch.name=%22*) br="\${q#*source.branch.name=%22}"; br="\${br%%%22*}"; br="\${br//%2F/_}" ;; esac
  key="api-$base\${st:+-$st}\${br:+-branch-$br}"
  [ -f "$dir/$key.json" ] || [ -n "$jq" ] || { printf '{"values":[],"size":0,"pagelen":50}\\n'; exit 0; }
fi`;

/**
 * Builds the stub for a host CLI (`gh` or `bb`).
 *
 * @param cli - the CLI name; also the fixture subdirectory.
 * @returns the script text.
 */
export const hostCliStub = (cli: 'gh' | 'bb'): string => `${STUB_HEADER}${EMIT}
dir="\${CENSUS_FIXTURES:?}/${cli}"
[ -z "\${CENSUS_STUB_LOG:-}" ] || printf '${cli} %s\\n' "$*" >> "$CENSUS_STUB_LOG"
words=(); state=''; head=''; jq=''; include=0
while [ $# -gt 0 ]; do
  case "$1" in
    --state|-s) state="\${2:-}"; shift; [ $# -eq 0 ] || shift ;;
    --head) head="\${2:-}"; shift; [ $# -eq 0 ] || shift ;;
    --jq|-q) jq=1; shift; [ $# -eq 0 ] || shift ;;
    --include|-i) include=1; shift ;;
    -R|--repo|--json|--limit|-L|--search|-S|--branch|-b|-f|-F|-X|--method|--field|--raw-field|-H|--header|--template|-t|--workspace|--repository) shift; [ $# -eq 0 ] || shift ;;
    --*=*|-*) shift ;;
    *) [ "\${#words[@]}" -ge 2 ] || words+=("$1"); shift ;;
  esac
done
key="\${words[0]:-none}-\${words[1]:-none}"
key="\${key//\\//_}\${state:+-$state}\${head:+-head-\${head//\\//_}}"
${cli === 'bb' ? BB_API_KEY : ''}
file="$dir/$key\${jq:+.jq.txt}"
[ -n "$jq" ] || file="$file.json"
[ "$include" = 0 ] || printf 'HTTP/2.0 200 OK\\r\\nContent-Type: application/json\\r\\n\\r\\n'
if [ -f "$file" ]; then emit "$file"; else [ -n "$jq" ] || printf '[]\\n'; fi
rc=0
[ ! -f "$file.rc" ] || read -r rc < "$file.rc"
exit "$rc"
`;

/**
 * Builds the `curl` stub that answers a Jira tracker's REST calls.
 *
 * `plot-host.sh` reaches Jira with `curl -sS --user … -w '\\n%{http_code}'
 * <base><path>` and no CLI of its own, so the tracker stub shadows `curl`. The
 * key is the URL path after the host, query stripped, `/` replaced by `_`; a
 * missing file answers an empty search page. Every answer ends with the
 * status line `-w` would print.
 *
 * @returns the script text.
 */
export const jiraCurlStub = (): string => `${STUB_HEADER}${EMIT}
dir="\${CENSUS_FIXTURES:?}/jira"
[ -z "\${CENSUS_STUB_LOG:-}" ] || printf 'curl %s\\n' "$*" >> "$CENSUS_STUB_LOG"
url=''
for arg in "$@"; do case "$arg" in http://*|https://*) url="$arg" ;; esac; done
path="\${url#*://}"; path="/\${path#*/}"; path="\${path%%\\?*}"
file="$dir/\${path//\\//_}.json"
if [ -f "$file" ]; then emit "$file"; else printf '{"issues":[],"isLast":true,"total":0}\\n'; fi
printf '200'
`;

/** One stub `gh` answer file, parsed; null where it is absent. */
const ghFile = (fixtures: string, key: string): unknown => {
  const file = join(fixtures, `${key}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as unknown) : null;
};

type GhRow = Record<string, unknown>;

/** One exported rollup item as the GraphQL context node it came from. */
const contextNode = (item: GhRow): GhRow =>
  item['__typename'] === 'CheckRun'
    ? {
        __typename: 'CheckRun',
        name: item['name'] ?? '',
        checkSuite: { workflowRun: { workflow: { name: item['workflowName'] ?? '' } } },
        status: item['status'] ?? '',
        conclusion: item['conclusion'] === '' ? null : (item['conclusion'] ?? null),
        startedAt: item['startedAt'] ?? null,
        completedAt: item['completedAt'] ?? null,
        detailsUrl: item['detailsUrl'] ?? '',
      }
    : {
        __typename: item['__typename'] ?? 'StatusContext',
        context: item['context'] ?? '',
        state: item['state'] ?? '',
        targetUrl: item['targetUrl'] ?? '',
        createdAt: item['startedAt'] ?? null,
        description: '',
      };

/** One `gh pr list --json` row as the GraphQL node `gh` exported it from. */
const pullRequestNode = (row: GhRow, rich: boolean): GhRow => {
  const author = (row['author'] ?? {}) as GhRow;
  const node: GhRow = {
    number: row['number'],
    title: row['title'],
    state: row['state'],
    headRefName: row['headRefName'],
    isDraft: row['isDraft'] ?? false,
    url: row['url'],
    updatedAt: row['updatedAt'],
    author: { login: author['login'] ?? '', id: 'U_census', name: author['name'] ?? '' },
    headRefOid: row['headRefOid'],
    mergedAt: row['mergedAt'] ?? null,
  };
  if (!rich) return node;
  const rollup = row['statusCheckRollup'];
  return {
    ...node,
    statusCheckRollup: {
      nodes: Array.isArray(rollup)
        ? [{ commit: { statusCheckRollup: { contexts: { nodes: (rollup as GhRow[]).map(contextNode), pageInfo: { hasNextPage: false, endCursor: null } } } } }]
        : [],
    },
    mergeable: row['mergeable'] ?? '',
    mergeStateStatus: row['mergeStateStatus'] ?? '',
    reviewDecision: row['reviewDecision'] ?? '',
  };
};

/** The `gh pr list --state` word a GraphQL listing or search asks for. */
const prStateOf = (variables: GhRow): string => {
  if (typeof variables['q'] === 'string') {
    const q = variables['q'];
    return q.includes('is:merged') ? 'merged' : q.includes('state:open') ? 'open' : 'all';
  }
  const states = Array.isArray(variables['state']) ? (variables['state'] as string[]) : ['OPEN'];
  return states.length > 1 ? 'all' : (states[0] ?? 'OPEN').toLowerCase();
};

/** One connection page holding every row, as GitHub pages a listing that fits. */
const page = (nodes: readonly unknown[]): GhRow => ({ totalCount: nodes.length, issueCount: nodes.length, nodes, pageInfo: { hasNextPage: false, endCursor: null } });

/**
 * The GraphQL answer to one request the in-process reads send, built from the
 * stub `gh`'s answer files: the search-type introspection, the PR listing and
 * search (`pr-list-<state>.json`), and the issue listing and search
 * (`issue-list-<state>.json`). Null for any other query.
 *
 * @param fixtures - the `gh` fixture directory.
 * @param body - the request's parsed JSON body.
 */
export const graphqlAnswer = (fixtures: string, body: GhRow): unknown => {
  const query = typeof body['query'] === 'string' ? body['query'] : '';
  const variables = (body['variables'] ?? {}) as GhRow;
  if (query.includes('SearchType_enumValues')) {
    return { data: { SearchType: { enumValues: [{ name: 'ISSUE' }, { name: 'ISSUE_ADVANCED' }] } } };
  }
  if (query.includes('query PullRequestList') || query.includes('query PullRequestSearch')) {
    const rows = (ghFile(fixtures, `pr-list-${prStateOf(variables)}`) ?? []) as GhRow[];
    const nodes = rows.map((row) => pullRequestNode(row, query.includes('statusCheckRollup')));
    return query.includes('query PullRequestList') ? { data: { repository: { pullRequests: page(nodes) } } } : { data: { search: page(nodes) } };
  }
  if (query.includes('query IssueList') || query.includes('query IssueSearch')) {
    const state = query.includes('query IssueList') ? 'open' : String(variables['query'] ?? '').includes('state:closed') ? 'closed' : 'changed';
    const rows = (ghFile(fixtures, `issue-list-${state}`) ?? []) as unknown[];
    return query.includes('query IssueList')
      ? { data: { repository: { hasIssuesEnabled: true, issues: page(rows) } } }
      : { data: { search: page(rows) } };
  }
  return null;
};

/**
 * The REST answer to one Actions request the in-process reads send, built
 * from the stub `gh`'s `run-list.json`: the runs listing, the workflows page
 * and one workflow. Null for any other path.
 *
 * @param fixtures - the `gh` fixture directory.
 * @param path - the request path, query stripped.
 */
export const restAnswer = (fixtures: string, path: string): unknown => {
  const runs = ((ghFile(fixtures, 'run-list') ?? []) as GhRow[]).map((run) => ({
    id: run['databaseId'],
    head_sha: run['headSha'],
    head_branch: run['headBranch'],
    name: run['name'],
    status: run['status'],
    conclusion: run['conclusion'],
    created_at: run['createdAt'],
    updated_at: run['updatedAt'],
    run_started_at: run['startedAt'] ?? run['createdAt'] ?? null,
    event: run['event'],
    html_url: run['url'] ?? '',
    workflow_id: 1,
  }));
  if (path.endsWith('/actions/runs')) return { total_count: runs.length, workflow_runs: runs };
  if (path.endsWith('/actions/workflows')) return { total_count: 1, workflows: [{ id: 1, name: 'CI' }] };
  if (/\/actions\/workflows\/\d+$/.test(path)) return { id: 1, name: 'CI' };
  return null;
};

/** The Jira account email the census sandbox sets as `JIRA_EMAIL`. */
export const CENSUS_JIRA_EMAIL = 'census@census.invalid';

/** The Jira API token the census sandbox sets as `JIRA_API_TOKEN`. */
export const CENSUS_JIRA_TOKEN = 'census';

/** The answer the `curl` stub and the Jira route give where no answer file exists: an empty last search page. */
const JIRA_EMPTY_PAGE = '{"issues":[],"isLast":true,"total":0}';

/**
 * Answers one in-process Jira request from the `curl` stub's answer files.
 *
 * The key is the one {@link jiraCurlStub} reads: the path, query stripped,
 * `/` replaced by `_`, under `$CENSUS_FIXTURES/jira/`. A missing file answers
 * an empty search page. A request whose `Authorization` is not Basic over
 * {@link CENSUS_JIRA_EMAIL} and {@link CENSUS_JIRA_TOKEN} answers `401`. No
 * answer carries a rate-limit header, as Jira's own answers measured
 * 2026-11-10 carry none.
 *
 * @param jiraDir - the Jira fixture directory.
 * @param path - the request path, query stripped.
 * @param authorization - the request's `Authorization` header.
 * @returns the status and the body.
 */
export const jiraAnswer = (jiraDir: string, path: string, authorization: string): { status: number; body: string } => {
  const expected = `Basic ${Buffer.from(`${CENSUS_JIRA_EMAIL}:${CENSUS_JIRA_TOKEN}`).toString('base64')}`;
  if (authorization !== expected) return { status: 401, body: '{"errorMessages":["Client must be authenticated to access this resource."]}' };
  const file = join(jiraDir, `${path.replaceAll('/', '_')}.json`);
  return { status: 200, body: existsSync(file) ? readFileSync(file, 'utf8') : JIRA_EMPTY_PAGE };
};

/** One request the stub API server answered. */
export type StubApiRequest = { method: string; path: string; authorization: string; body: string };

/** The local HTTP server that answers the in-process GitHub client in the census sandbox. */
export type StubApi = {
  /** The base URL the sandbox sets as `GITHUB_API_URL`. */
  url: string;
  /** Every request answered so far, in arrival order. */
  requests: () => readonly StubApiRequest[];
  /** How many requests named `path`, query stripped. */
  count: (path: string) => number;
  /** Closes the server and every open connection. */
  close: () => Promise<void>;
};

/**
 * Starts the stub GitHub API the census sandbox points `GITHUB_API_URL` at.
 *
 * A `PATH` stub cannot see an in-process request, so this server answers them
 * from the same fixture directory as the stub `gh`. The key is
 * `api/<METHOD>-<path>.json` under `$CENSUS_FIXTURES/gh/`, the path's query
 * stripped and `/` replaced by `_` (`POST /graphql` -> `api/POST-_graphql.json`).
 * `GET /user` answers `{"login":"census"}` without a file. Where no such file
 * exists, the server answers the requests the in-process reads send from the
 * stub `gh`'s own answer files ({@link graphqlAnswer}, {@link restAnswer}), so
 * both transports read one fixture. Any other `POST` answers `{"data":{}}`,
 * and any other `GET` answers `404`. A request whose
 * `Authorization` is not `Bearer <token>` answers `401 Bad credentials`. Every
 * answer carries a full `X-RateLimit-*` window for the bucket it spends.
 * A path under `/rest/api/` is a Jira request, answered by {@link jiraAnswer}
 * from the `jira` directory beside `fixtures`.
 *
 * @param fixtures - the `gh` fixture directory.
 * @param token - the fixture token the sandbox sets as `GH_TOKEN`.
 * @returns the running server.
 */
/** The GraphQL answer to a request body, or null where it names no read the stub answers. */
const graphqlOf = (fixtures: string, chunks: readonly Buffer[]): unknown => {
  try {
    return graphqlAnswer(fixtures, JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
  } catch {
    return null;
  }
};

export const startStubApi = async (fixtures: string, token: string): Promise<StubApi> => {
  const seen: StubApiRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const method = req.method ?? 'GET';
      const path = (req.url ?? '/').split('?')[0] ?? '/';
      const authorization = String(req.headers.authorization ?? '');
      seen.push({ method, path, authorization, body: Buffer.concat(chunks).toString('utf8') });
      if (path.startsWith('/rest/api/')) {
        const jira = jiraAnswer(join(dirname(fixtures), 'jira'), path, authorization);
        res.writeHead(jira.status, { 'Content-Type': 'application/json' });
        res.end(jira.body);
        return;
      }
      const headers = {
        'Content-Type': 'application/json',
        'X-RateLimit-Resource': path === '/graphql' ? 'graphql' : 'core',
        'X-RateLimit-Limit': '5000',
        'X-RateLimit-Remaining': '4999',
        'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600),
      };
      if (authorization !== `Bearer ${token}`) {
        res.writeHead(401, headers);
        res.end('{"message":"Bad credentials"}');
        return;
      }
      const file = join(fixtures, 'api', `${method}-${path.replaceAll('/', '_')}.json`);
      if (existsSync(file)) {
        res.writeHead(200, headers);
        res.end(readFileSync(file));
      } else if (method === 'GET' && path === '/user') {
        res.writeHead(200, headers);
        res.end('{"login":"census"}');
      } else if (method === 'POST' && path === '/graphql' && graphqlOf(fixtures, chunks) !== null) {
        res.writeHead(200, headers);
        res.end(JSON.stringify(graphqlOf(fixtures, chunks)));
      } else if (method === 'GET' && restAnswer(fixtures, path) !== null) {
        res.writeHead(200, headers);
        res.end(JSON.stringify(restAnswer(fixtures, path)));
      } else if (method === 'POST') {
        res.writeHead(200, headers);
        res.end('{"data":{}}');
      } else {
        res.writeHead(404, headers);
        res.end('{"message":"Not Found"}');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests: () => [...seen],
    count: (path) => seen.filter((one) => one.path === path).length,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};
