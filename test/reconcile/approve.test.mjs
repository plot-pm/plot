// Contract test for skills/plot/scripts/plot-approve.sh — the mechanical half
// of approving a plan.
//
// The script's hardest property is IDEMPOTENCE, and the reason is asymmetric:
// step 2 merges the plan PR, which writes irreversibly to the git host, while
// every step after it is local. A run interrupted in that window leaves the PR
// merged and the plan on the default branch still reading `Phase: Draft` — the
// state the skill names as the thing never to allow. So `run it again` has to
// be the repair, and the tests below assert that directly rather than only
// re-running a successful approval (which passes without the property).
//
// The host CLI is PATH-stubbed: `gh` records its argv and answers pr-state from
// a mutable state file, so a test can merge a PR and have the next call see it.
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

let tmp, origin, repo, stubDir, statePath;

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}

function run(args, { cwd = repo, expectFail = false } = {}) {
  try {
    const out = execFileSync('bash', [approve, ...args], {
      encoding: 'utf8',
      cwd,
      env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}`, PLOT_HOST: 'github' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (expectFail) assert.fail(`expected a refusal, got:\n${out}`);
    return { code: 0, out, err: '' };
  } catch (e) {
    if (!expectFail) assert.fail(`unexpected failure:\n${e.stdout}\n${e.stderr}`);
    return { code: e.status, out: e.stdout || '', err: e.stderr || '' };
  }
}

/** The stubbed host's view of the world — mutable, so a merge is visible next call. */
function setHostState(s) {
  fs.writeFileSync(statePath, JSON.stringify(s));
}
function hostState() {
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

const PLAN = (extra = {}) => `# Approve me

## Status

- **Phase:** ${extra.phase ?? 'Draft'}
- **Type:** feature
- **Story:** ${extra.story ?? ''}
- **Sprint:** ${extra.sprint ?? ''}
- **Review:** ${extra.review ?? 'pr'}
- **Impl:** ${extra.impl ?? 'own branches'}
- **Approved:**${extra.approved ? ` ${extra.approved}` : ''}
- **Started:**
- **Delivered:**

## Branches

### Wave one
- \`feature/alpha\` — the first
- \`feature/beta\` — the second
`;

before(() => {
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-approve-stub-'));
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
if (argv[0] === 'pr' && argv[1] === 'view') {
  process.stdout.write(JSON.stringify({
    number: state.number, state: state.state, isDraft: state.draft,
    url: 'https://example.invalid/pr/' + state.number, mergeCommit: null,
  }));
} else if (argv[0] === 'pr' && argv[1] === 'merge') {
  if (state.mergeFails) { process.stderr.write('merge refused'); process.exit(1); }
  state.state = 'MERGED';
  fs.writeFileSync(${JSON.stringify(statePath)}, JSON.stringify(state));
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

after(() => {
  fs.rmSync(stubDir, { recursive: true, force: true });
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

/** A fresh sandbox with a real bare origin — the script pushes for real. */
function makeRepo(planBody = PLAN(), files = {}) {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-approve-'));
  origin = path.join(tmp, 'origin.git');
  repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  fs.writeFileSync(path.join(repo, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** docs/plans/\n- **Active index:** docs/plans/active/\n- **Sprint directory:** docs/sprints/\n');
  fs.mkdirSync(path.join(repo, 'docs', 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'plans', '2026-08-17-approve-me.md'), planBody);
  fs.symlinkSync('../2026-08-17-approve-me.md',
    path.join(repo, 'docs', 'plans', 'active', 'approve-me.md'));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.join(repo, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), body);
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plan');
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'remote', 'set-head', 'origin', 'main');
  setHostState({ number: 42, state: 'OPEN', draft: false });
  return repo;
}

/** The plan file as it exists ON THE DEFAULT BRANCH — the only copy that counts. */
function planOnMain(rel = 'docs/plans/2026-08-17-approve-me.md') {
  return git(repo, 'show', `origin/main:${rel}`);
}
function refreshMain() {
  git(repo, 'fetch', '-q', 'origin', 'main');
}

beforeEach(() => {
  if (fs.existsSync(path.join(stubDir, 'calls.log'))) fs.rmSync(path.join(stubDir, 'calls.log'));
});

// --- the happy path ---------------------------------------------------------

test('approve: merges the PR, flips the phase, fills the record, pushes to main', () => {
  makeRepo();
  const { out } = run(['approve-me']);

  assert.match(out, /merged PR #42/);
  assert.equal(hostState().state, 'MERGED', 'the PR must actually be merged');

  refreshMain();
  const plan = planOnMain();
  assert.match(plan, /- \*\*Phase:\*\* Approved/, `phase must be flipped on main:\n${plan}`);
  assert.match(plan, /- \*\*Approved:\*\* \d{4}-\d{2}-\d{2}, .*plan-PR #42 merged/,
    `the record must be filled:\n${plan}`);
  assert.match(out, /summary: .*push=clean/);
});

test('approve: Approved: fills the placeholder rather than appending after the list', () => {
  // append_started_line() had exactly this bug on 2026-08-17 — it appended
  // below `- **Delivered:**` instead of filling the empty placeholder, so the
  // Status block listed a start after a delivery. A second implementation of
  // the same awk would repeat it, which is why the ORDER is asserted and not
  // merely the presence of the line.
  makeRepo();
  run(['approve-me']);
  refreshMain();
  const lines = planOnMain().split('\n');
  const approvedAt = lines.findIndex((l) => l.startsWith('- **Approved:**'));
  const startedAt = lines.findIndex((l) => l.startsWith('- **Started:**'));
  const deliveredAt = lines.findIndex((l) => l.startsWith('- **Delivered:**'));
  assert.ok(approvedAt > 0, 'the Approved: line must exist');
  assert.ok(approvedAt < startedAt, `Approved: must precede Started:\n${lines.join('\n')}`);
  assert.ok(approvedAt < deliveredAt, 'Approved: must precede Delivered:');
  // Exactly one — the placeholder was replaced, not duplicated.
  assert.equal(lines.filter((l) => l.startsWith('- **Approved:**')).length, 1);
});

// --- the three refusals -----------------------------------------------------

test('approve: refuses a plan that is not Draft, and says why', () => {
  makeRepo(PLAN({ phase: 'Delivered' }));
  const { code, err } = run(['approve-me'], { expectFail: true });
  assert.equal(code, 1);
  assert.match(err, /already delivered/i, `the reason must reach the caller:\n${err}`);
  assert.notEqual(hostState().state, 'MERGED', 'a refusal must merge nothing');
});

test('approve: refuses Review: in-session — a script cannot stand in for a human', () => {
  makeRepo(PLAN({ review: 'in-session' }));
  const { code, err } = run(['approve-me'], { expectFail: true });
  assert.equal(code, 1);
  assert.match(err, /in-session/);
  assert.match(err, /human/i);
  assert.notEqual(hostState().state, 'MERGED');
});

test('approve: refuses Review: ballot', () => {
  makeRepo(PLAN({ review: 'ballot' }));
  const { code, err } = run(['approve-me'], { expectFail: true });
  assert.equal(code, 1);
  assert.match(err, /ballot/);
  assert.notEqual(hostState().state, 'MERGED');
});

test('approve: refuses an unrecognised Review: rather than treating it as pr', () => {
  // The load-bearing default. Treating an unfamiliar value as `pr` would
  // approve a plan nobody discussed, with a commit indistinguishable from a
  // legitimate one.
  makeRepo(PLAN({ review: 'two-reviewers-in-a-trenchcoat' }));
  const { code, err } = run(['approve-me'], { expectFail: true });
  assert.equal(code, 1);
  assert.match(err, /unrecognised/i);
  assert.notEqual(hostState().state, 'MERGED');
});

test('approve: refuses a draft PR, a closed PR, and a missing PR', () => {
  makeRepo();
  setHostState({ number: 42, state: 'OPEN', draft: true });
  assert.match(run(['approve-me'], { expectFail: true }).err, /still a draft/i);

  setHostState({ number: 42, state: 'CLOSED', draft: false });
  assert.match(run(['approve-me'], { expectFail: true }).err, /closed/i);

  setHostState({ number: 0, state: 'NONE', draft: false });
  assert.match(run(['approve-me'], { expectFail: true }).err, /no PR found/i);
});

// --- the holds --------------------------------------------------------------

test('approve: clears the hold for EACH branch the plan names, and no others', () => {
  // Keyed by BRANCH, not by slug: plot-phase-gate.sh:121 matches $1 == b
  // against the branch name. Approving one piece of work must not release
  // someone else's gate.
  makeRepo(PLAN(), {
    '.plot/hold': [
      'feature/alpha review pending',
      'feature/beta review pending',
      'feature/unrelated someone else is reviewing this',
      '',
    ].join('\n'),
  });
  const { out } = run(['approve-me']);
  assert.match(out, /summary: .*holds=2/, `two entries must go:\n${out}`);

  refreshMain();
  const hold = git(repo, 'show', 'origin/main:.plot/hold');
  assert.doesNotMatch(hold, /feature\/alpha/);
  assert.doesNotMatch(hold, /feature\/beta/);
  assert.match(hold, /feature\/unrelated/, `an unrelated gate must survive:\n${hold}`);
});

test('approve: a missing .plot/hold is not a failure', () => {
  // The common path: this repo has no .plot/hold at all.
  makeRepo();
  const { code, out } = run(['approve-me']);
  assert.equal(code, 0);
  assert.match(out, /summary: .*holds=0/);
});

// --- the sprint annotation --------------------------------------------------

test('approve: updates the sprint annotation the sprint view reads', () => {
  makeRepo(PLAN({ sprint: 'w33-ship-it' }), {
    'docs/sprints/2026-W33-ship-it.md':
      '# Sprint\n\n## Must\n\n- [ ] [approve-me] the plan <!-- pr: none, status: draft, branch: none -->\n',
  });
  const { out } = run(['approve-me']);
  assert.match(out, /summary: .*sprint=updated/);

  refreshMain();
  const sprint = git(repo, 'show', 'origin/main:docs/sprints/2026-W33-ship-it.md');
  assert.match(sprint, /status: approved/, `the annotation must be updated:\n${sprint}`);
  assert.match(sprint, /pr: #42/);
  assert.match(sprint, /branch: feature\/alpha/);
});

test('approve: a plan in no sprint is a no-op, not a failure', () => {
  makeRepo();
  const { code, out } = run(['approve-me']);
  assert.equal(code, 0);
  assert.match(out, /summary: .*sprint=none/);
});

// --- idempotence ------------------------------------------------------------

test('approve: a second run after a completed one changes nothing and fails nothing', () => {
  makeRepo();
  run(['approve-me']);
  refreshMain();
  const before = planOnMain();
  const mainSha = git(repo, 'rev-parse', 'origin/main').trim();

  const { code, out } = run(['approve-me']);
  assert.equal(code, 0, 'a repeat run must succeed');
  assert.match(out, /already merged/i);
  assert.match(out, /nothing to commit/i);

  refreshMain();
  assert.equal(planOnMain(), before, 'the plan must be byte-identical');
  assert.equal(git(repo, 'rev-parse', 'origin/main').trim(), mainSha,
    'no new commit may land on the default branch');
});

test('approve: a run interrupted between the merge and the push is repaired by re-running', () => {
  // THE CASE THE WHOLE PROPERTY EXISTS FOR. A test that only re-runs a
  // SUCCESSFUL approval passes without idempotence; this one starts from the
  // exact half-state — PR merged, plan on main still Draft — and asserts the
  // second run reaches Approved.
  makeRepo();
  setHostState({ number: 42, state: 'MERGED', draft: false });
  refreshMain();
  assert.match(planOnMain(), /- \*\*Phase:\*\* Draft/, 'precondition: the plan is stranded at Draft');

  const { code, out } = run(['approve-me']);
  assert.equal(code, 0);
  assert.match(out, /already merged/i, 'the merge must be skipped, not retried');

  refreshMain();
  const plan = planOnMain();
  assert.match(plan, /- \*\*Phase:\*\* Approved/, `the repair must complete the approval:\n${plan}`);
  assert.match(plan, /- \*\*Approved:\*\* .*#42 merged/);
});

test('approve: the already-done tests read the real sources, not a progress file', () => {
  // A progress file would disagree with the repository exactly when someone
  // intervened by hand between two runs — the case it would exist for. Here
  // the phase is flipped BY HAND on main and the record left empty; the script
  // must notice both independently.
  makeRepo();
  run(['approve-me']);

  // Undo half of it by hand, directly on main.
  const wt = path.join(tmp, 'hand');
  git(repo, 'worktree', 'add', '-q', wt, 'origin/main');
  git(wt, 'checkout', '-q', '-b', 'byhand');
  const f = path.join(wt, 'docs', 'plans', '2026-08-17-approve-me.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8')
    .replace(/- \*\*Approved:\*\* .*/, '- **Approved:**'));
  git(wt, 'add', '-A');
  git(wt, 'commit', '-qm', 'by hand: drop the record');
  git(wt, 'push', '-q', 'origin', 'byhand:main');

  const { code, out } = run(['approve-me']);
  assert.equal(code, 0);
  assert.match(out, /summary: .*phase=already/, 'the phase must be seen as done');
  assert.match(out, /summary: .*record=written/, 'the missing record must be rewritten');

  refreshMain();
  assert.match(planOnMain(), /- \*\*Approved:\*\* \d{4}-\d{2}-\d{2}/);
  // And no progress file was ever created.
  assert.equal(fs.existsSync(path.join(repo, '.plot', 'approve-state')), false);
});

// --- reporting --------------------------------------------------------------

test('approve: --dry-run merges nothing, writes nothing, pushes nothing', () => {
  makeRepo();
  const shaBefore = git(repo, 'rev-parse', 'origin/main').trim();
  const { out } = run(['--dry-run', 'approve-me']);
  assert.match(out, /would merge PR #42/);
  assert.equal(hostState().state, 'OPEN', 'a dry run must not merge');
  refreshMain();
  assert.equal(git(repo, 'rev-parse', 'origin/main').trim(), shaBefore);
  assert.equal(git(repo, 'status', '--porcelain').trim(), '');
});

test('approve: the push verdict reaches the caller verbatim', () => {
  // plot-push-main.sh exists precisely because a protected-but-unenforced repo
  // exits 0 with only a stderr notice; swallowing that turns a missing CI run
  // into a mystery. The word must survive to stdout and to the summary.
  makeRepo();
  const { out } = run(['approve-me']);
  assert.match(out, /push: (clean|bypassed|unknown)/, `the helper's own line:\n${out}`);
  assert.match(out, /summary: .*push=(clean|bypassed|unknown)/);
});

test('approve: does not touch the caller working tree or its branch', () => {
  // The booking goes through a disposable worktree: the caller's checkout may
  // carry uncommitted work, and switching it out to save a note is exactly the
  // write this script otherwise refuses.
  makeRepo();
  git(repo, 'checkout', '-q', '-b', 'feature/alpha');
  fs.writeFileSync(path.join(repo, 'scratch.txt'), 'uncommitted work\n');
  run(['approve-me']);
  assert.equal(git(repo, 'branch', '--show-current').trim(), 'feature/alpha');
  assert.equal(fs.readFileSync(path.join(repo, 'scratch.txt'), 'utf8'), 'uncommitted work\n');
  // And no leftover booking worktree or branch. (`.plot-approve-<slug>` is the
  // booking worktree's name; the sandbox's own temp dir shares the prefix
  // without the dot, so the dot is load-bearing in this pattern.)
  assert.doesNotMatch(git(repo, 'worktree', 'list'), /\.plot-approve-/);
  assert.doesNotMatch(git(repo, 'branch', '--list'), /plot\/approve-/);
});

test('approve: Impl: same branch records on the work branch and never merges the PR', () => {
  // Plan and code ride one branch; the PR merges once, at the end. Merging it
  // here would land an unfinished implementation on the default branch.
  makeRepo(PLAN({ impl: 'same branch' }));
  git(repo, 'checkout', '-q', '-b', 'feature/approve-me');
  const { code, out } = run(['approve-me']);
  assert.equal(code, 0);
  assert.equal(hostState().state, 'OPEN', 'the PR must stay open');
  assert.match(out, /summary: .*merged=skipped-same-branch/);
  const plan = fs.readFileSync(path.join(repo, 'docs', 'plans', '2026-08-17-approve-me.md'), 'utf8');
  assert.match(plan, /- \*\*Phase:\*\* Approved/);
  assert.equal(git(repo, 'branch', '--show-current').trim(), 'feature/approve-me');
});

test('approve: the phase gate lets its commit through while the plan is still Draft', () => {
  // THE STATE IT ALWAYS RUNS IN. plot-phase-gate.sh is a PreToolUse hook that
  // blocks implementation commits while the governing plan is Draft — and this
  // script commits exactly then, because rewriting the phase IS the transition.
  // A script strangled by its own repo's hook would fail in its only case, so
  // the gate is run against the commit the script actually issues.
  makeRepo();
  const gate = path.join(SCRIPTS, 'plot-phase-gate.sh');
  const runGate = (cwd) => {
    try {
      execFileSync('bash', [gate], {
        cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
        input: JSON.stringify({ tool_input: { command: 'git commit -q -m "plot: approve approve-me"' } }),
      });
      return 0;
    } catch (e) {
      return e.status;
    }
  };

  // `feature/<slug>` and not `feature/alpha`: the gate keys the plan off the
  // BRANCH's slug (plot-phase-gate.sh:131), so only a branch named for the plan
  // brings it into scope at all.
  const wt = path.join(tmp, 'gatewt');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature/approve-me', wt, 'origin/main');

  // Control: the gate MUST fire here, or the pass below proves nothing. Same
  // Draft plan, same implementation branch — the only difference is what is
  // staged.
  fs.writeFileSync(path.join(wt, 'src.txt'), 'code\n');
  git(wt, 'add', 'src.txt');
  assert.equal(runGate(wt), 2, 'control: the gate must block a code commit on a Draft plan');

  // The real case: exactly what plot-approve.sh stages — the plan file alone,
  // with the phase rewritten in the working tree but the gate still reading
  // the Draft it is transitioning away from.
  git(wt, 'reset', '-q');
  fs.rmSync(path.join(wt, 'src.txt'));
  const f = path.join(wt, 'docs', 'plans', '2026-08-17-approve-me.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('**Phase:** Draft', '**Phase:** Approved'));
  git(wt, 'add', '--', 'docs/plans/2026-08-17-approve-me.md');
  assert.equal(runGate(wt), 0,
    'the gate must let the approval commit through — rewriting the phase IS the transition');

  // And end to end: the script itself completes with the gate present.
  git(repo, 'worktree', 'remove', '--force', wt);
  const { code, out } = run(['approve-me']);
  assert.equal(code, 0);
  assert.match(out, /summary: .*phase=flipped/);
});

test('approve: nothing is written when the merge fails', () => {
  // The merge is the irreversible step; if it does not happen, neither does
  // anything else, and the plan is left exactly as it was.
  makeRepo();
  setHostState({ number: 42, state: 'OPEN', draft: false, mergeFails: true });
  const shaBefore = git(repo, 'rev-parse', 'origin/main').trim();
  const { code, err } = run(['approve-me'], { expectFail: true });
  assert.equal(code, 1);
  assert.match(err, /could not merge/i);
  refreshMain();
  assert.equal(git(repo, 'rev-parse', 'origin/main').trim(), shaBefore);
  assert.match(planOnMain(), /- \*\*Phase:\*\* Draft/);
});
