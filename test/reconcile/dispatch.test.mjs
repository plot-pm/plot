// Contract test for skills/plot/scripts/plot-dispatch.sh — worktree fan-out.
//
// This is the one script in the fleet that WRITES: it creates worktrees, pushes
// claim refs, and starts workers. Everything it writes must therefore be either
// idempotent or refused, and `--dry-run` must show exactly what would happen
// without doing any of it. These tests hold that line.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const dispatch = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-dispatch.sh');

let tmp, repo;

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}
function run(args, cwd = repo) {
  return execFileSync('bash', [dispatch, ...args], { encoding: 'utf8', cwd });
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-dispatch-'));
  const origin = path.join(tmp, 'origin.git');
  repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  fs.writeFileSync(path.join(repo, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n');
  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'plans', '2026-01-01-fan.md'), `# Fan-out plan

## Status

- **Phase:** Approved
- **Type:** feature
- **Impl:** own branches

## Branches

### Implementation
- \`feature/one\` — first
- \`feature/two\` — second
- \`feature/skipped\` — not needed <!-- deferred: folded in -->
`);
  fs.symlinkSync('../2026-01-01-fan.md', path.join(repo, 'plans', 'active', 'fan.md'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plan');
  git(repo, 'push', '-q', 'origin', 'main');
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('dispatch: --dry-run lists eligible branches and creates nothing', () => {
  const out = run(['--dry-run', '--offline', 'fan']);
  assert.match(out, /feature\/one/);
  assert.match(out, /feature\/two/);
  // Deferred branches are never work.
  assert.doesNotMatch(out, /feature\/skipped/);

  // Nothing may exist yet: no worktrees, no refs, no working-tree changes.
  assert.equal(git(repo, 'worktree', 'list').trim().split('\n').length, 1);
  assert.equal(git(repo, 'ls-remote', '--heads', 'origin', 'feature/one').trim(), '');
  assert.equal(git(repo, 'status', '--porcelain').trim(), '');
});

test('dispatch: creates one worktree per eligible branch and claims each ref', () => {
  run(['--offline', '--no-start', 'fan']);

  const worktrees = git(repo, 'worktree', 'list');
  assert.match(worktrees, /plot-wt-one/);
  assert.match(worktrees, /plot-wt-two/);
  assert.doesNotMatch(worktrees, /plot-wt-skipped/);

  // The claim is the pushed ref — it must be on the remote, not just local.
  assert.match(git(repo, 'ls-remote', '--heads', 'origin', 'feature/one'), /feature\/one/);
  assert.match(git(repo, 'ls-remote', '--heads', 'origin', 'feature/two'), /feature\/two/);
});

test('dispatch: is idempotent — a second run re-adopts, never duplicates', () => {
  // A dispatcher that dies mid-fan-out must be safe to re-run. Claimed
  // branches stay claimed; existing worktrees are reused, not recreated.
  const before = git(repo, 'worktree', 'list').trim().split('\n').length;
  const out = run(['--offline', '--no-start', 'fan']);
  const after = git(repo, 'worktree', 'list').trim().split('\n').length;
  assert.equal(after, before, 'worktree count must not grow on re-dispatch');
  assert.match(out, /(already|existing|reus)/i);
});

test('dispatch: refuses to run outside a git repository', () => {
  const notRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-not-repo-'));
  let failed = false;
  try {
    run(['--dry-run', 'fan'], notRepo);
  } catch (e) {
    failed = true;
    assert.match(String(e.stderr ?? ''), /not a git repository/i);
  }
  assert.ok(failed, 'must exit non-zero outside a repo');
  fs.rmSync(notRepo, { recursive: true, force: true });
});
