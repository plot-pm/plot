#!/usr/bin/env node
/**
 * Records the fixtures `github-issue-reads.corpus.test.ts` and
 * `runs-for-sha.corpus.test.ts` read.
 *
 * For each case it runs `plot-host.sh issue-list` or `plot-host.sh
 * runs-for-sha` with the real `gh` on `PATH`, and points `gh` at a local stub
 * GitHub through `gh`'s `http_unix_socket` setting. The stub serves the
 * case's issues the way GitHub's GraphQL API pages them, and the case's
 * Actions runs and workflows the way the REST API pages them. The recorder
 * writes, per case:
 *
 * - `exchanges`: every request `gh` sent (method, path, GraphQL body) and the
 *   answer the stub gave, in order. The corpus serves these to the in-process
 *   reads.
 * - `calls`: every `gh` argv `plot-host.sh` ran, the stdout `gh` printed, and
 *   its exit code. The corpus serves these to `plot-host.sh` through a stub
 *   `gh`.
 * - `gh`: the `gh --version` line, because a `gh` upgrade can change the
 *   request a fixture stands for.
 *
 * It makes no network call and reads no real token: `gh` runs with
 * `GH_TOKEN=fixture`, its own config directory and its own cache directory.
 *
 * Usage: node packages/domain/corpus/record-github-issues-runs.mjs [case ...]
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const HOST = join(ROOT, 'skills/plot/scripts/plot-host.sh');
const OUT = {
  issues: join(ROOT, 'packages/domain/corpus/fixtures/github-issue-reads'),
  runs: join(ROOT, 'packages/domain/corpus/fixtures/github-runs-for-sha'),
};
const OWNER = 'plot-fixture';
const REPO = 'issues';

const stamp = (hours) => new Date(Date.UTC(2026, 9, 1) + hours * 3_600_000).toISOString().replace('.000Z', 'Z');
const sha = (n) => {
  let s = '';
  for (let i = 0; s.length < 40; i += 1) s += ((n * 2654435761 + i * 40503) >>> 0).toString(16);
  return s.slice(0, 40);
};

const PEOPLE = [
  { id: 'U_1', login: 'ada', name: 'Ada', databaseId: 1 },
  { id: 'U_2', login: 'grace', name: null, databaseId: 2 },
];
const TYPES = [null, { id: 'IT_1', name: 'Bug', description: 'A defect', color: 'RED' }, { id: 'IT_2', name: 'Task', description: '', color: 'BLUE' }];
const MILESTONES = [null, { number: 3, title: 'v2.35', description: '', dueOn: null }];
const LABELS = [[], [{ id: 'L_1', name: 'bug', description: '', color: 'd73a4a' }, { id: 'L_2', name: 'plot:idea', description: 'Plot', color: 'ededed' }]];

/**
 * One issue as GitHub's GraphQL API answers it for every field `plot-host.sh`
 * asks in any of its states.
 *
 * @param n - the issue number; every attribute derives from it.
 * @param state - `OPEN` or `CLOSED`.
 */
const issue = (n, state) => ({
  number: n,
  title: `Issue ${n}${n % 9 === 0 ? ' "quoted" & <tagged> ünïcode' : ''}`,
  url: `https://github.com/${OWNER}/${REPO}/issues/${n}`,
  createdAt: stamp(n),
  updatedAt: stamp(n * 3 + 600),
  state,
  closedAt: state === 'CLOSED' ? (n % 23 === 0 ? null : stamp(((n * 37) % 900) + 100)) : null,
  assignees: { nodes: PEOPLE.slice(0, n % 3), totalCount: n % 3 },
  issueType: TYPES[n % TYPES.length],
  milestone: MILESTONES[n % MILESTONES.length],
  labels: { nodes: LABELS[n % LABELS.length], totalCount: LABELS[n % LABELS.length].length },
});
const issues = (from, count, state) => Array.from({ length: count }, (_, i) => issue(from - i, typeof state === 'function' ? state(from - i) : state));
const mixed = (n) => (n % 3 === 0 ? 'CLOSED' : 'OPEN');

const WORKFLOWS = [
  { id: 11, node_id: 'W_11', name: 'CI', path: '.github/workflows/ci.yml', state: 'active' },
  { id: 12, node_id: 'W_12', name: 'Board', path: '.github/workflows/board.yml', state: 'active' },
  { id: 13, node_id: 'W_13', name: 'Release', path: '.github/workflows/release.yml', state: 'active' },
];

/**
 * One workflow run as GitHub's REST API answers it.
 *
 * @param id - the run id.
 * @param head - the head commit's number, which `sha` turns into a hash.
 * @param workflow - the workflow's index in {@link WORKFLOWS}.
 * @param status - the REST status word.
 * @param conclusion - the REST conclusion word, or null.
 */
const run = (id, head, workflow, status, conclusion) => ({
  id,
  name: `${WORKFLOWS[workflow].name}${id % 5 === 0 ? ' (run name)' : ''}`,
  node_id: `WFR_${id}`,
  head_branch: 'main',
  head_sha: sha(head),
  path: WORKFLOWS[workflow].path,
  display_title: `commit ${head}`,
  run_number: id,
  event: 'push',
  status,
  conclusion,
  workflow_id: WORKFLOWS[workflow].id,
  url: `https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/${id}`,
  html_url: `https://github.com/${OWNER}/${REPO}/actions/runs/${id}`,
  created_at: stamp(id),
  updated_at: stamp(id + 1),
  run_attempt: 1,
  run_started_at: id % 4 === 0 ? null : stamp(id + 0.5),
});

/** The issue cases; `args` is the `issue-list` argv after the op. */
const ISSUE_CASES = {
  'open-none': { read: { kind: 'open', limit: 1000 }, args: ['--paged', '--limit', '1000'], nodes: issues(60, 6, 'CLOSED') },
  'open-two-pages': { read: { kind: 'open', limit: 1000 }, args: ['--paged', '--limit', '1000'], nodes: issues(400, 160, mixed) },
  'open-at-limit': { read: { kind: 'open', limit: 5 }, args: ['--paged', '--limit', '5'], nodes: issues(300, 12, 'OPEN') },
  'open-past-one-page': { read: { kind: 'open', limit: 150 }, args: ['--paged', '--limit', '150'], nodes: issues(500, 220, 'OPEN') },
  'open-duplicate': {
    read: { kind: 'open', limit: 1000 },
    args: ['--paged', '--limit', '1000'],
    nodes: [...issues(250, 100, 'OPEN'), issue(151, 'OPEN'), ...issues(150, 10, 'OPEN')],
  },
  'closed-since': {
    read: { kind: 'closed', since: '2026-10-10', limit: 1000 },
    args: ['--state', 'closed', '--since', '2026-10-10', '--limit', '1000'],
    nodes: issues(200, 150, mixed),
  },
  'changed-since': {
    read: { kind: 'changed', since: '2026-11-01T00:00:00Z', limit: 1000 },
    args: ['--state', 'changed', '--since', '2026-11-01T00:00:00Z', '--limit', '1000'],
    nodes: issues(400, 300, mixed),
  },
  'changed-past-one-page': {
    read: { kind: 'changed', since: '2026-10-01T00:00:00Z', limit: 150 },
    args: ['--state', 'changed', '--since', '2026-10-01T00:00:00Z', '--limit', '150'],
    nodes: issues(400, 300, mixed),
  },
  'changed-at-limit': {
    read: { kind: 'changed', since: '2026-10-01T00:00:00Z', limit: 100 },
    args: ['--state', 'changed', '--since', '2026-10-01T00:00:00Z', '--limit', '100'],
    nodes: issues(400, 300, mixed),
  },
  'issues-disabled': { read: { kind: 'open', limit: 1000 }, args: ['--paged', '--limit', '1000'], nodes: issues(20, 3, 'OPEN'), disabled: true },
};

const HEAD = 7;
/** The runs cases; `runs` is every run on `main`, newest first. */
const RUN_CASES = {
  'one-match': { branch: 'main', sha: sha(HEAD), runs: [run(120, 8, 0, 'completed', 'success'), run(119, HEAD, 0, 'completed', 'failure'), run(118, 6, 0, 'completed', 'success')] },
  'several-workflows': {
    branch: 'main',
    sha: sha(HEAD),
    runs: [
      run(130, 9, 0, 'in_progress', null),
      run(129, HEAD, 0, 'completed', 'success'),
      run(128, HEAD, 1, 'completed', 'failure'),
      run(127, HEAD, 2, 'waiting', null),
      run(126, HEAD, 0, 'completed', 'cancelled'),
      run(125, HEAD, 1, 'completed', 'action_required'),
      run(124, 6, 0, 'queued', null),
      run(123, HEAD, 2, 'completed', 'skipped'),
      { ...run(122, HEAD, 0, 'completed', 'neutral'), workflow_id: 99 },
    ],
  },
  'no-match': { branch: 'main', sha: sha(HEAD), runs: [run(140, 8, 0, 'completed', 'success'), run(139, 6, 1, 'completed', 'success')] },
  'no-runs': { branch: 'main', sha: sha(HEAD), runs: [] },
  'past-the-limit': {
    branch: 'main',
    sha: sha(HEAD),
    runs: [...Array.from({ length: 20 }, (_, i) => run(200 - i, 100 + i, i % 3, 'completed', 'success')), run(150, HEAD, 0, 'completed', 'success')],
  },
};

const SEARCH_TYPES = { data: { SearchType: { enumValues: ['DISCUSSION', 'ISSUE', 'ISSUE_ADVANCED', 'REPOSITORY', 'USER'].map((name) => ({ name })) } } };

/** Keeps the fields the request's fragment names. */
const projectIssue = (node, query) => {
  const fragment = query.slice(0, query.indexOf('query '));
  const fields = ['number', 'title', 'url', 'createdAt', 'updatedAt', 'state', 'closedAt', 'assignees', 'issueType', 'milestone', 'labels'];
  return Object.fromEntries(fields.filter((f) => new RegExp(`[,{]${f}[,}{(]`).test(fragment)).map((f) => [f, node[f]]));
};

/** One page of `matching` from the cursor the request names. */
const pageOf = (matching, limit, cursor, query) => {
  const offset = cursor ? Number(String(cursor).replace('cursor:', '')) : 0;
  const slice = matching.slice(offset, offset + limit).map((node) => projectIssue(node, query));
  return {
    nodes: slice,
    pageInfo: { hasNextPage: offset + limit < matching.length, endCursor: slice.length === 0 ? null : `cursor:${offset + slice.length}` },
  };
};

/** Answers one GraphQL request the way GitHub pages a repository's issues. */
const answerGraphql = (one, body) => {
  const { query, variables = {} } = body;
  if (/SearchType_enumValues/.test(query)) return SEARCH_TYPES;
  const repository = { hasIssuesEnabled: one.disabled !== true };
  if (/search\(/.test(query)) {
    const q = String(variables.query);
    const closed = /closed:>=(\S+)/.exec(q)?.[1];
    const updated = /updated:>=(\S+)/.exec(q)?.[1];
    const state = /state:(open|closed)/.exec(q)?.[1]?.toUpperCase();
    const matching = one.nodes.filter(
      (n) =>
        (state === undefined || n.state === state) &&
        (closed === undefined || (n.closedAt !== null && n.closedAt >= closed)) &&
        (updated === undefined || n.updatedAt >= updated),
    );
    return { data: { repository, search: { issueCount: matching.length, ...pageOf(matching, variables.limit, variables.after, query) } } };
  }
  const states = variables.states ?? ['OPEN'];
  const matching = one.nodes.filter((n) => states.includes(n.state));
  return { data: { repository: { ...repository, issues: { totalCount: matching.length, ...pageOf(matching, variables.limit, variables.endCursor, query) } } } };
};

/** Answers one REST request the way GitHub pages a repository's Actions runs and workflows. */
const answerRest = (one, url) => {
  const params = url.searchParams;
  const perPage = Number(params.get('per_page') ?? 30);
  const page = Number(params.get('page') ?? 1);
  const slice = (all) => all.slice((page - 1) * perPage, page * perPage);
  if (url.pathname.endsWith('/actions/runs')) {
    const branch = params.get('branch');
    const matching = one.runs.filter((r) => branch === null || r.head_branch === branch);
    return { total_count: matching.length, workflow_runs: slice(matching) };
  }
  if (url.pathname.endsWith('/actions/workflows')) return { total_count: WORKFLOWS.length, workflows: slice(WORKFLOWS) };
  const workflow = /\/actions\/workflows\/(\d+)$/.exec(url.pathname);
  if (workflow !== null) return WORKFLOWS.find((w) => String(w.id) === workflow[1]) ?? null;
  return null;
};

/** Records one case. */
const record = async (kind, name, one, ghVersion) => {
  const dir = mkdtempSync(join(tmpdir().length > 60 ? '/tmp' : tmpdir(), 'ghr-'));
  try {
    const sock = join(dir, 's');
    const exchanges = [];
    const server = http.createServer((req, res) => {
      let text = '';
      req.on('data', (chunk) => (text += chunk));
      req.on('end', () => {
        const url = new URL(req.url, 'http://stub');
        const graphql = url.pathname === '/graphql' || url.pathname === '/api/graphql';
        const request = graphql ? { method: req.method, path: '/graphql', body: JSON.parse(text) } : { method: req.method, path: `${url.pathname.replace(/^\/api\/v3/, '')}${url.search}` };
        const response = graphql ? answerGraphql(one, request.body) : answerRest(one, url);
        const status = response === null ? 404 : 200;
        const body = response ?? { message: 'Not Found' };
        exchanges.push({ request, status, response: body });
        const resource = graphql ? 'graphql' : 'core';
        res.writeHead(status, { 'Content-Type': 'application/json', 'X-RateLimit-Resource': resource, 'X-RateLimit-Limit': '5000', 'X-RateLimit-Remaining': '4999', 'X-RateLimit-Reset': '1788003600' });
        res.end(JSON.stringify(body));
      });
    });
    await new Promise((resolve) => server.listen(sock, resolve));
    const config = join(dir, 'config');
    const bin = join(dir, 'bin');
    const calls = join(dir, 'calls');
    const repo = join(dir, 'repo');
    for (const d of [config, bin, calls, repo, join(dir, 'cache')]) mkdirSync(d);
    writeFileSync(join(config, 'config.yml'), `http_unix_socket: ${sock}\n`);
    const realGh = execFileSync('bash', ['-c', 'command -v gh'], { encoding: 'utf8' }).trim();
    writeFileSync(join(bin, 'gh'), [
      '#!/usr/bin/env bash',
      `n=$(ls ${JSON.stringify(calls)} | grep -c '\\.argv$' | tr -d ' ')`,
      `printf '%s\\n' "$@" > ${JSON.stringify(calls)}/$n.argv`,
      `XDG_CACHE_HOME=${JSON.stringify(join(dir, 'cache'))} GH_CONFIG_DIR=${JSON.stringify(config)} GH_TOKEN=fixture ${JSON.stringify(realGh)} "$@" > ${JSON.stringify(calls)}/$n.out 2> ${JSON.stringify(calls)}/$n.err; rc=$?`,
      `printf '%s' "$rc" > ${JSON.stringify(calls)}/$n.code`,
      `cat ${JSON.stringify(calls)}/$n.out; cat ${JSON.stringify(calls)}/$n.err >&2`,
      'exit $rc',
      '',
    ].join('\n'));
    chmodSync(join(bin, 'gh'), 0o755);
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['remote', 'add', 'origin', `git@github.com:${OWNER}/${REPO}.git`], { cwd: repo });
    const args = kind === 'issues' ? ['issue-list', ...one.args] : ['runs-for-sha', one.branch, one.sha];
    const said = await new Promise((resolve) => {
      const child = spawn('bash', [HOST, ...args], {
        cwd: repo,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PLOT_HOST: 'github', PLOT_CI: 'github-actions', PLOT_TRACKER: 'github-issues', PLOT_BUDGET_OFF: '1', GH_TOKEN: 'fixture' },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
    server.close();
    const argvFiles = readdirSync(calls).filter((f) => f.endsWith('.argv')).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    const recorded = argvFiles.map((f) => {
      const n = f.replace(/\.argv$/, '');
      return {
        argv: readFileSync(join(calls, f), 'utf8').replace(/\n$/, '').split('\n'),
        stdout: readFileSync(join(calls, `${n}.out`), 'utf8'),
        stderr: readFileSync(join(calls, `${n}.err`), 'utf8'),
        code: Number(readFileSync(join(calls, `${n}.code`), 'utf8')),
      };
    });
    const { nodes: _nodes, runs: _runs, disabled: _disabled, ...asked } = one;
    const fixture = { gh: ghVersion, ...asked, shell: { code: said.code }, calls: recorded, exchanges };
    writeFileSync(join(OUT[kind], `${name}.json`), `${JSON.stringify(fixture)}\n`);
    process.stdout.write(`${kind}/${name}: exit ${said.code}, ${recorded.length} gh call(s), ${exchanges.length} request(s)\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const main = async () => {
  for (const dir of Object.values(OUT)) if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const ghVersion = execFileSync('gh', ['--version'], { encoding: 'utf8' }).split('\n')[0];
  const names = process.argv.slice(2);
  const all = [...Object.entries(ISSUE_CASES).map(([n, c]) => ['issues', n, c]), ...Object.entries(RUN_CASES).map(([n, c]) => ['runs', n, c])];
  for (const [kind, name, one] of all) {
    if (names.length > 0 && !names.includes(name)) continue;
    await record(kind, name, one, ghVersion);
  }
};

await main();
