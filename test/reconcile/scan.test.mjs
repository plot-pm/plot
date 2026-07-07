// End-to-end contract test for skills/plot/scripts/plot-reconcile-scan.sh.
// Builds a throwaway git repo (with a local bare "origin") containing one
// known finding per report section, runs the scan, and asserts each section
// reports exactly its planted finding. The repo uses a NON-default plan
// directory (plans/ at the repo root) so the Plot Config path is exercised,
// not just the defaults. The origin remote is a local path (no forge), so
// the PR-state banner must be DEGRADED — deterministic in CI.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scan = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-reconcile-scan.sh');

let tmp, repo, report;

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}
function write(rel, content) {
  const p = path.join(repo, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-'));
  const origin = path.join(tmp, 'origin.git');
  repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  write('CLAUDE.md', `# Fixture project

## Plot Config

- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/
- **Plan directory:** plans/
- **Active index:** plans/active/
- **Delivered index:** plans/delivered/
`);

  // Section 1: phase Delivered but symlink still in active/ (half-delivery).
  write('plans/2026-01-01-alpha.md', `# Alpha

## Status

- **Phase:** Delivered
- **Type:** feature
`);
  // Section 2: front-matter Approved plan whose impl branch gets merged below.
  write('plans/2026-01-02-beta.md', `---
status: Approved
type: feature
---

# Beta

## Branches

- \`feature/beta\` — impl → #1
`);
  // Sections 3+4: Approved plan whose branch is ahead of main (orphan, no PR).
  write('plans/2026-01-03-gamma.md', `# Gamma

## Status

- **Phase:** Approved
- **Type:** bug

## Branches

- \`bug/gamma\` — impl
`);
  // Section 5a: legacy plan without any phase field.
  write('plans/2026-01-04-legacy.md', `# Legacy pre-plot notes\n`);
  // Section 5b: plot-managed plan with no symlink in either index.
  write('plans/2026-01-05-omega.md', `# Omega

## Status

- **Phase:** Approved
- **Type:** docs
`);

  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'plans', 'delivered'), { recursive: true });
  fs.symlinkSync('../2026-01-01-alpha.md', path.join(repo, 'plans', 'active', 'alpha.md'));
  fs.symlinkSync('../2026-01-02-beta.md', path.join(repo, 'plans', 'active', 'beta.md'));
  fs.symlinkSync('../2026-01-03-gamma.md', path.join(repo, 'plans', 'active', 'gamma.md'));

  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'plans');

  // feature/beta: branched, one commit, merged back to main (branch kept on
  // origin → section 2 merged-but-not-delivered + section 3 deletion candidate).
  git(repo, 'checkout', '-q', '-b', 'feature/beta');
  write('beta-impl.txt', 'done\n');
  git(repo, 'add', 'beta-impl.txt');
  git(repo, 'commit', '-q', '-m', 'beta impl');
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'merge', '-q', '--no-ff', '--no-edit', 'feature/beta');

  // bug/gamma: branched with one unmerged commit → section 3 orphan +
  // section 4 "1 ahead / 0 behind".
  git(repo, 'checkout', '-q', '-b', 'bug/gamma');
  write('gamma-wip.txt', 'wip\n');
  git(repo, 'add', 'gamma-wip.txt');
  git(repo, 'commit', '-q', '-m', 'gamma wip');
  git(repo, 'checkout', '-q', 'main');

  git(repo, 'push', '-q', 'origin', 'main', 'feature/beta', 'bug/gamma');

  report = execFileSync('bash', [scan, '--no-fetch'], { encoding: 'utf8', cwd: repo });
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('scan: degraded banner without a forge CLI for the origin host', () => {
  assert.match(report, /PR state: DEGRADED/);
});

test('scan: section 1 flags the half-delivered plan with its fix command', () => {
  assert.match(report, /2026-01-01-alpha\.md — phase 'Delivered' but symlink still in plans\/active\//);
  assert.match(report, /fix: git rm plans\/active\/alpha\.md && ln -s \.\.\/2026-01-01-alpha\.md plans\/delivered\/alpha\.md && git add -A/);
});

test('scan: section 2 flags the merged-but-not-delivered front-matter plan', () => {
  assert.match(report, /2026-01-02-beta\.md — impl branch merged to main, plan still Approved \(PRs: 1\)/);
  assert.match(report, /consider: \/plot-deliver beta/);
});

test('scan: section 3 lists merged branch as deletion candidate, unmerged as orphan', () => {
  assert.match(report, /origin\/feature\/beta — merged into main, no open PR → deletion candidate/);
  assert.match(report, /origin\/bug\/gamma — ahead of main, no open PR → orphan/);
});

test('scan: section 4 shows divergence for the active plan branch', () => {
  assert.match(report, /bug\/gamma — 1 ahead \/ 0 behind origin\/main/);
});

test('scan: section 5 reports legacy and orphaned plans, with symlink fix', () => {
  assert.match(report, /2026-01-04-legacy\.md — no phase field \(pre-plot \/ legacy plan\)/);
  assert.match(report, /2026-01-05-omega\.md — phase 'Approved' but NO symlink/);
  assert.match(report, /fix: ln -s \.\.\/2026-01-05-omega\.md plans\/active\/omega\.md/);
});

test('scan: healthy plans produce no false findings', () => {
  // gamma is Approved with an unmerged branch and a correct symlink — it must
  // not appear in sections 1, 2, or 5.
  assert.doesNotMatch(report, /2026-01-03-gamma\.md/);
});

test('scan: read-only — the sweep leaves the repo untouched', () => {
  assert.equal(git(repo, 'status', '--porcelain'), '');
});

test('scan: summary footer carries machine-countable finding counts', () => {
  // The one line consumers (the /plot hygiene hook, Automation Output) parse.
  // drift: alpha. merged_not_delivered: beta. stale: feature/beta (merged) +
  // bug/gamma (orphan). attention: legacy + omega. concurrent: beta + gamma
  // branches of active plans.
  const last = report.trim().split('\n').at(-1);
  assert.equal(last,
    'summary: drift=1 merged_not_delivered=1 stale=2 attention=2 concurrent=2 pr_source=degraded main=main');
});

test('scan: refuses to run outside a git repository', () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-nogit-'));
  try {
    assert.throws(() => execFileSync('bash', [scan, '--no-fetch'],
      { encoding: 'utf8', cwd: bare, stdio: 'pipe' }));
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
  }
});
