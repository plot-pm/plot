// Contract test for skills/plot/scripts/plot-desk-dirt.sh — the one sourced
// filter that excuses the generated board bundles, path by path, read from
// `packages/board/build.mjs`'s own `shipped*` declarations.
//
// `main` rebuilds and pushes every generated bundle
// (`bug/main-builds-its-bundles`, #1249), so a desk that locally rebuilt one
// to test holds nothing an agent put there. This pins the three functions
// `plot-desk-dirt.sh` now defines — `bundle_paths`, `exclude_bundle_paths`,
// `desk_dirt` — against a real git worktree, never a stubbed status string.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const made = [];
const scratch = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-desk-dirt-'));
  made.push(dir);
  return dir;
};
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const lib = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-desk-dirt.sh');

const BUILD = [
  "import path from 'node:path';",
  "const shippedArtifact = path.join(here, '../../skills/plot/scripts/board/board-server.mjs');",
  '',
].join('\n');

/** A real git repo with a committed build declaring one bundle. */
function repo() {
  const dir = scratch();
  const g = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  g('config', 'commit.gpgsign', 'false');
  mkdirSync(path.join(dir, 'packages', 'board'), { recursive: true });
  mkdirSync(path.join(dir, 'skills', 'plot', 'scripts', 'board'), { recursive: true });
  writeFileSync(path.join(dir, 'packages', 'board', 'build.mjs'), BUILD);
  writeFileSync(path.join(dir, 'skills', 'plot', 'scripts', 'board', 'board-server.mjs'), 'original bundle\n');
  g('add', '-A');
  g('commit', '-qm', 'init');
  return dir;
}

/** Runs a sourced function against a worktree, through a tiny bash wrapper. */
function call(fn, dir, extraArgs = []) {
  return spawnSync('bash', ['-c', `. "$1"; ${fn} "$2" ${extraArgs.join(' ')}`, 'bash', lib, dir], {
    encoding: 'utf8',
  });
}

test('bundle_paths: derives the set from build.mjs, one path per line', () => {
  const dir = repo();
  const r = call('bundle_paths', dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'skills/plot/scripts/board/board-server.mjs');
});

test('bundle_paths: prints nothing when build.mjs is missing', () => {
  const dir = scratch();
  const r = call('bundle_paths', dir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

test('desk_dirt: a desk holding only a rebuilt bundle reads clean', () => {
  const dir = repo();
  writeFileSync(path.join(dir, 'skills', 'plot', 'scripts', 'board', 'board-server.mjs'), 'rebuilt locally\n');
  const r = call('desk_dirt', dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '', `a rebuilt bundle alone is not unlanded work:\n${r.stdout}`);
});

test('desk_dirt: a source change beside the rebuilt bundle still reads dirty', () => {
  const dir = repo();
  writeFileSync(path.join(dir, 'skills', 'plot', 'scripts', 'board', 'board-server.mjs'), 'rebuilt locally\n');
  writeFileSync(path.join(dir, 'my-source.ts'), 'real work\n');
  const r = call('desk_dirt', dir);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /my-source\.ts/, `the source change must still be named:\n${r.stdout}`);
  assert.doesNotMatch(r.stdout, /board-server\.mjs/, `the bundle must not be:\n${r.stdout}`);
});

test('desk_dirt: a desk with nothing dirty reads clean', () => {
  const dir = repo();
  const r = call('desk_dirt', dir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

test('desk_dirt: the PLOT-CORRECTION.md and tiny-garden exclusions still apply beside the bundle one', () => {
  const dir = repo();
  writeFileSync(path.join(dir, 'skills', 'plot', 'scripts', 'board', 'board-server.mjs'), 'rebuilt locally\n');
  writeFileSync(path.join(dir, 'PLOT-CORRECTION.md'), 'a correction\n');
  const r = call('desk_dirt', dir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '', `neither exclusion should fire together:\n${r.stdout}`);
});

test('exclude_bundle_paths: an empty bundle set excludes nothing', () => {
  const dir = scratch(); // no build.mjs at all
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main']);
  const r = spawnSync('bash', ['-c', `. "$1"; printf '?? x.ts\\n' | exclude_bundle_paths "$2"`, 'bash', lib, dir], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /x\.ts/);
});
