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
    # A rebuild WRITES the artifact — that is the property being relied on, and
    # a stub that only exited 0 would let a test pass where the real rebuild
    # produced nothing.
    mkdir -p "$(dirname "${ARTIFACT}")"
    printf 'REBUILT\\n' > "${ARTIFACT}"
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
function makeRepo({ alsoConflictElsewhere = false } = {}) {
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
  fs.writeFileSync(path.join(repo, ARTIFACT), 'BASE\n');
  fs.writeFileSync(path.join(repo, 'other.txt'), 'base\n');
  fs.writeFileSync(path.join(repo, '.gitattributes'), `${ARTIFACT} -merge\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'remote', 'set-head', 'origin', 'main');

  // The branch rewrites the artifact.
  git(repo, 'checkout', '-qb', 'feature/x');
  fs.writeFileSync(path.join(repo, ARTIFACT), 'BRANCH SIDE\n');
  if (alsoConflictElsewhere) fs.writeFileSync(path.join(repo, 'other.txt'), 'branch\n');
  git(repo, 'commit', '-qam', 'branch work');
  git(repo, 'push', '-q', '-u', 'origin', 'feature/x');

  // main rewrites it too — the collision this whole design is about.
  git(repo, 'checkout', '-q', 'main');
  fs.writeFileSync(path.join(repo, ARTIFACT), 'MAIN SIDE\n');
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

// THE PAIRING THAT MATTERS. An implementation asking *is the artifact among the
// conflicts* passes the test above and silently repairs merges that need
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

// THE ARTIFACT PATH IS ONE FACT IN TWO LANGUAGES. The script cannot import the
// board's contract constant and the contract cannot read the script, so the
// pairing is asserted rather than trusted — a rename on one side that missed the
// other would make the resolver refuse everything, or worse, accept the wrong
// file.
test('the script and the board contract name the same artifact', () => {
  const script = fs.readFileSync(resolver, 'utf8');
  assert.match(script, new RegExp(`ARTIFACT_PATH="${ARTIFACT.replace(/\//g, '\\/')}"`));
  const schema = fs.readFileSync(
    path.join(here, '..', '..', 'packages', 'board', 'src', 'contract', 'schema.ts'), 'utf8');
  assert.match(schema, new RegExp(`BOARD_ARTIFACT_PATH = '${ARTIFACT.replace(/\//g, '\\/')}'`));
  // And .gitattributes marks it — property 1, without which nothing here is
  // licensed at all.
  const attrs = fs.readFileSync(path.join(here, '..', '..', '.gitattributes'), 'utf8');
  assert.match(attrs, new RegExp(`^${ARTIFACT.replace(/\//g, '\\/')} -merge$`, 'm'));
});
