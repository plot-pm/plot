// Contract test for `plot-approve.sh --who <handle> <slug>` — the mechanical
// half of an in-session approval, performed since
// an-in-session-approval-has-a-controller slice 2.
//
// NO HOST CALL AT ALL. There is no plan PR for `Review: in-session`: the
// approval is the reviewer's go, not a host state, so this suite stubs no
// `gh`/`bb` — a real call would be the bug this slice closes a different way.
//
// The script's hardest property is the SAME idempotence `approve.test.mjs`
// exercises for `pr`, with one difference: the `--who` reaching the write is
// never defaulted, because a default here is the one thing a script must
// never do for a channel that exists because a human is in the room.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const approve = path.join(SCRIPTS, 'plot-approve.sh');

let tmp, origin, repo;

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}

function run(args, { cwd = repo, expectFail = false, env = {} } = {}) {
  try {
    // `PLOT_UNATTENDED=1` MAY ALREADY BE SET IN THE AMBIENT ENVIRONMENT this
    // suite runs under (a fleet worker's own loop sets it for itself), which
    // would make every test here hit the unattended refusal unless explicitly
    // cleared. Only the one test that means to assert that refusal re-adds it.
    const childEnv = { ...process.env, ...env };
    if (!('PLOT_UNATTENDED' in env)) delete childEnv.PLOT_UNATTENDED;
    const out = execFileSync('bash', [approve, ...args], {
      encoding: 'utf8',
      cwd,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (expectFail) assert.fail(`expected a refusal, got:\n${out}`);
    return { code: 0, out, err: '' };
  } catch (e) {
    if (!expectFail) assert.fail(`unexpected failure:\n${e.stdout}\n${e.stderr}`);
    return { code: e.status, out: e.stdout || '', err: e.stderr || '' };
  }
}

const PLAN = (extra = {}) => `# Approve me in session

## Status

- **Phase:** ${extra.phase ?? 'Draft'}
- **Type:** feature
- **Review:** in-session
- **Impl:** own branches
- **Approved:**${extra.approved ? ` ${extra.approved}` : ''}
- **Started:**
- **Delivered:**

## Branches

### Wave one
- \`feature/alpha\` — the first
`;

after(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

/** A fresh sandbox with a real bare origin — the script pushes for real. `People` declares `jwloka`. */
function makeRepo(planBody = PLAN()) {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-approve-is-'));
  origin = path.join(tmp, 'origin.git');
  repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'git-identity-should-never-be-used');
  git(repo, 'config', 'commit.gpgsign', 'false');

  fs.writeFileSync(path.join(repo, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** docs/plans/\n- **Active index:** docs/plans/active/\n'
    + '- **People:** jwloka = Jan Wloka; eins78 = Max Albrecht\n');
  fs.mkdirSync(path.join(repo, 'docs', 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'plans', '2026-10-02-approve-me-is.md'), planBody);
  fs.symlinkSync('../2026-10-02-approve-me-is.md',
    path.join(repo, 'docs', 'plans', 'active', 'approve-me-is.md'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plan');
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'remote', 'set-head', 'origin', 'main');
  return repo;
}

function planOnMain(rel = 'docs/plans/2026-10-02-approve-me-is.md') {
  return git(repo, 'show', `origin/main:${rel}`);
}
function refreshMain() {
  git(repo, 'fetch', '-q', 'origin', 'main');
}
function tsvRows(file) {
  const p = path.join(repo, '.plot', 'state', file);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
}

beforeEach(() => makeRepo());

test('approve --who: a no-op write refuses nothing it did not need to', () => {
  // Baseline: the happy path performs the seven mechanical steps and the two
  // lifecycle files gain exactly the rows this run owns.
  const before = tsvRows('in-session-approvals.tsv').length;
  const beforeUnowned = tsvRows('unowned-state-writes.tsv').length;

  const r = run(['approve-me-is', '--who', 'jwloka']);
  assert.equal(r.code, 0, `the approval should succeed:\n${r.out}\n${r.err}`);

  refreshMain();
  const plan = planOnMain();
  assert.match(plan, /- \*\*Phase:\*\* Approved/, `the phase must flip:\n${plan}`);
  assert.match(plan, /- \*\*Approved:\*\* \d{4}-\d{2}-\d{2}, jwloka, in-session/,
    `the record must name the handle and the channel:\n${plan}`);

  assert.equal(tsvRows('in-session-approvals.tsv').length, before + 1,
    'exactly one in-session-approvals.tsv row');
  assert.equal(tsvRows('unowned-state-writes.tsv').length, beforeUnowned,
    'no unowned-state-writes.tsv row — the script owns this write now');
});

test('approve --who: refuses with no --who, writing nothing', () => {
  const r = run(['approve-me-is'], { expectFail: true });
  assert.match(r.err, /--who/, `must name --who:\n${r.err}`);

  refreshMain();
  assert.match(planOnMain(), /- \*\*Phase:\*\* Draft/);
  assert.equal(git(repo, 'status', '--porcelain').trim(), '');
  assert.equal(tsvRows('in-session-approvals.tsv').length, 0);
});

test('approve --who: refuses an empty --who, writing nothing', () => {
  const r = run(['approve-me-is', '--who', ''], { expectFail: true });
  assert.match(r.err, /review-human|name the reviewer/i, `must name the gate:\n${r.err}`);

  refreshMain();
  assert.match(planOnMain(), /- \*\*Phase:\*\* Draft/);
  assert.equal(git(repo, 'status', '--porcelain').trim(), '');
  assert.equal(tsvRows('in-session-approvals.tsv').length, 0);
});

test('approve --who: refuses an undeclared handle, writing nothing', () => {
  const r = run(['approve-me-is', '--who', 'nobody-declared'], { expectFail: true });
  assert.match(r.err, /reviewer-undeclared|not a handle this project declares/i,
    `must name the gate:\n${r.err}`);

  refreshMain();
  assert.match(planOnMain(), /- \*\*Phase:\*\* Draft/);
  assert.equal(git(repo, 'status', '--porcelain').trim(), '');
  assert.equal(tsvRows('in-session-approvals.tsv').length, 0);
});

test('approve --who: never falls back to git config user.name', () => {
  // THE CASE THAT CATCHES A FALLBACK IMPLEMENTATION. `git config user.name` is
  // deliberately set to a handle `People` does NOT declare, so a script that
  // silently defaulted to it would be caught by the same `reviewer-undeclared`
  // refusal an operator sees for a typo'd handle — not by a crash, which a
  // careless fallback could dodge by accident.
  const r = run(['approve-me-is'], { expectFail: true });
  assert.doesNotMatch(r.err, /git-identity-should-never-be-used/,
    'the git identity must never reach the record or the refusal');
});

test('approve --who: refuses under PLOT_UNATTENDED=1 even with --who supplied', () => {
  const r = run(['approve-me-is', '--who', 'jwloka'],
    { expectFail: true, env: { PLOT_UNATTENDED: '1' } });
  assert.match(r.err, /PLOT_UNATTENDED/, `must name the unattended refusal:\n${r.err}`);

  refreshMain();
  assert.match(planOnMain(), /- \*\*Phase:\*\* Draft/);
  assert.equal(git(repo, 'status', '--porcelain').trim(), '');
});

test('approve --who: PLOT_APPROVE_ENTRY=board records entry=board', () => {
  const r = run(['approve-me-is', '--who', 'jwloka'], { env: { PLOT_APPROVE_ENTRY: 'board' } });
  assert.equal(r.code, 0, `should succeed:\n${r.out}\n${r.err}`);
  const rows = tsvRows('in-session-approvals.tsv');
  assert.equal(rows.length, 1);
  assert.match(rows[0], /\tboard$/, `entry column must read board:\n${rows[0]}`);
});

test('approve --who: entry=script by default', () => {
  const r = run(['approve-me-is', '--who', 'jwloka']);
  assert.equal(r.code, 0, `should succeed:\n${r.out}\n${r.err}`);
  const rows = tsvRows('in-session-approvals.tsv');
  assert.equal(rows.length, 1);
  assert.match(rows[0], /\tscript$/, `entry column must read script:\n${rows[0]}`);
});

test('approve --who: re-running after success is a no-op and adds no second row', () => {
  const first = run(['approve-me-is', '--who', 'jwloka']);
  assert.equal(first.code, 0);
  assert.equal(tsvRows('in-session-approvals.tsv').length, 1);

  const second = run(['approve-me-is', '--who', 'jwloka']);
  assert.equal(second.code, 0, `the re-run should succeed:\n${second.out}\n${second.err}`);
  assert.equal(tsvRows('in-session-approvals.tsv').length, 1,
    'a no-op re-run must not add a second row');
});
