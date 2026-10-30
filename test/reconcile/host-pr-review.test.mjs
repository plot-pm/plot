// Contract test for `plot-host.sh pr-review <number>`: one JSON line holding the
// PR's head, the newest `plot/review` commit status on it, and whether a
// `review-bypass:` comment exists. Kept apart from host.test.mjs, whose whole
// file runs for minutes; this one needs only a stubbed `gh`.
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

/** A `gh` answering `pr view` and the statuses read; `view` and `statuses` are the JSON bodies. */
const ghStub = ({ view, statuses, failOn = null }) => {
  const dir = tmp('pr-review');
  const body = `#!/usr/bin/env bash
case "$*" in
  *${failOn ?? 'NEVER-MATCHES'}*) echo "HTTP 502" >&2; exit 1 ;;
  "pr view 7 --json headRefOid,comments") printf '%s' ${JSON.stringify(JSON.stringify(view))} ;;
  "api repos/{owner}/{repo}/commits/abc123/statuses") printf '%s' ${JSON.stringify(JSON.stringify(statuses))} ;;
  *) exit 9 ;;
esac
`;
  fs.writeFileSync(path.join(dir, 'gh'), body);
  fs.chmodSync(path.join(dir, 'gh'), 0o755);
  return dir;
};

const prReview = (dir, { backend = 'github', num = '7' } = {}) => spawnSync('bash', [host, 'pr-review', num], {
  encoding: 'utf8',
  env: {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    PLOT_HOST: backend,
    PLOT_BUDGET_HOME: tmp('pr-review-budget'),
  },
});

const view = (...comments) => ({ headRefOid: 'abc123', comments: comments.map((body) => ({ body })) });

test('pr-review reads the newest plot/review status, not the CI status beside it', () => {
  const r = prReview(ghStub({
    view: view(),
    statuses: [{ context: 'ci/build', state: 'success' }, { context: 'plot/review', state: 'failure' },
      { context: 'plot/review', state: 'success' }],
  }));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { sha: 'abc123', state: 'failure', description: '', time: '', bypass: false });
});

test('pr-review answers absent for a PR with green CI and no plot/review status', () => {
  const r = prReview(ghStub({ view: view(), statuses: [{ context: 'ci/build', state: 'success' }] }));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).state, 'absent');
});

test('pr-review reports a comment starting review-bypass:', () => {
  const r = prReview(ghStub({
    view: view('looks fine', 'review-bypass: reviewer stuck — jwloka'),
    statuses: [],
  }));
  assert.equal(JSON.parse(r.stdout).bypass, true);
});

test('pr-review exits 3 and prints no JSON when a read fails', () => {
  for (const failOn of ['pr view', 'statuses']) {
    const r = prReview(ghStub({ view: view(), statuses: [], failOn }));
    assert.equal(r.status, 3, `${failOn}: ${r.stderr}`);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /pr-review: the read failed/);
  }
});

/**
 * A `bb` answering the three Bitbucket reads; `failOn` makes the call whose
 * argv contains it exit 1. `comments` may instead be `{pages: [...]}` — each
 * array served in turn, every page but the last carrying a `next` link to a
 * synthetic second-page path this same stub recognises, so a test can prove a
 * `review-bypass:` comment on page 2 is read rather than missed.
 */
const bbStub = ({ pr = { source: { commit: { hash: 'abc123' } } }, statuses = { values: [] }, comments = { values: [] }, failOn = null }) => {
  const dir = tmp('pr-review-bb');
  const commentPages = comments.pages ?? [comments.values ?? []];
  const nextPath = '/repositories/{ws}/{repo}/pullrequests/7/comments-page-2';
  // THE SECOND PAGE'S ARM COMES FIRST: its synthetic path contains the
  // substring "/comments" too, so a case statement checking page 1's pattern
  // first would match every page as page 1 forever and loop on the page cap.
  const commentArms = commentPages.map((values, i) => {
    const page = i + 1;
    const isLast = page === commentPages.length;
    const next = isLast ? '' : `,"next":"https://api.bitbucket.org/2.0${nextPath}"`;
    const match = page === 1 ? '*"/pullrequests/7/comments"*' : `*"${nextPath}"*`;
    return `  ${match}) printf '{"values":%s${next}}' ${JSON.stringify(JSON.stringify(values))} ;;`;
  });
  commentArms.reverse();
  const commentArmsText = commentArms.join('\n');
  const body = `#!/usr/bin/env bash
case "$*" in
  *--version*) echo "bb version 1.9.0" ;;
  *${failOn ?? 'NEVER-MATCHES'}*) echo "HTTP 502" >&2; exit 1 ;;
  *"/commit/abc123/statuses"*) printf '%s' ${JSON.stringify(JSON.stringify(statuses))} ;;
${commentArmsText}
  *"/pullrequests/7") printf '%s' ${JSON.stringify(JSON.stringify(pr))} ;;
  *) exit 9 ;;
esac
`;
  fs.writeFileSync(path.join(dir, 'bb'), body);
  fs.chmodSync(path.join(dir, 'bb'), 0o755);
  return dir;
};

const bbPrReview = (dir) => prReview(dir, { backend: 'bitbucket' });
const status = (key, state) => ({ key, state });

test('pr-review on Bitbucket reads the newest plot/review commit status and maps its word', () => {
  const cases = [['SUCCESSFUL', 'success'], ['FAILED', 'failure'], ['INPROGRESS', 'pending'], ['STOPPED', 'error']];
  for (const [word, state] of cases) {
    const out = bbPrReview(bbStub({ statuses: { values: [status('ci/build', 'SUCCESSFUL'), status('plot/review', word)] } }));
    assert.equal(out.status, 0, out.stderr);
    assert.deepEqual(JSON.parse(out.stdout), { sha: 'abc123', state, description: '', time: '', bypass: false }, word);
  }
});

test('pr-review on Bitbucket carries the plot/review status description and updated_on', () => {
  const r = bbPrReview(bbStub({ statuses: { values: [
    { key: 'plot/review', state: 'INPROGRESS', description: 'run r-1', updated_on: '2026-10-30T10:00:00Z' },
  ] } }));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { sha: 'abc123', state: 'pending', description: 'run r-1', time: '2026-10-30T10:00:00Z', bypass: false });
});

test('pr-review carries the newest plot/review status description and updated_at on GitHub', () => {
  const r = prReview(ghStub({
    view: view(),
    statuses: [{ context: 'plot/review', state: 'pending', description: 'run r-1', updated_at: '2026-10-30T10:00:00Z' }],
  }));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { sha: 'abc123', state: 'pending', description: 'run r-1', time: '2026-10-30T10:00:00Z', bypass: false });
});

test('pr-review on Bitbucket answers absent with green CI and no plot/review status', () => {
  const r = bbPrReview(bbStub({ statuses: { values: [status('ci/build', 'SUCCESSFUL')] } }));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { sha: 'abc123', state: 'absent', description: '', time: '', bypass: false });
});

test('pr-review on Bitbucket reports a comment starting review-bypass:', () => {
  const r = bbPrReview(bbStub({
    comments: { values: [{ content: { raw: 'looks fine' } }, { content: { raw: 'review-bypass: reviewer stuck — jwloka' } }] },
  }));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).bypass, true);
});

test('pr-review on Bitbucket finds a review-bypass: comment that exists only on the second page', () => {
  // The brief's fourth required scenario: a single-page read of `/comments`
  // sees only page 1 and reports `bypass: false`; following `next` finds it.
  const r = bbPrReview(bbStub({
    comments: {
      pages: [
        [{ content: { raw: 'looks fine' } }],
        [{ content: { raw: 'review-bypass: reviewer stuck — jwloka' } }],
      ],
    },
  }));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).bypass, true, 'a single-page read of /comments would report false');
});

test('pr-review on Bitbucket exits 3 and prints no JSON when a read fails', () => {
  for (const failOn of ['/statuses', '/comments', 'pullrequests/7']) {
    const r = bbPrReview(bbStub({ failOn }));
    assert.equal(r.status, 3, `${failOn}: ${r.stderr}`);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /pr-review: the read failed/);
  }
});
