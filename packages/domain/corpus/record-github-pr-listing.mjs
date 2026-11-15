#!/usr/bin/env node
/**
 * Records the fixtures `github-pr-listing.corpus.test.ts` reads.
 *
 * For each case it runs `plot-host.sh pr-list` with the real `gh` on `PATH`,
 * and points `gh` at a local stub GitHub through `gh`'s `http_unix_socket`
 * setting. The stub serves the case's pull requests the way GitHub's GraphQL
 * API pages them. The recorder writes, per case:
 *
 * - `exchanges`: every GraphQL request `gh` sent and the answer the stub gave,
 *   in order. The corpus serves these to the in-process adapter.
 * - `calls`: every `gh` argv `plot-host.sh` ran and the stdout `gh` printed.
 *   The corpus serves these to `plot-host.sh` through a stub `gh`.
 * - `gh`: the `gh --version` line, because a `gh` upgrade can change the
 *   query a fixture stands for.
 *
 * It makes no network call and reads no real token: `gh` runs with
 * `GH_TOKEN=fixture`, its own config directory and its own cache directory.
 *
 * Usage: node packages/domain/corpus/record-github-pr-listing.mjs [case ...]
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const HOST = join(ROOT, 'skills/plot/scripts/plot-host.sh');
const OUT = join(ROOT, 'packages/domain/corpus/fixtures/github-pr-listing');
const OWNER = 'plot-fixture';
const REPO = 'listing';

/** The fields `plot-host.sh`'s plain arm asks for. */
const PLAIN = ['number', 'title', 'state', 'headRefName', 'isDraft', 'url', 'updatedAt', 'author', 'headRefOid', 'mergedAt'];
/** The fields the rich arm adds. */
const RICH = [...PLAIN, 'statusCheckRollup', 'mergeable', 'mergeStateStatus', 'reviewDecision'];

const sha = (n, salt = 'h') => {
  let s = '';
  for (let i = 0; s.length < 40; i += 1) s += ((n * 2654435761 + i * 40503 + salt.charCodeAt(0)) >>> 0).toString(16);
  return s.slice(0, 40);
};
const stamp = (n) => new Date(Date.UTC(2026, 9, 1) + n * 3_600_000).toISOString().replace('.000Z', 'Z');

const checkRun = (name, status, conclusion, workflow = 'CI') => ({
  __typename: 'CheckRun',
  name,
  checkSuite: { workflowRun: workflow === null ? null : { workflow: { name: workflow } } },
  status,
  conclusion,
  startedAt: status === 'QUEUED' ? null : '2026-10-02T10:00:00Z',
  completedAt: status === 'COMPLETED' ? '2026-10-02T10:05:00Z' : null,
  detailsUrl: `https://github.com/${OWNER}/${REPO}/actions/runs/1/job/${name.length}`,
});
const statusContext = (context, state, createdAt = '2026-10-02T11:00:00Z') => ({
  __typename: 'StatusContext',
  context,
  state,
  targetUrl: state === 'EXPECTED' ? null : `https://ci.example.test/${context}`,
  createdAt,
  description: `${context} ${state.toLowerCase()}`,
});

/**
 * The check rollups the generated pull requests cycle through. `null` is a
 * head commit with no rollup; `'no-commit'` is a pull request whose commit
 * list is empty.
 */
const ROLLUPS = [
  null,
  [checkRun('build', 'COMPLETED', 'SUCCESS')],
  [checkRun('build', 'IN_PROGRESS', null), statusContext('ci/other', 'SUCCESS')],
  [checkRun('build', 'COMPLETED', 'ACTION_REQUIRED')],
  [statusContext('plot/review', 'SUCCESS'), checkRun('build', 'COMPLETED', 'SUCCESS')],
  [statusContext('plot/review', 'PENDING', '2026-10-03T08:30:00Z')],
  [checkRun('test', 'COMPLETED', 'FAILURE'), checkRun('lint', 'COMPLETED', 'NEUTRAL'), checkRun('docs', 'COMPLETED', 'SKIPPED')],
  [statusContext('deploy', 'ERROR'), statusContext('plot/review', 'FAILURE')],
  [checkRun('build', 'QUEUED', null, null)],
  [statusContext('ci/expected', 'EXPECTED')],
  [checkRun('a', 'COMPLETED', 'TIMED_OUT'), checkRun('b', 'COMPLETED', 'CANCELLED'), checkRun('c', 'COMPLETED', 'STALE'), checkRun('d', 'COMPLETED', 'STARTUP_FAILURE')],
  'no-commit',
  [checkRun('w', 'WAITING', null), checkRun('p', 'PENDING', null), checkRun('r', 'REQUESTED', null)],
  [checkRun('plot/review', 'COMPLETED', 'SUCCESS'), statusContext('ci/other', 'FAILURE')],
  [statusContext('plot/review', 'ERROR'), statusContext('ci/other', 'PENDING')],
  [checkRun('build', 'COMPLETED', 'SUCCESS'), statusContext('plot/review', 'SUCCESS', '2026-10-04T09:00:00Z'), statusContext('plot/review', 'PENDING')],
  [checkRun('', 'COMPLETED', 'FAILURE'), statusContext('ci/fail', 'FAILURE')],
];
const MERGEABLE = [
  ['MERGEABLE', 'CLEAN'],
  ['CONFLICTING', 'DIRTY'],
  ['UNKNOWN', 'UNKNOWN'],
  ['MERGEABLE', 'BLOCKED'],
  ['MERGEABLE', 'DIRTY'],
  ['UNKNOWN', 'BEHIND'],
];
const REVIEWS = [null, 'APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'];

/**
 * One pull request as GitHub's GraphQL API answers it for the rich fragment.
 *
 * @param n - the PR number; every attribute derives from it.
 * @param state - `OPEN`, `MERGED` or `CLOSED`.
 */
const pr = (n, state) => {
  const rollup = ROLLUPS[n % ROLLUPS.length];
  const [mergeable, mergeStateStatus] = state === 'OPEN' ? MERGEABLE[n % MERGEABLE.length] : ['UNKNOWN', 'UNKNOWN'];
  const author = n % 13 === 0 ? null : n % 11 === 0 ? { login: 'dependabot' } : { login: `dev${n % 4}`, id: `U_${n % 4}`, name: `Dev ${n % 4}` };
  return {
    number: n,
    title: `Change ${n}${n % 9 === 0 ? ' "quoted" & <tagged>' : ''}`,
    state,
    headRefName: n % 17 === 0 ? `feature/ünïcode-${n}` : `feature/change-${n}`,
    isDraft: state === 'OPEN' && n % 7 === 0,
    statusCheckRollup: {
      nodes: rollup === 'no-commit' ? [] : [{ commit: { statusCheckRollup: rollup === null ? null : { contexts: { nodes: rollup, pageInfo: { hasNextPage: false, endCursor: rollup.length === 0 ? null : 'ctx' } } } } }],
    },
    mergeable,
    mergeStateStatus,
    reviewDecision: REVIEWS[n % REVIEWS.length],
    url: `https://github.com/${OWNER}/${REPO}/pull/${n}`,
    updatedAt: stamp(n),
    author,
    headRefOid: sha(n),
    mergedAt: state === 'MERGED' ? stamp(n + 1) : null,
  };
};

const range = (from, count, state) => Array.from({ length: count }, (_, i) => pr(from - i, typeof state === 'function' ? state(from - i) : state));
const mixed = (n) => (n % 5 === 0 ? 'OPEN' : n % 3 === 0 ? 'CLOSED' : 'MERGED');

/**
 * The cases. `nodes` is every pull request the stub repository holds, newest
 * first; `args` is the `pr-list` argv after the op.
 */
const CASES = {
  'open-rich-two-pages': {
    query: { state: 'open', limit: 150, rich: true },
    args: ['--rich', '--state', 'open', '--limit', '150'],
    nodes: range(400, 120, 'OPEN'),
  },
  'open-rich-at-limit': {
    query: { state: 'open', limit: 5, rich: true },
    args: ['--rich', '--state', 'open', '--limit', '5'],
    nodes: range(400, 40, 'OPEN'),
  },
  'open-rich-empty': {
    query: { state: 'open', limit: 50, rich: true },
    args: ['--rich', '--state', 'open', '--limit', '50'],
    nodes: range(90, 6, 'MERGED'),
  },
  'open-rich-no-limit': {
    query: { state: 'open', rich: true },
    args: ['--rich', '--state', 'open'],
    nodes: range(300, 34, 'OPEN'),
  },
  'open-plain-duplicate': {
    query: { state: 'open', limit: 150 },
    args: ['--state', 'open', '--limit', '150'],
    nodes: [...range(250, 100, 'OPEN'), pr(151, 'OPEN'), ...range(150, 10, 'OPEN')],
  },
  'all-rich-open': {
    query: { state: 'all', limit: 200, richOpen: true },
    args: ['--rich-open', '--state', 'all', '--limit', '200'],
    nodes: range(700, 140, mixed),
  },
  'merged-plain-three-pages': {
    query: { state: 'merged', limit: 500 },
    args: ['--state', 'merged', '--limit', '500'],
    nodes: [...range(900, 230, 'MERGED'), ...range(600, 20, 'CLOSED')],
  },
  'since-all-rich-open': {
    query: { state: 'all', limit: 200, since: '2026-10-25T00:00:00Z', richOpen: true },
    args: ['--rich-open', '--state', 'all', '--limit', '200', '--since', '2026-10-25T00:00:00Z'],
    nodes: range(700, 140, mixed),
  },
  'since-merged': {
    query: { state: 'merged', limit: 500, since: '2026-10-28T12:00:00Z' },
    args: ['--state', 'merged', '--limit', '500', '--since', '2026-10-28T12:00:00Z'],
    nodes: range(900, 230, (n) => (n % 4 === 0 ? 'CLOSED' : 'MERGED')),
  },
  'since-open-rich-at-limit': {
    query: { state: 'open', limit: 3, since: '2026-10-01T00:00:00Z', rich: true },
    args: ['--rich', '--state', 'open', '--limit', '3', '--since', '2026-10-01T00:00:00Z'],
    nodes: range(400, 12, 'OPEN'),
  },
};

/** Keeps the fields the request's fragment names. */
const project = (node, query) => {
  const fields = /statusCheckRollup/.test(query) ? RICH : PLAIN;
  return Object.fromEntries(fields.map((f) => [f, node[f]]));
};

const STATES_OF_SEARCH = { 'state:open': ['OPEN'], 'is:merged': ['MERGED'], 'state:closed': ['CLOSED', 'MERGED'] };

/** Answers one GraphQL request the way GitHub pages a repository's pull requests. */
const answer = (nodes, body) => {
  const { query, variables = {} } = body;
  if (/SearchType_enumValues/.test(query)) {
    return { data: { SearchType: { enumValues: ['DISCUSSION', 'ISSUE', 'ISSUE_ADVANCED', 'REPOSITORY', 'USER'].map((name) => ({ name })) } } };
  }
  const offset = variables.endCursor ? Number(String(variables.endCursor).replace('cursor:', '')) : 0;
  const page = (matching) => {
    const slice = matching.slice(offset, offset + variables.limit).map((node) => project(node, query));
    const more = offset + variables.limit < matching.length;
    return {
      nodes: slice,
      pageInfo: { hasNextPage: more, endCursor: slice.length === 0 ? null : `cursor:${offset + slice.length}` },
    };
  };
  if (/search\(/.test(query)) {
    const q = String(variables.q);
    const since = /updated:>(\S+)/.exec(q)?.[1];
    const qualifier = Object.keys(STATES_OF_SEARCH).find((word) => q.includes(word));
    const states = qualifier === undefined ? null : STATES_OF_SEARCH[qualifier];
    const matching = nodes.filter((n) => (states === null || states.includes(n.state)) && (since === undefined || n.updatedAt > since));
    return { data: { search: { issueCount: matching.length, ...page(matching) } } };
  }
  const states = variables.state ?? ['OPEN'];
  const matching = nodes.filter((n) => states.includes(n.state));
  return { data: { repository: { pullRequests: { totalCount: matching.length, ...page(matching) } } } };
};

/** Records one case. */
const record = async (name, one, ghVersion) => {
  const dir = mkdtempSync(join(tmpdir().length > 60 ? '/tmp' : tmpdir(), 'ghr-'));
  try {
    const sock = join(dir, 's');
    const exchanges = [];
    const server = http.createServer((req, res) => {
      let text = '';
      req.on('data', (chunk) => (text += chunk));
      req.on('end', () => {
        const request = JSON.parse(text);
        const response = answer(one.nodes, request);
        exchanges.push({ request, response });
        res.writeHead(200, { 'Content-Type': 'application/json', 'X-RateLimit-Resource': 'graphql', 'X-RateLimit-Limit': '5000', 'X-RateLimit-Remaining': '4999', 'X-RateLimit-Reset': '1788003600' });
        res.end(JSON.stringify(response));
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
      `n=$(ls ${JSON.stringify(calls)} | wc -l | tr -d ' ')`,
      `printf '%s\\n' "$@" > ${JSON.stringify(calls)}/$n.argv`,
      `out="$(XDG_CACHE_HOME=${JSON.stringify(join(dir, 'cache'))} GH_CONFIG_DIR=${JSON.stringify(config)} GH_TOKEN=fixture ${JSON.stringify(realGh)} "$@")"; rc=$?`,
      `printf '%s' "$out" > ${JSON.stringify(calls)}/$n.argv.out`,
      'printf \'%s\\n\' "$out"',
      'exit $rc',
      '',
    ].join('\n'));
    chmodSync(join(bin, 'gh'), 0o755);
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['remote', 'add', 'origin', `git@github.com:${OWNER}/${REPO}.git`], { cwd: repo });
    const run = await new Promise((resolve) => {
      const child = spawn('bash', [HOST, 'pr-list', ...one.args], {
        cwd: repo,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PLOT_HOST: 'github', PLOT_CI: 'github-actions', PLOT_BUDGET_OFF: '1', GH_TOKEN: 'fixture' },
      });
      let stderr = '';
      child.stderr.on('data', (d) => (stderr += d));
      child.stdout.resume();
      child.on('close', (code) => resolve({ code, stderr }));
    });
    server.close();
    if (run.code !== 0) throw new Error(`${name}: plot-host.sh pr-list exited ${run.code}: ${run.stderr}`);
    const argvFiles = readdirSync(calls).filter((f) => f.endsWith('.argv')).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    const recorded = argvFiles.map((f) => ({
      argv: readFileSync(join(calls, f), 'utf8').replace(/\n$/, '').split('\n'),
      stdout: readFileSync(join(calls, `${f}.out`), 'utf8'),
    }));
    const fixture = { gh: ghVersion, query: one.query, args: one.args, calls: recorded, exchanges };
    writeFileSync(join(OUT, `${name}.json`), `${JSON.stringify(fixture)}\n`);
    process.stdout.write(`${name}: ${recorded.length} gh call(s), ${exchanges.length} request(s)\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const main = async () => {
  mkdirSync(OUT, { recursive: true });
  const ghVersion = execFileSync('gh', ['--version'], { encoding: 'utf8' }).split('\n')[0];
  const names = process.argv.slice(2);
  for (const name of names.length === 0 ? Object.keys(CASES) : names) {
    if (CASES[name] === undefined) throw new Error(`no case named ${name}`);
    await record(name, CASES[name], ghVersion);
  }
};

await main();
