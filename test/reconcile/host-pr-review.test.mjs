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
  assert.deepEqual(JSON.parse(r.stdout), { sha: 'abc123', state: 'failure', bypass: false });
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

test('pr-review exits 4 on a backend it cannot ask', () => {
  const r = prReview(ghStub({ view: view(), statuses: [] }), { backend: 'bitbucket' });
  assert.equal(r.status, 4);
});
