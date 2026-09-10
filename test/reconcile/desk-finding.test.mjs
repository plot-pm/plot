// Contract test for the desk half of the sweep: which worktrees the scan
// reports, and which it stays silent about.
//
// The regression this locks: `plot-reap.sh:384` recognised a dispatch tree by
// its `.plot-worker.pid` file or its legacy `plot-wt-` path, and a tree
// matching NEITHER hit `continue` — not reaped, not kept, not counted, not
// named. Measured 2026-09-09, that silence hid ten finished desks while the
// reaper reported three.
//
// The three populations, and they are three rather than two:
//
//   a desk                → reap() judges it, unchanged
//   might be a desk       → reported as unclassified, with NO command
//   not a desk            → silence
//
// The middle one is what this slice added. The third is what it must not
// break: a person's checkout turned into a removal instruction is a worse
// failure than the silence being fixed, so the fixtures below include trees
// that MUST produce nothing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const scan = path.join(scripts, 'plot-reconcile-scan.sh');
const reap = path.join(scripts, 'plot-reap.sh');

let tmp, repo, report, reapReport;

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-desk-'));
  const origin = path.join(tmp, 'origin.git');
  repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  // `Worktree root` is what separates a candidate desk from a checkout: a
  // repo that declares none has no `.worktrees/` and every tree stays silent.
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n'
    + '- **Delivered index:** plans/delivered/\n- **Worktree root:** .worktrees\n');
  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'plans', 'delivered'), { recursive: true });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'config');
  git(repo, 'push', '-q', 'origin', 'main');

  // THE CASE THIS SLICE EXISTS FOR: under the worktree root, no pid file, and
  // a name no legacy test matches. Recognised by nothing, so silent before.
  git(repo, 'worktree', 'add', '-q', '-b', 'feature/stranded',
    path.join(repo, '.worktrees', 'feature-stranded'));
  git(path.join(repo, '.worktrees', 'feature-stranded'),
    'commit', '-q', '--allow-empty', '-m', 'stranded work nobody can see');

  // A RECOGNISED DESK: same location, carrying the marker the dispatcher
  // writes at creation. reap() judges this one, so it is never unclassified.
  const desk = path.join(repo, '.worktrees', 'feature-recognised');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature/recognised', desk);
  // A pid no process holds: the reading is "a pid file exists", and whether
  // anything runs is the rule's question, not the recognition test's.
  fs.writeFileSync(path.join(desk, '.plot-worker.pid'), '999999\n');
  // A commit, so the branch is genuinely unlanded. A desk cut at main and left
  // there is an ANCESTOR of main, which the reaper correctly calls merged —
  // and a fixture that reaps would test the opposite of what it claims.
  git(desk, 'commit', '-q', '--allow-empty', '-m', 'work in progress');

  // A HAND-MADE CHECKOUT, outside the root. Must produce nothing at all.
  git(repo, 'worktree', 'add', '-q', '-b', 'scratch/mine',
    path.join(tmp, 'my-own-checkout'));

  report = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: repo });
  reapReport = execFileSync('bash', [reap, '--dry-run'], { encoding: 'utf8', cwd: repo });
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('desk: a tree no recognition test placed is REPORTED, never skipped', () => {
  // The regression. A change that measures `isDispatchTree` but leaves the
  // `continue` in place looks correct and reports nothing — this is what
  // catches it.
  assert.match(report, /feature-stranded/,
    `the unclassified desk must appear in the sweep:\n${report}`);
});

test('desk: an unclassified tree is not reapable and gets no removal command', () => {
  // Reporting by WIDENING recognition is the shortcut this refuses: it would
  // trade a safe refusal for a wider blast radius.
  const idx = report.indexOf('feature-stranded');
  const following = report.slice(idx, idx + 400).split('\n').slice(0, 3).join('\n');
  assert.doesNotMatch(following, /git worktree remove/,
    `an unclassified tree must never be handed a removal:\n${following}`);
});

test('desk: a hand-made worktree outside the root is silent', () => {
  // The failure mode worse than today's silence: a person's checkout becoming
  // an instruction to delete it.
  const section = report.slice(report.indexOf('== 19.'));
  assert.doesNotMatch(section, /my-own-checkout|scratch\/mine/,
    `a checkout outside the worktree root must produce no finding:\n${section}`);
});

test('desk: the reaper still recognises a desk carrying the pid marker', () => {
  // The recognition test is unchanged in strictness — a tree with the marker
  // is judged by reap() and reported through its verdict, never as unplaced.
  assert.match(reapReport, /feature\/recognised/);
  assert.match(reapReport, /unplaced=1/,
    `exactly the stranded tree is unplaced:\n${reapReport}`);
});

test('desk: the reaper reaps nothing here, and says so', () => {
  // No fixture has a merged PR, so no tree may be removed. A change that
  // silently re-populates the reaper shows up as a non-zero count.
  assert.match(reapReport, /reapable=0/);
  assert.match(reapReport, /removed=0/);
});

test('desk: the count joins the summary footer', () => {
  const footer = report.trim().split('\n').at(-1);
  assert.match(footer, /^summary: /);
  assert.match(footer, /desks=\d+/, `the footer must be machine-countable:\n${footer}`);
});

test('desk: the sweep changes nothing', () => {
  // `.worktrees/` itself is untracked in this fixture — the desks live inside
  // the checkout. What matters is that the sweep added nothing to it.
  const dirty = git(repo, 'status', '--porcelain').trim().split('\n')
    .filter((l) => l !== '' && !/\.worktrees\/$/.test(l));
  assert.deepEqual(dirty, []);
  assert.ok(fs.existsSync(path.join(repo, '.worktrees', 'feature-stranded')),
    'the sweep reports desks and removes none');
});
