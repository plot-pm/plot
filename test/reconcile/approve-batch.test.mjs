// Contract test for approving a plan whose PR is not on `idea/<slug>`: the
// batch PR `/plot-idea` opens on `idea/batch-<first-slug>`, and a plan that
// exists only on that PR's head (#1610).
//
// The host stub keeps its PRs in a state file and performs a real merge into
// the sandbox's bare origin, with the merge subject GitHub writes, so a second
// approval reads the merged batch from git exactly as it would after a real
// merge.
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const BATCH = 'idea/batch-first-plan';
const FIRST = 'docs/plans/2026-10-12-first-plan.md';
const SECOND = 'docs/plans/2026-10-12-second-plan.md';
const OLD = 'docs/plans/2026-09-01-old-plan.md';

const made = [];
const track = (dir) => {
  made.push(dir);
  return dir;
};
after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

let stubDir;
let statePath;
let callsPath;

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

const PLAN = (title, { review = 'pr' } = {}) => `# ${title}

## Status

- **State:** Draft
- **Type:** feature
- **Review:** ${review}
- **Impl:** own branches
- **Approved:**

## Branches

### Wave one
- \`feature/${title.toLowerCase().replace(/ /g, '-')}\` — the work
`;

before(() => {
  stubDir = track(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-approve-batch-stub-')));
  statePath = path.join(stubDir, 'state.json');
  callsPath = path.join(stubDir, 'calls.log');
  fs.writeFileSync(path.join(stubDir, 'gh'), `#!/usr/bin/env bash
printf '%s\\n' "gh $*" >> "${callsPath}"
exec node "${stubDir}/gh.mjs" "$@"
`);
  fs.chmodSync(path.join(stubDir, 'gh'), 0o755);
  fs.writeFileSync(path.join(stubDir, 'gh.mjs'), `
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const argv = process.argv.slice(2);
const file = ${JSON.stringify(statePath)};
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const save = () => fs.writeFileSync(file, JSON.stringify(state));
const find = (ref) => state.prs.find((p) => String(p.number) === ref || p.head === ref);
const flag = (name) => { const i = argv.indexOf(name); return i === -1 ? '' : argv[i + 1]; };
if (argv[0] === 'pr' && argv[1] === 'view') {
  const pr = find(argv[2]);
  if (!pr) { process.stderr.write('no pull requests found for branch "' + argv[2] + '"'); process.exit(1); }
  process.stdout.write(JSON.stringify({
    number: pr.number, state: pr.state, isDraft: pr.draft, url: 'https://example.invalid/pr/' + pr.number,
    mergeCommit: pr.mergeCommit ? { oid: pr.mergeCommit } : null, headRefOid: pr.headRefOid,
  }));
} else if (argv[0] === 'pr' && argv[1] === 'list') {
  const want = flag('--state').toUpperCase();
  process.stdout.write(JSON.stringify(state.prs.filter((p) => want === 'ALL' || p.state === want).map((p) => ({
    number: p.number, title: 'Plan', state: p.state, headRefName: p.head, isDraft: p.draft,
    url: 'https://example.invalid/pr/' + p.number, updatedAt: '', author: { login: 'test' },
    headRefOid: p.headRefOid, mergedAt: p.state === 'MERGED' ? '2026-10-12T00:00:00Z' : null,
  }))));
} else if (argv[0] === 'pr' && argv[1] === 'ready') {
  find(argv[2]).draft = false;
  save();
} else if (argv[0] === 'pr' && argv[1] === 'merge') {
  const pr = find(argv[2]);
  const pin = flag('--match-head-commit');
  if (pin && pin !== pr.headRefOid) { process.stderr.write('head moved'); process.exit(1); }
  const g = (...a) => execFileSync('git', ['-C', state.mergeClone, ...a], { encoding: 'utf8' }).trim();
  g('fetch', '-q', 'origin');
  g('checkout', '-q', '-B', 'main', 'origin/main');
  g('merge', '-q', '--no-ff', '-m', 'Merge pull request #' + pr.number + ' from test/' + pr.head, 'origin/' + pr.head);
  g('push', '-q', 'origin', 'main');
  if (argv.includes('--delete-branch')) g('push', '-q', 'origin', '--delete', pr.head);
  pr.state = 'MERGED';
  pr.mergeCommit = g('rev-parse', 'HEAD');
  save();
  process.stdout.write('merged');
} else if (argv[0] === 'repo' && argv[1] === 'view') {
  process.stdout.write('main');
} else {
  process.stdout.write('{}');
}
`);
});

beforeEach(() => {
  fs.rmSync(callsPath, { force: true });
});

const hostCalls = () => (fs.existsSync(callsPath) ? fs.readFileSync(callsPath, 'utf8') : '');
const merges = () => hostCalls().split('\n').filter((l) => /^gh pr merge\b/.test(l));

/**
 * A sandbox with a bare origin, an empty plan directory on main, and a batch
 * branch adding two plans under one open draft PR, #77. The caller's checkout
 * stays on main, so neither plan is in it.
 */
const makeBatch = ({ first = PLAN('First plan'), extraPrs = [], old = false } = {}) => {
  const tmp = track(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-approve-batch-')));
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  const mergeClone = path.join(tmp, 'merge-clone');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  for (const [k, v] of [['user.email', 'test@example.invalid'], ['user.name', 'Plot Test'], ['commit.gpgsign', 'false']]) {
    git(repo, 'config', k, v);
  }
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** docs/plans/\n- **Active index:** docs/plans/active/\n- **Sprint directory:** docs/sprints/\n');
  fs.mkdirSync(path.join(repo, 'docs', 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'plans', '.keep'), '');
  if (old) fs.writeFileSync(path.join(repo, OLD), PLAN('Old plan'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'skeleton');
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'remote', 'set-head', 'origin', 'main');

  git(repo, 'checkout', '-q', '-b', BATCH);
  fs.writeFileSync(path.join(repo, FIRST), first);
  fs.writeFileSync(path.join(repo, SECOND), PLAN('Second plan'));
  fs.symlinkSync('../2026-10-12-first-plan.md', path.join(repo, 'docs', 'plans', 'active', 'first-plan.md'));
  fs.symlinkSync('../2026-10-12-second-plan.md', path.join(repo, 'docs', 'plans', 'active', 'second-plan.md'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plans');
  git(repo, 'push', '-q', 'origin', BATCH);
  const head = git(repo, 'rev-parse', 'HEAD').trim();
  git(repo, 'checkout', '-q', 'main');

  git(tmp, 'clone', '-q', origin, mergeClone);
  for (const [k, v] of [['user.email', 'host@example.invalid'], ['user.name', 'Host'], ['commit.gpgsign', 'false']]) {
    git(mergeClone, 'config', k, v);
  }
  const prs = [{ number: 77, head: BATCH, state: 'OPEN', draft: true, headRefOid: head }, ...extraPrs];
  fs.writeFileSync(statePath, JSON.stringify({ mergeClone, prs }));
  return { repo, head };
};

/** Commits a file change on a branch cut from origin/main and pushes it; returns the commit. */
const pushChange = (repo, branch, file, content, from = 'origin/main') => {
  git(repo, 'fetch', '-q', 'origin');
  git(repo, 'checkout', '-q', '-B', branch, from);
  fs.writeFileSync(path.join(repo, file), content);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', `change ${file}`);
  git(repo, 'push', '-q', '-f', 'origin', `${branch}:${branch}`);
  const sha = git(repo, 'rev-parse', 'HEAD').trim();
  git(repo, 'checkout', '-q', '--detach', 'origin/main');
  return sha;
};

/** Adds a PR to the host stub's state. */
const addPr = (pr) => {
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.prs.push(pr);
  fs.writeFileSync(statePath, JSON.stringify(state));
};

const childEnv = () => {
  const env = { ...process.env, PATH: `${stubDir}:${process.env.PATH}`, PLOT_HOST: 'github' };
  delete env.PLOT_UNATTENDED;
  delete env.PLOT_REPO_ROOT;
  delete env.PLOT_BRANCH;
  return env;
};

const approve = (repo, slug) =>
  spawnSync('bash', [path.join(SCRIPTS, 'plot-approve.sh'), slug], { cwd: repo, encoding: 'utf8', env: childEnv() });

const onMain = (repo, file) => {
  git(repo, 'fetch', '-q', 'origin', 'main');
  return git(repo, 'show', `origin/main:${file}`);
};

test('approve batch: a plan only on the open batch PR head is approved, the PR merges once, and the other plan lands as Draft', () => {
  const { repo, head } = makeBatch();
  assert.equal(fs.existsSync(path.join(repo, FIRST)), false, 'the checkout does not hold the plan');

  const r = approve(repo, 'first-plan');
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.equal(merges().length, 1, hostCalls());
  assert.match(merges()[0], new RegExp(`--match-head-commit ${head}\\b`), 'the merge is pinned to the head the approval read');
  assert.match(onMain(repo, FIRST), /\*\*State:\*\* Approved/);
  assert.match(onMain(repo, FIRST), /\*\*Approved:\*\* .*plan-PR #77 merged/);
  assert.match(onMain(repo, SECOND), /\*\*State:\*\* Draft/, 'the other plan lands unapproved');
  assert.match(r.stdout, /^summary: merged=yes .* carried=second-plan$/m, r.stdout);
  assert.match(r.stdout, /also carried 1 other plan\(s\).*second-plan/, r.stdout);
});

test('approve batch: the second plan of a merged batch answers merged=already and flips', () => {
  const { repo } = makeBatch();
  assert.equal(approve(repo, 'first-plan').status, 0);
  fs.rmSync(callsPath, { force: true });

  const r = approve(repo, 'second-plan');
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.deepEqual(merges(), [], 'nothing merges twice');
  assert.match(r.stdout, /^summary: merged=already /m, r.stdout);
  assert.doesNotMatch(r.stdout, /carried=/, r.stdout);
  assert.match(onMain(repo, SECOND), /\*\*State:\*\* Approved/);
  assert.match(onMain(repo, SECOND), /\*\*Approved:\*\* .*plan-PR #77 merged/);
});

test('approve batch: run from the batch worktree, where the plan is local, it finds the PR by the plan file', () => {
  const { repo } = makeBatch();
  git(repo, 'checkout', '-q', BATCH);
  const r = approve(repo, 'second-plan');
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(hostCalls(), /^gh pr view idea\/second-plan\b/m, 'idea/<slug> is asked first');
  assert.equal(merges().length, 1, hostCalls());
  assert.match(onMain(repo, SECOND), /\*\*State:\*\* Approved/);
  assert.match(onMain(repo, FIRST), /\*\*State:\*\* Draft/);
  assert.match(r.stdout, /carried=first-plan$/m, r.stdout);
});

test('approve batch: a plan two open PRs both change is refused before any merge', () => {
  const { repo, head } = makeBatch();
  addPr({ number: 78, head: BATCH, state: 'OPEN', draft: false, headRefOid: head });
  const r = approve(repo, 'first-plan');
  assert.notEqual(r.status, 0, r.stdout);
  assert.match(r.stderr, /more than one open PR \(#77, #78\)/, r.stderr);
  assert.deepEqual(merges(), []);
});

test('approve batch: a non-Draft plan on the PR head is refused before any merge', () => {
  const { repo } = makeBatch({ first: PLAN('First plan').replace('**State:** Draft', '**State:** Delivered') });
  const r = approve(repo, 'first-plan');
  assert.notEqual(r.status, 0, r.stdout);
  assert.match(r.stderr, /already delivered/, r.stderr);
  assert.deepEqual(merges(), []);
});

test('approve batch: a slug no checkout, default branch or open PR holds is refused as not found', () => {
  const { repo } = makeBatch();
  const r = approve(repo, 'no-such-plan');
  assert.notEqual(r.status, 0, r.stdout);
  assert.match(r.stderr, /no plan found for 'no-such-plan'/, r.stderr);
  assert.deepEqual(merges(), []);
});

test('approve batch: carried= names only the plans the batch changes, not one main edited after the batch branched', () => {
  const { repo } = makeBatch({ old: true });
  pushChange(repo, 'main', OLD, PLAN('Old plan').replace('the work', 'edited on main'));
  const r = approve(repo, 'first-plan');
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /^summary: merged=yes .* carried=second-plan$/m, r.stdout);
});

test('approve batch: an open PR editing a plan the merged batch landed is not merged; the batch PR answers', () => {
  const { repo } = makeBatch();
  assert.equal(approve(repo, 'first-plan').status, 0);
  const sweep = pushChange(repo, 'chore/typo-sweep', SECOND, PLAN('Second plan').replace('the work', 'the work, typo fixed'));
  addPr({ number: 90, head: 'chore/typo-sweep', state: 'OPEN', draft: false, headRefOid: sweep });
  fs.rmSync(callsPath, { force: true });

  const r = approve(repo, 'second-plan');
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.deepEqual(merges(), [], `the typo sweep must not merge:\n${hostCalls()}`);
  assert.match(r.stdout, /^summary: merged=already /m, r.stdout);
  assert.match(onMain(repo, SECOND), /\*\*Approved:\*\* .*plan-PR #77 merged/);
});

test('approve batch: a plan pushed straight to main is refused pr-absent, whatever the open PRs change', () => {
  const { repo } = makeBatch({ old: true });
  const unrelated = pushChange(repo, 'feature/readme', 'README.md', 'readme\n');
  pushChange(repo, 'main', OLD, PLAN('Old plan').replace('the work', 'edited on main'));
  const edit = pushChange(repo, 'chore/old-edit', OLD, PLAN('Old plan').replace('the work', 'edited by a PR'));
  addPr({ number: 91, head: 'feature/readme', state: 'OPEN', draft: false, headRefOid: unrelated });
  addPr({ number: 92, head: 'chore/old-edit', state: 'OPEN', draft: false, headRefOid: edit });

  const r = approve(repo, 'old-plan');
  assert.notEqual(r.status, 0, r.stdout);
  assert.match(r.stderr, /no PR found for branch 'idea\/old-plan'/, r.stderr);
  assert.deepEqual(merges(), [], hostCalls());
});

test('approve batch: an open PR whose head commit git cannot resolve is skipped, never read at origin/<head>', () => {
  const { repo } = makeBatch();
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.prs[0].headRefOid = 'f'.repeat(40);
  fs.writeFileSync(statePath, JSON.stringify(state));
  const r = approve(repo, 'first-plan');
  assert.notEqual(r.status, 0, r.stdout);
  assert.match(r.stderr, /no plan found for 'first-plan'/, r.stderr);
  assert.deepEqual(merges(), []);
});

test('approve batch: the open PRs are listed once, with an explicit limit', () => {
  const { repo } = makeBatch();
  assert.equal(approve(repo, 'first-plan').status, 0);
  const lists = hostCalls().split('\n').filter((l) => /^gh pr list\b/.test(l));
  assert.equal(lists.length, 1, hostCalls());
  assert.match(lists[0], /--limit 100\b/, lists[0]);
});
