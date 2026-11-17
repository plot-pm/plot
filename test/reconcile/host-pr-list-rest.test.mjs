// `plot-host.sh pr-list` on GitHub over REST — the plain listing's second
// transport. GitHub meters GraphQL and REST separately, and on 2026-11-16 the
// GraphQL bucket read 0 while REST answered: every `pr-list` caller failed with
// exit 5 because the op had no REST arm. The `gh` on PATH is a stub that logs
// its argv and answers from fixtures; nothing reaches a real host.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Every directory this file creates, removed after its last test by the exact
// path mkdtempSync returned — never by a glob over the shared temp directory.
const made = [];
after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const adapter = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-host.sh');
const ACCOUNT = 'test-account';

/** One PR in the shape GitHub's REST `pulls` list returns. */
const restPr = (number, { state = 'open', merged = false, draft = false, head = `feature/b${number}`, updated }) => ({
  number,
  title: `PR ${number}`,
  state,
  draft,
  html_url: `https://github.com/o/r/pull/${number}`,
  updated_at: updated ?? `2026-11-${String(10 + (number % 5)).padStart(2, '0')}T10:00:${String(number % 60).padStart(2, '0')}Z`,
  merged_at: merged ? `2026-11-15T09:00:${String(number % 60).padStart(2, '0')}Z` : null,
  user: { login: `user${number}` },
  head: { ref: head, sha: String(number).padStart(40, 'a') },
  base: { ref: 'main' },
});

/** The same PR as `gh pr list --json …` prints it: GitHub's own GraphQL answer, modelled. */
const graphqlOf = (p) => ({
  number: p.number,
  title: p.title,
  state: p.merged_at ? 'MERGED' : p.state.toUpperCase(),
  headRefName: p.head.ref,
  baseRefName: p.base.ref,
  isDraft: p.draft,
  url: p.html_url,
  updatedAt: p.updated_at,
  author: { id: `U_${p.number}`, is_bot: false, login: p.user.login, name: '' },
  headRefOid: p.head.sha,
  mergedAt: p.merged_at,
});

/** What GitHub's GraphQL `gh pr list` answers for these flags: newest first, filtered, cut at the limit. */
const graphqlAnswer = (prs, { state = 'open', limit = 30, head = '', since = '' } = {}) =>
  prs
    .filter((p) => state === 'all'
      || (state === 'open' && p.state === 'open')
      || (state === 'merged' && p.merged_at !== null)
      || (state === 'closed' && p.state === 'closed' && p.merged_at === null))
    .filter((p) => head === '' || p.head.ref === head)
    .filter((p) => since === '' || p.updated_at > since)
    .sort((a, b) => b.number - a.number)
    .slice(0, limit)
    .map(graphqlOf);

// The stub. `api repos/<o>/<r>/pulls?…` answers one page of the REST fixture,
// filtered by `state=` and `head=` and ordered by `sort=` the way GitHub does;
// `pr list` prints the GraphQL answer file, or fails with `GQL_FAIL`'s words.
const STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_CALLS"
if [ "$1" = pr ] && [ "$2" = list ]; then
  [ -z "\${GQL_FAIL:-}" ] || { printf '%s\\n' "$GQL_FAIL" >&2; exit 1; }
  cat "$STUB_GQL"; exit 0
fi
if [ "$1" = api ]; then
  case "$2" in
    repos/*/pulls\\?*)
      [ -z "\${REST_FAIL:-}" ] || { printf '%s\\n' "$REST_FAIL" >&2; exit 1; }
      q="\${2#*\\?}"
      st=$(printf '%s' "$q" | sed -n 's/.*state=\\([a-z]*\\).*/\\1/p')
      pg=$(printf '%s' "$q" | sed -n 's/.*[?&]*page=\\([0-9]*\\).*/\\1/p')
      hd=$(printf '%s' "$q" | sed -n 's/.*head=[^:]*:\\([^&]*\\).*/\\1/p')
      so=$(printf '%s' "$q" | sed -n 's/.*sort=\\([a-z]*\\).*/\\1/p')
      jq -c --arg st "$st" --argjson pg "\${pg:-1}" --arg hd "$hd" --arg so "$so" '
        map(select($st == "all" or .state == $st)) | map(select($hd == "" or .head.ref == $hd))
        | (if $so == "updated" then sort_by(.updated_at) | reverse else sort_by(.number) | reverse end)
        | .[(($pg - 1) * 100):($pg * 100)]' "$STUB_REST"
      exit 0 ;;
  esac
fi
echo '{}'
`;

/** A scratch repo with the stub `gh` first on PATH and a budget record of its own. */
const sandbox = ({ prs, gql = [], graphqlRemaining = null } = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-host-pr-list-rest-'));
  made.push(root);
  execFileSync('git', ['init', '-q', root]);
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), STUB);
  fs.chmodSync(path.join(bin, 'gh'), 0o755);
  const budgetHome = path.join(root, 'budget-home');
  fs.mkdirSync(budgetHome);
  if (graphqlRemaining !== null) {
    const at = Date.now();
    fs.writeFileSync(path.join(budgetHome, 'budget.tsv'), [
      `b1\tgithub\t${ACCOUNT}\tcore\t${at - 1000}\t1\t5000\t4990\t-\tactual`,
      `b1\tgithub\t${ACCOUNT}\tgraphql\t${at}\t1\t5000\t${graphqlRemaining}\t-\tactual`,
      '',
    ].join('\n'));
  }
  const rest = path.join(root, 'rest.json');
  fs.writeFileSync(rest, JSON.stringify(prs ?? []));
  const gqlFile = path.join(root, 'gql.json');
  fs.writeFileSync(gqlFile, JSON.stringify(gql));
  return { root, bin, budgetHome, rest, gqlFile, calls: path.join(root, 'calls') };
};

const pristineEnv = () => {
  const env = { ...process.env };
  delete env.PLOT_REPO_ROOT;
  delete env.PLOT_UNATTENDED;
  delete env.PLOT_HOST_FORCE_REST;
  return env;
};

/** Runs `plot-host.sh pr-list …` in the sandbox: exit code, both streams, and the stub's argv log. */
const prList = (box, args, env = {}) => {
  const res = spawnSync('bash', [adapter, 'pr-list', ...args], {
    cwd: box.root,
    encoding: 'utf8',
    env: {
      ...pristineEnv(),
      PATH: `${box.bin}:${process.env.PATH}`,
      PLOT_HOST: 'github',
      PLOT_BUDGET_HOME: box.budgetHome,
      PLOT_BUDGET_ACCOUNT: ACCOUNT,
      GH_CONFIG_DIR: path.join(box.root, 'gh-config'),
      STUB_CALLS: path.join(box.root, 'calls'),
      STUB_REST: box.rest,
      STUB_GQL: box.gqlFile,
      ...env,
    },
  });
  const calls = fs.existsSync(box.calls) ? fs.readFileSync(box.calls, 'utf8').trim().split('\n').filter(Boolean) : [];
  return { code: res.status, stdout: res.stdout, stderr: res.stderr, calls };
};

const restCalls = (calls) => calls.filter((c) => c.startsWith('api repos/'));
const graphqlCalls = (calls) => calls.filter((c) => c.startsWith('pr list'));

// Open, draft, merged and closed-unmerged PRs, on distinct branches and stamps.
const FIXTURE = [
  restPr(1, { state: 'closed', merged: true }),
  restPr(2, { state: 'closed' }),
  restPr(3, { draft: true }),
  restPr(4, { state: 'closed', merged: true, head: 'feature/shared' }),
  restPr(5, { head: 'feature/shared' }),
  restPr(6, {}),
  restPr(7, { state: 'closed', merged: true }),
  restPr(8, { state: 'closed' }),
];

// THE CONTRACT: a caller cannot tell which transport answered. Each flag set is
// asked twice against one population, once per route, and the lines must match.
for (const flags of [
  { state: 'open' },
  { state: 'merged' },
  { state: 'closed' },
  { state: 'all' },
  { state: 'settled' },
  { state: 'all', limit: 3 },
  { state: 'merged', limit: 1 },
  { state: 'all', head: 'feature/shared' },
  { state: 'open', head: 'feature/shared' },
  { state: 'all', since: '2026-11-12T10:00:00Z' },
  { state: 'merged', since: '2026-11-11T00:00:00Z' },
]) {
  test(`pr-list: REST and GraphQL print the same lines for ${JSON.stringify(flags)}`, () => {
    const args = ['--state', flags.state];
    if (flags.limit) args.push('--limit', String(flags.limit));
    if (flags.head) args.push('--branch', flags.head);
    if (flags.since) args.push('--since', flags.since);
    const gqlState = flags.state === 'settled' ? 'all' : flags.state;
    const gql = graphqlAnswer(FIXTURE, { ...flags, state: gqlState });
    const viaGraphql = prList(sandbox({ prs: FIXTURE, gql }), args);
    const viaRest = prList(sandbox({ prs: FIXTURE }), args, { PLOT_HOST_FORCE_REST: '1' });
    assert.equal(viaGraphql.code, 0, viaGraphql.stderr);
    assert.equal(viaRest.code, 0, viaRest.stderr);
    assert.ok(viaGraphql.stdout.trim() !== '' || gql.length === 0, 'the GraphQL fixture answered rows');
    assert.equal(viaRest.stdout, viaGraphql.stdout, 'a caller must not be able to tell which route answered');
    assert.equal(graphqlCalls(viaRest.calls).length, 0, 'the forced REST run asks no GraphQL');
    assert.ok(restCalls(viaRest.calls).length > 0, 'the forced REST run asks REST');
  });
}

test('pr-list: a REST row carries MERGED, the draft flag and every plain field', () => {
  const out = prList(sandbox({ prs: FIXTURE }), ['--state', 'all'], { PLOT_HOST_FORCE_REST: '1' });
  assert.equal(out.code, 0, out.stderr);
  const rows = out.stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(rows.find((r) => r.number === 7), {
    number: 7, title: 'PR 7', state: 'MERGED', head: 'feature/b7', base: 'main', draft: false, url: 'https://github.com/o/r/pull/7',
    updatedAt: FIXTURE[6].updated_at, headSha: FIXTURE[6].head.sha, mergedAt: FIXTURE[6].merged_at, author: 'user7',
  });
  assert.equal(rows.find((r) => r.number === 2).state, 'CLOSED');
  assert.equal(rows.find((r) => r.number === 2).mergedAt, '');
  assert.equal(rows.find((r) => r.number === 3).draft, true);
});

test('pr-list: --branch with one branch asks REST with head=, as GraphQL asks --head', () => {
  const out = prList(sandbox({ prs: FIXTURE }), ['--state', 'open', '--branch', 'feature/shared'], { PLOT_HOST_FORCE_REST: '1' });
  assert.equal(out.code, 0, out.stderr);
  assert.match(restCalls(out.calls)[0], /[?&]head=\{owner\}:feature\/shared(&|$| )/);
});

test('pr-list: --repo pins the REST path to that repository', () => {
  const out = prList(sandbox({ prs: FIXTURE }), ['--state', 'open', '--repo', 'acme/widgets'], { PLOT_HOST_FORCE_REST: '1' });
  assert.equal(out.code, 0, out.stderr);
  assert.match(restCalls(out.calls)[0], /^api repos\/acme\/widgets\/pulls\?state=open&/);
});

test('pr-list: a spent GraphQL budget routes the plain listing to REST without asking GraphQL', () => {
  const box = sandbox({ prs: FIXTURE, graphqlRemaining: 0 });
  const out = prList(box, ['--state', 'all']);
  assert.equal(out.code, 0, out.stderr);
  assert.equal(out.stdout.trim().split('\n').length, FIXTURE.length);
  assert.equal(graphqlCalls(out.calls).length, 0, 'a known-spent bucket is not asked');
  assert.equal(restCalls(out.calls).length, 1);
});

test('pr-list: GraphQL with budget left stays the default route', () => {
  const box = sandbox({ prs: FIXTURE, gql: graphqlAnswer(FIXTURE, { state: 'open' }), graphqlRemaining: 4000 });
  const out = prList(box, ['--state', 'open']);
  assert.equal(out.code, 0, out.stderr);
  assert.equal(graphqlCalls(out.calls).length, 1);
  assert.equal(restCalls(out.calls).length, 0, 'REST is the fallback, not the default');
});

test('pr-list: a GraphQL refusal for rate falls back to REST and answers', () => {
  const gqlFail = 'GraphQL: API rate limit already exceeded for user ID 1.';
  const viaFallback = prList(sandbox({ prs: FIXTURE }), ['--state', 'merged'], { GQL_FAIL: gqlFail });
  const viaGraphql = prList(sandbox({ prs: FIXTURE, gql: graphqlAnswer(FIXTURE, { state: 'merged' }) }), ['--state', 'merged']);
  assert.equal(viaFallback.code, 0, viaFallback.stderr);
  assert.equal(viaFallback.stdout, viaGraphql.stdout);
  assert.equal(graphqlCalls(viaFallback.calls).length, 1, 'GraphQL was asked first');
  assert.equal(restCalls(viaFallback.calls).length, 1, 'then REST, once');
  assert.doesNotMatch(viaFallback.stderr, /throttled|rate limit/, 'an answered list reports no refusal');
});

test('pr-list: a GraphQL failure that is not a rate refusal does not fall back', () => {
  const out = prList(sandbox({ prs: FIXTURE }), ['--state', 'open'], { GQL_FAIL: 'error connecting to api.github.com' });
  assert.equal(out.code, 3);
  assert.equal(out.stdout, '');
  assert.equal(restCalls(out.calls).length, 0);
  assert.match(out.stderr, /error connecting to api\.github\.com/);
});

test('pr-list: a failed REST call exits non-zero and prints nothing on stdout', () => {
  const out = prList(sandbox({ prs: FIXTURE }), ['--state', 'all'], { PLOT_HOST_FORCE_REST: '1', REST_FAIL: 'HTTP 502: Bad Gateway (https://api.github.com/repos/o/r/pulls)' });
  assert.notEqual(out.code, 0);
  assert.equal(out.stdout, '');
  assert.match(out.stderr, /pr-list/);
});

test('pr-list: a REST refusal for rate after a GraphQL one exits 5 with nothing on stdout', () => {
  const out = prList(sandbox({ prs: FIXTURE }), ['--state', 'open'], {
    GQL_FAIL: 'GraphQL: API rate limit already exceeded for user ID 1.',
    REST_FAIL: 'HTTP 403: API rate limit exceeded for user ID 1.',
  });
  assert.equal(out.code, 5);
  assert.equal(out.stdout, '');
  assert.match(out.stderr, /host throttled — HTTP 403: API rate limit exceeded/);
  assert.equal(restCalls(out.calls).length, 1, 'REST is asked once, never in a loop');
});

test('pr-list: an empty REST answer is an answer — exit 0, no lines', () => {
  const out = prList(sandbox({ prs: [] }), ['--state', 'open'], { PLOT_HOST_FORCE_REST: '1' });
  assert.equal(out.code, 0, out.stderr);
  assert.equal(out.stdout, '');
});

// PAGING: REST returns 100 rows a page, so a limit past that reads a second page
// and a limit inside the first reads one. A filtered state keeps paging until
// the limit holds enough of its own rows.
test('pr-list: REST pages until the limit is met, and no further', () => {
  const many = Array.from({ length: 250 }, (_, i) => restPr(i + 1, { state: i % 2 ? 'open' : 'closed', merged: i % 2 === 0 }));
  const big = prList(sandbox({ prs: many }), ['--state', 'all', '--limit', '150'], { PLOT_HOST_FORCE_REST: '1' });
  assert.equal(big.code, 0, big.stderr);
  assert.equal(big.stdout.trim().split('\n').length, 150);
  assert.equal(restCalls(big.calls).length, 2);
  assert.equal(JSON.parse(big.stdout.split('\n')[0]).number, 250, 'newest first');
  const small = prList(sandbox({ prs: many }), ['--state', 'all'], { PLOT_HOST_FORCE_REST: '1' });
  assert.equal(small.stdout.trim().split('\n').length, 30, "gh's default limit of 30");
  assert.equal(restCalls(small.calls).length, 1);
  const closed = Array.from({ length: 250 }, (_, i) => restPr(i + 1, { state: 'closed', merged: i % 2 === 0 }));
  const merged = prList(sandbox({ prs: closed }), ['--state', 'merged', '--limit', '120'], { PLOT_HOST_FORCE_REST: '1' });
  assert.equal(merged.stdout.trim().split('\n').length, 120);
  assert.equal(restCalls(merged.calls).length, 3, 'closed rows are half merged, so 120 merged rows take three pages');
  assert.match(merged.stderr, /possibly truncated/, 'a full limit still reports that it may be truncated');
});

test('pr-list: --since reads sort=updated pages and stops at the first page that reaches the stamp', () => {
  const many = Array.from({ length: 250 }, (_, i) => restPr(i + 1, { updated: `2026-11-01T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z` }));
  // Rows 201–250 are newer than the stamp of row 200.
  const out = prList(sandbox({ prs: many }), ['--state', 'open', '--limit', '500', '--since', many[199].updated_at], { PLOT_HOST_FORCE_REST: '1' });
  assert.equal(out.code, 0, out.stderr);
  const numbers = out.stdout.trim().split('\n').map((l) => JSON.parse(l).number);
  assert.equal(numbers.length, 50);
  assert.equal(Math.min(...numbers), 201);
  assert.equal(restCalls(out.calls).length, 1, 'the first page already reaches the stamp');
  assert.match(restCalls(out.calls)[0], /sort=updated&direction=desc/);
});

// THE RICH FIELDS STAY GRAPHQL. REST's list carries no check rollup, no
// `mergeable` and no `reviewDecision`, so a rich row cannot come from it; the
// route does not move a rich call, and a rich call is never answered thinner.
test('pr-list: --rich stays on GraphQL even when REST is forced', () => {
  const box = sandbox({ prs: FIXTURE, gql: [] });
  const out = prList(box, ['--rich', '--state', 'open'], { PLOT_HOST_FORCE_REST: '1' });
  assert.equal(out.code, 0, out.stderr);
  assert.equal(restCalls(out.calls).length, 0);
  assert.match(graphqlCalls(out.calls)[0], /statusCheckRollup/);
});

test('pr-list: --rich-open asks its terminal half over REST and its open half over GraphQL', () => {
  const box = sandbox({ prs: FIXTURE, gql: [] });
  const out = prList(box, ['--rich-open', '--state', 'all'], { PLOT_HOST_FORCE_REST: '1' });
  assert.equal(out.code, 0, out.stderr);
  assert.equal(graphqlCalls(out.calls).length, 1, 'the rich open half');
  assert.match(graphqlCalls(out.calls)[0], /statusCheckRollup/);
  assert.equal(restCalls(out.calls).length, 1, 'the plain half');
  const rows = out.stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((r) => r.number).sort(), [1, 2, 4, 7, 8], 'the terminal rows, from REST');
  assert.ok(rows.every((r) => r.checks === 'unknown'));
});
