// Contract test for skills/plot/scripts/plot-bundle-commit-gate.sh — the gate
// that refuses a commit staging a generated board bundle, on any branch.
// Builds throwaway git repos and drives the gate the way Claude Code does:
// hook JSON on stdin, in the repository.
//
// THE ARRIVAL POINT IS BEFORE THE COMMIT EXISTS, which is what this proves
// that scripts/check-no-bundle-diff.sh cannot: that gate reads a diff against
// a merge base after a commit landed, this one reads the index before one
// does. A PR carrying no bundle needs both — a branch whose every commit was
// refused here never produces the diff the CI gate would otherwise have to
// catch, 16-18 minutes later.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const made = [];
const scratch = (prefix) => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  made.push(dir);
  return dir;
};
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const gate = path.join(scripts, 'plot-bundle-commit-gate.sh');

const BUILD = [
  "import path from 'node:path';",
  "const shippedArtifact = path.join(here, '../../skills/plot/scripts/board/board-server.mjs');",
  '',
].join('\n');

// A repo with a build declaring one bundle, committed, then `origin/main`
// pointed at that same commit (so a merge base exists), then `files` written
// and staged on top.
const repo = ({ files = {} } = {}) => {
  const tmp = scratch('plot-bundle-commit-gate-');
  const dir = path.join(tmp, 'repo');
  mkdirSync(dir, { recursive: true });
  const sh = (c) => execSync(c, { cwd: dir, stdio: 'pipe' });
  sh('git init -q -b main && git config user.email t@t && git config user.name t && git config commit.gpgsign false');
  const write = (rel, body) => {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  };
  write('packages/board/build.mjs', BUILD);
  write('skills/plot/scripts/board/board-server.mjs', 'original bundle\n');
  write('skills/plot/scripts/board/README.md', 'hand-written docs\n');
  write(
    'packages/board/src/contract/bundles.generated.ts',
    "export const BOARD_ARTIFACT_PATHS = ['skills/plot/scripts/board/board-server.mjs'];\n",
  );
  write('.gitattributes', 'skills/plot/scripts/board/board-server.mjs -merge\n');
  sh('git add -A && git commit -qm init');
  sh(`git update-ref refs/remotes/origin/main "$(git rev-parse main)"`);
  for (const [rel, body] of Object.entries(files)) write(rel, body);
  sh('git add -A');
  return { dir, sh };
};

const run = (dir, command = 'git commit -m x') =>
  spawnSync('bash', [gate], { cwd: dir, input: JSON.stringify({ tool_input: { command } }), encoding: 'utf8' });

test('bundle-commit gate: staging a changed bundle is refused and names the restore', () => {
  const { dir } = repo({ files: { 'skills/plot/scripts/board/board-server.mjs': 'rebuilt locally\n' } });
  const r = run(dir);
  assert.equal(r.status, 2, `must block (stderr: ${r.stderr})`);
  assert.match(r.stderr, /board-server\.mjs/);
  assert.match(r.stderr, /git restore --staged --worktree --source=/);
});

test('bundle-commit gate: staging only README.md passes', () => {
  const { dir } = repo({ files: { 'skills/plot/scripts/board/README.md': 'hand-written docs, updated\n' } });
  const r = run(dir);
  assert.equal(r.status, 0, `README-only must pass (stderr: ${r.stderr})`);
});

test('bundle-commit gate: staging bundles.generated.ts or .gitattributes passes', () => {
  const { dir } = repo({
    files: {
      'packages/board/src/contract/bundles.generated.ts':
        "export const BOARD_ARTIFACT_PATHS = ['skills/plot/scripts/board/board-server.mjs', 'skills/plot/scripts/board/plot-new.mjs'];\n",
      '.gitattributes':
        'skills/plot/scripts/board/board-server.mjs -merge\nskills/plot/scripts/board/plot-new.mjs -merge\n',
    },
  });
  const r = run(dir);
  assert.equal(r.status, 0, `neither file is this gate's business (stderr: ${r.stderr})`);
});

test('bundle-commit gate: the printed restore, run in the fixture, clears the gate', () => {
  const { dir, sh } = repo({ files: { 'skills/plot/scripts/board/board-server.mjs': 'rebuilt locally\n' } });
  const refused = run(dir);
  assert.equal(refused.status, 2);
  const match = refused.stderr.match(/git restore --staged --worktree --source="([a-f0-9]+)" -- (\S+)/);
  assert.ok(match, `must print a restore command: ${refused.stderr}`);
  sh(`git restore --staged --worktree --source="${match[1]}" -- ${match[2]}`);
  const cleared = run(dir);
  assert.equal(cleared.status, 0, `must now pass: ${cleared.stderr}`);
});

test('bundle-commit gate: a new bundle born on this branch prints git rm --cached', () => {
  const { dir } = repo({
    files: {
      'packages/board/build.mjs': BUILD + "const shippedNinth = path.join(here, '../../skills/plot/scripts/board/plot-ninth.mjs');\n",
      'skills/plot/scripts/board/plot-ninth.mjs': 'new bundle\n',
    },
  });
  const r = run(dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /git rm --cached skills\/plot\/scripts\/board\/plot-ninth\.mjs/);
});

test('bundle-commit gate: a repository with no build.mjs allows a staged bundle', () => {
  // An adopter vendors the bundles it runs and builds none, so a bundle it
  // stages is not generated output.
  const { dir, sh } = repo();
  sh('git rm -q packages/board/build.mjs && git commit -qm "drop the build"');
  sh(`git update-ref refs/remotes/origin/main "$(git rev-parse main)"`);
  writeFileSync(path.join(dir, 'skills/plot/scripts/board/board-server.mjs'), 'vendored update\n');
  sh('git add -A');
  const r = run(dir);
  assert.equal(r.status, 0, `no build.mjs means no generated set (stderr: ${r.stderr})`);
});

test('bundle-commit gate: a command that makes no commit is ignored', () => {
  const { dir } = repo({ files: { 'skills/plot/scripts/board/board-server.mjs': 'rebuilt locally\n' } });
  const r = run(dir, 'git status');
  assert.equal(r.status, 0);
});

test('bundle-commit gate: run from outside the fixture, git -C <dir> commit is still read', () => {
  const { dir } = repo({ files: { 'skills/plot/scripts/board/board-server.mjs': 'rebuilt locally\n' } });
  const outside = scratch('plot-bundle-commit-gate-outside-');
  const r = spawnSync('bash', [gate], {
    cwd: outside,
    input: JSON.stringify({ tool_input: { command: `git -C ${dir} commit -m x` } }),
    encoding: 'utf8',
  });
  assert.equal(r.status, 2, `must refuse from outside the fixture (stderr: ${r.stderr})`);
});

test('bundle-commit gate: a deleted bundle is not refused', () => {
  const { dir, sh } = repo();
  sh('git rm -q skills/plot/scripts/board/board-server.mjs');
  const r = run(dir);
  assert.equal(r.status, 0, `a removal is never this defect: ${r.stderr}`);
});

// ---------------------------------------------------------------------------
// The gate allows exactly when CI reads the path clean.
//
// Each state below is built in a temporary repository. The gate answers on the
// index before the commit; then the commit is made with plain git (no hook is
// installed in the fixture) and `scripts/check-no-bundle-diff.sh <root> HEAD <B>`
// reads the result, with B resolved by this test from git directly.
// ---------------------------------------------------------------------------
const checkScript = path.join(here, '..', '..', 'scripts', 'check-no-bundle-diff.sh');
const BUNDLE = 'skills/plot/scripts/board/board-server.mjs';

const commitBundle = (sh, dir, body, message) => {
  writeFileSync(path.join(dir, BUNDLE), body);
  sh(`git add -A && git commit -qm "${message}"`);
};

// `git merge-base origin/main HEAD [MERGE_HEAD]`, resolved without the gate.
const baseOf = (sh) => {
  const merging = (() => {
    try {
      return sh('git rev-parse -q --verify MERGE_HEAD').toString().trim();
    } catch {
      return '';
    }
  })();
  return sh(`git merge-base origin/main HEAD ${merging}`).toString().trim();
};

// Runs the gate on the staged state, commits it regardless, and asks CI's
// script. Returns whether each side was clean.
const verdicts = (dir, sh) => {
  const base = baseOf(sh);
  const gateAllows = run(dir).status === 0;
  sh('git commit -qm candidate');
  const ci = spawnSync('bash', [checkScript, dir, 'HEAD', base], { encoding: 'utf8' });
  return { gateAllows, ciClean: ci.status === 0, base };
};

// main moves on by one commit holding `body` for the bundle; `origin/main`
// follows. Built with plumbing and a private index, so the working tree and
// the staged state under test stay as they are.
const advanceMain = (sh, dir, body) => {
  writeFileSync(path.join(dir, '.git', 'advance-body'), body);
  const index = path.join(dir, '.git', 'advance-index');
  const env = `GIT_INDEX_FILE="${index}"`;
  const blob = sh(`git hash-object -w .git/advance-body`).toString().trim();
  sh(`${env} git read-tree origin/main`);
  sh(`${env} git update-index --add --cacheinfo 100644,${blob},${BUNDLE}`);
  const tree = sh(`${env} git write-tree`).toString().trim();
  const commit = sh(`git commit-tree ${tree} -p origin/main -m "main moves"`).toString().trim();
  sh(`git update-ref refs/remotes/origin/main ${commit}`);
};

// A feature branch carrying its own older copy of the bundle, with main ahead
// by a newer one, and a merge of origin/main in progress that conflicts.
const conflictedMerge = () => {
  const { dir, sh } = repo();
  sh('git checkout -q -b feature');
  commitBundle(sh, dir, 'branch copy\n', 'branch carries a bundle');
  advanceMain(sh, dir, 'main copy\n');
  try {
    sh('git merge --no-commit --no-ff origin/main');
  } catch {
    // the bundle conflicts, which is the state under test
  }
  return { dir, sh };
};

test('bundle-commit gate and CI agree: the #2965 replay takes main\'s copy during a conflicted merge', () => {
  const { dir, sh } = conflictedMerge();
  sh(`git checkout origin/main -- ${BUNDLE}`);
  const { gateAllows, ciClean } = verdicts(dir, sh);
  assert.equal(gateAllows, true, 'main\'s copy equals the merge base the merge commit will have');
  assert.equal(ciClean, true);
});

test('bundle-commit gate and CI agree: a plain commit restoring the branch base is allowed', () => {
  const { dir, sh } = repo();
  sh('git checkout -q -b feature');
  commitBundle(sh, dir, 'branch copy\n', 'branch carries a bundle');
  sh(`git restore --staged --worktree --source="$(git merge-base origin/main HEAD)" -- ${BUNDLE}`);
  const { gateAllows, ciClean } = verdicts(dir, sh);
  assert.equal(gateAllows, true);
  assert.equal(ciClean, true);
});

test('bundle-commit gate and CI agree: a plain commit of a newer origin/main copy is refused', () => {
  const { dir, sh } = repo();
  sh('git checkout -q -b feature');
  commitBundle(sh, dir, 'branch copy\n', 'branch carries a bundle');
  advanceMain(sh, dir, 'main copy\n');
  sh(`git restore --staged --worktree --source=origin/main -- ${BUNDLE}`);
  const refused = run(dir);
  assert.match(refused.stderr, /git merge origin\/main/, 'a branch behind origin/main is told to merge first');
  const { gateAllows, ciClean } = verdicts(dir, sh);
  assert.equal(gateAllows, false);
  assert.equal(ciClean, false);
});

test('bundle-commit gate and CI agree: a mode-only change is refused', () => {
  const { dir, sh } = repo();
  sh(`git update-index --chmod=+x ${BUNDLE}`);
  const { gateAllows, ciClean } = verdicts(dir, sh);
  assert.equal(gateAllows, false);
  assert.equal(ciClean, false);
});

test('bundle-commit gate: a fetch during a merge does not change the answer', () => {
  const { dir, sh } = conflictedMerge();
  sh(`git checkout origin/main -- ${BUNDLE}`);
  assert.equal(run(dir).status, 0);
  advanceMain(sh, dir, 'main moved again\n');
  assert.equal(run(dir).status, 0, 'origin/main moved after the merge began; the merge base did not');
});

test('bundle-commit gate: the printed repair names a sha, so a moved origin/main leaves it valid', () => {
  const { dir, sh } = repo();
  sh('git checkout -q -b feature');
  commitBundle(sh, dir, 'branch copy\n', 'branch carries a bundle');
  writeFileSync(path.join(dir, BUNDLE), 'rebuilt again\n');
  sh('git add -A');
  const refused = run(dir);
  assert.equal(refused.status, 2);
  const match = refused.stderr.match(/git restore --staged --worktree --source="([a-f0-9]{40})" -- (\S+)/);
  assert.ok(match, `the repair names the resolved sha: ${refused.stderr}`);
  advanceMain(sh, dir, 'main moved\n');
  sh(`git restore --staged --worktree --source="${match[1]}" -- ${match[2]}`);
  assert.equal(run(dir).status, 0);
});

test('bundle-commit gate: the printed repair clears the gate when the merge base differs from HEAD', () => {
  const { dir, sh } = repo();
  sh('git checkout -q -b feature');
  commitBundle(sh, dir, 'branch copy\n', 'branch carries a bundle');
  writeFileSync(path.join(dir, BUNDLE), 'rebuilt again\n');
  sh('git add -A');
  const refused = run(dir);
  assert.equal(refused.status, 2);
  const match = refused.stderr.match(/git restore --staged --worktree --source="([a-f0-9]{40})" -- (\S+)/);
  assert.ok(match);
  sh(`git restore --staged --worktree --source="${match[1]}" -- ${match[2]}`);
  assert.notEqual(sh('git rev-parse HEAD').toString().trim(), match[1], 'the base is not HEAD');
  assert.equal(run(dir).status, 0, 'a repair the gate refuses again is the original defect');
});

test('bundle-commit gate: an unreadable reading refuses and prints no repair line', () => {
  const noMain = repo({ files: { [BUNDLE]: 'rebuilt locally\n' } });
  noMain.sh('git update-ref -d refs/remotes/origin/main');
  const garbled = conflictedMerge();
  garbled.sh(`git checkout origin/main -- ${BUNDLE}`);
  writeFileSync(path.join(garbled.dir, '.git', 'MERGE_HEAD'), 'not-a-commit\n');
  for (const { dir } of [noMain, garbled]) {
    const r = run(dir);
    assert.equal(r.status, 2, `must refuse (stderr: ${r.stderr})`);
    assert.match(r.stderr, /board-server\.mjs/);
    assert.doesNotMatch(r.stderr, /git restore|git rm/);
  }
});
