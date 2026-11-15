// Contract test for `plot-host.sh pr-conversation <number>`: the PR author and
// every issue comment, inline comment and review, read REST-only from every page.
// Needs only a stubbed `gh`.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const host = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-host.sh');

const made = [];
const tmp = (tag) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `plot-${tag}-`));
  made.push(d);
  return d;
};
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const pages = (list) => JSON.stringify(list.map((page) => JSON.stringify(page)).join(''));

/**
 * A `gh` answering the three paginated reads and the pull. Each of `issue`,
 * `inline` and `reviews` is a list of pages, printed back to back as
 * `gh api --paginate` prints them. `failOn` fails the call whose argv contains
 * it. A `pr view` or `api graphql` call exits 9, so a GraphQL read fails the test.
 */
const ghStub = ({ pull = { user: { login: 'jwloka' } }, issue = [[]], inline = [[]], reviews = [[]], failOn = null }) => {
  const dir = tmp('pr-conversation');
  const body = `#!/usr/bin/env bash
case "$*" in
  *${failOn ?? 'NEVER-MATCHES'}*) echo "HTTP 502" >&2; exit 1 ;;
  "api repos/{owner}/{repo}/pulls/7 --include") printf '%s' ${JSON.stringify(JSON.stringify(pull))} ;;
  "api --paginate repos/{owner}/{repo}/issues/7/comments?per_page=100") printf '%s' ${pages(issue)} ;;
  "api --paginate repos/{owner}/{repo}/pulls/7/comments?per_page=100") printf '%s' ${pages(inline)} ;;
  "api --paginate repos/{owner}/{repo}/pulls/7/reviews?per_page=100") printf '%s' ${pages(reviews)} ;;
  *) exit 9 ;;
esac
`;
  fs.writeFileSync(path.join(dir, 'gh'), body);
  fs.chmodSync(path.join(dir, 'gh'), 0o755);
  return dir;
};

const run = (dir, { backend = 'github' } = {}) => spawnSync('bash', [host, 'pr-conversation', '7'], {
  encoding: 'utf8',
  env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, PLOT_HOST: backend, PLOT_BUDGET_HOME: tmp('pr-conversation-budget') },
});

const user = (login, type = 'User') => ({ login, type });

test('pr-conversation reads all three kinds with author, type, time and state', () => {
  const r = run(ghStub({
    issue: [[{ id: 1, user: user('eins78'), created_at: '2026-11-09T14:32:00Z', updated_at: '2026-11-09T16:00:00Z', body: 'why?' }]],
    inline: [[{ id: 2, user: user('ci-bot', 'Bot'), created_at: '2026-11-09T14:40:00Z', body: 'nit' }]],
    reviews: [[{ id: 3, user: user('eins78'), submitted_at: '2026-11-09T15:00:00Z', state: 'APPROVED', body: '' }]],
  }));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), {
    prAuthor: 'jwloka',
    rows: [
      { kind: 'issue', id: 1, login: 'eins78', type: 'User', time: '2026-11-09T14:32:00Z', body: 'why?' },
      { kind: 'inline', id: 2, login: 'ci-bot', type: 'Bot', time: '2026-11-09T14:40:00Z', body: 'nit' },
      { kind: 'review', id: 3, login: 'eins78', type: 'User', time: '2026-11-09T15:00:00Z', body: '', state: 'APPROVED' },
    ],
  });
});

test('pr-conversation returns the comment on page 2 of each endpoint', () => {
  const row = (id) => ({ id, user: user('a'), created_at: 't', body: 'b' });
  const r = run(ghStub({
    issue: [[row(1)], [row(2)]],
    inline: [[row(3)], [row(4)]],
    reviews: [[{ ...row(5), submitted_at: 't', state: 'COMMENTED' }], [{ ...row(6), submitted_at: 't', state: 'COMMENTED' }]],
  }));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).rows.map((x) => x.id), [1, 2, 3, 4, 5, 6]);
});

for (const endpoint of ['issues/7/comments', 'pulls/7/comments', 'pulls/7/reviews', 'pulls/7 ']) {
  test(`a failing ${endpoint.trim()} read exits 3 and prints no rows`, () => {
    const r = run(ghStub({ failOn: endpoint }));
    assert.equal(r.status, 3);
    assert.equal(r.stdout.trim(), '');
  });
}

test('a deleted account comes back with an empty login and type, as the PR author too', () => {
  const r = run(ghStub({
    pull: { user: null },
    issue: [[{ id: 1, user: null, created_at: 't', body: 'x' }]],
  }));
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.prAuthor, '');
  assert.equal(out.rows[0].login, '');
  assert.equal(out.rows[0].type, '');
});

test('prAuthor is the PR author, not a comment author', () => {
  const r = run(ghStub({ pull: { user: { login: 'author' } }, issue: [[{ id: 1, user: user('other'), created_at: 't', body: 'x' }]] }));
  assert.equal(JSON.parse(r.stdout).prAuthor, 'author');
});

test('a review with an empty body still comes back; a PENDING review has an empty time', () => {
  const r = run(ghStub({ reviews: [[{ id: 3, user: user('x'), state: 'PENDING', body: null }]] }));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).rows, [{ kind: 'review', id: 3, login: 'x', type: 'User', time: '', body: '', state: 'PENDING' }]);
});

test('an edited comment keeps its created_at', () => {
  const r = run(ghStub({ issue: [[{ id: 1, user: user('x'), created_at: 'first', updated_at: 'later', body: 'b' }]] }));
  assert.equal(JSON.parse(r.stdout).rows[0].time, 'first');
});

/** A `bb` answering the PR and its comment pages; page 1 links to a second page this stub also serves. */
const bbStub = ({ pr, pages = [[]], failOn = null }) => {
  const dir = tmp('pr-conversation-bb');
  const next = '/repositories/{ws}/{repo}/pullrequests/7/comments-page-2';
  const arms = pages.map((values, i) => {
    const link = i + 1 === pages.length ? '' : `,"next":"https://api.bitbucket.org/2.0${next}"`;
    return `  ${i === 0 ? '*"/pullrequests/7/comments"*' : `*"${next}"*`}) printf '{"values":%s${link}}' ${JSON.stringify(JSON.stringify(values))} ;;`;
  }).reverse().join('\n');
  fs.writeFileSync(path.join(dir, 'bb'), `#!/usr/bin/env bash
case "$*" in
  *--version*) echo "bb version 1.9.0" ;;
  *${failOn ?? 'NEVER-MATCHES'}*) echo "HTTP 502" >&2; exit 1 ;;
${arms}
  *"/pullrequests/7") printf '%s' ${JSON.stringify(JSON.stringify(pr))} ;;
  *) exit 9 ;;
esac
`);
  fs.chmodSync(path.join(dir, 'bb'), 0o755);
  return dir;
};

const bbPr = { author: { nickname: 'Andreas', type: 'user' }, participants: [
  { user: { nickname: 'Markus', type: 'user' }, approved: true, participated_on: '2026-10-27T13:05:55Z' },
  { user: { nickname: 'Lena', type: 'user' }, approved: false, participated_on: null },
] };

test('Bitbucket reads every comment page and the approvals', () => {
  const r = run(bbStub({ pr: bbPr, pages: [
    [{ id: 1, user: { nickname: 'Markus', type: 'user' }, created_on: 'c1', updated_on: 'later', content: { raw: 'q' }, inline: { path: 'a.ts' } }],
    [{ id: 2, user: { nickname: 'Bot', type: 'app_user' }, created_on: 'c2', content: { raw: 'ci' } }],
  ] }), { backend: 'bitbucket' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { prAuthor: 'Andreas', rows: [
    { kind: 'inline', id: 1, login: 'Markus', type: 'User', time: 'c1', body: 'q' },
    { kind: 'issue', id: 2, login: 'Bot', type: 'Bot', time: 'c2', body: 'ci' },
    { kind: 'review', id: 0, login: 'Markus', type: 'User', time: '2026-10-27T13:05:55Z', body: '', state: 'APPROVED' },
  ] });
});

test('a failing Bitbucket page exits 3 and prints no rows', () => {
  const r = run(bbStub({ pr: bbPr, pages: [[{ id: 1, content: { raw: 'q' } }], []], failOn: 'comments-page-2' }), { backend: 'bitbucket' });
  assert.equal(r.status, 3);
  assert.equal(r.stdout, '');
});
