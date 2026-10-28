// Section 24c of plot-reconcile-scan.sh: a list item in a Slices/Branches/
// Waves section that is NOT a branch claim (branch_claim_re) and yet names a
// branch-prefixed token no claim reads — a foreign-repository branch cited
// in prose instead of claimed. Read from the parser's own
// `unread_branch_items[]` field out of the one parse the sweep already
// makes. UNLIKE its siblings 24/24a/24b, this section sits ABOVE the
// blocking marker and gates delivery: those annotate a claim that still
// reads, so the slice is accounted for even while a detail is lost; here
// there is no claim at all, so the branch would otherwise never be verified
// (ewz-kus-portal #3853, #3819).
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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-unread-branch-items-'));
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
  // A plan naming a branch in prose (no claim reads it) beside a plan whose
  // only such mention carries a `<!-- deferred: ... -->` marker — the
  // "reported" and "excluded by the marker" halves of the contract together.
  w('plans/2026-10-03-unclaimed-branch.md', `# Unclaimed branch

## Status

- **State:** Approved
- **Type:** bug

## Slices

- \`bug/claimed-one\` — the real claim → #12
- Dependency work lands in \`bug/foreign-unclaimed\` first.
`);
  w('plans/2026-10-03-deferred-branch.md', `# Deferred branch

## Status

- **State:** Approved
- **Type:** bug

## Slices

- \`bug/claimed-two\` — the real claim → #34
- Dependency work lands in \`bug/foreign-deferred\` first. <!-- deferred: tracked separately -->
`);
  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'plans', 'delivered'), { recursive: true });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'plans');
  git(repo, 'push', '-q', 'origin', 'main');

  report = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: repo });
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('scan: section 24c names the plan and the branch no claim reads', () => {
  assert.match(
    report,
    /2026-10-03-unclaimed-branch\.md — branch 'bug\/foreign-unclaimed' is named by a list item no claim reads/,
    report,
  );
});

test('scan: section 24c prints a rewrite suggestion and the blocking sentence', () => {
  assert.match(
    report,
    /rewrite: either a claim line \(- `bug\/foreign-unclaimed` — <repo>: \.\.\. -> owner\/repo#N\) or <!-- deferred: <reason> -->/,
    report,
  );
  assert.match(report, /delivery refuses until this line changes/, report);
});

test('scan: section 24c is silent for an item carrying a deferred marker', () => {
  assert.doesNotMatch(report, /bug\/foreign-deferred/, report);
});

test('scan: section 24c sits ABOVE the blocking marker and gates delivery', () => {
  assert.ok(
    report.indexOf('== 24c. ') < report.indexOf('== blocking sections end =='),
    'above the marker',
  );
  const footer = report.trim().split('\n').at(-1);
  assert.match(footer, /\bunread_branch_items=1\b/, footer);
});
