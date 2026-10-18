// Contract test for issue #1340: section 2 ("merged-but-not-delivered") must
// read a plan's PHASE from `origin/<main>`, not the working tree.
//
// `plot-deliver.sh` pushes a plan's `Delivered:` record through
// `plot-push-main.sh` and never fast-forwards the local checkout. The first
// scan run after a delivery therefore globs the PRE-delivery copy of the plan
// file — Approved — while `origin/main` already carries Delivered. Before the
// fix, that stale read produced a false `merged_not_delivered` finding for a
// plan that had, in fact, just been delivered. Observed twice on 2026-10-06
// (Bitbucket, default branch `develop`).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scan = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-reconcile-scan.sh');

const made = [];
const scratch = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
};
after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

const CONFIG = `# Fixture project

## Plot Config

- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/
- **Plan directory:** plans/
- **Active index:** plans/active/
- **Delivered index:** plans/delivered/
`;

const write = (repo, rel, content) => {
  const p = path.join(repo, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};

const planBody = (phase) => `# Beta

## Status

- **Phase:** ${phase}
- **Type:** feature

## Branches

- \`feature/beta\` — impl → #1
`;

// A FRESH REPO PER TEST. Each test pushes its own commits, and a push leaves
// `origin` permanently mutated — sharing one fixture across tests would make
// test 2's reading of `origin/main` depend on whether test 1 already ran.
const makeRepo = () => {
  const t = scratch('plot-stale-scan-');
  const origin = path.join(t, 'origin.git');
  const repo = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', origin);
  git(t, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  write(repo, 'CLAUDE.md', CONFIG);
  write(repo, 'plans/2026-01-02-beta.md', planBody('Approved'));
  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  fs.symlinkSync('../2026-01-02-beta.md', path.join(repo, 'plans', 'active', 'beta.md'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'plans');

  git(repo, 'checkout', '-q', '-b', 'feature/beta');
  write(repo, 'beta-impl.txt', 'done\n');
  git(repo, 'add', 'beta-impl.txt');
  git(repo, 'commit', '-q', '-m', 'beta impl');
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'merge', '-q', '--no-ff', '--no-edit', 'feature/beta');

  git(repo, 'push', '-q', 'origin', 'main', 'feature/beta');
  return repo;
};

const runScan = (repo, env = {}) => {
  const t = scratch('plot-stale-scan-run-');
  return execFileSync('bash', [scan, '--no-fetch'], {
    encoding: 'utf8', cwd: repo,
    env: { ...process.env, TMPDIR: t, PLOT_BUDGET_HOME: path.join(t, 'budget'), ...env },
  });
};

// THE FIXTURE THAT REPRODUCES #1340. Deliver on a checkout sitting on main
// (push the Delivered record), then — without fast-forwarding — reset the
// local branch back to the Approved commit, exactly as `plot-deliver.sh`
// leaves it. A scan run with no fetch and no pull must read Delivered from
// `origin/main`, not Approved from the working tree.
test('scan: a plan delivered on origin but stale locally is not flagged merged_not_delivered', () => {
  const repo = makeRepo();
  const approvedSha = git(repo, 'rev-parse', 'HEAD').trim();

  write(repo, 'plans/2026-01-02-beta.md', planBody('Delivered'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'deliver beta');
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'reset', '-q', '--hard', approvedSha); // the un-fast-forwarded local checkout

  const out = runScan(repo);
  assert.doesNotMatch(out, /2026-01-02-beta\.md — impl branch merged to main, plan still Approved/,
    'origin already carries Delivered — the stale local Approved copy must not produce a finding');
  assert.match(out, /\bmerged_not_delivered=0\b/);
});

// THE NON-REGRESSION. A plan still on a feature branch — never pushed to
// `origin/main` at all — has no ref for `origin/main` to answer with. The
// finding must still fire exactly as it did before the ref read existed.
test('scan: an Approved plan whose delivery never reached origin is still flagged', () => {
  const repo = makeRepo();
  const out = runScan(repo);
  assert.match(out, /2026-01-02-beta\.md — impl branch merged to main, plan still Approved \(PRs: 1\)/);
  assert.match(out, /consider: \/plot-deliver beta/);
  assert.match(out, /\bmerged_not_delivered=1\b/);
});
