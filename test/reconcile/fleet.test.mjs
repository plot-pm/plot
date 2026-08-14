// Contract test for skills/plot/scripts/plot-fleet-scan.sh — the derived fleet
// view. Builds a throwaway git repo (with a local bare "origin") holding one
// wave-structured plan, plants a claimed branch and a merged branch, then
// asserts the scan reports wave eligibility from git state alone.
//
// The scan is READ-ONLY and STATELESS: every fact it prints is re-derived from
// refs on each run. There is no fleet database — that is the design (Manifesto
// Principle 1), and these tests are what hold it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scan = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-fleet-scan.sh');

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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fleet-'));
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

  // Wave 1 (Tracer) has one branch, merged below → wave 2 becomes eligible.
  // Wave 2 has three branches: one claimed (pushed, empty), one deferred
  // (never eligible), one unclaimed. Wave 3 stays blocked behind wave 2.
  // A pre-wave plan: no ### subheadings, so one unnamed wave. Its branch line
  // must still render as a branch — an empty wave name must not shift fields.
  // It also cites a docs/ FILE PATH and an idea/ branch: neither is
  // implementation work, and neither may enter the wave arithmetic.
  write('plans/2026-01-02-legacy.md', `# Legacy plan without waves

## Status

- **Phase:** Approved
- **Type:** feature

## Branches

- \`feature/no-waves\` — the only implementation branch
- see \`docs/some-note.md\` for background
- planning lived on \`idea/legacy\`
`);
  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  fs.symlinkSync('../2026-01-02-legacy.md', path.join(repo, 'plans', 'active', 'legacy.md'));

  write('plans/2026-01-01-fleet.md', `# Fleet plan

## Status

- **Phase:** Approved
- **Type:** feature
- **Review:** pr
- **Impl:** own branches

## Branches

### Tracer
- \`feature/tracer\` — thin slice

### Implementation
- \`feature/claimed-one\` — taken <!-- claimed: 2026-01-02T09:00Z, session-1 -->
- \`feature/unclaimed\` — free
- \`feature/dropped\` — not needed <!-- deferred: folded into tracer -->

### Wave 3
- \`feature/later\` — blocked behind wave 2
`);
  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  fs.symlinkSync('../2026-01-01-fleet.md', path.join(repo, 'plans', 'active', 'fleet.md'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plan');
  git(repo, 'push', '-q', 'origin', 'main');

  // Wave 1's branch: real work, merged to main → wave 1 complete.
  git(repo, 'checkout', '-qb', 'feature/tracer');
  write('src/tracer.txt', 'thin slice\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'tracer work');
  git(repo, 'push', '-q', '-u', 'origin', 'feature/tracer');
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge tracer', 'feature/tracer');
  git(repo, 'push', '-q', 'origin', 'main');

  // A claim: branch pushed with NO commits of its own. This is what claiming
  // looks like on the wire — the ref exists, the work does not yet.
  git(repo, 'checkout', '-qb', 'feature/claimed-one');
  git(repo, 'push', '-q', '-u', 'origin', 'feature/claimed-one');
  git(repo, 'checkout', '-q', 'main');

  report = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: repo });
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('fleet: reports the plan with its wave structure', () => {
  assert.match(report, /2026-01-01-fleet\.md/);
  assert.match(report, /Tracer/);
  assert.match(report, /Implementation/);
});

test('fleet: a wave whose branches are all merged reports as complete', () => {
  assert.match(report, /Tracer.*complete/is);
});

test('fleet: the wave after a complete wave is eligible', () => {
  assert.match(report, /Implementation.*eligible/is);
});

test('fleet: a wave behind an incomplete wave is blocked', () => {
  assert.match(report, /Wave 3.*blocked/is);
});

test('fleet: a claimed branch with no commits is reported as claimed', () => {
  assert.match(report, /feature\/claimed-one.*claimed/is);
});

test('fleet: a deferred branch never counts as outstanding work', () => {
  assert.match(report, /feature\/dropped.*deferred/is);
});

test('fleet: emits a machine-countable summary footer', () => {
  // Same contract shape as plot-reconcile-scan.sh: callers read the footer,
  // never re-count the body.
  const footer = report.trim().split('\n').at(-1);
  assert.match(footer, /^summary: /);
  assert.match(footer, /plans=2/);
  // 3 waves in the fleet plan + 1 unnamed wave in the legacy plan.
  assert.match(footer, /waves=4/);
  assert.match(footer, /claimed=1/);
  // eligible counts branches a worker could pick up RIGHT NOW: in an eligible
  // wave, not already claimed, not deferred, not merged. Here that is
  // feature/unclaimed alone — claimed-one is taken, dropped is deferred.
  // feature/unclaimed (fleet plan) + feature/no-waves (legacy plan).
  assert.match(footer, /eligible=2/);
  assert.match(footer, /blocked=1/);
  assert.match(footer, /deferred=1/);
});

test('fleet: branches without a claim note keep their state (IFS collapse)', () => {
  // Regression: tab is an IFS whitespace character, so bash collapses runs of
  // tabs into one separator. With the claim note in a middle column, every
  // unclaimed branch shifted its later fields left and lost its git state —
  // merged branches silently read as "open", which would make a completed wave
  // look outstanding forever. Unclaimed branches must still report truthfully.
  assert.match(report, /feature\/tracer — merged/);
  assert.match(report, /feature\/unclaimed — open/);
  assert.match(report, /feature\/dropped — deferred/);
});

test('fleet: an unnamed wave renders its branch as a branch, not as a wave name', () => {
  // Regression: with no ### subheading the wave name is empty, and the IFS
  // tab-collapse shifted the branch into the wave-name column — the report
  // printed "feature/no-waves — eligible" as a heading with an empty branch
  // under it.
  assert.match(report, /\(unnamed\) — eligible/);
  assert.match(report, /feature\/no-waves — open/);
  assert.doesNotMatch(report, /^ *feature\/no-waves — eligible/m);
});

test('fleet: a docs/ file path in a plan is not treated as a branch', () => {
  // `docs/` is a branch prefix, so the parser scrapes any backticked token
  // that looks like one. A cited file path is not implementation work and must
  // not enter the wave arithmetic.
  assert.doesNotMatch(report, /docs\/some-note\.md/);
});

test('fleet: an idea/ branch is not implementation work', () => {
  // idea/ branches carry the plan itself, never implementation. Counting one
  // as outstanding work would keep a finished wave blocked forever.
  assert.doesNotMatch(report, /idea\/legacy/);
});

test('fleet: scan is read-only — working tree and refs unchanged', () => {
  const status = git(repo, 'status', '--porcelain');
  assert.equal(status.trim(), '', 'scan must not modify the working tree');
});
