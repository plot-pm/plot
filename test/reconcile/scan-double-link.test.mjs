// Contract test for `plot-reconcile-scan.sh` §1's double-link case (#2284).
//
// A plan symlinked in BOTH `plans/active/` and `plans/delivered/` matched no
// existing arm — each requires exactly one link present — so the scan printed
// nothing for it. Two Released plans sat in both directories on
// ewz-kus-portal and the scan stayed silent. Its own fixture, not the shared
// one in scan.test.mjs: that fixture's counts feed other assertions, and a
// new plan here would shift them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const made = [];
const scratch = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
};
after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

const here = path.dirname(fileURLToPath(import.meta.url));
const scan = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-reconcile-scan.sh');

let tmp, repo, report;

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });
const write = (rel, content) => {
  const p = path.join(repo, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};
// Split the report by its `== N. … ==` headings, as scan.test.mjs does.
const splitSections = (text) => {
  const out = {};
  let cur = null;
  for (const line of text.split('\n')) {
    const m = /^== (\d+)\. /.exec(line);
    if (m) { cur = m[1]; out[cur] = ''; continue; }
    if (cur) out[cur] += line + '\n';
  }
  return out;
};

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-dlink-'));
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

  // Released, linked in both directories — the active/ link is stale.
  write('plans/2026-01-01-released-both.md', `# Released Both

## Status

- **Phase:** Released
- **Type:** feature
`);
  // Draft, linked in both directories — the delivered/ link is stale.
  write('plans/2026-01-02-draft-both.md', `# Draft Both

## Status

- **Phase:** Draft
- **Type:** feature
`);
  // A phase outside both lists (design): double-linked, reported with no fix.
  write('plans/2026-01-03-design-both.md', `# Design Both

## Status

- **Phase:** Design
- **Type:** feature
`);
  // A one-link plan, unaffected by the new case — must still drift as before.
  write('plans/2026-01-04-alpha.md', `# Alpha

## Status

- **Phase:** Delivered
- **Type:** feature
`);

  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'plans', 'delivered'), { recursive: true });
  fs.symlinkSync('../2026-01-01-released-both.md', path.join(repo, 'plans', 'active', 'released-both.md'));
  fs.symlinkSync('../2026-01-01-released-both.md', path.join(repo, 'plans', 'delivered', 'released-both.md'));
  fs.symlinkSync('../2026-01-02-draft-both.md', path.join(repo, 'plans', 'active', 'draft-both.md'));
  fs.symlinkSync('../2026-01-02-draft-both.md', path.join(repo, 'plans', 'delivered', 'draft-both.md'));
  fs.symlinkSync('../2026-01-03-design-both.md', path.join(repo, 'plans', 'active', 'design-both.md'));
  fs.symlinkSync('../2026-01-03-design-both.md', path.join(repo, 'plans', 'delivered', 'design-both.md'));
  fs.symlinkSync('../2026-01-04-alpha.md', path.join(repo, 'plans', 'active', 'alpha.md'));

  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'plans');

  const t = scratch('plot-scan-dlink-tmpdir-');
  report = execFileSync('bash', [scan, '--no-fetch'], {
    encoding: 'utf8', cwd: repo,
    env: { ...process.env, TMPDIR: t, PLOT_BUDGET_HOME: path.join(t, 'budget') },
  });
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('a Released plan double-linked names the active/ link as the fix target', () => {
  const sections = splitSections(report);
  assert.match(sections['1'], /2026-01-01-released-both\.md — phase 'Released' but linked in both plans\/active\/ and plans\/delivered\//);
  assert.match(sections['1'], /fix: git rm plans\/active\/released-both\.md && git add -A/);
  assert.doesNotMatch(sections['1'], /fix: git rm plans\/delivered\/released-both\.md/);
});

test('a Draft plan double-linked names the delivered/ link as the fix target', () => {
  const sections = splitSections(report);
  assert.match(sections['1'], /2026-01-02-draft-both\.md — phase 'Draft' but linked in both plans\/active\/ and plans\/delivered\//);
  assert.match(sections['1'], /fix: git rm plans\/delivered\/draft-both\.md && git add -A/);
  assert.doesNotMatch(sections['1'], /fix: git rm plans\/active\/draft-both\.md/);
});

test('a design-phase plan double-linked is reported with no fix command', () => {
  const sections = splitSections(report);
  assert.match(sections['1'], /2026-01-03-design-both\.md — phase 'Design' but linked in both plans\/active\/ and plans\/delivered\//);
  const planLine = sections['1'].split('\n').findIndex((l) => l.includes('2026-01-03-design-both.md'));
  assert.ok(!sections['1'].split('\n')[planLine + 1]?.includes('fix:'),
    'a phase outside both lists prints no fix line — picking one would guess');
});

test('the double-link case appears once per plan, not twice', () => {
  const sections = splitSections(report);
  const hits = (name) => sections['1'].split('\n').filter((l) => l.includes(name)).length;
  assert.equal(hits('2026-01-01-released-both.md'), 1);
  assert.equal(hits('2026-01-02-draft-both.md'), 1);
  assert.equal(hits('2026-01-03-design-both.md'), 1);
});

test('the summary counts each double-linked plan in drift=', () => {
  const m = /\bdrift=(\d+)\b/.exec(report);
  assert.ok(m, 'summary line must report drift=');
  // released-both, draft-both, design-both (no fix, still counted as drift per
  // the brief), and alpha's existing one-link drift: 4 total.
  assert.equal(Number(m[1]), 4);
});

test('a one-link plan drifts exactly as before the double-link case was added', () => {
  const sections = splitSections(report);
  assert.match(sections['1'], /2026-01-04-alpha\.md — phase 'Delivered' but symlink still in plans\/active\/ \(half-delivery failure mode\)/);
  assert.match(sections['1'], /fix: git rm plans\/active\/alpha\.md && ln -s \.\.\/2026-01-04-alpha\.md plans\/delivered\/alpha\.md && git add -A/);
});

test('read-only — the sweep leaves the repo untouched', () => {
  assert.equal(git(repo, 'status', '--porcelain'), '');
});
