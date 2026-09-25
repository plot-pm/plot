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

// ---------------------------------------------------------------------------
// A branch's own plans (#972)
// ---------------------------------------------------------------------------
//
// A plan created with `Impl: same branch` lives ONLY on its work branch until
// that branch merges. The scan enumerated `origin/<main>` alone, so the branch
// carrying the plan reached the pulse as an anonymous row with `plan: ""` while
// `/api/board` showed the same plan as a Draft card — measured on Plot 2.20.0.
//
// ITS OWN ORIGIN, for the reason the absolute-symlink test above gives: pushing
// these branches to the shared `origin` would change the plan count every
// earlier test asserts against, and a suite whose tests depend on their order
// fails for reasons unrelated to the code it tests.

/** A repo whose default branch carries `mainPlans`, cloned and pushed. */
function makeBranchRepo(name, mainPlans = {}) {
  const bare = path.join(tmp, `${name}-origin.git`);
  const repo = path.join(tmp, name);
  git(tmp, 'init', '--bare', '-q', '-b', 'main', bare);
  git(tmp, 'clone', '-q', bare, name);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(
    path.join(repo, 'CLAUDE.md'),
    '# Sandbox\n\n## Plot Config\n\n- **Plan directory:** docs/plans/\n' +
      '- **Active index:** docs/plans/active/\n',
  );
  fs.mkdirSync(path.join(repo, 'docs', 'plans', 'active'), { recursive: true });
  for (const [file, body] of Object.entries(mainPlans)) {
    fs.writeFileSync(path.join(repo, 'docs', 'plans', file), body);
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'the default branch');
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  return repo;
}

/**
 * Commit files onto `branch`, cut from `from`, and push it.
 *
 * `from` is what makes the twin case expressible: two branches cut from the
 * SAME commit are the shape that carries one plan file twice.
 */
function pushBranch(repo, branch, files, { from = 'main' } = {}) {
  git(repo, 'checkout', '-q', from);
  git(repo, 'checkout', '-qb', branch);
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.join(repo, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), body);
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', `work on ${branch}`);
  git(repo, 'push', '-q', 'origin', branch);
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'fetch', '-q', 'origin');
}

test('a plan living only on its own branch is seen, and names its branch', () => {
  // The measured defect, in its narrowest form: the plan file reaches no ref
  // but the branch's own, and the branch it names is itself.
  const repo = makeBranchRepo('same-branch', {
    '2026-09-24-on-main.md': plan('On main', 'bug/main-work'),
  });
  pushBranch(repo, 'bug/lives-on-its-branch', {
    'docs/plans/2026-09-24-own-branch.md': plan('On its own branch', 'bug/lives-on-its-branch'),
  });

  // The precondition that makes this mean anything: the default branch does NOT
  // carry the plan. Without it the test would pass on the old enumeration.
  assert.equal(
    git(repo, 'ls-tree', '--name-only', 'origin/main', '--', 'docs/plans/').trim(),
    'docs/plans/2026-09-24-on-main.md',
    'origin/main must carry only its own plan, or this proves nothing',
  );

  const out = scanJson(repo);
  assert.equal(out.summary.plans, 2, 'the branch plan must enter the pulse');
  const own = out.plans.find((p) => p.file === '2026-09-24-own-branch.md');
  assert.ok(own, 'the plan on the branch must be named');
  // ATTRIBUTED, not merely counted: a reader that found the file but not its
  // branches would report a plan with no work under it, which is the anonymous
  // row wearing a name.
  assert.deepEqual(
    own.waves.flatMap((w) => w.branches.map((b) => b.branch)),
    ['bug/lives-on-its-branch'],
  );
});

test('two branches carrying one plan file report ONE plan', () => {
  // The regression `board.ts`'s own comment names, and the reason its `seen` set
  // exists: two branches cut from one point carry the same plan file, and a row
  // per branch would report one plan as several.
  //
  // A ONE-BRANCH FIXTURE PASSES WITH OR WITHOUT THE DEDUP, so the branches are
  // cut from the same commit and both add the same path.
  const repo = makeBranchRepo('twins', {
    '2026-09-24-anchor.md': plan('Anchor', 'bug/anchor-work'),
  });
  const shared = plan('Shared', 'bug/twin-a');
  pushBranch(repo, 'bug/twin-a', { 'docs/plans/2026-09-24-shared.md': shared });
  pushBranch(repo, 'bug/twin-b', { 'docs/plans/2026-09-24-shared.md': shared });

  // Both branches genuinely carry the path — otherwise the dedup is untested.
  for (const b of ['bug/twin-a', 'bug/twin-b']) {
    assert.match(
      git(repo, 'ls-tree', '--name-only', `origin/${b}`, '--', 'docs/plans/'),
      /2026-09-24-shared\.md/,
      `${b} must carry the shared plan`,
    );
  }

  const out = scanJson(repo);
  const shares = out.plans.filter((p) => p.file === '2026-09-24-shared.md');
  assert.equal(shares.length, 1, 'one plan file is one plan, however many branches hold it');
  assert.equal(out.summary.plans, 2, 'and the estate is the anchor plus it');
});

test('a plan on both the default branch and a branch reports once, from the default branch', () => {
  // Catches a dedup that compares branch against branch and forgets
  // `onDefault`. The branch copy is given a DIFFERENT phase so the winner is
  // identifiable: counting alone would pass whichever side won.
  const repo = makeBranchRepo('on-both', {
    '2026-09-24-contested.md': plan('Contested', 'bug/contested-work'),
  });
  pushBranch(repo, 'bug/carries-mains-plan', {
    'docs/plans/2026-09-24-contested.md': plan('Contested', 'bug/contested-work')
      .replace('**Phase:** Approved', '**Phase:** Draft'),
  });

  const out = scanJson(repo);
  const hits = out.plans.filter((p) => p.file === '2026-09-24-contested.md');
  assert.equal(hits.length, 1, 'a path on both sides is one plan');
  assert.equal(hits[0].phase, 'approved', "and it is the default branch's copy that is read");
});

test("a branch's active/ symlink is not a second plan", () => {
  // Catches a listing without the mode filter. A symlink is a mode-120000 blob
  // whose CONTENT IS ITS TARGET PATH, so parsing one hands plot-plan-meta.sh a
  // line of text — and `active/` indexes every plan, so counting links would
  // double the estate.
  const repo = makeBranchRepo('symlinked', {
    '2026-09-24-indexed.md': plan('Indexed', 'bug/indexed-work'),
  });
  // The link is added INSIDE `$PLAN_DIR` rather than under `active/`, which is
  // the sharper case: the scan lists `$PLAN_DIR`, so a link there is a path the
  // listing genuinely returns and only the mode can reject.
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'checkout', '-qb', 'bug/adds-a-link');
  fs.symlinkSync('2026-09-24-indexed.md', path.join(repo, 'docs/plans/2026-09-24-alias.md'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'a link beside the plans');
  git(repo, 'push', '-q', 'origin', 'bug/adds-a-link');
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'fetch', '-q', 'origin');

  // The link is really a 120000 blob in the branch's tree, or the filter is
  // being credited for work the fixture never asked of it.
  assert.match(
    git(repo, 'ls-tree', 'origin/bug/adds-a-link', '--', 'docs/plans/2026-09-24-alias.md'),
    /^120000 /,
    'the fixture must contain a symlink blob',
  );

  const out = scanJson(repo);
  assert.equal(out.summary.plans, 1, 'a symlink is not a plan');
  assert.deepEqual(out.plans.map((p) => p.file), ['2026-09-24-indexed.md']);
});

test('a branch with no plan anywhere still reports plan: ""', () => {
  // #973's subject and deliberately NOT this one's: a branch nothing names must
  // stay anonymous. Catches an implementation that attributes a branch to the
  // nearest plan rather than to the plan that names it.
  const repo = makeBranchRepo('unplanned', {
    '2026-09-24-named.md': plan('Named', 'bug/named-work'),
  });
  pushBranch(repo, 'bug/nothing-names-me', { 'note.txt': 'no plan here\n' });

  const out = scanJson(repo);
  assert.equal(out.summary.plans, 1, 'a branch with no plan file adds no plan');
  const named = out.plans.flatMap((p) => p.waves.flatMap((w) => w.branches.map((b) => b.branch)));
  assert.ok(
    !named.includes('bug/nothing-names-me'),
    'and must not be adopted by the plan that happens to be nearby',
  );
});

test('an unreadable branch ref contributes nothing, silently', () => {
  // A branch whose tip object is missing is the fetch that half-landed. An
  // empty set is the answer `planPathsInTree` gives, and the scan must still
  // report the rest of the estate rather than failing over one ref.
  const repo = makeBranchRepo('broken-ref', {
    '2026-09-24-survivor.md': plan('Survivor', 'bug/survivor-work'),
  });
  // A ref naming an object that does not exist — `ls-tree` on it fails, which is
  // exactly the condition the reader swallows. Written through the ref store so
  // git reports the ref and then cannot read its tree.
  const phantomDir = path.join(repo, '.git', 'refs', 'remotes', 'origin', 'bug');
  fs.mkdirSync(phantomDir, { recursive: true });
  fs.writeFileSync(
    path.join(phantomDir, 'phantom'),
    '0000000000000000000000000000000000000001\n',
  );
  const out = scanJson(repo, '--offline');
  assert.equal(out.summary.plans, 1, 'the readable estate must still be reported');
  assert.equal(out.plans[0].file, '2026-09-24-survivor.md');
});
