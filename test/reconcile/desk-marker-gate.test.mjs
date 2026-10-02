// Contract test for scripts/check-desk-markers.sh — a desk marker
// (`PLOT-BLOCKED*`, `PLOT-CORRECTION.md`) is never tracked, because on `main`
// it reads as waiting on a person at every desk cut from it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const rmTree = (dir) => rmSync(dir, { recursive: true, force: true });

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const gate = path.join(repoRoot, 'scripts', 'check-desk-markers.sh');

const run = (root) => spawnSync('bash', [gate, root], { encoding: 'utf8' });

/** A git repository holding the given files; `tracked` decides whether each is added. */
const repoWith = (files) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-deskmarker-'));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  writeFileSync(path.join(dir, 'README.md'), 'repo\n');
  git('add', 'README.md');
  for (const { rel, tracked } of files) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), 'PLOT-BLOCKED: a question\n');
    if (tracked) git('add', rel);
  }
  git('commit', '-q', '-m', 'fixture');
  return dir;
};

test('a tracked PLOT-BLOCKED.md at the root is refused, by name', () => {
  const dir = repoWith([{ rel: 'PLOT-BLOCKED.md', tracked: true }]);
  const r = run(dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^ {2}PLOT-BLOCKED\.md$/m);
  assert.match(r.stdout, /git rm --cached/);
  rmTree(dir);
});

test('a suffixed or nested marker is refused, and so is a tracked correction', () => {
  const dir = repoWith([
    { rel: 'PLOT-BLOCKED-ci.md', tracked: true },
    { rel: 'packages/board/PLOT-BLOCKED.md', tracked: true },
    { rel: 'PLOT-CORRECTION.md', tracked: true },
  ]);
  const r = run(dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  for (const rel of ['PLOT-BLOCKED-ci.md', 'packages/board/PLOT-BLOCKED.md', 'PLOT-CORRECTION.md']) {
    assert.ok(r.stdout.includes(`  ${rel}\n`), `names ${rel}: ${r.stdout}`);
  }
  rmTree(dir);
});

test('an untracked marker at a desk passes — that is the marker doing its job', () => {
  const dir = repoWith([
    { rel: 'PLOT-BLOCKED.md', tracked: false },
    { rel: 'PLOT-CORRECTION.md', tracked: false },
  ]);
  assert.equal(run(dir).status, 0);
  rmTree(dir);
});

test('a file that only mentions a marker in its name passes', () => {
  const dir = repoWith([
    { rel: 'docs/PLOT-CORRECTION-format.md', tracked: true },
    { rel: 'docs/about-PLOT-BLOCKED.md', tracked: true },
  ]);
  assert.equal(run(dir).status, 0, run(dir).stdout);
  rmTree(dir);
});

test('this repository passes it', () => {
  const r = spawnSync('bash', [gate], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
