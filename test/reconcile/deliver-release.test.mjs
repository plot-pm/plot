// Contract test for `plot-deliver.sh --release <version> <slug>` — the
// mechanical half of cutting a Delivered plan's `Released:` record, performed
// since an-in-session-approval-has-a-controller slice 2.
//
// THE VERSION COMES FROM THE PLAN'S MERGE COMMIT, NEVER FROM A DATE. The
// script asks `plot-host.sh pr-state <N>` (stubbed `gh` here) for the last
// `→ #N`'s mergeCommit, then resolves the release that shipped it as the
// FIRST `vX.Y.Z` tag (by version, not creation order) that contains it — real
// git tags against a real bare origin, so `git tag --contains` and
// `sort -V` run for real rather than being re-implemented in the test.
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

let tmp, origin, repo, stubDir;

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}

function run(args, { cwd = repo, expectFail = false } = {}) {
  try {
    const childEnv = {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH}`,
      PLOT_HOST: 'github',
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
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-release-stub-'));
  // `gh pr view <N> --json number,state,isDraft,url,mergeCommit` is the one
  // call this arm makes to the host. The mergeCommit SHA travels in through
  // GH_STUB_SHA, set per test to the real commit the test repo's merge
  // produced, since `git tag --contains` needs a real reachable commit.
  fs.writeFileSync(path.join(stubDir, 'gh'), `#!/usr/bin/env bash
exec node "${stubDir}/gh.mjs" "$@"
`);
  fs.chmodSync(path.join(stubDir, 'gh'), 0o755);
  fs.writeFileSync(path.join(stubDir, 'gh.mjs'), `
const argv = process.argv.slice(2);
if (argv[0] === 'pr' && argv[1] === 'view') {
  const sha = process.env.GH_STUB_SHA || '';
  process.stdout.write(JSON.stringify({
    number: Number(argv[2]), state: 'MERGED', isDraft: false,
    url: 'https://example.invalid/pr/' + argv[2],
    mergeCommit: sha ? { oid: sha } : null,
  }));
} else if (argv[0] === 'repo' && argv[1] === 'view') {
  process.stdout.write('main');
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

- **Phase:** ${extra.phase ?? 'Delivered'}
- **Type:** feature
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-09-01, jwloka, plan-PR #41 merged
- **Delivered:** ${extra.deliveredDate ?? '2026-09-10'}
- **Released:**${extra.released ? ` ${extra.released}` : ''}

## Branches

### Wave one
- \`feature/alpha\` — the first → #${extra.pr ?? 300}
`;

/**
 * A fresh sandbox with a real bare origin and a commit that shipped work —
 * so a real `git tag --contains` has something true to answer.
 *
 * @returns {{shippedSha: string}} the commit `GH_STUB_SHA` should name as the
 *   plan's merge commit.
 */
function makeRepo(planBody = PLAN()) {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-release-'));
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
  fs.symlinkSync('../2026-09-01-release-me.md',
    path.join(repo, 'docs', 'plans', 'active', 'release-me.md'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plan');

  // The "shipped work" commit — a stand-in for the plan's implementation
  // merge, which is all that matters: the SHA this names is what the plan's
  // `mergeCommit` will claim, and only a REAL commit can be tagged.
  fs.writeFileSync(path.join(repo, 'shipped.txt'), 'the feature');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'ship the feature');
  const shippedSha = git(repo, 'rev-parse', 'HEAD').trim();

  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'remote', 'set-head', 'origin', 'main');
  return { shippedSha };
}

function planOnMain(rel = 'docs/plans/2026-09-01-release-me.md') {
  return git(repo, 'show', `origin/main:${rel}`);
}
function refreshMain() {
  git(repo, 'fetch', '-q', 'origin', 'main');
}
function tag(name, target) {
  // Annotated, pointing at `target` (a commit or ref). `git log -1
  // --format=%as <tag>` reads the TARGET COMMIT's own author date — set when
  // that commit was made, not when the tag object is created — so a test
  // asserting a specific "tag date" must read it back from the commit rather
  // than from when `tag()` itself ran.
  execFileSync('git', ['tag', '-a', name, '-m', name, target], { cwd: repo });
  git(repo, 'push', '-q', 'origin', name);
}
function commitDate(ref) {
  return git(repo, 'log', '-1', '--format=%as', ref).trim();
}

beforeEach(() => {
  delete process.env.GH_STUB_SHA;
});

test('release: a plan with no → #N annotation is refused, writing nothing', () => {
  makeRepo(`# Release me

## Status

- **Phase:** Delivered
- **Type:** feature
- **Delivered:** 2026-09-10
- **Released:**

## Branches

### Wave one
- \`feature/alpha\` — no annotation
`);
  const r = run(['--release', '1.0.0', 'release-me'], { expectFail: true });
  assert.match(r.err, /names no.*→ #N|no.*annotation/i, `must name the gate:\n${r.err}`);
  assert.equal(git(repo, 'status', '--porcelain').trim(), '');
});

test('release: a PR with no mergeCommit is refused, writing nothing', () => {
  makeRepo();
  process.env.GH_STUB_SHA = ''; // the host answers a PR with no mergeCommit
  const r = run(['--release', '1.0.0', 'release-me'], { expectFail: true });
  assert.match(r.err, /mergeCommit/i, `must name the gate:\n${r.err}`);
  assert.equal(git(repo, 'status', '--porcelain').trim(), '');
});

test('release: no tag contains the version at all — refused, writing nothing', () => {
  const { shippedSha } = makeRepo();
  process.env.GH_STUB_SHA = shippedSha;
  // No tags exist anywhere.
  const r = run(['--release', '1.0.0', 'release-me'], { expectFail: true });
  assert.match(r.err, /no.*tag.*contains/i, `must name the gate:\n${r.err}`);
  assert.equal(git(repo, 'status', '--porcelain').trim(), '');
});

test('release: a tag exists but does not contain the merge commit — refused', () => {
  const { shippedSha } = makeRepo();
  process.env.GH_STUB_SHA = shippedSha;
  // v1.0.0 tags the EARLIER plan commit, which does not contain the shipped
  // work. v2.0.0 tags the shipped commit itself, so `containing_tags` is NOT
  // empty — it is non-empty and simply does not include v1.0.0, which is the
  // "wrong version named" case rather than "nothing ships this at all".
  const planCommit = git(repo, 'rev-parse', 'HEAD~1').trim();
  execFileSync('git', ['tag', '-a', 'v1.0.0', '-m', 'v1.0.0', planCommit], { cwd: repo });
  git(repo, 'push', '-q', 'origin', 'v1.0.0');
  execFileSync('git', ['tag', '-a', 'v2.0.0', '-m', 'v2.0.0', shippedSha], { cwd: repo });
  git(repo, 'push', '-q', 'origin', 'v2.0.0');

  const r = run(['--release', '1.0.0', 'release-me'], { expectFail: true });
  assert.match(r.err, /does not contain/i, `must name the gate:\n${r.err}`);
  assert.equal(git(repo, 'status', '--porcelain').trim(), '');
});

test('release: a later tag than the first that contains the commit is refused — the version-sort case', () => {
  // THE CASE `git tag --contains | head -1` WITHOUT A VERSION SORT PASSES.
  // Both v1.0.0 and v2.0.0 contain the shipped commit (both are AFTER it in
  // history); v1.0.0 is the first by version and is what actually shipped it.
  // Naming v2.0.0 must be refused as "shipped earlier", not silently accepted.
  const { shippedSha } = makeRepo();
  process.env.GH_STUB_SHA = shippedSha;
  tag('v1.0.0', shippedSha);
  // A second commit after the first tag, then a second tag — both still
  // contain the shipped commit via ancestry.
  fs.writeFileSync(path.join(repo, 'unrelated.txt'), 'later work');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'later, unrelated work');
  git(repo, 'push', '-q', 'origin', 'main');
  tag('v2.0.0', 'HEAD');

  const r = run(['--release', '2.0.0', 'release-me'], { expectFail: true });
  assert.match(r.err, /v1\.0\.0/, `must name the actually-shipping tag:\n${r.err}`);
  assert.equal(git(repo, 'status', '--porcelain').trim(), '');
});

test('release: the first tag containing the commit succeeds and writes Released:', () => {
  const { shippedSha } = makeRepo();
  process.env.GH_STUB_SHA = shippedSha;
  tag('v1.0.0', shippedSha);
  const expectedDate = commitDate(shippedSha);

  const r = run(['--release', '1.0.0', 'release-me']);
  assert.equal(r.code, 0, `should succeed:\n${r.out}\n${r.err}`);

  refreshMain();
  const plan = planOnMain();
  assert.match(plan, /- \*\*Phase:\*\* Released/, `phase must flip:\n${plan}`);
  assert.match(plan, new RegExp(`- \\*\\*Released:\\*\\* ${expectedDate}, v1\\.0\\.0`),
    `record must name the tag's commit date and version:\n${plan}`);
});

test('release: accepts a version with no v prefix, resolving the same tag', () => {
  const { shippedSha } = makeRepo();
  process.env.GH_STUB_SHA = shippedSha;
  tag('v1.0.0', shippedSha);
  const expectedDate = commitDate(shippedSha);

  const r = run(['--release', '1.0.0', 'release-me']);
  assert.equal(r.code, 0, `should succeed:\n${r.out}\n${r.err}`);
  refreshMain();
  assert.match(planOnMain(), new RegExp(`- \\*\\*Released:\\*\\* ${expectedDate}, v1\\.0\\.0`));
});

test('release: a Draft plan is refused — too early', () => {
  makeRepo(PLAN({ phase: 'Draft' }));
  const r = run(['--release', '1.0.0', 'release-me'], { expectFail: true });
  assert.match(r.err, /still 'draft'|deliver it first/i, `must name the gate:\n${r.err}`);
});

test('release: an Approved plan is refused — too early', () => {
  makeRepo(PLAN({ phase: 'Approved' }));
  const r = run(['--release', '1.0.0', 'release-me'], { expectFail: true });
  assert.match(r.err, /still 'approved'|deliver it first/i, `must name the gate:\n${r.err}`);
});

test('release: a second --release on an already-Released plan is a no-op', () => {
  const { shippedSha } = makeRepo();
  process.env.GH_STUB_SHA = shippedSha;
  tag('v1.0.0', shippedSha);

  const first = run(['--release', '1.0.0', 'release-me']);
  assert.equal(first.code, 0);
  refreshMain();
  const shaBefore = git(repo, 'rev-parse', 'origin/main');

  const second = run(['--release', '1.0.0', 'release-me']);
  assert.equal(second.code, 0, `the re-run should succeed:\n${second.out}\n${second.err}`);
  assert.match(second.out, /nothing to commit/i, `must report the no-op:\n${second.out}`);

  refreshMain();
  assert.equal(git(repo, 'rev-parse', 'origin/main'), shaBefore, 'no new commit landed');
});

test('release: moves no index symlink — delivered/ stays as it was', () => {
  const { shippedSha } = makeRepo();
  process.env.GH_STUB_SHA = shippedSha;
  tag('v1.0.0', shippedSha);

  run(['--release', '1.0.0', 'release-me']);
  refreshMain();
  // The active/ symlink must still exist on main — releasing moves nothing,
  // unlike delivering, which moves active/ → delivered/.
  const lsTree = git(repo, 'ls-tree', 'origin/main', '--', 'docs/plans/active/');
  assert.match(lsTree, /release-me\.md/, 'the active/ symlink must survive a release');
});
