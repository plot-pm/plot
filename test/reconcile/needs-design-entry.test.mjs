// Contract test for the needs-design entry (`board/plot-needs-design.mjs`): the
// two write targets a sandbox can reach without a booking ladder — the open
// plan PR's head branch and the caller's checkout under `Impl: same branch` —
// and the channel the `Design:` record carries.
//
// The host is a `gh` stub on PATH; the origin is a real bare repository, so a
// push lands or is rejected by a real `pre-receive` hook. The state receipt is
// read back through `plot-state-receipt.sh`, the file the gate sources.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const BUNDLE = path.join(SCRIPTS, 'board', 'plot-needs-design.mjs');
const SLUG = 'needs-me';
const PLAN_REL = `docs/plans/2026-10-12-${SLUG}.md`;
const HEAD = `idea/${SLUG}`;

const made = [];
const track = (dir) => {
  made.push(dir);
  return dir;
};
after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

let stubDir;

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

const PLAN = ({ impl = 'own branches' } = {}) => `# Needs me

## Status

- **State:** Draft
- **Type:** feature
- **Review:** pr
- **Impl:** ${impl}
- **Approved:**
- **Started:**

## Branches

### Wave one
- \`feature/alpha\` — the first
`;

before(() => {
  stubDir = track(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-needs-design-entry-stub-')));
  fs.writeFileSync(path.join(stubDir, 'gh'), `#!/usr/bin/env bash
if [ "$1" = pr ] && [ "$2" = view ]; then
  printf '%s' '{"number":42,"state":"OPEN","isDraft":true,"url":"https://example.invalid/pr/42","mergeCommit":null}'
elif [ "$1" = repo ] && [ "$2" = view ]; then
  printf 'main'
else
  printf '{}'
fi
`);
  fs.chmodSync(path.join(stubDir, 'gh'), 0o755);
});

/** A sandbox clone of a bare origin with the plan on main and `origin/HEAD` set. */
const makeRepo = (planBody) => {
  const tmp = track(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-needs-design-entry-')));
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** docs/plans/\n- **Active index:** docs/plans/active/\n');
  fs.mkdirSync(path.join(repo, 'docs', 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(repo, PLAN_REL), planBody);
  fs.symlinkSync(`../${path.basename(PLAN_REL)}`, path.join(repo, 'docs', 'plans', 'active', `${SLUG}.md`));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plan');
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'remote', 'set-head', 'origin', 'main');
  return { repo, origin };
};

/** Pushes `idea/<slug>` to origin, one commit ahead of main, and keeps no local branch. */
const pushPlanPrBranch = (repo) => {
  git(repo, 'checkout', '-qb', HEAD);
  fs.writeFileSync(path.join(repo, 'NOTES.md'), 'the plan PR\n');
  git(repo, 'add', 'NOTES.md');
  git(repo, 'commit', '-qm', 'plan PR');
  git(repo, 'push', '-q', 'origin', HEAD);
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'branch', '-qD', HEAD);
};

const childEnv = () => {
  const env = {
    ...process.env,
    PATH: `${stubDir}:${process.env.PATH}`,
    PLOT_HOST: 'github',
    PLOT_BUDGET_HOME: stubDir,
    PLOT_PR_INDEX_HOME: stubDir,
  };
  delete env.PLOT_UNATTENDED;
  delete env.PLOT_REPO_ROOT;
  return env;
};

const needsDesign = (repo, args) =>
  spawnSync(process.execPath, [BUNDLE, ...args], { cwd: repo, encoding: 'utf8', env: childEnv() });

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

/** Whether `receipt_clears` accepts a receipt for the plan and value; spends it when it does. */
const receiptClears = (repo, value) =>
  spawnSync('bash', ['-c', `. "${path.join(SCRIPTS, 'plot-state-receipt.sh')}" && receipt_clears ${PLAN_REL} ${value}`], {
    cwd: repo,
    encoding: 'utf8',
  }).status;

const worktrees = (repo) => git(repo, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree '));

test('needs-design entry: --channel takes board or cli and refuses anything else', () => {
  const { repo } = makeRepo(PLAN());
  const r = needsDesign(repo, ['--channel', 'slack', SLUG]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--channel takes 'board' or 'cli', not 'slack'/);
});

test('needs-design entry: the plan-PR arm commits onto the PR head, records the board channel, and leaves the receipt', () => {
  const { repo } = makeRepo(PLAN());
  pushPlanPrBranch(repo);
  const mainBefore = git(repo, 'rev-parse', 'origin/main').trim();

  const r = needsDesign(repo, ['--channel', 'board', SLUG]);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /summary: target=plan-pr phase=flipped record=written push=clean/);

  git(repo, 'fetch', '-q', 'origin');
  const onHead = git(repo, 'show', `origin/${HEAD}:${PLAN_REL}`);
  assert.match(onHead, /^- \*\*State:\*\* Design$/m);
  assert.match(onHead, new RegExp(`^- \\*\\*Design:\\*\\* ${today()}, Plot Test, board$`, 'm'));
  assert.match(onHead, /^## Spec$/m);
  assert.equal(git(repo, 'log', '-1', '--format=%s', `origin/${HEAD}`).trim(), `plot: move ${SLUG} to design`);
  assert.equal(git(repo, 'rev-parse', 'origin/main').trim(), mainBefore, 'the default branch is untouched');
  assert.match(git(repo, 'show', `origin/main:${PLAN_REL}`), /^- \*\*State:\*\* Draft$/m);

  assert.equal(receiptClears(repo, 'Design'), 0, 'the receipt sits in the caller checkout, keyed by the plan path');
  assert.equal(git(repo, 'branch', '--list', HEAD).trim(), '', 'no local branch of the head is left behind');
  assert.equal(worktrees(repo).length, 1, 'the scratch worktree is removed');
});

test('needs-design entry: a rejected push on the plan-PR arm leaves the head and the checkout as they were', () => {
  const { repo, origin } = makeRepo(PLAN());
  pushPlanPrBranch(repo);
  const headBefore = git(repo, 'rev-parse', `origin/${HEAD}`).trim();
  fs.writeFileSync(path.join(origin, 'hooks', 'pre-receive'), '#!/bin/sh\necho "rejected by the test" >&2\nexit 1\n');
  fs.chmodSync(path.join(origin, 'hooks', 'pre-receive'), 0o755);

  const r = needsDesign(repo, ['--channel', 'board', SLUG]);
  assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /push was rejected/);
  assert.equal(git(origin, 'rev-parse', HEAD).trim(), headBefore, 'the head branch on origin did not move');
  assert.equal(git(repo, 'branch', '--list', HEAD).trim(), '', 'no stray local branch of the head');
  assert.equal(worktrees(repo).length, 1, 'the scratch worktree is removed');
});

test('needs-design entry: the caller-checkout arm commits on the current branch, records cli by default, and pushes nothing', () => {
  const { repo } = makeRepo(PLAN({ impl: 'same branch' }));
  git(repo, 'checkout', '-qb', 'feature/alpha');

  const r = needsDesign(repo, [SLUG]);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /summary: target=caller-checkout phase=flipped record=written push=local/);

  assert.equal(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'feature/alpha');
  assert.equal(git(repo, 'log', '-1', '--format=%s').trim(), `plot: move ${SLUG} to design`);
  assert.deepEqual(git(repo, 'show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean), [PLAN_REL]);
  const committed = git(repo, 'show', `HEAD:${PLAN_REL}`);
  assert.match(committed, /^- \*\*State:\*\* Design$/m);
  assert.match(committed, new RegExp(`^- \\*\\*Design:\\*\\* ${today()}, Plot Test, cli$`, 'm'));
  assert.equal(git(repo, 'ls-remote', 'origin', 'feature/alpha').trim(), '', 'nothing is pushed');
  assert.match(git(repo, 'show', `origin/main:${PLAN_REL}`), /^- \*\*State:\*\* Draft$/m);

  assert.equal(receiptClears(repo, 'Design'), 0, 'the receipt names the plan path and Design');
});
