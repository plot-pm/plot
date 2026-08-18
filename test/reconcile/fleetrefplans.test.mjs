// Contract test for the half of plot-fleet-scan.sh that decides WHERE the plan
// list comes from: the ref it names, not the directory it stands in.
//
// The bug this holds shut was measured in a two-clone sandbox on 2026-08-18:
//
//     origin/main active plans (the REF): 3
//     working tree active plans:          2
//     scan --json reports:                2 plans
//
// The fetch SUCCEEDED — `origin/main` genuinely carried a third plan pushed by
// a second agent — and the scan still reported two, because it enumerated the
// filesystem while its banner named the ref. Nothing in the output
// distinguished that answer from a correct one, which is what made it a
// flicker on the board rather than an error anyone could see.
//
// TWO CLONES ARE LOAD-BEARING here and this is why the suite is not a
// one-repo fixture: a single clone cannot tell "read the ref" from "read the
// tree", because on one machine the two agree. The disagreement is the test.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scan = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-fleet-scan.sh');

let tmp, origin, A, B;

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}

const plan = (title, branch) => `# ${title}

## Status

- **Phase:** Approved
- **Type:** bug

## Branches

### Fixes

- \`${branch}\` — do the thing
`;

/** Write a plan and link it into the active index, the way plot lays them out. */
function addPlan(repo, name, title, branch, { absolute = false } = {}) {
  const plans = path.join(repo, 'docs', 'plans');
  fs.mkdirSync(path.join(plans, 'active'), { recursive: true });
  fs.writeFileSync(path.join(plans, name), plan(title, branch));
  // Both link shapes occur in the wild: plot writes relative links, and test
  // fixtures (and some hand-made indexes) write absolute ones. A ref-space
  // resolver has to handle both — an absolute target names no path inside a
  // repository, so only its basename can be trusted.
  fs.symlinkSync(
    absolute ? path.join(plans, name) : path.join('..', name),
    path.join(plans, 'active', name),
  );
}

function runScan(cwd, ...args) {
  return execFileSync('bash', [scan, ...args], { encoding: 'utf8', cwd });
}

function scanJson(cwd, ...args) {
  return JSON.parse(runScan(cwd, '--json', ...args));
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fleet-ref-'));
  origin = path.join(tmp, 'origin.git');
  A = path.join(tmp, 'A');
  B = path.join(tmp, 'B');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);

  git(tmp, 'clone', '-q', origin, 'A');
  git(A, 'config', 'user.email', 'test@example.invalid');
  git(A, 'config', 'user.name', 'Plot Test');
  git(A, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(
    path.join(A, 'CLAUDE.md'),
    '# Sandbox\n\n## Plot Config\n\n- **Plan directory:** docs/plans/\n' +
      '- **Active index:** docs/plans/active/\n',
  );
  addPlan(A, '2026-08-18-one.md', 'Plan one', 'bug/one-work');
  addPlan(A, '2026-08-18-two.md', 'Plan two', 'bug/two-work');
  git(A, 'add', '-A');
  git(A, 'commit', '-qm', 'plans one and two');
  git(A, 'push', '-q', '-u', 'origin', 'main');

  // The SECOND AGENT. A separate clone pushes a third plan; clone A never
  // pulls, exactly as an operator watching a board never pulls mid-run.
  git(tmp, 'clone', '-q', origin, 'B');
  git(B, 'config', 'user.email', 'test@example.invalid');
  git(B, 'config', 'user.name', 'Plot Test');
  git(B, 'config', 'commit.gpgsign', 'false');
  addPlan(B, '2026-08-18-three.md', 'Plan three', 'bug/three-work');
  git(B, 'add', '-A');
  git(B, 'commit', '-qm', 'plan three');
  git(B, 'push', '-q', 'origin', 'main');
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('a plan pushed by another clone is seen without a local pull', () => {
  // The precondition that makes this test mean anything: A's working tree does
  // NOT have the third plan. If this ever stops holding, the assertion below
  // would pass for the wrong reason.
  assert.equal(
    fs.readdirSync(path.join(A, 'docs', 'plans', 'active')).length, 2,
    "A's working tree must still hold two plans — otherwise this proves nothing",
  );

  const out = scanJson(A);
  assert.equal(out.summary.plans, 3, 'the scan must report the ref, not the tree');
  assert.deepEqual(
    out.plans.map((p) => p.file).sort(),
    ['2026-08-18-one.md', '2026-08-18-three.md', '2026-08-18-two.md'],
    'and must name the third plan specifically',
  );
});

test('the count does not depend on the working tree', () => {
  // Deleting a plan from the checkout is the sharpest form of the fleet-run
  // hazard: rebases, checkouts and worker commits rewrite the tree under a
  // running scan, and each rewrite is a moment a glob returns a different set
  // while exiting 0.
  const active = path.join(A, 'docs', 'plans', 'active', '2026-08-18-one.md');
  const file = path.join(A, 'docs', 'plans', '2026-08-18-one.md');
  fs.rmSync(active);
  fs.rmSync(file);
  try {
    const out = scanJson(A);
    assert.equal(out.summary.plans, 3, 'a tree missing a plan must not shrink the pulse');
    assert.equal(out.plan_source, 'ref');
  } finally {
    git(A, 'checkout', '-q', '--', 'docs');
  }
});

test('an absolute symlink in the index still resolves', () => {
  // `ln -s "$(pwd)/…"` stores a machine-specific absolute path in the blob,
  // and a repository contains no such path. Prefixing it with the link's own
  // directory yields a path that resolves to nothing — which is how this first
  // appeared: the plan silently left the pulse rather than erroring.
  //
  // ITS OWN ORIGIN, deliberately. Pushing this plan to the shared origin would
  // change the plan count every later test asserts against — the tests would
  // then depend on their order, which is the kind of coupling that makes a
  // suite fail for reasons unrelated to the code it tests.
  const cOrigin = path.join(tmp, 'c-origin.git');
  const C = path.join(tmp, 'C');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', cOrigin);
  git(tmp, 'clone', '-q', cOrigin, 'C');
  git(C, 'config', 'user.email', 'test@example.invalid');
  git(C, 'config', 'user.name', 'Plot Test');
  git(C, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(
    path.join(C, 'CLAUDE.md'),
    '# Sandbox\n\n## Plot Config\n\n- **Plan directory:** docs/plans/\n' +
      '- **Active index:** docs/plans/active/\n',
  );
  addPlan(C, '2026-08-18-four.md', 'Plan four', 'bug/four-work', { absolute: true });
  git(C, 'add', '-A');
  git(C, 'commit', '-qm', 'plan four, absolute link');
  git(C, 'push', '-q', '-u', 'origin', 'main');

  const out = scanJson(C);
  assert.ok(
    out.plans.some((p) => p.file === '2026-08-18-four.md'),
    'a plan linked by absolute path must still appear',
  );
  // Resolved to the plan's CONTENT, not merely counted: a resolver that found
  // the link but not its target would report a plan with no branches.
  const four = out.plans.find((p) => p.file === '2026-08-18-four.md');
  assert.deepEqual(
    four.waves.flatMap((w) => w.branches.map((b) => b.branch)),
    ['bug/four-work'],
  );
});

test('a failed fetch is reported rather than swallowed', () => {
  // The old line was `git fetch ... 2>/dev/null` with its status discarded, so
  // a 503, a held ref lock or an offline laptop produced a scan
  // indistinguishable from a healthy one. The refs were older than the banner
  // claimed and nothing said so.
  const D = path.join(tmp, 'D');
  git(tmp, 'clone', '-q', origin, 'D');
  git(D, 'remote', 'set-url', 'origin', path.join(tmp, 'nonexistent.git'));

  const out = scanJson(D);
  assert.equal(out.fetch_failed, true, 'the failure must travel in --json');
  assert.match(out.fetch_error, /\S/, 'and must carry git’s own words');

  // STILL REPORTS. Refusing to answer would trade a slightly stale board for
  // no board at all, precisely when something is going wrong — the fix is to
  // carry the staleness, not to withhold the pulse.
  assert.equal(out.summary.plans, 3, 'a failed fetch must not empty the pulse');

  const prose = runScan(D);
  assert.match(prose, /note: git fetch failed/, 'a human must be told too');
});

test('--offline is not a failure', () => {
  // The operator asked for local refs and got them. Reporting that as a failed
  // fetch would cry wolf on the one mode that is working exactly as asked.
  const out = scanJson(A, '--offline');
  assert.equal(out.fetch_failed, false);
  assert.equal(out.summary.plans, 3);
});

test('an unreadable ref falls back to the tree and says so', () => {
  // A fresh repo with no remote can only answer from its checkout. Falling
  // back is honest; falling back SILENTLY would recreate the original bug in
  // the one case where the operator has no way to check it.
  const solo = path.join(tmp, 'solo');
  fs.mkdirSync(solo);
  git(solo, 'init', '-q', '-b', 'main');
  git(solo, 'config', 'user.email', 'test@example.invalid');
  git(solo, 'config', 'user.name', 'Plot Test');
  git(solo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(
    path.join(solo, 'CLAUDE.md'),
    '# Sandbox\n\n## Plot Config\n\n- **Plan directory:** docs/plans/\n' +
      '- **Active index:** docs/plans/active/\n',
  );
  addPlan(solo, '2026-08-18-solo.md', 'Plan solo', 'bug/solo-work');
  git(solo, 'add', '-A');
  git(solo, 'commit', '-qm', 'solo plan');

  const out = scanJson(solo);
  assert.equal(out.plan_source, 'worktree', 'the fallback must be declared');
  assert.equal(out.summary.plans, 1, 'and must still answer from the checkout');
  assert.match(runScan(solo), /could not be read/, 'a human must be told too');
});

test('an uncommitted plan is invisible — the fleet view shows what is shared', () => {
  // The behaviour change this plan's Open Points asked to be stated. A plan
  // only this machine has cannot be claimed by any worker (they are detached
  // agents in other worktrees and on other machines), so advertising it would
  // offer work nobody can take. `/plot-idea` commits and pushes in one flow,
  // so the window this closes is seconds wide.
  addPlan(A, '2026-08-18-draft.md', 'Plan draft', 'bug/draft-work');
  try {
    const out = scanJson(A);
    assert.equal(out.summary.plans, 3, 'an uncommitted plan must not enter the pulse');
    assert.ok(!out.plans.some((p) => p.file === '2026-08-18-draft.md'));
  } finally {
    fs.rmSync(path.join(A, 'docs', 'plans', '2026-08-18-draft.md'), { force: true });
    fs.rmSync(path.join(A, 'docs', 'plans', 'active', '2026-08-18-draft.md'), { force: true });
  }
});

test('the scan leaves no temp directory behind', () => {
  // The materialized blobs live in a temp dir removed by an EXIT trap. An
  // early version created it inside `$(ref_plan_file …)` — a SUBSHELL — so the
  // parent's variable stayed empty and the trap cleaned nothing: one leaked
  // directory per plan, per 5 s board poll.
  //
  // A PRIVATE TMPDIR, because the obvious version of this test is flaky: the
  // scan honours `$TMPDIR`, `node --test` runs files CONCURRENTLY, and a
  // sibling suite's scan creates and removes its own `plot-fleet-ref.*` in the
  // shared directory while this one is counting. Measured here — it passed
  // alone and failed in the full suite, naming directories no assertion in
  // this file created. Pointing the scan at a directory nothing else writes
  // measures what this test actually controls.
  const priv = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fleet-tmphome-'));
  try {
    execFileSync('bash', [scan, '--json'], {
      encoding: 'utf8', cwd: A, env: { ...process.env, TMPDIR: priv },
    });
    assert.deepEqual(
      fs.readdirSync(priv).filter((f) => f.startsWith('plot-fleet-ref.')), [],
      'the scan must clean up after itself',
    );
  } finally {
    fs.rmSync(priv, { recursive: true, force: true });
  }
});
