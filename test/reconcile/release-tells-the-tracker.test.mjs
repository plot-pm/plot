// Contract test for `plot-deliver.sh --release <version> <slug>` telling the
// tracker, closing the regression this branch fixes: the release arm used to
// hardcode `tracker=skipped` and never called `plot-issue-status.sh` or
// `plot-plan-state.sh` at all (#2355 — 63 of 65 released plans kept an open
// issue after /plot-release 2.28.0).
//
// `gh` is stubbed directly on PATH, the way deliver-release.test.mjs already
// does for `pr view` — `issue-label`, `issue-comment` and `issue-close` are
// the three calls `githubPlanStateWrite` makes, in that order, and the stub
// records each one to a marker file so a test can prove which ran.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const deliver = path.join(SCRIPTS, 'plot-deliver.sh');

let tmp, origin, repo, stubDir, issueCalls;

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}

function run(args, { cwd = repo, expectFail = false } = {}) {
  try {
    const childEnv = {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH}`,
      PLOT_HOST: 'github',
      ISSUE_CALLS: issueCalls,
    };
    delete childEnv.PLOT_UNATTENDED;
    const out = execFileSync('bash', [deliver, ...args], {
      encoding: 'utf8',
      cwd,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (expectFail) assert.fail(`expected a refusal, got:\n${out}`);
    return { code: 0, out, err: '' };
  } catch (e) {
    if (!expectFail) assert.fail(`unexpected failure:\n${e.stdout}\n${e.stderr}`);
    return { code: e.status, out: e.stdout || '', err: e.stderr || '' };
  }
}

before(() => {
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-release-tracker-stub-'));
  fs.writeFileSync(path.join(stubDir, 'gh'), `#!/usr/bin/env bash
exec node "${stubDir}/gh.mjs" "$@"
`);
  fs.chmodSync(path.join(stubDir, 'gh'), 0o755);
  // `issue edit`/`comment`/`close` each append one line to ISSUE_CALLS and
  // exit 0, unless GH_STUB_ISSUE_RC says otherwise for that issue number.
  fs.writeFileSync(path.join(stubDir, 'gh.mjs'), `
import fs from 'node:fs';
const argv = process.argv.slice(2);
if (argv[0] === 'pr' && argv[1] === 'view') {
  const closed = (process.env.GH_STUB_CLOSED || '').split(',').includes(argv[2]);
  const sha = closed ? '' : process.env.GH_STUB_SHA || '';
  process.stdout.write(JSON.stringify({
    number: Number(argv[2]), state: closed ? 'CLOSED' : 'MERGED', isDraft: false,
    url: 'https://example.invalid/pr/' + argv[2],
    mergeCommit: sha ? { oid: sha } : null,
  }));
} else if (argv[0] === 'repo' && argv[1] === 'view') {
  process.stdout.write('main');
} else if (argv[0] === 'issue' && ['edit', 'comment', 'close', 'view'].includes(argv[1])) {
  const num = argv[2];
  if (argv[1] === 'view') { process.stdout.write(JSON.stringify({ comments: [] })); process.exit(0); }
  const failing = (process.env.GH_STUB_ISSUE_FAIL || '').split(',').includes(num);
  if (process.env.ISSUE_CALLS) fs.appendFileSync(process.env.ISSUE_CALLS, argv[1] + ' ' + num + '\\n');
  if (failing) { process.stderr.write('stub: issue op refused\\n'); process.exit(1); }
} else {
  process.stdout.write('{}');
}
`);
});

after(() => {
  fs.rmSync(stubDir, { recursive: true, force: true });
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

const PLAN = (extra = {}) => `# Release me

## Status

- **Phase:** Delivered
- **Type:** feature
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-09-01, jwloka, plan-PR #41 merged
- **Delivered:** 2026-09-10
- **Released:**
${extra.issue !== undefined ? `- **Issue:** ${extra.issue}\n` : ''}
## Branches

### Wave one
- \`feature/alpha\` — the first → #${extra.pr ?? 300}
`;

/** A second plan, written into the active index, sharing an issue and not yet Released. */
const OTHER_PLAN = (issue) => `# Other plan

## Status

- **Phase:** Approved
- **Type:** feature
- **Approved:** 2026-09-01, jwloka, plan-PR #42 merged
- **Issue:** ${issue}

## Branches

### Wave one
- \`feature/beta\` — in flight
`;

function makeRepo(planBody = PLAN({ issue: '#7' }), { otherPlan } = {}) {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-release-tracker-'));
  issueCalls = path.join(tmp, 'issue.calls');
  origin = path.join(tmp, 'origin.git');
  repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  fs.writeFileSync(path.join(repo, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** docs/plans/\n- **Active index:** docs/plans/active/\n');
  fs.mkdirSync(path.join(repo, 'docs', 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'plans', '2026-09-01-release-me.md'), planBody);
  if (otherPlan !== undefined) {
    fs.writeFileSync(path.join(repo, 'docs', 'plans', '2026-09-01-other.md'), otherPlan);
    fs.symlinkSync('../2026-09-01-other.md', path.join(repo, 'docs', 'plans', 'active', 'other.md'));
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plan');

  fs.writeFileSync(path.join(repo, 'shipped.txt'), 'the feature');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'ship the feature');
  const shippedSha = git(repo, 'rev-parse', 'HEAD').trim();

  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'remote', 'set-head', 'origin', 'main');
  return { shippedSha };
}

function refreshMain() {
  git(repo, 'fetch', '-q', 'origin', 'main');
}

function issueCallLines() {
  return fs.existsSync(issueCalls) ? fs.readFileSync(issueCalls, 'utf8').trim().split('\n').filter(Boolean) : [];
}

beforeEach(() => {
  delete process.env.GH_STUB_SHA;
  delete process.env.GH_STUB_CLOSED;
  delete process.env.GH_STUB_ISSUE_FAIL;
});

test('release: closes the issue it names, with no other plan in the way', () => {
  const { shippedSha } = makeRepo(PLAN({ issue: '#7' }));
  process.env.GH_STUB_SHA = shippedSha;
  execFileSync('git', ['tag', '-a', 'v1.0.0', '-m', 'v1.0.0', shippedSha], { cwd: repo });
  git(repo, 'push', '-q', 'origin', 'v1.0.0');

  const r = run(['--release', '1.0.0', 'release-me']);
  assert.equal(r.code, 0, `should succeed:\n${r.out}\n${r.err}`);
  assert.match(r.out, /summary: issues closed=1 left-open=0\n/, r.out);
  assert.deepEqual(issueCallLines(), ['edit 7', 'comment 7', 'close 7']);
  refreshMain();
  assert.match(git(repo, 'show', 'origin/main:docs/plans/2026-09-01-release-me.md'), /Phase:\*\* Released/);
});

test('release: a shared issue stays open while another plan has not released yet', () => {
  const { shippedSha } = makeRepo(PLAN({ issue: '#7' }), { otherPlan: OTHER_PLAN('#7') });
  process.env.GH_STUB_SHA = shippedSha;
  execFileSync('git', ['tag', '-a', 'v1.0.0', '-m', 'v1.0.0', shippedSha], { cwd: repo });
  git(repo, 'push', '-q', 'origin', 'v1.0.0');

  const r = run(['--release', '1.0.0', 'release-me']);
  assert.equal(r.code, 0, `should succeed:\n${r.out}\n${r.err}`);
  assert.match(r.out, /summary: issues closed=0 left-open=1 \(another-plan-unfinished=1\)\n/, r.out);
  assert.deepEqual(issueCallLines(), [], 'a shared, unfinished issue must never be asked of the tracker');
});

test('release: a plan naming no issue reports nothing to close and never asks the tracker', () => {
  const { shippedSha } = makeRepo(PLAN());
  process.env.GH_STUB_SHA = shippedSha;
  execFileSync('git', ['tag', '-a', 'v1.0.0', '-m', 'v1.0.0', shippedSha], { cwd: repo });
  git(repo, 'push', '-q', 'origin', 'v1.0.0');

  const r = run(['--release', '1.0.0', 'release-me']);
  assert.equal(r.code, 0, `should succeed:\n${r.out}\n${r.err}`);
  assert.match(r.out, /summary: issues closed=0 left-open=0\n/, r.out);
  assert.deepEqual(issueCallLines(), []);
});

test('release: a failed tracker write is reported and the release still succeeds', () => {
  const { shippedSha } = makeRepo(PLAN({ issue: '#7' }));
  process.env.GH_STUB_SHA = shippedSha;
  process.env.GH_STUB_ISSUE_FAIL = '7';
  execFileSync('git', ['tag', '-a', 'v1.0.0', '-m', 'v1.0.0', shippedSha], { cwd: repo });
  git(repo, 'push', '-q', 'origin', 'v1.0.0');

  const r = run(['--release', '1.0.0', 'release-me']);
  assert.equal(r.code, 0, `a tracker failure must not fail the release:\n${r.out}\n${r.err}`);
  assert.match(r.out, /summary: issues closed=0 left-open=1 \(failed=1\)\n/, r.out);
  refreshMain();
  assert.match(git(repo, 'show', 'origin/main:docs/plans/2026-09-01-release-me.md'), /Phase:\*\* Released/,
    'the release record must land even where the tracker write failed');
});
