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

let tmp, origin, repo, stubDir, issueCalls, repoLabelsFile, issueLabelsFile;

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
      REPO_LABELS: repoLabelsFile,
      ISSUE_LABELS: issueLabelsFile,
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
  //
  // REPO_LABELS and ISSUE_LABELS are files holding the repo's label set and
  // the asked issue's carried labels, comma-separated — real `gh issue edit`
  // rejects the WHOLE call when any `--remove-label` name is not a repo
  // label, so this stub does the same, rather than accepting any string.
  fs.writeFileSync(path.join(stubDir, 'gh.mjs'), `
import fs from 'node:fs';
const argv = process.argv.slice(2);
const repoLabels = () => (process.env.REPO_LABELS && fs.existsSync(process.env.REPO_LABELS))
  ? fs.readFileSync(process.env.REPO_LABELS, 'utf8').split(',').filter(Boolean) : [];
const issueLabels = () => (process.env.ISSUE_LABELS && fs.existsSync(process.env.ISSUE_LABELS))
  ? fs.readFileSync(process.env.ISSUE_LABELS, 'utf8').split(',').filter(Boolean) : [];
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
} else if (argv[0] === 'label' && argv[1] === 'create') {
  const name = argv[2];
  if (repoLabels().includes(name)) { process.stderr.write('label already exists\\n'); process.exit(1); }
  if (process.env.GH_STUB_LABEL_CREATE_RC) { process.stderr.write('stub: label create refused\\n'); process.exit(1); }
  if (process.env.REPO_LABELS) fs.appendFileSync(process.env.REPO_LABELS, (repoLabels().length ? ',' : '') + name);
} else if (argv[0] === 'issue' && ['edit', 'comment', 'close', 'view'].includes(argv[1])) {
  const num = argv[2];
  if (argv[1] === 'view') {
    if (argv.includes('--json') && argv[argv.indexOf('--json') + 1] === 'labels') {
      if (argv.includes('-q')) process.stdout.write(issueLabels().map((name) => name + '\\n').join(''));
      else process.stdout.write(JSON.stringify({ labels: issueLabels().map((name) => ({ name })) }));
    } else {
      process.stdout.write(JSON.stringify({ comments: [] }));
    }
    process.exit(0);
  }
  const failing = (process.env.GH_STUB_ISSUE_FAIL || '').split(',').includes(num);
  if (argv[1] === 'edit' && argv.includes('--remove-label')) {
    const drop = argv[argv.indexOf('--remove-label') + 1].split(',');
    const unknown = drop.find((l) => !repoLabels().includes(l));
    if (unknown) { process.stderr.write("label '" + unknown + "' not found\\n"); process.exit(1); }
  }
  if (process.env.ISSUE_CALLS) fs.appendFileSync(process.env.ISSUE_CALLS, argv[1] + ' ' + num + '\\n');
  if (failing) { process.stderr.write('stub: issue op refused\\n'); process.exit(1); }
  if (argv[1] === 'edit' && process.env.ISSUE_LABELS) {
    let labels = issueLabels();
    const addIdx = argv.indexOf('--add-label');
    if (addIdx !== -1) labels = labels.filter((l) => l !== argv[addIdx + 1]).concat(argv[addIdx + 1]);
    const dropIdx = argv.indexOf('--remove-label');
    if (dropIdx !== -1) { const drop = argv[dropIdx + 1].split(','); labels = labels.filter((l) => !drop.includes(l)); }
    fs.writeFileSync(process.env.ISSUE_LABELS, labels.join(','));
  }
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
const OTHER_PLAN = (issue, phase = 'Approved') => `# Other plan

## Status

- **Phase:** ${phase}
- **Type:** feature
- **Approved:** 2026-09-01, jwloka, plan-PR #42 merged
- **Issue:** ${issue}

## Branches

### Wave one
- \`feature/beta\` — in flight
`;

function makeRepo(planBody = PLAN({ issue: '#7' }), { otherPlan, otherPlanActive = true } = {}) {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-release-tracker-'));
  issueCalls = path.join(tmp, 'issue.calls');
  repoLabelsFile = path.join(tmp, 'repo.labels');
  issueLabelsFile = path.join(tmp, 'issue.labels');
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
    if (otherPlanActive) fs.symlinkSync('../2026-09-01-other.md', path.join(repo, 'docs', 'plans', 'active', 'other.md'));
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

/** The current label set a file tracks, comma-joined by the stub; [] once no file is seeded. */
function labelSet(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(',').filter(Boolean) : [];
}

/** Seeds the repo's label set and one issue's carried labels before a run. */
function seedLabels(repoLabels, issueLabels) {
  fs.writeFileSync(repoLabelsFile, repoLabels.join(','));
  fs.writeFileSync(issueLabelsFile, issueLabels.join(','));
}

beforeEach(() => {
  delete process.env.GH_STUB_SHA;
  delete process.env.GH_STUB_CLOSED;
  delete process.env.GH_STUB_ISSUE_FAIL;
  delete process.env.GH_STUB_LABEL_CREATE_RC;
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

// #2374 (1): a Delivered-but-not-released sibling is invisible to the Active
// index (it carries no active/ symlink) — the sibling read must still see it
// through the flat plan directory, or the shared issue closes early.
test('release: a shared issue stays open while a Delivered sibling is not yet released, though it carries no Active-index symlink', () => {
  const { shippedSha } = makeRepo(PLAN({ issue: '#7' }), { otherPlan: OTHER_PLAN('#7', 'Delivered'), otherPlanActive: false });
  process.env.GH_STUB_SHA = shippedSha;
  execFileSync('git', ['tag', '-a', 'v1.0.0', '-m', 'v1.0.0', shippedSha], { cwd: repo });
  git(repo, 'push', '-q', 'origin', 'v1.0.0');

  const r = run(['--release', '1.0.0', 'release-me']);
  assert.equal(r.code, 0, `should succeed:\n${r.out}\n${r.err}`);
  assert.match(r.out, /summary: issues closed=0 left-open=1 \(another-plan-unfinished=1\)\n/, r.out);
  assert.deepEqual(issueCallLines(), [], 'a Delivered sibling with no Active-index entry must still hold the issue open');
});

// #2374 (2): the skip list must reach every tracker write, not just the close
// decision. This fixture configures no Jira status word, so
// `plot-issue-status.sh` owes nothing regardless of the skip list and reports
// `tracker=none` — `plot-plan-state.sh` is the write this fixture's GitHub
// labels actually exercise, and its own `--skip-issue` must be the SAME list
// the close decision used, never asked of `gh` for a shared, unfinished issue.
test('release: the skip list reaches the plan-state write as --skip-issue, never just the close decision', () => {
  const { shippedSha } = makeRepo(PLAN({ issue: '#7' }), { otherPlan: OTHER_PLAN('#7') });
  process.env.GH_STUB_SHA = shippedSha;
  execFileSync('git', ['tag', '-a', 'v1.0.0', '-m', 'v1.0.0', shippedSha], { cwd: repo });
  git(repo, 'push', '-q', 'origin', 'v1.0.0');

  const r = run(['--release', '1.0.0', 'release-me']);
  assert.equal(r.code, 0, `should succeed:\n${r.out}\n${r.err}`);
  assert.deepEqual(issueCallLines(), [], 'the write itself must never reach the tracker for a skipped issue');
  assert.match(r.out, /plan-state: 7\tskipped\tanother plan unfinished/, r.out);
});

// #2374 (3): a sibling read that fails outright (not "no sibling found") must
// never behave like an empty read — every issue named by this release stays
// open, and the release itself still succeeds. Only the SIBLING file is made
// unreadable (not the plan directory itself, and not the released plan): the
// directory listing that finds it still succeeds — `plot-plan-meta.sh` is
// what fails, on that one file, mid-batch (exit 2) — so the primary plan
// lookup, which never reads this file, is unaffected.
test('release: a sibling read that fails outright leaves every issue open, and the release still succeeds', () => {
  const { shippedSha } = makeRepo(PLAN({ issue: '#7' }), { otherPlan: OTHER_PLAN('#7') });
  process.env.GH_STUB_SHA = shippedSha;
  execFileSync('git', ['tag', '-a', 'v1.0.0', '-m', 'v1.0.0', shippedSha], { cwd: repo });
  git(repo, 'push', '-q', 'origin', 'v1.0.0');

  const otherPlanFile = path.join(repo, 'docs', 'plans', '2026-09-01-other.md');
  fs.chmodSync(otherPlanFile, 0o000);
  try {
    const r = run(['--release', '1.0.0', 'release-me']);
    assert.equal(r.code, 0, `an unreadable sibling read must not fail the release:\n${r.out}\n${r.err}`);
    assert.match(r.out, /summary: issues closed=0 left-open=1 \(unreadable=1\)\n/, r.out);
    assert.deepEqual(issueCallLines(), [], 'an unreadable sibling read must never let a write through');
  } finally {
    fs.chmodSync(otherPlanFile, 0o644);
  }
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

// Regression coverage for #2054/#2055: the repo carried `plan:draft`,
// `plan:approved` and `plan:delivered` but never `plan:released`, so
// `issue-label`'s single `gh issue edit --add-label --remove-label a,b,c,d`
// failed outright on the missing label — and on #2054 the add had already
// landed, leaving the issue carrying two `plan:*` labels at once.
test('release: creates the missing plan:released label before setting it, on a repo that never had it', () => {
  const { shippedSha } = makeRepo(PLAN({ issue: '#7' }));
  process.env.GH_STUB_SHA = shippedSha;
  seedLabels(['plan:draft', 'plan:approved', 'plan:delivered'], ['plan:delivered']);
  execFileSync('git', ['tag', '-a', 'v1.0.0', '-m', 'v1.0.0', shippedSha], { cwd: repo });
  git(repo, 'push', '-q', 'origin', 'v1.0.0');

  const r = run(['--release', '1.0.0', 'release-me']);
  assert.equal(r.code, 0, `should succeed:\n${r.out}\n${r.err}`);
  assert.deepEqual(labelSet(issueLabelsFile), ['plan:released'],
    'the issue must end up carrying exactly the released label, not the label it started with');
  assert.ok(labelSet(repoLabelsFile).includes('plan:released'), 'the repo must gain the label the write needed');
});

test('release: a next write drops both labels from an issue already carrying two plan:* labels', () => {
  const { shippedSha } = makeRepo(PLAN({ issue: '#7' }));
  process.env.GH_STUB_SHA = shippedSha;
  seedLabels(['plan:draft', 'plan:approved', 'plan:delivered', 'plan:released'], ['plan:draft', 'plan:approved']);
  execFileSync('git', ['tag', '-a', 'v1.0.0', '-m', 'v1.0.0', shippedSha], { cwd: repo });
  git(repo, 'push', '-q', 'origin', 'v1.0.0');

  const r = run(['--release', '1.0.0', 'release-me']);
  assert.equal(r.code, 0, `should succeed:\n${r.out}\n${r.err}`);
  assert.deepEqual(labelSet(issueLabelsFile), ['plan:released'],
    'the repair case: an issue holding two phase labels must end the write holding exactly one');
});

test('release: a gh label create failure that is not "already exists" fails the whole write', () => {
  const { shippedSha } = makeRepo(PLAN({ issue: '#7' }));
  process.env.GH_STUB_SHA = shippedSha;
  process.env.GH_STUB_LABEL_CREATE_RC = '1';
  seedLabels(['plan:draft', 'plan:approved', 'plan:delivered'], ['plan:delivered']);
  execFileSync('git', ['tag', '-a', 'v1.0.0', '-m', 'v1.0.0', shippedSha], { cwd: repo });
  git(repo, 'push', '-q', 'origin', 'v1.0.0');

  const r = run(['--release', '1.0.0', 'release-me']);
  assert.equal(r.code, 0, `a tracker failure must not fail the release itself:\n${r.out}\n${r.err}`);
  assert.match(r.out, /summary: issues closed=0 left-open=1 \(failed=1\)\n/, r.out);
  assert.deepEqual(labelSet(issueLabelsFile), ['plan:delivered'],
    'a label-create failure other than "already exists" must leave the issue untouched');
});
