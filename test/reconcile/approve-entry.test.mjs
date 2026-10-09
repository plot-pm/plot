// Contract test for the approve launcher and the entry behind it
// (`board/plot-approve.mjs`): the launcher's two exits, the order of the
// refusals against the host, the two receipts the gates read, and a run from
// the npm layout, where no `packages/` directory exists beside the scripts.
//
// The receipts are read back through the shell files the gates source
// (`receipt_clears`, `action_receipt_clears`), not through a fixture: a test
// that wrote the expected file by hand would pin the entry against itself.
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const PLAN_REL = 'docs/plans/2026-08-17-approve-me.md';

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

const PLAN = ({ phase = 'Draft', review = 'pr', named = true } = {}) => `# Approve me

## Status

- **Phase:** ${phase}
- **Type:** feature
- **Story:**
- **Sprint:**
- **Review:** ${review}
- **Impl:** own branches
- **Approved:**
- **Started:**
- **Delivered:**

## Branches

${named ? '### Wave one\n' : ''}- \`feature/alpha\` — the first
`;

before(() => {
  stubDir = track(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-approve-entry-stub-')));
  statePath = path.join(stubDir, 'state.json');
  callsPath = path.join(stubDir, 'calls.log');
  fs.writeFileSync(path.join(stubDir, 'gh'), `#!/usr/bin/env bash
printf '%s\\n' "gh $*" >> "${callsPath}"
exec node "${stubDir}/gh.mjs" "$@"
`);
  fs.chmodSync(path.join(stubDir, 'gh'), 0o755);
  fs.writeFileSync(path.join(stubDir, 'gh.mjs'), `
import fs from 'node:fs';
const argv = process.argv.slice(2);
const file = ${JSON.stringify(statePath)};
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
if (argv[0] === 'pr' && argv[1] === 'view') {
  process.stdout.write(JSON.stringify({
    number: state.number, state: state.state, isDraft: state.draft,
    url: 'https://example.invalid/pr/' + state.number, mergeCommit: null,
  }));
} else if (argv[0] === 'pr' && argv[1] === 'ready') {
  state.draft = false;
  fs.writeFileSync(file, JSON.stringify(state));
} else if (argv[0] === 'pr' && argv[1] === 'merge') {
  state.state = 'MERGED';
  fs.writeFileSync(file, JSON.stringify(state));
  process.stdout.write('merged');
} else if (argv[0] === 'pr' && argv[1] === 'create') {
  process.stdout.write('https://example.invalid/pr/999');
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

const setHost = (s) => fs.writeFileSync(statePath, JSON.stringify(s));
const hostCalls = () => (fs.existsSync(callsPath) ? fs.readFileSync(callsPath, 'utf8') : '');

/** A sandbox with a real bare origin, the plan on main, and the host stub at an open PR. */
const makeRepo = (planBody, host = { number: 42, state: 'OPEN', draft: false }) => {
  const tmp = track(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-approve-entry-')));
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** docs/plans/\n- **Active index:** docs/plans/active/\n- **Sprint directory:** docs/sprints/\n');
  fs.mkdirSync(path.join(repo, 'docs', 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(repo, PLAN_REL), planBody);
  fs.symlinkSync('../2026-08-17-approve-me.md', path.join(repo, 'docs', 'plans', 'active', 'approve-me.md'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plan');
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'remote', 'set-head', 'origin', 'main');
  setHost(host);
  return { repo, origin };
};

const childEnv = () => {
  const env = { ...process.env, PATH: `${stubDir}:${process.env.PATH}`, PLOT_HOST: 'github' };
  delete env.PLOT_UNATTENDED;
  delete env.PLOT_REPO_ROOT;
  return env;
};

const approve = (repo, args = ['approve-me'], scripts = SCRIPTS) =>
  spawnSync('bash', [path.join(scripts, 'plot-approve.sh'), ...args], { cwd: repo, encoding: 'utf8', env: childEnv() });

const planOnMain = (repo) => {
  git(repo, 'fetch', '-q', 'origin', 'main');
  return git(repo, 'show', `origin/main:${PLAN_REL}`);
};

const mutatingCalls = () => hostCalls().split('\n').filter((l) => /^gh pr (ready|merge)\b/.test(l));

/** Runs a shell snippet that sources one of the receipt files the gates source. */
const shellRead = (repo, file, snippet) =>
  spawnSync('bash', ['-c', `. "${path.join(SCRIPTS, file)}" && ${snippet}`], { cwd: repo, encoding: 'utf8' }).status;

const seedActionReceipt = (repo) => {
  const dir = path.join(repo, '.plot', 'state', 'action-receipts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'approve'), 'seeded\n');
};

// --- the launcher ------------------------------------------------------------

test('approve launcher: a missing bundle exits 2, naming the file and both remedies', () => {
  const dir = track(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-approve-launcher-')));
  fs.copyFileSync(path.join(SCRIPTS, 'plot-approve.sh'), path.join(dir, 'plot-approve.sh'));
  const r = spawnSync('bash', [path.join(dir, 'plot-approve.sh'), 'x'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /board\/plot-approve\.mjs/);
  assert.match(r.stderr, /update the plot plugin/i);
  assert.match(r.stderr, /pnpm build:board/);
  assert.equal(r.stdout, '');
});

test('approve launcher: a present bundle receives the arguments and its exit code passes through', () => {
  const dir = track(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-approve-launcher-')));
  fs.copyFileSync(path.join(SCRIPTS, 'plot-approve.sh'), path.join(dir, 'plot-approve.sh'));
  fs.mkdirSync(path.join(dir, 'board'));
  fs.writeFileSync(path.join(dir, 'board', 'plot-approve.mjs'),
    'process.stdout.write(JSON.stringify(process.argv.slice(2)));\nprocess.exit(7);\n');
  const r = spawnSync('bash', [path.join(dir, 'plot-approve.sh'), '--dry-run', 'slug'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 7);
  assert.deepEqual(JSON.parse(r.stdout), ['--dry-run', 'slug']);
});

test('approve entry: an unknown flag exits 1 and a missing slug names the usage', () => {
  const { repo } = makeRepo(PLAN());
  const flag = approve(repo, ['--frobnicate', 'approve-me']);
  assert.equal(flag.status, 1);
  assert.match(flag.stderr, /plot-approve: unknown flag '--frobnicate'/);
  const none = approve(repo, []);
  assert.equal(none.status, 1);
  assert.match(none.stderr, /plot-approve: need a plan slug \(usage: plot-approve\.sh \[--dry-run\] <slug>\)/);
});

// --- refusals leave the host untouched ---------------------------------------

const REFUSALS = [
  ['a plan already delivered', () => makeRepo(PLAN({ phase: 'Delivered' }), { number: 42, state: 'OPEN', draft: true })],
  ['a review channel that is not a PR', () => makeRepo(PLAN({ review: 'none' }), { number: 42, state: 'OPEN', draft: true })],
  ['a PR that was closed unmerged', () => makeRepo(PLAN(), { number: 42, state: 'CLOSED', draft: false })],
  ['a branch under no slice heading', () => makeRepo(PLAN({ named: false }), { number: 42, state: 'OPEN', draft: true })],
];

for (const [name, build] of REFUSALS) {
  test(`approve entry: ${name} refuses before the merge and writes nothing`, () => {
    const { repo } = build();
    const before = planOnMain(repo);
    const r = approve(repo);
    assert.notEqual(r.status, 0, `must refuse:\n${r.stdout}\n${r.stderr}`);
    assert.deepEqual(mutatingCalls(), [], `no pr-ready or pr-merge call may precede a refusal:\n${hostCalls()}`);
    assert.equal(planOnMain(repo), before, 'the plan on main is byte-identical');
    assert.equal(fs.existsSync(path.join(repo, '.plot', 'state', 'state-receipts')), false,
      'no state receipt exists for a write that did not happen');
  });
}

// --- the receipts ------------------------------------------------------------

test('approve entry: a completed approval leaves the state receipt the gate reads and spends the action receipt', () => {
  const { repo } = makeRepo(PLAN(), { number: 42, state: 'OPEN', draft: true });
  seedActionReceipt(repo);
  assert.equal(shellRead(repo, 'plot-state-receipt.sh', 'action_receipt_clears approve'), 0, 'the seeded receipt clears the gate');

  const r = approve(repo);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(planOnMain(repo), /\*\*Phase:\*\* Approved/);
  assert.match(hostCalls(), /^gh pr ready\b/m, 'a draft is made ready first');
  assert.match(hostCalls(), /^gh pr merge\b/m);

  assert.equal(shellRead(repo, 'plot-state-receipt.sh', 'action_receipt_clears approve'), 1,
    'the action receipt is spent once the action completes');
  assert.equal(shellRead(repo, 'plot-state-receipt.sh', `receipt_clears ${PLAN_REL} Approved`), 0,
    'the state receipt names the plan path and the value the gate compares');
  assert.equal(shellRead(repo, 'plot-state-receipt.sh', `receipt_clears ${PLAN_REL} Approved`), 1,
    'a receipt clears one commit');
});

test('approve entry: a rejected push leaves the action receipt, so the re-run needs no second controller call', () => {
  const { repo, origin } = makeRepo(PLAN(), { number: 42, state: 'OPEN', draft: false });
  fs.writeFileSync(path.join(origin, 'hooks', 'pre-receive'), '#!/bin/sh\necho "rejected by the test" >&2\nexit 1\n');
  fs.chmodSync(path.join(origin, 'hooks', 'pre-receive'), 0o755);
  seedActionReceipt(repo);

  const r = approve(repo);
  assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
  assert.match(hostCalls(), /^gh pr merge\b/m, 'the irreversible merge ran before the push');
  assert.equal(shellRead(repo, 'plot-state-receipt.sh', 'action_receipt_clears approve'), 0,
    'the action receipt survives a failed push');

  fs.rmSync(path.join(origin, 'hooks', 'pre-receive'));
  const again = approve(repo);
  assert.equal(again.status, 0, `the re-run repairs the interrupted approval:\n${again.stdout}\n${again.stderr}`);
  assert.match(planOnMain(repo), /\*\*Phase:\*\* Approved/);
  assert.equal(shellRead(repo, 'plot-state-receipt.sh', 'action_receipt_clears approve'), 1);
});

// --- the npm layout ----------------------------------------------------------

test('approve entry: the bundle runs from the npm layout, with no packages/ beside the scripts', () => {
  const root = track(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-approve-npm-')));
  const scripts = path.join(root, 'scripts');
  fs.cpSync(SCRIPTS, scripts, { recursive: true });
  assert.equal(fs.existsSync(path.join(root, 'packages')), false);
  const { repo } = makeRepo(PLAN(), { number: 42, state: 'OPEN', draft: false });
  const r = approve(repo, ['approve-me'], scripts);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(planOnMain(repo), /\*\*Phase:\*\* Approved/);
});
