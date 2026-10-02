// Contract test for the CI-suite arm of skills/plot/scripts/plot-controller-gate.sh:
// an unattended agent at a fleet desk that starts a suite the project's
// `CI suites` key leaves to CI is refused, with the local checks command.
//
// This is the third slice of
// docs/plans/2026-10-02-an-agent-runs-the-tests-its-change-touches.md.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const gate = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-controller-gate.sh');

const made = [];
after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

/** A repository declaring two CI suites, and a linked worktree that is a fleet desk. */
const estate = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-ci-suite-gate-'));
  made.push(root);
  const repo = path.join(root, 'repo');
  const git = (...args) => execFileSync('git', args, { stdio: 'ignore' });
  git('init', '-q', '-b', 'main', repo);
  git('-C', repo, 'config', 'user.email', 'test@example.com');
  git('-C', repo, 'config', 'user.name', 'Test');
  fs.writeFileSync(
    path.join(repo, 'CLAUDE.md'),
    '## Plot Config\n\n- **CI suites:** pnpm run test:contracts; pnpm --filter @plot-pm/domain exec vitest run --coverage\n',
  );
  git('-C', repo, 'add', '-A');
  git('-C', repo, 'commit', '-q', '-m', 'config');
  const desk = path.join(root, 'desk');
  git('-C', repo, 'worktree', 'add', '-q', '-b', 'feature/x', desk);
  fs.writeFileSync(path.join(desk, '.plot-worker.pid'), '12345');
  return { repo, desk };
};

const ask = (cwd, command, unattended = true) => {
  const env = { ...process.env };
  delete env.PLOT_REPO_ROOT;
  if (unattended) env.PLOT_UNATTENDED = '1';
  else delete env.PLOT_UNATTENDED;
  return spawnSync('bash', [gate], {
    cwd,
    env,
    input: JSON.stringify({ tool_input: { command } }),
    encoding: 'utf8',
    timeout: 60_000,
  });
};

test('a listed suite at a fleet desk is refused, naming the local checks command', () => {
  const { desk } = estate();
  const r = ask(desk, 'pnpm run test:contracts');
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /`pnpm run test:contracts` is a CI suite/);
  assert.match(r.stderr, /plot-local-checks\.mjs/);
});

test('a listed suite behind a prefix or inside a chain is refused at the desk', () => {
  const { desk } = estate();
  assert.equal(ask(desk, 'nvm use && env -u FOO pnpm run test:contracts 2>&1 | tail').status, 2);
  assert.equal(ask(desk, 'X=1 pnpm --filter @plot-pm/domain exec vitest run --coverage').status, 2);
});

test('the same command passes in the main checkout and without PLOT_UNATTENDED', () => {
  const { repo, desk } = estate();
  assert.equal(ask(repo, 'pnpm run test:contracts').status, 0);
  assert.equal(ask(desk, 'pnpm run test:contracts', false).status, 0);
});

test('a desk without .plot-worker.pid is not a fleet desk, and passes', () => {
  const { desk } = estate();
  fs.unlinkSync(path.join(desk, '.plot-worker.pid'));
  assert.equal(ask(desk, 'pnpm run test:contracts').status, 0);
});

test('a read, a commit message and an unlisted command pass at the desk', () => {
  const { desk } = estate();
  assert.equal(ask(desk, 'grep test:contracts package.json').status, 0);
  assert.equal(ask(desk, 'git commit -m "pnpm run test:contracts runs in CI"').status, 0);
  assert.equal(ask(desk, 'pnpm run test:board').status, 0);
  assert.equal(ask(desk, 'node --test test/reconcile/reap.test.mjs').status, 0);
});
