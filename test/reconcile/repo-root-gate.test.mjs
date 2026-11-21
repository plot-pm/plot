// Contract test for scripts/check-repo-root.sh — the repository root holds only
// the entries on scripts/repo-root.allowed, because the plugin installs from a
// tag of this repository and a stray at the root is in every installed copy.
//
// The gate reads what git tracks, checks the first path segment only, and
// exits 2 when it cannot read its allow-list (a blind gate is not a pass).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const rmTree = (dir) => rmSync(dir, { recursive: true, force: true });

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const gate = path.join(repoRoot, 'scripts', 'check-repo-root.sh');

const run = (root, allowFile) => spawnSync('bash', [gate, root, allowFile], { encoding: 'utf8' });

/**
 * A git repository holding the given files, and an allow-list file kept outside
 * it. `tracked` decides whether each file is added.
 *
 * @param files - `{ rel, tracked }` for each file the fixture writes.
 * @param allowed - the allow-list's text, or `null` for no allow-list file.
 * @returns the repository, the allow-list path and a cleanup function.
 */
const fixture = (files, allowed) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-repo-root-'));
  const holder = mkdtempSync(path.join(tmpdir(), 'plot-repo-root-list-'));
  const allowFile = path.join(holder, 'repo-root.allowed');
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  writeFileSync(path.join(dir, 'README.md'), 'repo\n');
  git('add', 'README.md');
  for (const { rel, tracked } of files) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), 'content\n');
    // `-f`: a machine's global ignore file may name a scratch path such as `.playwright-mcp`.
    if (tracked) git('add', '-f', rel);
  }
  git('commit', '-q', '-m', 'fixture');
  if (allowed !== null) writeFileSync(allowFile, allowed);
  return {
    dir,
    allowFile,
    cleanup: () => {
      rmTree(dir);
      rmTree(holder);
    },
  };
};

test('a root of allowed names passes', () => {
  const f = fixture([{ rel: 'docs/a.md', tracked: true }], 'README.md\ndocs\n');
  const r = run(f.dir, f.allowFile);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /every tracked root entry is on the allow-list \(2 entries\)/);
  f.cleanup();
});

test('a tracked unknown file at the root is refused, by name', () => {
  const f = fixture([{ rel: 'after_521.txt', tracked: true }], 'README.md\n');
  const r = run(f.dir, f.allowFile);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^::error::/m);
  assert.match(r.stdout, /^ {2}after_521\.txt$/m);
  assert.match(r.stdout, /scripts\/repo-root\.allowed/);
  assert.match(r.stdout, /git rm -r --cached/);
  f.cleanup();
});

test('a tracked unknown directory at the root is refused, and the directory is named', () => {
  const f = fixture([{ rel: '.playwright-mcp/page-1.yml', tracked: true }], 'README.md\n');
  const r = run(f.dir, f.allowFile);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^ {2}\.playwright-mcp$/m);
  assert.doesNotMatch(r.stdout, /page-1\.yml/);
  f.cleanup();
});

test('every unknown root entry is named, and an allowed one is not', () => {
  const f = fixture(
    [
      { rel: 'new_skill.md', tracked: true },
      { rel: 'SKILL_new.md', tracked: true },
      { rel: 'docs/a.md', tracked: true },
    ],
    'README.md\ndocs\n',
  );
  const r = run(f.dir, f.allowFile);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^ {2}new_skill\.md$/m);
  assert.match(r.stdout, /^ {2}SKILL_new\.md$/m);
  assert.doesNotMatch(r.stdout, /^ {2}docs$/m);
  f.cleanup();
});

test('an unknown file below an allowed directory passes', () => {
  const f = fixture(
    [
      { rel: 'docs/stray.txt', tracked: true },
      { rel: 'docs/deep/er/stray.txt', tracked: true },
    ],
    'README.md\ndocs\n',
  );
  const r = run(f.dir, f.allowFile);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  f.cleanup();
});

test('an untracked unknown file at the root passes', () => {
  const f = fixture(
    [
      { rel: 'scratch.txt', tracked: false },
      { rel: '.playwright-mcp/page-1.yml', tracked: false },
    ],
    'README.md\n',
  );
  const r = run(f.dir, f.allowFile);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  f.cleanup();
});

test('an allow-list entry that no tracked path uses is a notice, not a failure', () => {
  const f = fixture([], 'README.md\ngone.md\n');
  const r = run(f.dir, f.allowFile);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^::notice::.*gone\.md/m);
  assert.doesNotMatch(r.stdout, /README\.md, which git no longer tracks/);
  f.cleanup();
});

test('a missing allow-list exits 2 and names the file', () => {
  const f = fixture([], null);
  const r = run(f.dir, f.allowFile);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /^::error::/m);
  assert.ok(r.stdout.includes(f.allowFile), r.stdout);
  f.cleanup();
});

test('an allow-list with no name exits 2', () => {
  const f = fixture([], '# only a comment\n\n   \n');
  const r = run(f.dir, f.allowFile);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /names no entry/);
  f.cleanup();
});

test('a directory that is not a git repository exits 2', () => {
  const f = fixture([], 'README.md\n');
  const notRepo = mkdtempSync(path.join(tmpdir(), 'plot-repo-root-none-'));
  const r = run(notRepo, f.allowFile);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /^::error::/m);
  rmTree(notRepo);
  f.cleanup();
});

test('comment lines, blank lines and surrounding whitespace in the allow-list are ignored', () => {
  const f = fixture(
    [{ rel: 'docs/a.md', tracked: true }],
    '# the root\n\n   # an indented comment\n  README.md  \n\ndocs\t\n',
  );
  const r = run(f.dir, f.allowFile);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /::notice::/);
  f.cleanup();
});

test('an allow-list line is a name, never a pattern', () => {
  const f = fixture(
    [
      { rel: 'a.txt', tracked: true },
      { rel: 'b.txt', tracked: true },
    ],
    'README.md\n*\n*.txt\n[ab].txt\n',
  );
  const r = run(f.dir, f.allowFile);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^ {2}a\.txt$/m);
  assert.match(r.stdout, /^ {2}b\.txt$/m);
  f.cleanup();
});

test('a name that is a prefix of an allowed name is still refused', () => {
  const f = fixture([{ rel: 'doc', tracked: true }], 'README.md\ndocs\n');
  const r = run(f.dir, f.allowFile);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^ {2}doc$/m);
  f.cleanup();
});

test('this repository passes it, and its allow-list names no entry twice', () => {
  const r = spawnSync('bash', [gate], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const names = readFileSync(path.join(repoRoot, 'scripts', 'repo-root.allowed'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  assert.equal(new Set(names).size, names.length, `a duplicate line in the allow-list: ${names}`);
});
