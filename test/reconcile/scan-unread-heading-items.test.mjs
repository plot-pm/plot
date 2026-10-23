// Section 24b of plot-reconcile-scan.sh: a heading-shape wave's list item that
// reads as a branch claim (branch_claim_re) but names a branch no heading in
// that wave carries. Read from the parser's own `unread_heading_items[]`
// field out of the one parse the sweep already makes — the reconcile side of
// bug/plot-plan-meta-a-branch-heading's repair.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const scan = path.join(repoRoot, 'skills', 'plot', 'scripts', 'plot-reconcile-scan.sh');

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

let tmp, report;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-unread-heading-items-'));
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  const w = (rel, content) => {
    const p = path.join(repo, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  };
  w('CLAUDE.md', `# Fixture project

## Plot Config

- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/
- **Plan directory:** plans/
- **Active index:** plans/active/
- **Delivered index:** plans/delivered/
`);
  // A heading-shape wave whose list item names a DIFFERENT branch — the
  // unread case — beside a wave whose list item names the SAME branch as its
  // heading, so the "attributed, and silent" half of the contract is in the
  // same fixture.
  w('plans/2026-10-03-unattributed-item.md', `# Unattributed item

## Status

- **State:** Draft
- **Type:** bug

## Slices

### Stray (Branch: bug/x)

- \`bug/other\` — a claim naming a different branch → #12
`);
  w('plans/2026-10-03-attributed-item.md', `# Attributed item

## Status

- **State:** Draft
- **Type:** bug

## Slices

### Matched (Branch: bug/y)

- \`bug/y\` — the item names its own heading's branch → #34
`);
  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'plans', 'delivered'), { recursive: true });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'plans');
  git(repo, 'push', '-q', 'origin', 'main');

  report = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: repo });
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('scan: section 24b names the wave and the unattributable branch', () => {
  assert.match(report,
    /2026-10-03-unattributed-item\.md — wave 'Stray' holds a list item naming 'bug\/other', a branch no heading in that wave claims/,
    report);
  assert.match(report, /rewrite: move the item under its own heading, or give this wave a \(Branch: bug\/other\) heading/, report);
});

test('scan: section 24b is silent for a list item the parser attributed', () => {
  assert.doesNotMatch(report, /2026-10-03-attributed-item\.md — wave/, report);
});

test('scan: section 24b sits below the blocking marker and gates nothing', () => {
  assert.ok(report.indexOf('== blocking sections end ==') < report.indexOf('== 24b. '), 'below the marker');
  const footer = report.trim().split('\n').at(-1);
  assert.match(footer, /\bunread_heading_items=1\b/, footer);
});
