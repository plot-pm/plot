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

test('bundle-commit gate: a new bundle born on this branch is beyond this gate now, and CI remains the backstop', () => {
  // Since `the-bundle-gate-is-a-launcher`: the generated set is read from
  // `BOARD_ARTIFACT_PATHS`, compiled into the INSTALLED `plot-gate.mjs` — not
  // grepped live from `build.mjs` the way the shell gate used to. A branch
  // that adds a new `shipped*` declaration changes its own working tree's
  // `bundles.generated.ts`, but the installed gate bundle (built from `main`,
  // never committed per-branch) still carries the old array, so this early
  // gate cannot see the addition. `scripts/check-no-bundle-diff.sh` reads the
  // branch's own checkout directly in CI and still catches it, 16-18 minutes
  // later — the layering this gate was always the cheap, early half of.
  const { dir } = repo({
    files: {
      'packages/board/build.mjs': BUILD + "const shippedNinth = path.join(here, '../../skills/plot/scripts/board/plot-ninth.mjs');\n",
      'skills/plot/scripts/board/plot-ninth.mjs': 'new bundle\n',
    },
  });
  const r = run(dir);
  assert.equal(r.status, 0, `a brand-new bundle not yet in the installed gate's compiled set passes here; CI's own gate catches it: ${r.stderr}`);
});

test('bundle-commit gate: a command with no "git commit" is ignored', () => {
  const { dir } = repo({ files: { 'skills/plot/scripts/board/board-server.mjs': 'rebuilt locally\n' } });
  const r = run(dir, 'git status');
  assert.equal(r.status, 0);
});

test('bundle-commit gate: a deleted bundle is not refused', () => {
  const { dir, sh } = repo();
  sh('git rm -q skills/plot/scripts/board/board-server.mjs');
  const r = run(dir);
  assert.equal(r.status, 0, `a removal is never this defect: ${r.stderr}`);
});
