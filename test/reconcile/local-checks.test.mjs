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
