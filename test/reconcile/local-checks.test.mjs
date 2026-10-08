// Contract test for skills/plot/scripts/board/plot-local-checks.mjs — the
// checks a branch's change needs, run as an agent runs it: in a repository,
// with the config in its CLAUDE.md, the branch against its default branch and
// the working tree both read.
//
// This is the second slice of
// docs/plans/2026-10-02-an-agent-runs-the-tests-its-change-touches.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const bundle = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'board', 'plot-local-checks.mjs');
const repoRoot = path.join(here, '..', '..');
const vitestBin = path.join(repoRoot, 'packages', 'domain', 'node_modules', '.bin', 'vitest');
const vitestPkg = path.join(repoRoot, 'packages', 'domain', 'node_modules', 'vitest');

const CONFIG = [
  '# Sandbox',
  '',
  '## Plot Config',
  '',
  '- **Local checks:** test/*.test.mjs = node --test {tests}; src/** = echo typecheck',
  '- **Local checks limit:** 2',
  '- **CI suites:** pnpm run test:all',
  '',
].join('\n');

/**
 * `vitest related` resolves its own project root through `realpath`
 * internally and compares it against the literal `--run` argument; given a
 * symlinked path it reports no related test and exits 0 (#1317). `node --test
 * <file>` runs the file it is given directly and has no such comparison, so it
 * cannot expose this failure — only a `vitest related`-style check can.
 */
const CONFIG_VITEST = [
  '# Sandbox',
  '',
  '## Plot Config',
  '',
  `- **Local checks:** src/** = ${vitestBin} related --run {changed}`,
  '',
].join('\n');

/**
 * A repository whose `origin` is itself, so `origin/main...HEAD` reads with no
 * network. Main holds a script, two tests naming it and a generated file; the
 * branch changes the script and the generated file and leaves one file
 * uncommitted.
 */
const sandbox = () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-local-checks-'));
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), content);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  write('CLAUDE.md', CONFIG);
  write('.gitattributes', 'gen/*.mjs -merge\n');
  write('src/tool.sh', 'echo tool\n');
  write('src/wide.sh', 'echo wide\n');
  write('gen/bundle.mjs', '// generated\n');
  write('test/tool.test.mjs', "// runs src/tool.sh\n");
  write('test/other.test.mjs', "// unrelated\n");
  write('test/w1.test.mjs', '// wide.sh\n');
  write('test/w2.test.mjs', '// wide.sh\n');
  write('test/w3.test.mjs', '// wide.sh\n');
  write('docs/note.md', 'a note\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'main');
  git('remote', 'add', 'origin', repo);
  git('fetch', '-q', 'origin');
  git('remote', 'set-head', 'origin', 'main');
  git('checkout', '-q', '-b', 'feature/x');
  write('src/tool.sh', 'echo changed\n');
  write('gen/bundle.mjs', '// regenerated\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'branch');
  write('docs/note.md', 'an uncommitted edit\n');
  write('src/wide.sh', 'echo wider\n');
  return repo;
};

const runIn = (cwd) => {
  const env = { ...process.env };
  delete env.PLOT_REPO_ROOT;
  return spawnSync('node', [bundle], { cwd, encoding: 'utf8', timeout: 60_000, env });
};

test('the bundle prints the selected tests, the glob check, and the report for a branch and its working tree', () => {
  const repo = sandbox();
  try {
    const res = runIn(repo);
    assert.equal(res.status, 0, res.stderr);
    const real = fs.realpathSync(repo);
    const lines = res.stdout.trim().split('\n');
    assert.deepEqual(lines, [
      `node --test ${real}/test/tool.test.mjs`,
      'echo typecheck',
      '# CI runs these: src/wide.sh is named by 3 test files',
      '# untested here, CI runs it: docs/note.md',
      '# CI suites: pnpm run test:all',
      'summary: commands=2 tests=1 over_limit=1 untested=1',
    ]);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('the generated file selects nothing and is not reported', () => {
  const repo = sandbox();
  try {
    const res = runIn(repo);
    assert.doesNotMatch(res.stdout, /gen\/bundle\.mjs/, res.stdout);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('outside a git repository the bundle exits 2 and says so', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-local-checks-norepo-'));
  try {
    const res = runIn(dir);
    assert.equal(res.status, 2, res.stdout + res.stderr);
    assert.match(res.stderr, /not inside a git repository/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A repository whose check runs `vitest related`, under its own `mkdtemp`
 * directory, plus a symlink to that directory elsewhere in `TMPDIR`. `cwd` is
 * the symlink, so a caller that normalises only one of `root`/`cwd` is
 * exercised: `os.tmpdir()` is already a symlink on macOS, so `sandbox()`
 * above sits in the symlinked case too, but it cannot prove which side a fix
 * resolved — this fixture controls both names, and its check command is the
 * one (`vitest related`) that actually fails silently on a symlinked path.
 */
const vitestSandbox = () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-local-checks-vitest-'));
  const git = (...args) => execFileSync('git', ['-C', target, ...args], { stdio: 'ignore' });
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(target, file)), { recursive: true });
    fs.writeFileSync(path.join(target, file), content);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  write('CLAUDE.md', CONFIG_VITEST);
  write('vitest.config.mjs', 'export default { test: { globals: false } };\n');
  write('src/a.mjs', 'export const a = 1;\n');
  write('test/a.test.mjs', [
    "import { describe, it, expect } from 'vitest';",
    "import { a } from '../src/a.mjs';",
    "describe('a', () => { it('is 2', () => { expect(a).toBe(2); }); });",
    '',
  ].join('\n'));
  fs.mkdirSync(path.join(target, 'node_modules'), { recursive: true });
  fs.symlinkSync(vitestPkg, path.join(target, 'node_modules', 'vitest'));
  git('add', '-A');
  git('commit', '-q', '-m', 'main');
  git('remote', 'add', 'origin', target);
  git('fetch', '-q', 'origin');
  git('remote', 'set-head', 'origin', 'main');
  git('checkout', '-q', '-b', 'feature/x');
  write('src/a.mjs', 'export const a = 2;\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'branch');

  const link = path.join(os.tmpdir(), `plot-local-checks-vitest-link-${path.basename(target)}`);
  fs.symlinkSync(target, link);
  return { target, link };
};

const removeVitestSandbox = ({ target, link }) => {
  fs.rmSync(link, { force: true });
  fs.rmSync(target, { recursive: true, force: true });
};

test('a worktree reached through a symlinked directory prints the real path, and the command finds its test', () => {
  const pair = vitestSandbox();
  try {
    const res = runIn(pair.link);
    assert.equal(res.status, 0, res.stderr);
    const real = fs.realpathSync(pair.target);
    const line = res.stdout.trim().split('\n')[0];
    assert.equal(line, `${vitestBin} related --run ${real}/src/a.mjs`);
    assert.notEqual(real, pair.link, 'the fixture must actually differ by symlink, or this proves nothing');

    const run = spawnSync(vitestBin, ['related', '--run', `${real}/src/a.mjs`], {
      cwd: pair.link,
      encoding: 'utf8',
    });
    assert.match(
      run.stderr + run.stdout,
      /1 passed/,
      'the printed command must find and pass the test, not just print a path',
    );
  } finally {
    removeVitestSandbox(pair);
  }
});

/**
 * The seam where a root can arrive unresolved: `git rev-parse --show-toplevel`.
 * Git on this machine already prints the real path, so a `git` on PATH stands
 * in for one that reports the symlink it was reached through. Every other
 * git call goes to the real binary.
 */
const gitReporting = (toplevel) => {
  const real = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-local-checks-shim-'));
  const shim = path.join(dir, 'git');
  fs.writeFileSync(
    shim,
    `#!/bin/sh\nif [ "$1" = rev-parse ] && [ "$2" = --show-toplevel ]; then echo '${toplevel}'; exit 0; fi\nexec '${real}' "$@"\n`,
    { mode: 0o755 },
  );
  return dir;
};

test('a root reported through a symlink is printed as its real path, and the command finds its test', () => {
  const pair = vitestSandbox();
  const shim = gitReporting(pair.link);
  try {
    const env = { ...process.env, PATH: `${shim}${path.delimiter}${process.env.PATH}` };
    delete env.PLOT_REPO_ROOT;
    const res = spawnSync('node', [bundle], { cwd: pair.link, encoding: 'utf8', timeout: 60_000, env });
    assert.equal(res.status, 0, res.stderr);
    const real = fs.realpathSync(pair.target);
    assert.notEqual(real, pair.link, 'the fixture must differ by symlink, or this proves nothing');
    const line = res.stdout.trim().split('\n')[0];
    assert.equal(line, `${vitestBin} related --run ${real}/src/a.mjs`);
  } finally {
    fs.rmSync(shim, { recursive: true, force: true });
    removeVitestSandbox(pair);
  }
});

test('the non-symlinked case still prints the path as given, unchanged by the symlink fix', () => {
  const repo = sandbox();
  try {
    const res = runIn(repo);
    assert.equal(res.status, 0, res.stderr);
    const real = fs.realpathSync(repo);
    const line = res.stdout.trim().split('\n')[0];
    assert.equal(line, `node --test ${real}/test/tool.test.mjs`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('a deleted file still appears in the report though it has no real path of its own', () => {
  const repo = sandbox();
  try {
    fs.rmSync(path.join(repo, 'docs/note.md'));
    execFileSync('git', ['-C', repo, 'rm', '-q', '--cached', 'docs/note.md'], { stdio: 'ignore' });
    const res = runIn(repo);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /# untested here, CI runs it: docs\/note\.md/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
