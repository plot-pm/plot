// Contract test for skills/plot/scripts/plot-phase-gate.sh's merge carve-out:
// completing a conflicted `git merge origin/<main>` stages every path the
// merge resolved, including every path main touched that the branch never
// did. Those paths are not the branch's own and must not trip the Draft/Design
// phase check or an explicit review hold — but only once every `MERGE_HEAD`
// commit is confirmed CONTAINED in origin/<main>, and only for a staged blob
// that EQUALS the blob already at that commit (a path the resolution changed
// still counts as the branch's own).
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
const gate = path.join(scripts, 'plot-phase-gate.sh');

const planBody = (phase) => `# P\n\n## Status\n\n- **Phase:** ${phase}\n- **Type:** feature\n`;

// A repo with a plan at `planPhase`, pushed to a real bare `origin` (the gate
// reads the phase from the shared ref), then a `branch` checked out carrying
// `ownFiles` as its own committed work.
const repo = ({ branch, planPhase, ownFiles = {} }) => {
  const tmp = scratch('plot-replay-phase-gate-');
  const dir = path.join(tmp, 'repo');
  mkdirSync(dir, { recursive: true });
  const sh = (c) => execSync(c, { cwd: dir, stdio: 'pipe' });
  sh('git init -q -b main && git config user.email t@t && git config user.name t && git config commit.gpgsign false');
  const write = (rel, body) => {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  };
  write('docs/plans/2026-01-01-x.md', planBody(planPhase));
  write('README.md', 'x');
  sh('git add -A && git commit -qm init');

  const origin = path.join(tmp, 'origin.git');
  execSync(`git init --bare -q -b main "${origin}"`, { cwd: tmp, stdio: 'pipe' });
  sh(`git remote add origin "${origin}" && git push -q origin main`);
  sh('git remote set-head origin main');

  sh(`git checkout -qb ${branch}`);
  for (const [rel, body] of Object.entries(ownFiles)) write(rel, body);
  if (Object.keys(ownFiles).length > 0) sh('git add -A && git commit -qm "branch work"');
  return { dir, sh, tmp };
};

const run = (dir, command = 'git commit -m x') =>
  spawnSync('bash', [gate], { cwd: dir, input: JSON.stringify({ tool_input: { command } }), encoding: 'utf8' });

// origin/main moves on by one commit holding `files`, through a private index
// so the branch's own working tree and staged state are untouched.
const advanceMain = (sh, dir, files) => {
  const index = path.join(dir, '.git', 'advance-index');
  const env = `GIT_INDEX_FILE="${index}"`;
  sh(`${env} git read-tree origin/main`);
  for (const [rel, body] of Object.entries(files)) {
    const bodyPath = path.join(dir, '.git', 'advance-body');
    writeFileSync(bodyPath, body);
    const blob = sh(`git hash-object -w ${bodyPath}`).toString().trim();
    sh(`${env} git update-index --add --cacheinfo 100644,${blob},${rel}`);
  }
  const tree = sh(`${env} git write-tree`).toString().trim();
  const commit = sh(`git commit-tree ${tree} -p origin/main -m "main moves"`).toString().trim();
  sh(`git update-ref refs/remotes/origin/main ${commit}`);
};

// A conflicted merge of origin/main into the current branch: both sides touch
// `path`, so `git merge --no-commit --no-ff origin/main` stops with the file
// unmerged and `MERGE_HEAD` set.
const conflictedMerge = (sh, dir, path_, branchBody, mainBody) => {
  const full = path.join(dir, path_);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, branchBody);
  sh(`git add -A && git commit -qm "branch touches ${path_}"`);
  advanceMain(sh, dir, { [path_]: mainBody });
  try {
    sh('git merge --no-commit --no-ff origin/main');
  } catch {
    // the file conflicts, which is the state under test
  }
};

// --- held branch (.plot/hold) ----------------------------------------------

test('replay phase gate, held branch: main\'s own paths staged unchanged allow finishing the merge', () => {
  const { dir, sh } = repo({ branch: 'feature/x', planPhase: 'Approved' });
  mkdirSync(path.join(dir, '.plot'), { recursive: true });
  writeFileSync(path.join(dir, '.plot', 'hold'), 'feature/x no reason recorded\n');
  sh('git add -A && git commit -qm "add hold"');

  conflictedMerge(sh, dir, 'src/a.js', 'branch version\n', 'main version\n');
  // Resolve by taking main's copy exactly (the `before -> after` equality the carve-out requires).
  sh('git checkout origin/main -- src/a.js');
  const r = run(dir);
  assert.equal(r.status, 0, `main's unmodified copy must not trip the hold (stderr: ${r.stderr})`);
});

test('replay phase gate, held branch: a path the resolution changed still refuses', () => {
  const { dir, sh } = repo({ branch: 'feature/x', planPhase: 'Approved' });
  mkdirSync(path.join(dir, '.plot'), { recursive: true });
  writeFileSync(path.join(dir, '.plot', 'hold'), 'feature/x no reason recorded\n');
  sh('git add -A && git commit -qm "add hold"');

  conflictedMerge(sh, dir, 'src/a.js', 'branch version\n', 'main version\n');
  // Resolve with a THIRD value — neither side's own blob.
  writeFileSync(path.join(dir, 'src', 'a.js'), 'resolved differently\n');
  sh('git add -A');
  const r = run(dir);
  assert.equal(r.status, 2, `a changed resolution is the branch's own (stderr: ${r.stderr})`);
});

test('replay phase gate, held branch: unchanged paths with MERGE_HEAD not contained in origin/main still refuse', () => {
  const { dir, sh } = repo({ branch: 'feature/x', planPhase: 'Approved' });
  mkdirSync(path.join(dir, '.plot'), { recursive: true });
  writeFileSync(path.join(dir, '.plot', 'hold'), 'feature/x no reason recorded\n');
  sh('git add -A && git commit -qm "add hold"');

  // Merge another branch entirely — not origin/main — so MERGE_HEAD's commit
  // is never contained in origin/main.
  sh('git branch other-branch');
  sh('git checkout -q other-branch');
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  writeFileSync(path.join(dir, 'src', 'a.js'), 'other version\n');
  sh('git add -A && git commit -qm "other touches a.js"');
  const otherSha = sh('git rev-parse HEAD').toString().trim();
  sh('git checkout -q feature/x');
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  writeFileSync(path.join(dir, 'src', 'a.js'), 'branch version\n');
  sh('git add -A && git commit -qm "branch touches a.js"');
  try {
    sh(`git merge --no-commit --no-ff ${otherSha}`);
  } catch {
    // conflict, the state under test
  }
  // Resolve by taking the other branch's copy exactly — would clear the carve-out
  // if containment were skipped, since the blob equals the MERGE_HEAD commit's own.
  sh(`git checkout ${otherSha} -- src/a.js`);
  const r = run(dir);
  assert.equal(r.status, 2, `a MERGE_HEAD not contained in origin/main earns no carve-out (stderr: ${r.stderr})`);
});

// --- implementation branch (Draft/Design phase check) ----------------------

test('replay phase gate, implementation branch: main\'s own paths staged unchanged allow the commit', () => {
  const { dir, sh } = repo({ branch: 'feature/x', planPhase: 'Draft' });
  conflictedMerge(sh, dir, 'src/a.js', 'branch version\n', 'main version\n');
  sh('git checkout origin/main -- src/a.js');
  const r = run(dir);
  assert.equal(r.status, 0, `main's unmodified copy must not trip the Draft phase check (stderr: ${r.stderr})`);
});

test('replay phase gate, implementation branch: a changed path still refuses', () => {
  const { dir, sh } = repo({ branch: 'feature/x', planPhase: 'Draft' });
  conflictedMerge(sh, dir, 'src/a.js', 'branch version\n', 'main version\n');
  writeFileSync(path.join(dir, 'src', 'a.js'), 'resolved differently\n');
  sh('git add -A');
  const r = run(dir);
  assert.equal(r.status, 2, `a changed resolution still implements the plan (stderr: ${r.stderr})`);
  assert.match(r.stderr, /still Draft/);
});

// --- regression: the gate's un-related merge-in-progress behaviour ----------

test('replay phase gate: an ordinary commit with no merge in progress behaves as before (regression)', () => {
  const { dir, sh } = repo({ branch: 'feature/x', planPhase: 'Draft' });
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  writeFileSync(path.join(dir, 'src', 'a.js'), 'branch version\n');
  sh('git add -A');
  const r = run(dir);
  assert.equal(r.status, 2, `an ordinary implementation commit still refuses (stderr: ${r.stderr})`);
  assert.match(r.stderr, /still Draft/);
});
