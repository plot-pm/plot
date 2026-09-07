// Contract test for skills/plot/scripts/plot-resolve-artifact.sh — the ONLY
// automatic write this system grants.
//
// The permission exists because of three verified properties and for no other
// reason: `-merge` keeps the artifact valid through a conflict, the rebuild is
// deterministic, and CI's no-diff gate proves the result. Every assertion below
// aims at an implementation that would satisfy the happy path while removing one
// of those — because such an implementation still looks correct.
//
// THE SEQUENCE IS TESTED AGAINST A REAL TEMP REPO, with a real origin, a real
// `-merge` attribute and a real conflicting merge. The two commands that are
// expensive rather than interesting — `pnpm build:board` and `pnpm run
// test:board` — are PATH-stubbed, so a test can make the gate pass or fail on
// demand. That is the point: the load-bearing property is *what the script does
// when its own gate says no*, and only a stub can ask it.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const resolver = path.join(SCRIPTS, 'plot-resolve-artifact.sh');
const ARTIFACT = 'skills/plot/scripts/board/board-server.mjs';
// A SECOND BUNDLE IN THE FIXTURE, because the defect was about the second one.
// Until 2026-09-06 the script named `board-server.mjs` and nothing else, so a
// conflict in any other bundle was refused — measured on PR #727, refused on
// `plot-registryd.mjs` and repaired automatically on `board-server.mjs` hours
// later. A fixture holding one bundle cannot tell those two runs apart.
const ARTIFACT2 = 'skills/plot/scripts/board/plot-registryd.mjs';
const BUNDLES = [ARTIFACT, ARTIFACT2];

// The script derives its set from the repository's own `build.mjs`, by the same
// `shippedX = path.join(…)` pipeline `scripts/check-bundle-attributes.sh` uses.
// The fixture therefore ships a build declaring its bundles in that shape —
// nothing here parses JavaScript, so the declarations only have to be spelled
// the way the derivation reads them.
// The names are LETTERS, matching the real build's `shippedAsk`, `shippedTask`
// and so on — the derivation's pattern is `shipped[A-Za-z]*`, so a fixture
// spelling them `shipped0` would silently derive nothing and every test here
// would fail on an empty set rather than on what it meant to assert.
const SHIPPED_NAMES = ['shippedServer', 'shippedRegistryd'];
const FIXTURE_BUILD = `import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
${BUNDLES.map((b, i) => `const ${SHIPPED_NAMES[i]} = path.join(here, '../../${b}');`).join('\n')}
`;

let tmp, origin, repo, stubDir;

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}

function run(branch, { expectFail = true } = {}) {
  try {
    const out = execFileSync('bash', [resolver, branch], {
      encoding: 'utf8',
      cwd: repo,
      env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}` },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { out, code: 0 };
  } catch (err) {
    if (!expectFail) assert.fail(`unexpected failure:\n${err.stdout}\n${err.stderr}`);
    return { out: `${err.stdout ?? ''}${err.stderr ?? ''}`, code: err.status };
  }
}

/** The `summary:` footer, parsed. Every exit path must carry one. */
function footer(out) {
  const line = out.trim().split('\n').reverse()
    .find((l) => l.startsWith('summary: '));
  assert.ok(line, `no summary footer in:\n${out}`);
  const fields = {};
  for (const pair of line.slice('summary: '.length).split(' ')) {
    const [k, v] = pair.split('=');
    fields[k] = v;
  }
  return fields;
}

/**
 * `pnpm` stubbed so the two expensive commands answer on demand.
 *
 * Writing to a marker file per invocation lets a test assert that the BUILD ran
 * and the SUITE ran — the ordering the whole design rests on is "tests before
 * the push", and only the record proves the suite was consulted at all.
 */
function writePnpmStub({ build = 0, tests = 0 } = {}) {
  fs.writeFileSync(path.join(stubDir, 'pnpm'), `#!/usr/bin/env bash
echo "$*" >> "${stubDir}/pnpm.log"
case "$*" in
  *build:board*)
    # A rebuild WRITES the artifacts — that is the property being relied on, and
    # a stub that only exited 0 would let a test pass where the real rebuild
    # produced nothing. EVERY bundle, like the real build: one
    # \`pnpm build:board\` regenerates all of them, which is why the script
    # stages the whole set rather than only what conflicted.
    mkdir -p "$(dirname "${ARTIFACT}")"
${BUNDLES.map((b) => `    printf 'REBUILT\\n' > "${b}"`).join('\n')}
    exit ${build} ;;
  *test:board*) exit ${tests} ;;
esac
exit 0
`, { mode: 0o755 });
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-resolve-'));
  stubDir = path.join(tmp, 'stub');
  fs.mkdirSync(stubDir);
});

after(() => {
  // Worktrees the script created live BESIDE the repo, inside tmp, so removing
  // tmp takes them with it.
  fs.rmSync(tmp, { recursive: true, force: true });
});

/**
 * A repo whose artifact conflicts between `main` and a feature branch, exactly
 * as this repo's does: `-merge` set, both sides having rewritten the whole file.
 */
// `conflictIn` names the bundles the branch and main both rewrite. It defaults
// to the first, which is every pre-2026-09-06 test unchanged; passing the
// second is what asks whether the widening actually happened.
function makeRepo({ alsoConflictElsewhere = false, conflictIn = [ARTIFACT] } = {}) {
  const id = Math.random().toString(36).slice(2, 8);
  origin = path.join(tmp, `origin-${id}.git`);
  // The repo must sit one level down from a directory the script may write
  // worktrees into — it derives `wt_root` as the repo's parent.
  const work = path.join(tmp, `work-${id}`);
  fs.mkdirSync(work);
  repo = path.join(work, 'repo');

  execFileSync('git', ['init', '--bare', '-b', 'main', origin]);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');

  fs.mkdirSync(path.join(repo, path.dirname(ARTIFACT)), { recursive: true });
  for (const b of BUNDLES) fs.writeFileSync(path.join(repo, b), 'BASE\n');
  fs.writeFileSync(path.join(repo, 'other.txt'), 'base\n');
  // Every bundle marked, which is what `check-bundle-attributes.sh` gates in
  // the real repo — property 1, without which nothing here is licensed at all.
  fs.writeFileSync(path.join(repo, '.gitattributes'),
    BUNDLES.map((b) => `${b} -merge`).join('\n') + '\n');
  // The set's single source, read by the script from the repo it repairs.
  fs.mkdirSync(path.join(repo, 'packages', 'board'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'packages', 'board', 'build.mjs'), FIXTURE_BUILD);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'remote', 'set-head', 'origin', 'main');

  // The branch rewrites the named bundles.
  git(repo, 'checkout', '-qb', 'feature/x');
  for (const b of conflictIn) fs.writeFileSync(path.join(repo, b), 'BRANCH SIDE\n');
  if (alsoConflictElsewhere) fs.writeFileSync(path.join(repo, 'other.txt'), 'branch\n');
  git(repo, 'commit', '-qam', 'branch work');
  git(repo, 'push', '-q', '-u', 'origin', 'feature/x');

  // main rewrites them too — the collision this whole design is about.
  git(repo, 'checkout', '-q', 'main');
  for (const b of conflictIn) fs.writeFileSync(path.join(repo, b), 'MAIN SIDE\n');
  if (alsoConflictElsewhere) fs.writeFileSync(path.join(repo, 'other.txt'), 'main\n');
  git(repo, 'commit', '-qam', 'main work');
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'fetch', '-q', 'origin');
}

beforeEach(() => {
  fs.rmSync(path.join(stubDir, 'pnpm.log'), { force: true });
});

test('resolves an artifact-only conflict: rebuilds, tests, and pushes on green', () => {
  makeRepo();
  writePnpmStub({ build: 0, tests: 0 });

  const { out, code } = run('feature/x', { expectFail: false });
  assert.equal(code, 0, out);
  assert.deepEqual(footer(out), {
    branch: 'feature/x', outcome: 'pushed', reason: 'artifact-conflict-resolved',
  });

  // THE REBUILD DECIDED, not the side. Whichever half git kept, the pushed
  // artifact is the rebuild's output — the property `.gitattributes` argues and
  // CI's no-diff gate re-checks.
  const pushed = git(repo, 'show', `origin/feature/x:${ARTIFACT}`);
  assert.equal(pushed.trim(), 'REBUILT');

  // AND IT RAN THE SUITE BEFORE PUSHING. A resolver that skipped the gate
  // passes every assertion above.
  const log = fs.readFileSync(path.join(stubDir, 'pnpm.log'), 'utf8');
  assert.match(log, /build:board/);
  assert.match(log, /test:board/);
});

// THE DEFECT THIS SLICE EXISTS FOR, end to end.
//
// MEASURED 2026-09-06: PR #727 conflicted in `plot-registryd.mjs` — a `-merge`
// bundle with a deterministic rebuild, exactly the licensed case — and the
// script refused `not-artifact-only` against a list naming only
// `board-server.mjs`. The repair was done by hand. Hours later the same branch
// conflicted in `board-server.mjs` and the same script repaired it
// automatically: same class of conflict, opposite outcome, one filename apart.
//
// The test above proves the FIRST bundle is repaired; only this one proves the
// list is no longer a list of one.
test('repairs a conflict in a bundle that is not board-server.mjs', () => {
  makeRepo({ conflictIn: [ARTIFACT2] });
  writePnpmStub({ build: 0, tests: 0 });

  const { out, code } = run('feature/x', { expectFail: false });
  assert.equal(code, 0, out);
  assert.equal(footer(out).outcome, 'pushed', out);

  // The pushed commit carries the REBUILD, not either side of the conflict.
  assert.equal(git(repo, 'show', `origin/feature/x:${ARTIFACT2}`).trim(), 'REBUILT');

  // And the gate still ran before the push.
  const log = fs.readFileSync(path.join(stubDir, 'pnpm.log'), 'utf8');
  assert.match(log, /build:board/);
  assert.match(log, /test:board/);
});

test('repairs a conflict spanning several bundles at once', () => {
  // One `pnpm build:board` regenerates every bundle, so a set of them is no
  // less mechanical than a set of one — and a merge routinely collides in more
  // than one.
  makeRepo({ conflictIn: BUNDLES });
  writePnpmStub({ build: 0, tests: 0 });

  const { out, code } = run('feature/x', { expectFail: false });
  assert.equal(code, 0, out);
  assert.equal(footer(out).outcome, 'pushed', out);
  for (const bundle of BUNDLES) {
    assert.equal(git(repo, 'show', `origin/feature/x:${bundle}`).trim(), 'REBUILT',
      `${bundle} must carry the rebuild`);
  }
});

// THE PAIRING THAT MATTERS. An implementation asking *is a bundle among the
// conflicts* passes every test above and silently repairs merges that need
// judgement as a whole. This is that merge.
test('refuses a mixed conflict set — the artifact plus another file', () => {
  makeRepo({ alsoConflictElsewhere: true });
  writePnpmStub({ build: 0, tests: 0 });

  const before = git(repo, 'rev-parse', 'origin/feature/x').trim();
  const { out } = run('feature/x');

  assert.equal(footer(out).outcome, 'refused');
  assert.equal(footer(out).reason, 'not-artifact-only');
  // NOTHING WAS PUSHED, and nothing was built: the refusal happens before the
  // rebuild, so the gate was never even reached.
  assert.equal(git(repo, 'rev-parse', 'origin/feature/x').trim(), before);
  assert.ok(!fs.existsSync(path.join(stubDir, 'pnpm.log')),
    'a refused conflict set must not reach the rebuild');
});

// THE DISCIPLINE MUST SURVIVE THE WIDENING, and this is the test that says so.
//
// The refusal above could pass while the guard asked the forbidden question, as
// long as the ONE licensed bundle was the one it looked for. Widened to nine,
// the same mistake has eight more ways to hide — so the mixed set is asserted
// against a bundle that is NOT the first, over a set that is not of size one.
test('refuses a mixed set even when every other path IS a bundle', () => {
  makeRepo({ conflictIn: BUNDLES, alsoConflictElsewhere: true });
  writePnpmStub({ build: 0, tests: 0 });

  const before = git(repo, 'rev-parse', 'origin/feature/x').trim();
  const { out } = run('feature/x');

  assert.equal(footer(out).outcome, 'refused');
  assert.equal(footer(out).reason, 'not-artifact-only');
  // It NAMES what put it outside the set — a refusal that only says no sends a
  // reader to reproduce the merge to find out which file it meant.
  assert.match(out, /outside the bundle set: .*other\.txt/);
  assert.equal(git(repo, 'rev-parse', 'origin/feature/x').trim(), before);
  assert.ok(!fs.existsSync(path.join(stubDir, 'pnpm.log')),
    'a refused conflict set must not reach the rebuild');
});

// NOTHING IS PUSHED UNTIL THE SUITE PASSES. The CI no-diff gate is what makes
// the repair checkable, and CI runs only AFTER a push — so a resolver that
// pushed and waited would manufacture exactly the state this plan defines as
// stuck: a red PR in the queue.
test('a failing test:board pushes nothing and reports an abandoned repair', () => {
  makeRepo();
  writePnpmStub({ build: 0, tests: 1 });

  const before = git(repo, 'rev-parse', 'origin/feature/x').trim();
  const { out } = run('feature/x');

  assert.equal(footer(out).outcome, 'abandoned');
  assert.equal(footer(out).reason, 'tests-failed');
  assert.equal(git(repo, 'rev-parse', 'origin/feature/x').trim(), before,
    'a failing suite must push nothing');
  // The suite WAS consulted — the difference between "refused to try" and
  // "tried and its own gate said no".
  assert.match(fs.readFileSync(path.join(stubDir, 'pnpm.log'), 'utf8'), /test:board/);
});

test('a failing rebuild pushes nothing and never reaches the suite', () => {
  makeRepo();
  writePnpmStub({ build: 1, tests: 0 });

  const before = git(repo, 'rev-parse', 'origin/feature/x').trim();
  const { out } = run('feature/x');

  assert.equal(footer(out).outcome, 'abandoned');
  assert.equal(footer(out).reason, 'build-failed');
  assert.equal(git(repo, 'rev-parse', 'origin/feature/x').trim(), before);
  assert.doesNotMatch(fs.readFileSync(path.join(stubDir, 'pnpm.log'), 'utf8'), /test:board/);
});

// ONE REPAIR AT A TIME, AND NEVER TWO ON ONE BRANCH. A second run while the
// first is working would fight over the same worktree, and the artifact would
// belong to neither.
test('refuses a second repair while a lock is held for the branch', () => {
  makeRepo();
  writePnpmStub({ build: 0, tests: 0 });

  const lock = path.join(repo, '.plot', 'state', 'resolve-feature-x.lock');
  fs.mkdirSync(lock, { recursive: true });

  const { out } = run('feature/x');
  assert.equal(footer(out).outcome, 'refused');
  assert.equal(footer(out).reason, 'already-in-flight');
  assert.ok(!fs.existsSync(path.join(stubDir, 'pnpm.log')));

  // And the lock is RELEASED by a run that holds it, so one repair cannot block
  // the branch forever.
  fs.rmSync(lock, { recursive: true });
  const second = run('feature/x', { expectFail: false });
  assert.equal(footer(second.out).outcome, 'pushed');
  assert.ok(!fs.existsSync(lock), 'the lock must not outlive the run that took it');
});

// A branch that merges cleanly after all — the prediction was made from refs
// that have since moved, which is the direction this repo knows they move in.
// There is nothing to repair, so nothing is pushed: a merge nobody asked for is
// still a write.
test('pushes nothing when the merge turns out to be clean', () => {
  makeRepo();
  // Rewind main so the branch merges without conflict.
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'reset', '-q', '--hard', 'HEAD~1');
  git(repo, 'push', '-qf', 'origin', 'main');
  git(repo, 'fetch', '-q', 'origin');
  writePnpmStub({ build: 0, tests: 0 });

  const before = git(repo, 'rev-parse', 'origin/feature/x').trim();
  const { out } = run('feature/x');

  assert.equal(footer(out).outcome, 'refused');
  assert.equal(footer(out).reason, 'no-conflict');
  assert.equal(git(repo, 'rev-parse', 'origin/feature/x').trim(), before);
});

// AN EMPTY CONFLICT SET IS NOT A SMALL ONE — it is the absence of a reading, and
// naming it `not-artifact-only` asserts something about files nobody examined.
//
// THE MEASURED CASE, 2026-08-17: the resolver reused a worktree in which no
// merge was running, read zero unmerged paths, compared zero against one, and
// refused as though it had seen other files. The refusal was right; the reason
// sent a reader looking for conflicts that did not exist.
//
// Reproduced by making the merge fail WITHOUT conflicting: a worktree in which a
// merge is already recorded as in progress makes `git merge` exit non-zero
// before it starts, so THIS merge's unmerged set is empty. The distinction under
// test is exactly that non-zero-with-nothing-observed differs from
// non-zero-with-a-set.
//
// The worktree is left CLEAN apart from that record, so the `worktree-busy`
// fence cannot fire and steal the assertion — this test must reach the set check
// or it proves nothing about how an empty set is named.
test('refuses as not-observed when the merge left no unmerged paths', () => {
  makeRepo();
  writePnpmStub({ build: 0, tests: 0 });

  const wt = path.join(path.dirname(repo), 'plot-wt-feature-x');
  git(repo, 'worktree', 'add', '-q', wt, 'feature/x');
  git(wt, 'fetch', '-q', 'origin');

  // MERGE_HEAD alone: git refuses to start a new merge ("You have not concluded
  // your merge"), the index is clean, and nothing is unmerged.
  const gitDir = git(wt, 'rev-parse', '--absolute-git-dir').trim();
  fs.writeFileSync(path.join(gitDir, 'MERGE_HEAD'),
    `${git(repo, 'rev-parse', 'origin/main').trim()}\n`);
  assert.equal(git(wt, 'status', '--porcelain', '--untracked-files=no').trim(), '',
    'the fixture must leave the worktree CLEAN — worktree-busy must not fire here');
  assert.equal(git(wt, 'diff', '--name-only', '--diff-filter=U').trim(), '',
    'the fixture must leave NO unmerged paths — that is the case under test');

  const before = git(repo, 'rev-parse', 'origin/feature/x').trim();
  const { out } = run('feature/x');

  // THE REASON IS THE ASSERTION. `refused` alone would pass with the old code.
  assert.equal(footer(out).outcome, 'refused');
  assert.equal(footer(out).reason, 'not-observed',
    'an empty set must never be reported as not-artifact-only');
  assert.equal(git(repo, 'rev-parse', 'origin/feature/x').trim(), before);
  assert.ok(!fs.existsSync(path.join(stubDir, 'pnpm.log')),
    'nothing observed must not reach the rebuild');
});

// THE RESOLVER NEVER MERGES IN A WORKTREE SOMEONE ELSE IS WORKING IN.
//
// Measured on 2026-08-17: zero unmerged paths, three modified files, an agent
// working in it — and the resolver ran `git merge` inside it anyway. It refused
// before writing, but that was luck. Reuse is right when the worktree is idle;
// the name alone does not say so.
test('refuses a worktree carrying foreign modifications', () => {
  makeRepo();
  writePnpmStub({ build: 0, tests: 0 });

  const wt = path.join(path.dirname(repo), 'plot-wt-feature-x');
  git(repo, 'worktree', 'add', '-q', wt, 'feature/x');
  // Someone else's work in progress: tracked files modified, nothing committed.
  fs.writeFileSync(path.join(wt, 'other.txt'), 'an agent was typing here\n');

  const before = git(repo, 'rev-parse', 'origin/feature/x').trim();
  const { out } = run('feature/x');

  assert.equal(footer(out).outcome, 'refused');
  assert.equal(footer(out).reason, 'worktree-busy');
  assert.equal(git(repo, 'rev-parse', 'origin/feature/x').trim(), before);

  // AND THE FOREIGN WORK IS UNTOUCHED — the assertion the measured case makes
  // load-bearing. A refusal that still merged first would pass every line above.
  assert.equal(fs.readFileSync(path.join(wt, 'other.txt'), 'utf8'),
    'an agent was typing here\n');
  assert.ok(!fs.existsSync(path.join(wt, '.git', 'MERGE_HEAD')));
  assert.ok(!fs.existsSync(path.join(stubDir, 'pnpm.log')),
    'a busy worktree must not reach the rebuild');
});

// AN UNTRACKED FILE IS NOT WORK IN PROGRESS. The pairing that matters: a fence
// counting every difference would refuse the repair whenever a stray log or an
// editor scratch file sat in the worktree — and `merge` does not touch those.
// This is the artifact-only repair succeeding with one present.
test('repairs a worktree holding only untracked files', () => {
  makeRepo();
  writePnpmStub({ build: 0, tests: 0 });

  const wt = path.join(path.dirname(repo), 'plot-wt-feature-x');
  git(repo, 'worktree', 'add', '-q', wt, 'feature/x');
  fs.writeFileSync(path.join(wt, 'stray.log'), 'not work in progress\n');

  const { out, code } = run('feature/x', { expectFail: false });
  assert.equal(code, 0, out);
  assert.equal(footer(out).outcome, 'pushed');
  assert.equal(git(repo, 'show', `origin/feature/x:${ARTIFACT}`).trim(), 'REBUILT');
});

test('a dry run changes nothing and says so', () => {
  makeRepo();
  writePnpmStub({ build: 0, tests: 0 });

  const before = git(repo, 'rev-parse', 'origin/feature/x').trim();
  let out;
  try {
    out = execFileSync('bash', [resolver, '--dry-run', 'feature/x'],
      { encoding: 'utf8', cwd: repo, env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}` } });
  } catch (err) {
    out = `${err.stdout}${err.stderr}`;
  }
  assert.equal(footer(out).reason, 'dry-run');
  assert.equal(git(repo, 'rev-parse', 'origin/feature/x').trim(), before);
  assert.ok(!fs.existsSync(path.join(stubDir, 'pnpm.log')));
});

// THE LOOKUP ASKS GIT, IT DOES NOT GUESS THE PATH. The measured failure that
// forced held_worktree to ask git lives here too: a hand-made worktree named
// for the branch with its TYPE dropped, matching NEITHER the `plot-wt-<branch>`
// creation rule nor a bare `<branch>` dedicated-root name. A resolver that
// reconstructed the path would create a SECOND worktree on the branch (or fail),
// and git refuses a second checkout — so the repair would never reach the one
// desk the work is actually on. This plants that worktree and asserts the repair
// happened INSIDE it.
test('finds a worktree it did not create, whose name matches no convention', () => {
  makeRepo();
  writePnpmStub({ build: 0, tests: 0 });

  // A name a human would pick — not `plot-wt-feature-x`, not `feature-x`. This is
  // the exact population the git-vs-guess distinction exists to cover.
  const wt = path.join(path.dirname(repo), 'hand-made-x');
  git(repo, 'worktree', 'add', '-q', wt, 'feature/x');
  git(wt, 'fetch', '-q', 'origin');

  const { out, code } = run('feature/x', { expectFail: false });
  assert.equal(code, 0, out);
  assert.equal(footer(out).outcome, 'pushed');

  // IT REUSED THE HAND-MADE WORKTREE rather than composing a fresh path: the
  // `step:` line names it by its real (symlink-resolved) directory, and no
  // second worktree was registered. Matching the basename dodges macOS's
  // /var → /private/var symlink without weakening the claim — a guessed path
  // would have said `plot-wt-feature-x` or `feature-x`, never `hand-made-x`.
  assert.match(out, /reusing worktree \S*\/hand-made-x\b/,
    'the repair must run in the worktree git reported, not a guessed path');
  const registered = git(repo, 'worktree', 'list', '--porcelain')
    .split('\n').filter((l) => l.startsWith('worktree ')).length;
  assert.equal(registered, 2, 'exactly the main repo and the one hand-made worktree — no guessed third');
});

// THE BUNDLE SET IS ONE FACT IN TWO LANGUAGES. The script cannot import the
// board's contract constant and the contract cannot read the script, so the
// pairing is asserted rather than trusted — a bundle added on one side and
// missed on the other would make the resolver refuse a repair it is licensed to
// make, or worse, claim one it is not.
//
// SET EQUALITY, NOT ONE STRING. It asserted a single filename until 2026-09-06,
// and that is precisely the assertion that passed while the two sides disagreed
// about the other eight: `board-server.mjs` matched on both, so the test was
// green throughout the window in which PR #727's repair was refused.
//
// `build.mjs` IS THE SOURCE and the other two are checked against it. The
// script derives from it at run time; the contract derives from it at BUILD
// time, into `bundles.generated.ts`, because the board is a bundle that must
// not read the repository to load.
//
// WHAT THIS TEST ASSERTS CHANGED ON 2026-09-07, and the change is the point. It
// used to assert that SOMEBODY HAD REMEMBERED to update a hand-written list —
// an assertion that is only ever red after the damage. It now asserts that THE
// DERIVATION RAN: all three readers derive from one source, and what could still
// go wrong is a stale generated file, which is what set equality now catches.
test('build.mjs, the script and the board contract name the same bundle set', () => {
  const root = path.join(here, '..', '..');

  // 1. THE SOURCE. The same derivation `scripts/check-bundle-attributes.sh`
  //    runs, so a third spelling of it cannot appear here either.
  const build = fs.readFileSync(path.join(root, 'packages', 'board', 'build.mjs'), 'utf8');
  const emitted = [...build.matchAll(/shipped[A-Za-z]* = path\.join\([^)]*'\.\.\/\.\.\/([^']*)'\)/g)]
    .map((m) => m[1]).sort();
  assert.ok(emitted.length > 0, 'the derivation found no bundles — the build changed shape');

  // 2. THE SCRIPT derives rather than lists, so what is asserted is that it
  //    derives from that file by that shape. A hardcoded path would not match.
  const script = fs.readFileSync(resolver, 'utf8');
  assert.match(script, /packages\/board\/build\.mjs/,
    'the script must derive its set from the build, never list it');
  assert.match(script, /shipped\[A-Za-z\]\* = path\\\.join/,
    'the script must use the same derivation as check-bundle-attributes.sh');
  assert.doesNotMatch(script, /ARTIFACT_PATH=/,
    'a single hardcoded artifact is the defect this replaced');

  // 3. THE CONTRACT DERIVES rather than lists, and what it derived must equal
  //    the source exactly. Equality in BOTH directions: a missing entry makes a
  //    licensed repair be refused, and an extra one claims a rebuild that does
  //    not exist.
  //
  //    The contract itself must carry NO list — that is the property this slice
  //    added, and asserting the generated file alone would pass just as well
  //    with a hand-written array beside it shadowing the re-export.
  const schema = fs.readFileSync(
    path.join(root, 'packages', 'board', 'src', 'contract', 'schema.ts'), 'utf8');
  assert.doesNotMatch(schema, /BOARD_ARTIFACT_PATHS: readonly string\[\] = \[/,
    'the contract must derive the bundle set, never list it — that list drifted three times in one evening');
  assert.match(schema, /from '\.\/bundles\.generated\.js'/,
    'the contract must obtain the bundle set from the generated module');

  //    The generated module is what the contract re-exports, and it is
  //    COMMITTED: CI typechecks before it builds, so an ignored file would fail
  //    `tsc --noEmit` on a fresh clone. Committed, it can go stale — and a stale
  //    one is exactly what this comparison catches.
  const generated = fs.readFileSync(
    path.join(root, 'packages', 'board', 'src', 'contract', 'bundles.generated.ts'), 'utf8');
  const declared = generated.match(/BOARD_ARTIFACT_PATHS: readonly string\[\] = \[([^\]]*)\]/);
  assert.ok(declared, 'bundles.generated.ts is not declared in the shape this test reads');
  const listed = [...declared[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(listed, emitted,
    'bundles.generated.ts is stale — run `pnpm build:board` and commit the result');

  //    AND THE BUILD IS WHAT WRITES IT. Without this, a hand-edited generated
  //    file passes every assertion above for exactly as long as nobody adds a
  //    bundle — which is the original defect, moved one file across.
  assert.match(build, /bundles\.generated\.ts/,
    'build.mjs must write the generated module, or nothing keeps it fresh');

  // 5. EVERY DERIVED ENTRY IS A REAL FILE. The derivation reads `build.mjs` as
  //    TEXT, so any complete declaration written in a COMMENT is matched by it
  //    and lands in the set as a bundle nothing emits — and the pattern spans
  //    newlines, so a wrapped comment matches too.
  //
  //    Measured 2026-09-07 while adding the generator: two comments explaining
  //    the derivation put `<path>` and an ellipsis into the set, and
  //    `plot-resolve-artifact.sh` read both as bundles it might repair. The
  //    prose now describes the shape in pieces; this is what keeps it that way,
  //    because the next author explaining the derivation will reach for an
  //    example.
  //
  //    Existence is the assertion rather than a shape match: a path that is not
  //    on disk is not a bundle, whatever it looks like.
  for (const bundle of emitted) {
    assert.ok(fs.existsSync(path.join(root, bundle)),
      `the derivation produced ${JSON.stringify(bundle)}, which is not a file — `
      + 'a complete declaration written in a comment is matched by the derivation');
  }

  // 4. AND `.gitattributes` MARKS EVERY ONE — property 1, without which nothing
  //    here is licensed at all. `check-bundle-attributes.sh` is the gate; this
  //    asserts the same fact from the side that acts on it.
  const attrs = fs.readFileSync(path.join(root, '.gitattributes'), 'utf8');
  for (const bundle of emitted) {
    assert.match(attrs, new RegExp(`^${bundle.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} -merge$`, 'm'),
      `${bundle} is emitted by the build and not marked -merge`);
  }

  // 5. `plot-monitor.mjs` IS NOT IN THE SET. Nothing rebuilds it, so it has no
  //    deterministic rebuild — and that is the whole licence. Asserted rather
  //    than assumed, because the natural mistake when widening a list is to
  //    sweep in every file in the directory.
  assert.ok(!emitted.includes('skills/plot/scripts/board/plot-monitor.mjs'),
    'plot-monitor.mjs has no build output; including it asserts a rebuild that does not exist');
});
