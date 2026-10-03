// Section 24a of plot-reconcile-scan.sh: a `<!-- waits: … -->` marker on a
// branch line whose value the parser could not read as a branch
// (`the-parser-reads-every-wait`, #1153). A wait the parser cannot read is
// reported, never dropped — this is the reconcile side of that contract, read
// from the parser's own `unread_waits[]` field out of the one parse the sweep
// already makes.
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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-unread-waits-'));
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
  // A branch line whose waits: value is not a branch name — the unread case —
  // beside a branch whose waits: value is readable, and a plan with no waits:
  // annotation at all, so the "none" estate stays silent.
  w('plans/2026-10-03-unreadable-wait.md', `# Unreadable wait

## Status

- **State:** Draft
- **Type:** bug

## Branches

- \`feature/mixed\` <!-- waits: bug/real --> <!-- waits: <branch> --> — one good, one not.
`);
  w('plans/2026-10-03-clean.md', `# Clean plan

## Status

- **State:** Draft
- **Type:** bug

## Branches

- \`feature/tidy\` — no annotation at all.
`);
  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'plans', 'delivered'), { recursive: true });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'plans');
  git(repo, 'push', '-q', 'origin', 'main');

  report = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: repo });
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('scan: section 24a names the branch and the unreadable value', () => {
  assert.match(report,
    /2026-10-03-unreadable-wait\.md — branch 'feature\/mixed' names a waits: value the parser could not read: '<branch>'/,
    report);
  assert.match(report, /rewrite: the value as a branch name/, report);
});

test('scan: section 24a is silent for a plan with no unreadable wait', () => {
  assert.doesNotMatch(report, /2026-10-03-clean\.md — branch/, report);
});

test('scan: section 24a sits below the blocking marker and gates nothing', () => {
  assert.ok(report.indexOf('== blocking sections end ==') < report.indexOf('== 24a. '), 'below the marker');
  const footer = report.trim().split('\n').at(-1);
  assert.match(footer, /\bunread_waits=1\b/, footer);
});
