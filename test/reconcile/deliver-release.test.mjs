// Contract test for `plot-deliver.sh --release <version> <slug>` — the
// mechanical half of cutting a Delivered plan's `Released:` record, performed
// since an-in-session-approval-has-a-controller slice 2.
//
// THE VERSION COMES FROM THE PLAN'S MERGE COMMIT, NEVER FROM A DATE. The
// script asks `plot-host.sh pr-state <N>` (stubbed `gh` here) for the last
// `→ #N` of a slice that was not deferred, reads its mergeCommit, then
// resolves the release that shipped it as the FIRST `vX.Y.Z` tag (by version,
// not creation order) that contains it — real git tags against a real bare
// origin, so `git tag --contains` and
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
    if (process.env.GH_STUB_CALL_LOG) childEnv.GH_STUB_CALL_LOG = process.env.GH_STUB_CALL_LOG;
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
  // call this arm makes to the host, once per local PR number. The answer for
  // a given number comes from GH_STUB_SHA_<N> / GH_STUB_MERGED_AT_<N> when
  // set, falling back to the un-suffixed GH_STUB_SHA / GH_STUB_MERGED_AT so
  // every existing single-PR test keeps working unchanged. Both travel in as
  // real values the test repo can tag and date, since `git tag --contains`
  // needs a real reachable commit.
  fs.writeFileSync(path.join(stubDir, 'gh'), `#!/usr/bin/env bash
exec node "${stubDir}/gh.mjs" "$@"
`);
  fs.chmodSync(path.join(stubDir, 'gh'), 0o755);
  fs.writeFileSync(path.join(stubDir, 'gh.mjs'), `
import fs from 'node:fs';
const argv = process.argv.slice(2);
if (process.env.GH_STUB_CALL_LOG) fs.appendFileSync(process.env.GH_STUB_CALL_LOG, argv.join(' ') + '\\n');
if (argv[0] === 'pr' && argv[1] === 'view') {
  const n = argv[2];
  const closed = (process.env.GH_STUB_CLOSED || '').split(',').includes(n);
  const sha = closed ? '' : (process.env['GH_STUB_SHA_' + n] || process.env.GH_STUB_SHA || '');
  const mergedAt = closed ? null : (process.env['GH_STUB_MERGED_AT_' + n] || process.env.GH_STUB_MERGED_AT || null);
  process.stdout.write(JSON.stringify({
    number: Number(n), state: closed ? 'CLOSED' : 'MERGED', isDraft: false,
    url: 'https://example.invalid/pr/' + n,
    mergeCommit: sha ? { oid: sha } : null,
    mergedAt,
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
  delete process.env.GH_STUB_CLOSED;
  delete process.env.GH_STUB_CALL_LOG;
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

const DEFERRED_PLAN = (slices) => `# Release me

## Status

- **Phase:** Delivered
- **Type:** feature
- **Delivered:** 2026-09-10
- **Released:**

## Slices

${slices}`;

test('release: a deferred last slice with a closed PR releases from the earlier merged PR', () => {
  const { shippedSha } = makeRepo(DEFERRED_PLAN(`### Shipped
- \`feature/alpha\` — the work → #1423

### Given up
- \`feature/beta\` — not built <!-- deferred: 2026-10-09, PR closed on purpose --> → #1425
`));
  process.env.GH_STUB_SHA = shippedSha;
  process.env.GH_STUB_CLOSED = '1425';
  tag('v1.0.0', shippedSha);

  const r = run(['--release', '1.0.0', 'release-me']);
  assert.match(r.out, /PR #1423 merged/, `must read the non-deferred PR:\n${r.out}`);
  refreshMain();
  assert.match(planOnMain(), /- \*\*Released:\*\* .*v1\.0\.0/);
});

test('release: a plan whose only PR-bearing slice is deferred is refused, writing nothing', () => {
  const { shippedSha } = makeRepo(DEFERRED_PLAN(`### Unannotated
- \`feature/alpha\` — no annotation

### Given up
- \`feature/beta\` — not built <!-- deferred: 2026-10-09, PR closed on purpose --> → #1425
`));
  process.env.GH_STUB_SHA = shippedSha;
  tag('v1.0.0', shippedSha);

  const r = run(['--release', '1.0.0', 'release-me'], { expectFail: true });
  assert.match(r.err, /names no '→ #N' annotation on a slice that was not deferred/, `must name the gate:\n${r.err}`);
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

// #3081 — A LOCAL `→ #N` MUST WIN OVER A HIGHER-NUMBERED FOREIGN ONE. Without
// GH_STUB_CLOSED marking the foreign number closed, the stub would answer it
// MERGED regardless of `--repo`, and the buggy "highest PR number" code would
// pass these tests too — closing it is what makes a wrong implementation fail.

test('release: a local PR wins over a higher-numbered foreign one', () => {
  const { shippedSha } = makeRepo(DEFERRED_PLAN(`### Shipped
- \`feature/alpha\` — the work → #33 → owner/other-repo#280
`));
  process.env.GH_STUB_SHA = shippedSha;
  process.env.GH_STUB_CLOSED = '280';
  tag('v0.1.0', shippedSha);

  const r = run(['--release', '0.1.0', 'release-me']);
  assert.match(r.out, /PR #33 merged/, `must resolve the local PR:\n${r.out}`);
  refreshMain();
  assert.match(planOnMain(), /- \*\*Released:\*\* .*v0\.1\.0/);
});

test('release: a foreign reference sharing the local PR number still resolves locally', () => {
  const { shippedSha } = makeRepo(DEFERRED_PLAN(`### Shipped
- \`feature/alpha\` — the work → #33 → owner/other-repo#33
`));
  process.env.GH_STUB_SHA = shippedSha;
  tag('v0.1.0', shippedSha);

  const r = run(['--release', '0.1.0', 'release-me']);
  assert.match(r.out, /PR #33 merged/, `must still resolve:\n${r.out}`);
  refreshMain();
  assert.match(planOnMain(), /- \*\*Released:\*\* .*v0\.1\.0/);
});

test('release: a deferred foreign reference equal to the shipped local PR is dropped before counting', () => {
  const { shippedSha } = makeRepo(DEFERRED_PLAN(`### Shipped
- \`feature/alpha\` — the work → #33

### Given up
- \`feature/beta\` — not built <!-- deferred: 2026-10-09, PR closed on purpose --> → owner/other-repo#33
`));
  process.env.GH_STUB_SHA = shippedSha;
  tag('v0.1.0', shippedSha);

  const r = run(['--release', '0.1.0', 'release-me']);
  assert.match(r.out, /PR #33 merged/, `must resolve the local, non-deferred PR:\n${r.out}`);
  refreshMain();
  assert.match(planOnMain(), /- \*\*Released:\*\* .*v0\.1\.0/);
});

// THE CASE PICKING THE TAG BY PR NUMBER, RATHER THAN mergedAt, WOULD PASS
// SILENTLY, ONE LEVEL DOWN FROM #3081: #60 and #50 are two SIBLING branches
// off the same base, each shipping to its own tag (v2.9.0 for #60, v2.10.0
// for #50) — neither commit is an ancestor of the other, so a tag can
// legitimately contain one and not the other. #60 merged first, #50 merged
// last. Resolving from the latest mergedAt (#50, tag v2.10.0) and then
// checking #60's commit against THAT tag is what catches #60 missing from
// it; resolving by number would have picked #60's own tag (v2.9.0) instead
// and never noticed #50 was absent from it the other way round.
test('release: two local PRs on sibling branches, the lower-numbered one merged last — refuses tag-misses-pr, writing nothing', () => {
  const { shippedSha: base } = makeRepo(DEFERRED_PLAN(`### Shipped
- \`feature/alpha\` — the work → #60
- \`feature/beta\` — the rest → #50
`));

  git(repo, 'checkout', '-q', '-b', 'br60', base);
  fs.writeFileSync(path.join(repo, 'f60.txt'), 'feature 60');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'ship feature 60');
  const sha60 = git(repo, 'rev-parse', 'HEAD').trim();
  git(repo, 'push', '-q', 'origin', 'br60');
  tag('v2.9.0', sha60);

  git(repo, 'checkout', '-q', '-b', 'br50', base);
  fs.writeFileSync(path.join(repo, 'f50.txt'), 'feature 50');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'ship feature 50');
  const sha50 = git(repo, 'rev-parse', 'HEAD').trim();
  git(repo, 'push', '-q', 'origin', 'br50');
  tag('v2.10.0', sha50);

  git(repo, 'checkout', '-q', 'main');

  process.env['GH_STUB_SHA_60'] = sha60;
  process.env['GH_STUB_MERGED_AT_60'] = '2026-09-01T00:00:00Z';
  process.env['GH_STUB_SHA_50'] = sha50;
  process.env['GH_STUB_MERGED_AT_50'] = '2026-09-02T00:00:00Z';

  const r = run(['--release', '2.10.0', 'release-me'], { expectFail: true });
  assert.match(r.err, /tag-misses-pr|does not contain PR #60/i, `must name the gate:\n${r.err}`);
  assert.match(r.err, /#60/, `must name the missing PR:\n${r.err}`);
  assert.equal(git(repo, 'status', '--porcelain').trim(), '');
  refreshMain();
  assert.doesNotMatch(planOnMain(), /\*\*Phase:\*\* Released/, 'phase must not flip');
  assert.doesNotMatch(planOnMain(), /\*\*Released:\*\* \S/, 'no Released: value must be written');
});

test('release: an all-foreign plan books Released with all-prs-foreign, asking the host nothing', () => {
  makeRepo(DEFERRED_PLAN(`### Shipped
- \`feature/alpha\` — the work → owner/other-repo#280
`));
  const callLog = path.join(tmp, 'gh-calls.log');
  process.env.GH_STUB_CALL_LOG = callLog;

  const r = run(['--release', '0.1.0', 'release-me']);
  assert.match(r.out, /all-prs-foreign/, `must name the reason:\n${r.out}`);
  assert.match(r.out, /owner\/other-repo/, `must name the foreign repository:\n${r.out}`);
  assert.ok(!fs.existsSync(callLog) || fs.readFileSync(callLog, 'utf8').trim() === '',
    `must ask the host nothing — gh was called:\n${fs.existsSync(callLog) ? fs.readFileSync(callLog, 'utf8') : ''}`);

  refreshMain();
  const plan = planOnMain();
  assert.match(plan, /- \*\*Phase:\*\* Released/, `phase must flip:\n${plan}`);
  assert.match(plan, /- \*\*Released:\*\* .*v0\.1\.0/, `record must name the requested version:\n${plan}`);
});
