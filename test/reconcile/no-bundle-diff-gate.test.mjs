// Contract test for scripts/check-no-bundle-diff.sh — the gate that stops a
// PR's diff from carrying a generated board bundle.
//
// `main` now builds its own bundles after every merge
// (`bug/main-builds-its-bundles`, #1249), so a generated path in a PR's diff
// is never that branch's own work. This pins: the refusal and its repair
// line, the merge-base restore for a path the base holds, `git rm` for a path
// born on the branch, and the deliberate exemptions for `bundles.generated.ts`
// and `.gitattributes` — a directory-wide gate would refuse both, and both
// must pass because two PRs that each add a bundle still conflict there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const rmTree = (dir) => rmSync(dir, { recursive: true, force: true });

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const gate = path.join(repoRoot, 'scripts', 'check-no-bundle-diff.sh');

const sh = (dir, args) => spawnSync('bash', [gate, dir, ...args], { encoding: 'utf8' });
const git = (dir, args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });

/** A throwaway repo with one generated bundle declared and committed on `base`. */
function baseTree() {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-no-bundle-diff-'));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  mkdirSync(path.join(dir, 'packages', 'board', 'src', 'contract'), { recursive: true });
  mkdirSync(path.join(dir, 'skills', 'plot', 'scripts', 'board'), { recursive: true });
  writeFileSync(
    path.join(dir, 'packages', 'board', 'build.mjs'),
    [
      "import path from 'node:path';",
      '',
      "const shippedArtifact = path.join(here, '../../skills/plot/scripts/board/board-server.mjs');",
      '',
    ].join('\n'),
  );
  writeFileSync(
    path.join(dir, 'skills', 'plot', 'scripts', 'board', 'board-server.mjs'),
    'original bundle\n',
  );
  writeFileSync(
    path.join(dir, 'skills', 'plot', 'scripts', 'board', 'README.md'),
    'hand-written docs\n',
  );
  writeFileSync(
    path.join(dir, 'packages', 'board', 'src', 'contract', 'bundles.generated.ts'),
    "export const BOARD_ARTIFACT_PATHS = ['skills/plot/scripts/board/board-server.mjs'];\n",
  );
  writeFileSync(
    path.join(dir, '.gitattributes'),
    'skills/plot/scripts/board/board-server.mjs -merge\n',
  );
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'base']);
  git(dir, ['checkout', '-q', '-b', 'feature']);
  return dir;
}

test('no-bundle-diff gate: refuses a changed bundle and passes a README-only change', () => {
  // THE DIRECTORY-WIDE-MATCH CATCH. Change the bundle, then in a second
  // fixture change only README.md: the first must fail, the second must pass.
  const dirty = baseTree();
  writeFileSync(
    path.join(dirty, 'skills', 'plot', 'scripts', 'board', 'board-server.mjs'),
    'rebuilt locally\n',
  );
  git(dirty, ['add', '-A']);
  git(dirty, ['commit', '-q', '-m', 'rebuilt the bundle']);

  const got = sh(dirty, ['feature', 'master']);
  assert.equal(got.status, 1, `a changed bundle must fail:\n${got.stdout}`);
  assert.match(got.stdout, /board-server\.mjs/, `and name it:\n${got.stdout}`);
  assert.match(got.stdout, /git checkout/, `and print the restore:\n${got.stdout}`);
  rmTree(dirty);

  const clean = baseTree();
  writeFileSync(
    path.join(clean, 'skills', 'plot', 'scripts', 'board', 'README.md'),
    'hand-written docs, updated\n',
  );
  git(clean, ['add', '-A']);
  git(clean, ['commit', '-q', '-m', 'README only']);

  const gotClean = sh(clean, ['feature', 'master']);
  assert.equal(gotClean.status, 0, `README-only must pass:\n${gotClean.stdout}`);
  rmTree(clean);
});

test('no-bundle-diff gate: passes a diff touching bundles.generated.ts or .gitattributes', () => {
  // THE WHOLE-SURFACE CATCH. A gate reading the whole board directory would
  // refuse both; the plan says neither is this gate's business because two
  // PRs that each add a bundle still conflict there, and that conflict is the
  // correct one to read.
  const dir = baseTree();
  writeFileSync(
    path.join(dir, 'packages', 'board', 'src', 'contract', 'bundles.generated.ts'),
    "export const BOARD_ARTIFACT_PATHS = ['skills/plot/scripts/board/board-server.mjs', 'skills/plot/scripts/board/plot-new.mjs'];\n",
  );
  writeFileSync(
    path.join(dir, '.gitattributes'),
    'skills/plot/scripts/board/board-server.mjs -merge\nskills/plot/scripts/board/plot-new.mjs -merge\n',
  );
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'declare the next bundle']);

  const got = sh(dir, ['feature', 'master']);
  assert.equal(got.status, 0, `neither file is this gate's business:\n${got.stdout}`);
  rmTree(dir);
});

test('no-bundle-diff gate: the printed repair line, run in the fixture, clears the gate', () => {
  const dir = baseTree();
  const base = git(dir, ['rev-parse', 'master']).stdout.trim();
  writeFileSync(
    path.join(dir, 'skills', 'plot', 'scripts', 'board', 'board-server.mjs'),
    'rebuilt locally\n',
  );
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'rebuilt the bundle']);

  const refused = sh(dir, ['feature', 'master']);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, new RegExp(`git checkout "${base}" -- skills/plot/scripts/board/board-server\\.mjs`));

  const restore = spawnSync('bash', ['-c', `cd ${dir} && git checkout "${base}" -- skills/plot/scripts/board/board-server.mjs && git add -A && git commit -q -m restore`]);
  assert.equal(restore.status, 0, `the printed command must apply cleanly: ${restore.stderr}`);

  const rechecked = sh(dir, ['feature', 'master']);
  assert.equal(rechecked.status, 0, `the gate must now pass:\n${rechecked.stdout}`);
  rmTree(dir);
});

test('no-bundle-diff gate: prints git rm for a bundle the merge base never had', () => {
  const dir = baseTree();
  writeFileSync(
    path.join(dir, 'packages', 'board', 'build.mjs'),
    [
      "import path from 'node:path';",
      '',
      "const shippedArtifact = path.join(here, '../../skills/plot/scripts/board/board-server.mjs');",
      "const shippedNinth = path.join(here, '../../skills/plot/scripts/board/plot-ninth.mjs');",
      '',
    ].join('\n'),
  );
  writeFileSync(path.join(dir, 'skills', 'plot', 'scripts', 'board', 'plot-ninth.mjs'), 'new bundle\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'add a bundle born on this branch']);

  const got = sh(dir, ['feature', 'master']);
  assert.equal(got.status, 1);
  assert.match(got.stdout, /git rm skills\/plot\/scripts\/board\/plot-ninth\.mjs/, `must print git rm, not a checkout that cannot find the path:\n${got.stdout}`);
  assert.doesNotMatch(got.stdout, /git checkout.*plot-ninth/, `the merge base never had this path:\n${got.stdout}`);
  rmTree(dir);
});

test('no-bundle-diff gate: never prints the directory', () => {
  const dir = baseTree();
  writeFileSync(
    path.join(dir, 'skills', 'plot', 'scripts', 'board', 'board-server.mjs'),
    'rebuilt locally\n',
  );
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'rebuilt the bundle']);

  const got = sh(dir, ['feature', 'master']);
  assert.equal(got.status, 1);
  assert.doesNotMatch(
    got.stdout,
    /skills\/plot\/scripts\/board\/?["'\s]*$/m,
    `must never print the bare directory:\n${got.stdout}`,
  );
  rmTree(dir);
});

test('no-bundle-diff gate: a clean diff with no bundle changes passes', () => {
  const dir = baseTree();
  writeFileSync(path.join(dir, 'skills', 'plot', 'scripts', 'board', 'plot-monitor.mjs'), 'hand-written\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'unrelated hand-written file']);

  const got = sh(dir, ['feature', 'master']);
  assert.equal(got.status, 0, `no generated path changed:\n${got.stdout}`);
  rmTree(dir);
});

test('no-bundle-diff gate: this repo passes it', () => {
  const got = sh(repoRoot, ['HEAD', 'origin/main']);
  assert.equal(got.status, 0, `plot's own tree must carry no bundle diff:\n${got.stdout}`);
});
