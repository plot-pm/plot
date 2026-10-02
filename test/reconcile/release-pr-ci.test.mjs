// Contract test: the release PR's `validate` check reports.
//
// The release PR's required `validate` check had never reported. `release.yml`
// pushes `changeset-release/main` with `secrets.GITHUB_TOKEN`, and GitHub
// starts no workflow from an event that token caused, except
// `workflow_dispatch` and `repository_dispatch`. Measured 2026-10-01 through
// the Actions API: 0 runs with `event=push` on that branch, ever; 18 of the 20
// most recent `pull_request` runs ended `action_required`; v2.22.0, v2.22.1
// and v2.22.2 all merged with `gh pr merge --admin`.
//
// So the release workflow dispatches CI itself, pinned to the head SHA it just
// wrote and to the one release branch.
//
// BOTH FILES ARE READ AS TEXT, the way `artifact.test.mjs:249` reads `ci.yml`.
// No YAML parser is added: the repository carries none as a dependency.
//
// THE ASSERTIONS ARE SCOPED TO A NAMED BLOCK, not to the whole file. A
// whole-file match for `actions: write` passes with the permission on the
// `release` job, which is the rejected alternative; a guard found anywhere in
// `ci.yml` passes with `corpus` unguarded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..');

const read = (name) =>
  fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', name), 'utf8');

const CI = read('ci.yml');
const RELEASE = read('release.yml');

/**
 * The text of one top-level `jobs:` entry, from its own `  <name>:` line to the
 * next job at the same indentation (or the end of the file).
 *
 * Scoping is the point: every job-level assertion below must fail when the
 * thing it looks for sits in a sibling job.
 */
const jobBlock = (yaml, name) => {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  assert.notEqual(start, -1, `${name}: must be a top-level job`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {2}[A-Za-z_][A-Za-z0-9_-]*:/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
};

/** Everything above `jobs:` — the triggers, permissions and concurrency block. */
const preamble = (yaml) => yaml.slice(0, yaml.indexOf('\njobs:'));

/**
 * The text of one trigger under `on:`, from its own `  <name>:` line to the next
 * key at that indentation, with comment lines dropped.
 *
 * SCOPED LIKE A JOB, AND FOR THE SAME REASON. The comment above
 * `workflow_dispatch` names `changeset-release/main` as prose — it has to, it
 * explains why the branch is no longer a push target — and a slice that ran to
 * the end of the preamble read that sentence as a `push` entry.
 */
const triggerBlock = (yaml, name) => {
  const lines = preamble(yaml).split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  assert.notEqual(start, -1, `on.${name} must be declared`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {2}[A-Za-z_][A-Za-z0-9_-]*:/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines
    .slice(start, end)
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
};

// ── ci.yml: the trigger ──────────────────────────────────────────────────────

test('ci.yml declares workflow_dispatch with a required expected_sha input', () => {
  const block = triggerBlock(CI, 'workflow_dispatch');
  assert.match(block, /^ {6}expected_sha:/m, 'the dispatch must take an expected_sha input');
  // REQUIRED, because a gate that cannot be asked must fail rather than skip:
  // an empty `expected_sha` would otherwise dispatch an unpinned run.
  const input = block.slice(block.indexOf('      expected_sha:'));
  assert.match(input, /required: true/, 'expected_sha must be required');
});

test('ci.yml no longer lists changeset-release/main under push', () => {
  const push = triggerBlock(CI, 'push');
  assert.doesNotMatch(
    push,
    /changeset-release\/main/,
    'the push trigger must not list the release branch: a push by GITHUB_TOKEN starts no run',
  );
  assert.match(push, /branches: \[main\]/, 'the push trigger must keep main');
});

test("ci.yml's comment states the measured mechanism rather than the push run", () => {
  const head = preamble(CI);
  // The predecessor comment claimed a push-triggered run "reports without
  // anyone approving it". That run has never existed.
  assert.doesNotMatch(
    head,
    /without anyone approving it/,
    'the comment must not claim a push-triggered run reports',
  );
  assert.match(
    head,
    /workflow_dispatch/,
    'the comment must name the trigger that actually starts the release run',
  );
});

// ── ci.yml: the top-level blocks ─────────────────────────────────────────────

test('ci.yml carries a top-level permissions: contents: read', () => {
  const head = preamble(CI);
  assert.match(
    head,
    /^permissions:\n(?: +[a-z-]+: .*\n)*? {2}contents: read$/m,
    'ci.yml must pin contents: read at the top level rather than inherit the repository default',
  );
});

test('ci.yml shares one concurrency group across dispatched runs and isolates every other run', () => {
  const head = preamble(CI);
  const block = head.slice(head.indexOf('\nconcurrency:'));
  assert.notEqual(head.indexOf('\nconcurrency:'), -1, 'ci.yml must declare a top-level concurrency block');
  assert.match(block, /cancel-in-progress: true/, 'a superseded release run must be cancelled');
  assert.match(
    block,
    /github\.event_name == 'workflow_dispatch'/,
    'the group must distinguish a dispatched run from every other run',
  );
  assert.match(block, /release-dispatch/, 'every dispatched run must share one group');
  assert.match(
    block,
    /github\.run_id/,
    'every non-dispatched run must get its own group, so a main push or a pull request run is never cancelled',
  );
});

test('no concurrency group in ci.yml is keyed on the ref', () => {
  // A ref-keyed group would cancel pull request runs against each other.
  const groups = CI.split('\n').filter((l) => /^\s*group:/.test(l));
  assert.ok(groups.length > 0, 'ci.yml must declare at least one concurrency group');
  for (const g of groups) {
    assert.doesNotMatch(g, /github\.ref/, `a concurrency group must not contain github.ref: ${g.trim()}`);
  }
});

// ── ci.yml: the guard, in each job by name ───────────────────────────────────

// BY NAME, BOTH JOBS. A test that finds one guard anywhere in the file passes
// with `corpus` unguarded — and `corpus` being skipped on a dispatched run
// would make that pass by accident rather than by design.
for (const job of ['corpus', 'validate']) {
  test(`ci.yml's ${job} job starts with the dispatch guard`, () => {
    const block = jobBlock(CI, job);
    const steps = block.slice(block.indexOf('\n    steps:'));
    const first = steps.split('\n').findIndex((l) => /^ {6}- /.test(l));
    assert.notEqual(first, -1, `${job} must have steps`);
    // The guard is the FIRST step: a checkout ahead of it would run on an
    // unpinned ref before anything refused.
    const firstStep = steps.split('\n').slice(first).join('\n');
    const guard = firstStep.slice(0, firstStep.indexOf('\n      - ', 1) === -1
      ? undefined
      : firstStep.indexOf('\n      - ', 1));

    assert.match(
      guard,
      /if: \$\{\{ github\.event_name == 'workflow_dispatch' \}\}/,
      `${job}'s guard must run only on workflow_dispatch`,
    );
    assert.match(
      guard,
      /refs\/heads\/changeset-release\/main/,
      `${job}'s guard must refuse a dispatch on any other ref`,
    );
    assert.match(
      guard,
      /inputs\.expected_sha/,
      `${job}'s guard must refuse a github.sha that differs from expected_sha`,
    );
  });
}

// ── release.yml: the dispatch job ────────────────────────────────────────────

test('release.yml exposes the release head SHA and PR number as job outputs', () => {
  const release = jobBlock(RELEASE, 'release');
  assert.match(release, /^ {4}outputs:/m, 'the release job must declare outputs');
  assert.match(release, /pr_number:/, 'the release job must output the release PR number');
  assert.match(release, /head_sha:/, 'the release job must output the release branch head SHA');
  // THE LOCAL REF, never the remote: the remote is the ref the guard
  // distrusts. `changeset-release/main` has no branch protection and no
  // ruleset (404 on 2026-10-01), so any writer can push between the
  // force-push and the dispatch.
  assert.match(
    release,
    /rev-parse[^\n]*changeset-release\/main/,
    'the head SHA must be read from the local changeset-release/main ref',
  );
  assert.doesNotMatch(
    release,
    /rev-parse[^\n]*origin\/changeset-release\/main/,
    'the head SHA must never be read from the remote ref',
  );
});

test("release.yml's release job permissions are unchanged and carry no actions: write", () => {
  const release = jobBlock(RELEASE, 'release');
  const perms = release.slice(release.indexOf('\n    permissions:'));
  const block = perms.slice(0, perms.indexOf('\n    steps:'));
  assert.match(block, /contents: write/, 'the release job keeps contents: write');
  assert.match(block, /pull-requests: write/, 'the release job keeps pull-requests: write');
  assert.match(block, /id-token: write/, 'the release job keeps id-token: write');
  // Widening the publishing job with actions: write was the rejected
  // alternative: it runs changesets/action, pnpm install and
  // create-release.sh.
  assert.doesNotMatch(block, /actions: write/, 'the release job must not gain actions: write');
});

test('release.yml has a dispatch-ci job that needs release and is gated on the PR number', () => {
  const job = jobBlock(RELEASE, 'dispatch-ci');
  assert.match(job, /needs: release/, 'dispatch-ci must run after the release job');
  assert.match(
    job,
    /if: \$\{\{ needs\.release\.outputs\.pr_number \}\}/,
    'dispatch-ci must run only when a release PR exists',
  );
});

test('dispatch-ci holds actions: write and nothing else', () => {
  const job = jobBlock(RELEASE, 'dispatch-ci');
  const perms = job.slice(job.indexOf('\n    permissions:'));
  const block = perms.slice(0, perms.indexOf('\n    steps:'));
  const declared = block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[a-z-]+: /.test(l));
  assert.deepEqual(declared, ['actions: write'], 'dispatch-ci must hold exactly actions: write');
});

test('dispatch-ci checks nothing out and uses no action', () => {
  const job = jobBlock(RELEASE, 'dispatch-ci');
  // `gh` is preinstalled on the runner, so the job needs no action at all —
  // and a job with no `uses:` cannot drift off a pinned SHA.
  assert.doesNotMatch(job, /^\s*- uses:/m, 'dispatch-ci must add no action');
  assert.doesNotMatch(job, /actions\/checkout/, 'dispatch-ci must not check the repository out');
});

test('dispatch-ci dispatches ci.yml pinned to the ref and the expected SHA', () => {
  const job = jobBlock(RELEASE, 'dispatch-ci');
  assert.match(job, /gh workflow run ci\.yml/, 'dispatch-ci must dispatch ci.yml');
  assert.match(job, /--ref changeset-release\/main/, 'the dispatch must name the release branch');
  assert.match(job, /-f expected_sha=/, 'the dispatch must pin the run to the expected head SHA');
  assert.match(
    job,
    /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/,
    'dispatch-ci must authenticate with GITHUB_TOKEN',
  );
  // The printed SHA is what makes a wrong-SHA dispatch diagnosable from the
  // release run's own log.
  assert.match(job, /echo/, 'dispatch-ci must print the SHA it dispatches');
});

test('a failed dispatch fails the release run', () => {
  const job = jobBlock(RELEASE, 'dispatch-ci');
  // It is the ONLY signal that the release PR carries no check.
  assert.doesNotMatch(job, /continue-on-error/, 'a failed dispatch must not be a warning');
  assert.doesNotMatch(job, /\|\| true/, 'a failed dispatch must not be swallowed');
});

// ── Both files: the action set did not move ──────────────────────────────────

test('every uses: in both workflows is still pinned to a full SHA', () => {
  for (const [name, yaml] of [['ci.yml', CI], ['release.yml', RELEASE]]) {
    const uses = [...yaml.matchAll(/^\s*- uses: (\S+)/gm)].map((m) => m[1]);
    assert.ok(uses.length > 0, `${name} must use at least one action`);
    for (const ref of uses) {
      assert.match(ref, /@[0-9a-f]{40}$/, `${name}: ${ref} must be pinned to a 40-hex SHA`);
    }
  }
});

test('the set of actions used did not grow', () => {
  // Three actions, and the dispatch adds none: `gh` is preinstalled.
  const expected = ['actions/checkout', 'actions/setup-node', 'pnpm/action-setup'];
  const used = new Set(
    [...`${CI}\n${RELEASE}`.matchAll(/^\s*- uses: ([^@\s]+)@/gm)].map((m) => m[1]),
  );
  assert.deepEqual([...used].sort(), expected, 'no new action may be added by this change');
});
