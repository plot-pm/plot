// Contract test for skills/plot/scripts/plot-open-pr.sh — the mechanical half
// of opening a slice's pull request.
//
// THE ACTION THAT HAD NO CONTROLLER. Measured 2026-09-08: three PRs were opened
// with `gh pr create` because no endpoint offered it, and the sprint before,
// fifteen branches carried finished work nobody could see because no PR was
// raised at all. So the properties asserted here are the ones a hand-run
// `pr create` cannot have — that the title comes from the plan, that a branch a
// PR already carries is refused by number, and that a branch carrying nothing
// but a marker is NAMED rather than opened silently.
//
// The host CLI is PATH-stubbed: `gh` records its argv, so a test can assert
// what was sent to `pr create` without opening anything.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const openPr = path.join(SCRIPTS, 'plot-open-pr.sh');

let tmp, origin, repo, stubDir, statePath;

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}

function run(args, { cwd = repo, expectFail = false } = {}) {
  // Stderr is redirected to a file rather than captured, because a SUCCESSFUL
  // run's stderr is a property under test here: the marker notice goes to the
  // operator's terminal on a run that opens the PR and exits 0.
  const errFile = path.join(stubDir, 'stderr.txt');
  const errFd = fs.openSync(errFile, 'w');
  try {
    const out = execFileSync('bash', [openPr, ...args], {
      encoding: 'utf8',
      cwd,
      env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}`, PLOT_HOST: 'github' },
      stdio: ['pipe', 'pipe', errFd],
    });
    fs.closeSync(errFd);
    const err = fs.readFileSync(errFile, 'utf8');
    if (expectFail) assert.fail(`expected a refusal, got:\n${out}\n${err}`);
    return { code: 0, out, err };
  } catch (e) {
    try { fs.closeSync(errFd); } catch { /* already closed by the success path */ }
    const err = fs.existsSync(errFile) ? fs.readFileSync(errFile, 'utf8') : '';
    if (!expectFail) assert.fail(`unexpected failure:\n${e.stdout}\n${err}`);
    return { code: e.status, out: e.stdout || '', err };
  }
}

/** The stubbed host's view of the world — which PRs exist, and on which heads. */
function setHostState(s) {
  fs.writeFileSync(statePath, JSON.stringify(s));
}

/** What the stub was asked to do, one `gh …` line per call. */
function calls() {
  const log = path.join(stubDir, 'calls.log');
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
}

/** The argv of the `pr create` call, as JSON the stub recorded. */
function created() {
  const file = path.join(stubDir, 'created.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

const PLAN = `# A plan with waves

## Status

- **State:** Approved
- **Type:** feature
- **Review:** pr
- **Impl:** own branches

## Branches

### The slice that opens its own PR
- \`feature/alpha\` — the first

### A second slice, named differently
- \`feature/beta\` — the second
`;

before(() => {
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-openpr-stub-'));
  statePath = path.join(stubDir, 'state.json');
  fs.writeFileSync(path.join(stubDir, 'gh'), `#!/usr/bin/env bash
printf '%s\\n' "gh $*" >> "${stubDir}/calls.log"
exec node "${stubDir}/gh.mjs" "$@"
`);
  fs.chmodSync(path.join(stubDir, 'gh'), 0o755);
  fs.writeFileSync(path.join(stubDir, 'gh.mjs'), `
import fs from 'node:fs';
const argv = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(${JSON.stringify(statePath)}, 'utf8'));
if (argv[0] === 'pr' && argv[1] === 'list') {
  // The host CLI's own shape: a JSON ARRAY whose head field is headRefName.
  // plot-host.sh reshapes it to the {number,title,state,head} lines its callers
  // read, so a stub emitting the reshaped form would test a wire nobody uses.
  process.stdout.write(JSON.stringify(state.prs.map((p) => ({
    number: p.number, title: p.title, state: p.state, headRefName: p.head,
    isDraft: false, statusCheckRollup: [], mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN', reviewDecision: null, url: 'https://example.invalid/pr/' + p.number,
  }))));
} else if (argv[0] === 'pr' && argv[1] === 'create') {
  // Record the whole argv: what a slice PR SAYS is the property under test.
  fs.writeFileSync(${JSON.stringify(path.join(stubDir, 'created.json'))}, JSON.stringify(argv));
  process.stdout.write('https://example.invalid/pr/900');
} else if (argv[0] === 'repo' && argv[1] === 'view') {
  process.stdout.write('main');
} else {
  process.stdout.write('{}');
}
`);
});

after(() => {
  fs.rmSync(stubDir, { recursive: true, force: true });
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

/**
 * A fresh sandbox: a bare origin, a plan naming two branches, and a branch
 * carrying whatever the caller asked for.
 */
function makeRepo({ files = { 'src/alpha.ts': 'export const a = 1;\n' }, branch = 'feature/alpha' } = {}) {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-openpr-'));
  origin = path.join(tmp, 'origin.git');
  repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  fs.writeFileSync(path.join(repo, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** docs/plans/\n- **Active index:** docs/plans/active/\n');
  fs.mkdirSync(path.join(repo, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'plans', '2026-09-09-a-plan-with-waves.md'), PLAN);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plan');
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'remote', 'set-head', 'origin', 'main');

  if (branch) {
    git(repo, 'checkout', '-q', '-b', branch);
    for (const [rel, body] of Object.entries(files)) {
      fs.mkdirSync(path.join(repo, path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(repo, rel), body);
    }
    if (Object.keys(files).length > 0) {
      git(repo, 'add', '-A');
      git(repo, 'commit', '-qm', 'plot: build the board artifact');
    }
  }
  setHostState({ prs: [] });
  return repo;
}

beforeEach(() => {
  const log = path.join(stubDir, 'calls.log');
  if (fs.existsSync(log)) fs.rmSync(log);
  const made = path.join(stubDir, 'created.json');
  if (fs.existsSync(made)) fs.rmSync(made);
});

// --- the title and body -----------------------------------------------------

test('open-pr: the title is the wave heading, never the last commit subject', () => {
  makeRepo();
  run([]);

  const argv = created();
  assert.ok(argv, `nothing was opened:\n${calls()}`);
  const title = argv[argv.indexOf('--title') + 1];
  assert.equal(title, 'The slice that opens its own PR');
  // The branch's only commit says `plot: build the board artifact`, which is
  // what a title taken from git would have read.
  assert.doesNotMatch(title, /board artifact/);
});

test('open-pr: the body names the plan and the brief', () => {
  makeRepo();
  fs.mkdirSync(path.join(repo, '.plot', 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.plot', 'briefs', 'alpha.md'), '# brief\n');
  run([]);

  const argv = created();
  const body = argv[argv.indexOf('--body') + 1];
  assert.match(body, /a-plan-with-waves/, `the plan must be named:\n${body}`);
  assert.match(body, /docs\/plans\/2026-09-09-a-plan-with-waves\.md/);
  assert.match(body, /\.plot\/briefs\/alpha\.md/, `the brief must be named:\n${body}`);
});

test('open-pr: a slice with no brief still opens, naming only its plan', () => {
  makeRepo();
  run([]);

  const argv = created();
  const body = argv[argv.indexOf('--body') + 1];
  assert.doesNotMatch(body, /Brief:/);
  assert.match(body, /a-plan-with-waves/);
});

test('open-pr: each branch gets its own wave heading', () => {
  makeRepo({ branch: 'feature/beta', files: { 'src/beta.ts': 'export const b = 2;\n' } });
  run([]);

  const argv = created();
  assert.equal(argv[argv.indexOf('--title') + 1], 'A second slice, named differently');
});

test('open-pr: --draft opens a draft, and the default does not', () => {
  makeRepo();
  run([]);
  assert.ok(!created().includes('--draft'), 'the default must not be a draft');

  makeRepo();
  run(['--draft']);
  assert.ok(created().includes('--draft'));
});

test('open-pr: --dry-run opens nothing and prints the decision', () => {
  makeRepo();
  const { out } = run(['--dry-run']);

  assert.equal(created(), null, `--dry-run must open nothing:\n${calls()}`);
  const decided = JSON.parse(out);
  assert.equal(decided.outcome, 'decided');
  assert.equal(decided.title, 'The slice that opens its own PR');
});

// --- what the branch carries ------------------------------------------------

test('open-pr: a branch carrying nothing but a marker is named, and opens anyway', () => {
  makeRepo({ files: { 'PLOT-BLOCKED.md': 'PLOT-BLOCKED: which adapter?\n' } });
  const { err } = run([]);

  assert.match(err, /carries no implementation/, `the operator must be told:\n${err}`);
  const argv = created();
  assert.ok(argv, 'it reports and never refuses — the PR is still opened');
  const body = argv[argv.indexOf('--body') + 1];
  assert.match(body, /carries no implementation/, `and the PR says so:\n${body}`);
  assert.match(body, /deferred:/, 'naming the annotation that settles it');
});

test('open-pr: a documentation-only branch carried work', () => {
  makeRepo({ files: { 'docs/note.md': '# a note\n' } });
  const { err } = run([]);

  assert.doesNotMatch(err, /carries no implementation/);
  const body = created()[created().indexOf('--body') + 1];
  assert.doesNotMatch(body, /carries no implementation/);
});

// --- the four refusals ------------------------------------------------------

test('open-pr: refuses a branch no plan names', () => {
  makeRepo({ branch: 'feature/unnamed' });
  const { err } = run([], { expectFail: true });

  assert.match(err, /no plan names 'feature\/unnamed'/);
  assert.equal(created(), null, 'a refusal opens nothing');
});

test('open-pr: refuses a branch a PR already carries, naming the number', () => {
  makeRepo();
  setHostState({ prs: [{ number: 846, title: 'whatever', state: 'OPEN', head: 'feature/alpha' }] });
  const { err } = run([], { expectFail: true });

  assert.match(err, /#846 already carries/);
  assert.equal(created(), null);
});

test('open-pr: a merged PR counts as carrying the branch too', () => {
  makeRepo();
  setHostState({ prs: [{ number: 12, title: 'done', state: 'MERGED', head: 'feature/alpha' }] });
  const { err } = run([], { expectFail: true });

  assert.match(err, /#12 already carries/);
});

test('open-pr: refuses a branch holding no commit its base does not', () => {
  makeRepo({ files: {} });
  const { err } = run([], { expectFail: true });

  assert.match(err, /holds no commit/);
  assert.equal(created(), null);
});

test('open-pr: refuses a branch whose plan names it under no wave heading', () => {
  makeRepo();
  // A plan that lists the branch in prose rather than under a `###` heading has
  // no title to give, and the branch name is not one.
  fs.writeFileSync(path.join(repo, 'docs', 'plans', '2026-09-09-a-plan-with-waves.md'),
    PLAN.replace('### The slice that opens its own PR\n', ''));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plan: drop the heading');
  const { err } = run([], { expectFail: true });

  assert.match(err, /under no wave heading|no plan names/);
  assert.equal(created(), null);
});

// --- the host boundary ------------------------------------------------------

test('open-pr: reaches the host only through the adapter', () => {
  makeRepo();
  run([]);

  // `plot-host.sh` is the ONE place that talks to the host CLI. Every `gh` line
  // the stub logged came from it, and this script names neither `gh` nor `bb`.
  const source = fs.readFileSync(openPr, 'utf8');
  const code = source.split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n');
  assert.doesNotMatch(code, /\bgh\s+pr\b/, 'the script must not call gh directly');
  assert.match(calls(), /gh pr create/, 'and the adapter must have made the call');
});
