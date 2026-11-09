// A declared `State branch` must survive every path that deletes a ref.
//
// The state branch is merged into the default branch by the sync and is often a
// squash-merged or contained ref, which is the exact shape each sweep deletes.
// Each test declares the key, makes the state branch look finished to the path
// under test, and asserts the ref is still there afterwards.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const reap = path.join(scripts, 'plot-reap.sh');
const releaseRefs = path.join(scripts, 'plot-release-refs.sh');
const reconcileScan = path.join(scripts, 'plot-reconcile-scan.sh');
const dispatch = path.join(scripts, 'plot-dispatch.sh');

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

const made = [];
after(() => { for (const t of made) fs.rmSync(t, { recursive: true, force: true }); });

const STATE = 'plot/state';

/** A repo with an origin, a plan naming the state branch, and the state branch on both sides. */
const makeRepo = (planBody) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-state-delete-'));
  made.push(tmp);
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(repo, 'docs', 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'),
    `# Repo\n\n## Plot Config\n\n- **Active index:** docs/plans/active/\n- **State branch:** ${STATE}\n`);
  fs.writeFileSync(path.join(repo, 'docs', 'plans', '2026-11-08-a-plan.md'), planBody);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  git(repo, 'push', '-q', 'origin', 'main');
  // The state branch carries a commit of its own that main took by squash.
  git(repo, 'checkout', '-q', '-b', STATE);
  fs.writeFileSync(path.join(repo, 'record.txt'), 'a record\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'a record');
  git(repo, 'push', '-q', 'origin', STATE);
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'fetch', '-q', 'origin');
  return { tmp, repo, origin };
};

/** A `gh` that reports a merged PR for every head and an empty open list. */
const stubGh = (tmp) => {
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const gh = path.join(bin, 'gh');
  fs.writeFileSync(gh, `#!/usr/bin/env node
const argv = process.argv.slice(2);
if (argv[0] !== 'pr' || argv[1] !== 'list') process.exit(1);
const si = argv.indexOf('--state');
const state = si === -1 ? 'open' : argv[si + 1];
const hi = argv.indexOf('--head');
const head = hi === -1 ? '${STATE}' : argv[hi + 1];
const row = { number: 7, state: 'closed', mergedAt: '2026-11-08T08:00:00Z', headRefName: head, open: false };
process.stdout.write(JSON.stringify(state === 'open' ? [] : [row]));
`);
  fs.chmodSync(gh, 0o755);
  return bin;
};

const envWith = (bin) => {
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  delete env.PLOT_REPO_ROOT;
  delete env.PLOT_UNATTENDED;
  return env;
};

const localHas = (repo, branch) => {
  try { git(repo, 'show-ref', '-q', '--verify', `refs/heads/${branch}`); return true; } catch { return false; }
};
const remoteHas = (repo, branch) => git(repo, 'ls-remote', '--heads', 'origin', branch).trim() !== '';

const PLAN_NAMING_STATE = `# A plan

## Status

- **Phase:** Delivered
- **Type:** feature
- **Delivered:** 2026-11-08

## Waves

### Records (Branch: ${STATE}, PR: #7)

A wave naming the state branch.

### Control (Branch: feature/control, PR: #7)

A merged slice branch, so the run proves it reads this plan at all.
`;

test('plot-release-refs keeps the state branch even when a delivered plan names it and its PR merged', () => {
  const { tmp, repo } = makeRepo(PLAN_NAMING_STATE);
  git(repo, 'branch', 'feature/control');
  git(repo, 'push', '-q', 'origin', 'feature/control');
  const out = execFileSync('bash', [releaseRefs, '--yes', 'a-plan'],
    { encoding: 'utf8', cwd: repo, env: envWith(stubGh(tmp)) });
  assert.ok(!remoteHas(repo, 'feature/control'), `the control branch should be released, so the plan was read:\n${out}`);
  assert.ok(remoteHas(repo, STATE), `the state branch lost its remote ref:\n${out}`);
});

test('plot-reap keeps a local state branch the host reports merged', () => {
  const { tmp, repo } = makeRepo('# A plan\n');
  const env = envWith(stubGh(tmp));
  execFileSync('bash', [reap, '--dry-run'], { encoding: 'utf8', cwd: repo, env });
  const out = execFileSync('bash', [reap, '--yes'], { encoding: 'utf8', cwd: repo, env });
  assert.ok(localHas(repo, STATE), `plot-reap deleted the local state branch:\n${out}`);
});

test('plot-reconcile-scan lists no deletion candidate for the state branch', () => {
  const { tmp, repo } = makeRepo('# A plan\n');
  git(repo, 'merge', '-q', '--no-edit', STATE);
  git(repo, 'push', '-q', 'origin', 'main');
  const out = execFileSync('bash', [reconcileScan], { encoding: 'utf8', cwd: repo, env: envWith(stubGh(tmp)) });
  assert.doesNotMatch(out, /git push origin --delete plot\/state/, `the scan proposes deleting the state branch:\n${out}`);
  assert.doesNotMatch(out, /git branch -D plot\/state/, `the scan proposes deleting the local state branch:\n${out}`);
});

test('plot-dispatch deletes only its own plot/start- booking branch', () => {
  // The dispatch script's local deletions are `git branch -D "$bookbr"`, and
  // bookbr is always `plot/start-<slug>`.
  const body = fs.readFileSync(dispatch, 'utf8');
  const sites = body.split('\n').filter((l) => /git branch -D/.test(l));
  assert.ok(sites.length > 0);
  for (const line of sites) assert.match(line, /"\$bookbr"/, `an unexpected branch deletion: ${line}`);
  assert.match(body, /bookbr="plot\/start-/);
});
