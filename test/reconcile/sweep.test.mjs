// Contract tests for the three kinds of leftover the sweep learned on
// 2026-09-03: local branches, orphaned claim refs, and dirty trees nobody owns.
//
// WHAT THIS FILE IS ABOUT. Measured 2026-09-02 on plot's own estate:
//
//   leftover                  swept by      measured
//   worktrees                 plot-reap.sh  19 reaped by hand
//   remote refs               plot-release-refs.sh, plan-scoped
//   LOCAL BRANCHES            nothing       85 of 98 already merged
//   ORPHANED CLAIM REFS       nothing       a claim whose agent never existed
//   DIRTY TREES NOBODY OWNS   refused, never resolved   2 desks, 52 and 1 files
//
// THE ONE THAT MATTERS MOST IS THE SQUASH CASE. `git branch -d` refuses an
// unmerged branch, which sounds like the safety this needs — except a
// squash-merge rewrites the commits and leaves the branch permanently ahead of
// main, so `-d` would have refused all 85 for the wrong reason. The gate is the
// reaper's two measurements instead: the host says merged, AND no worktree
// holds it. `assert` below fails if the gate ever regresses to ancestry or to
// the PR's `state`.
//
// WHY THIS FILE STUBS `gh`. The same reason `reap-merged-pr.test.mjs` does:
// the squash path is reached ONLY when ancestry finds nothing, so a hermetic
// test cannot exercise the line these cases are about. The stub is a real
// executable on PATH, not a shell function, because `pr_merged` gates on
// `command -v gh` before calling it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const reap = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-reap.sh');

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}

const ctx = [];
after(() => { for (const t of ctx) fs.rmSync(t, { recursive: true, force: true }); });

function makeRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-sweep-'));
  ctx.push(tmp);
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(repo, 'docs', 'plans', 'active'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'CLAUDE.md'),
    '# Repo\n\n## Plot Config\n\n- **Active index:** docs/plans/active/\n',
  );
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'fetch', '-q', 'origin');
  return { tmp, repo };
}

/**
 * A local branch carrying a commit that is NOT an ancestor of main — the
 * squash-merge shape, and the only shape whose merge state the host alone can
 * answer. No worktree is created: this is the population no script looks at.
 */
function squashedBranch(repo, branch) {
  git(repo, 'checkout', '-q', '-b', branch);
  fs.writeFileSync(path.join(repo, `${branch.replace(/\//g, '-')}.txt`), branch);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', `work on ${branch}`);
  git(repo, 'checkout', '-q', 'main');
}

/** A branch carrying nothing but an empty `plot: claim` marker. */
function claimBranch(repo, branch) {
  git(repo, 'checkout', '-q', '-b', branch);
  git(repo, 'commit', '-q', '--allow-empty', '-m', `plot: claim ${branch}`);
  git(repo, 'checkout', '-q', 'main');
}

/** A plan naming a branch, with or without the deferred annotation. */
function plan(repo, slug, branch, { deferred = false } = {}) {
  const annotation = deferred ? ' <!-- deferred: superseded -->' : '';
  fs.writeFileSync(
    path.join(repo, 'docs', 'plans', 'active', `${slug}.md`),
    `# ${slug}\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n- \`${branch}\` — the work${annotation}\n`,
  );
}

function stubGh(tmp, prs) {
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const gh = path.join(bin, 'gh');
  fs.writeFileSync(gh, `#!/usr/bin/env node
const argv = process.argv.slice(2);
if (argv[0] !== 'pr' || argv[1] !== 'list') { process.exit(1); }
const table = ${JSON.stringify(prs)};
const head = argv[argv.indexOf('--head') + 1];
const state = argv[argv.indexOf('--state') + 1];
let all = table[head] || [];
if (state === 'open') { all = all.filter((p) => p.mergedAt === null && p.open); }
process.stdout.write(JSON.stringify(all));
`);
  fs.chmodSync(gh, 0o755);
  return bin;
}

/** A `gh` that is on PATH and always fails — an unreachable host. */
function brokenGh(tmp) {
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const gh = path.join(bin, 'gh');
  fs.writeFileSync(gh, '#!/bin/sh\nexit 1\n');
  fs.chmodSync(gh, 0o755);
  return bin;
}

function run(repo, bin, ...args) {
  return execFileSync('bash', [reap, ...args], {
    encoding: 'utf8',
    cwd: repo,
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
  });
}

/** The line of the report naming a branch, or ''. */
function lineFor(out, branch) {
  return out.split('\n').find((l) => l.includes(` ${branch} `) || l.includes(` ${branch}`)) ?? '';
}

/** Whether the local ref still exists. */
function hasBranch(repo, branch) {
  try {
    git(repo, 'show-ref', '-q', '--verify', `refs/heads/${branch}`);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Kind 2: local branches
// ---------------------------------------------------------------------------

test('a squash-merged local branch no worktree holds is deleted', () => {
  // THE MEASURED POPULATION: 85 of 98. The branch is ahead of main forever,
  // so ancestry says nothing and `git branch -d` would refuse it. The host is
  // the authority.
  const { tmp, repo } = makeRepo();
  const branch = 'feature/squash-landed';
  squashedBranch(repo, branch);
  const bin = stubGh(tmp, { [branch]: [{ mergedAt: '2026-09-01T10:00:00Z', number: 500 }] });

  const dry = run(repo, bin, '--dry-run');
  assert.match(lineFor(dry, branch), /^would/, `a merged branch must be swept:\n${dry}`);
  assert.ok(hasBranch(repo, branch), 'a dry run must delete nothing');

  run(repo, bin, '--yes');
  assert.ok(!hasBranch(repo, branch), 'under --yes the local ref is actually deleted');
});

test('the gate is not ancestry and not `git branch -d`', () => {
  // Pins the CAUSE rather than the symptom. The branch is unmerged by ancestry
  // and `git branch -d` refuses it; only reading `mergedAt` off the host can
  // clear it. If a future edit swaps `-D` for `-d`, or gates on
  // `git merge-base --is-ancestor` alone, this fails and the test above does
  // not necessarily.
  const { tmp, repo } = makeRepo();
  const branch = 'feature/ahead-of-main-forever';
  squashedBranch(repo, branch);

  // git itself refuses: proof the shape is the squash shape.
  assert.throws(() => git(repo, 'branch', '-d', branch), /not fully merged/i);

  const bin = stubGh(tmp, { [branch]: [{ mergedAt: '2026-09-01T10:00:00Z', number: 501 }] });
  run(repo, bin, '--yes');
  assert.ok(!hasBranch(repo, branch), 'the host says merged, so the branch goes');
});

test('the gate reads the merge, never the PR state — a merged PR reports CLOSED', () => {
  // The same lesson `pr_merged` records, asserted from the sweep's side. The
  // PR carries `state: CLOSED` and a real `mergedAt`; a gate reading `state`
  // would keep every squash-merged branch on the estate.
  const { tmp, repo } = makeRepo();
  const branch = 'feature/closed-but-merged';
  squashedBranch(repo, branch);
  const bin = stubGh(tmp, {
    [branch]: [{ mergedAt: '2026-09-01T10:00:00Z', number: 502, state: 'CLOSED' }],
  });

  run(repo, bin, '--yes');
  assert.ok(!hasBranch(repo, branch), 'a CLOSED PR with a mergedAt is a merge');
});

test('a local branch with no merged PR survives --yes', () => {
  // The assertion that makes the sweep safe: genuinely unlanded work. A
  // careless fix that deletes every local branch would still pass the tests
  // above.
  const { tmp, repo } = makeRepo();
  const branch = 'feature/genuinely-unlanded';
  squashedBranch(repo, branch);
  const bin = stubGh(tmp, { [branch]: [{ mergedAt: null, number: 503, open: true }] });

  const dry = run(repo, bin, '--dry-run');
  assert.match(lineFor(dry, branch), /^keep/, `an unmerged branch must be kept:\n${dry}`);
  assert.match(lineFor(dry, branch), /no merged PR/);

  run(repo, bin, '--yes');
  assert.ok(hasBranch(repo, branch), 'under --yes an unlanded branch must SURVIVE');
});

test('an unreachable host deletes nothing', () => {
  // Silence is never permission. `gh` is on PATH and fails, which is the shape
  // an unauthed CLI and a network outage both take.
  const { tmp, repo } = makeRepo();
  const branch = 'feature/host-cannot-be-asked';
  squashedBranch(repo, branch);
  const bin = brokenGh(tmp);

  const dry = run(repo, bin, '--dry-run');
  assert.match(lineFor(dry, branch), /^keep/, `an unreachable host must keep:\n${dry}`);

  run(repo, bin, '--yes');
  assert.ok(hasBranch(repo, branch), 'an unreachable host deletes nothing, even under --yes');
});

test('a merged branch a worktree holds is kept', () => {
  // The second half of the gate, and it refuses on its own. Deleting a branch
  // out from under a checkout is exactly what the reaper's guards exist to
  // prevent.
  const { tmp, repo } = makeRepo();
  const branch = 'feature/somebody-is-reading-it';
  squashedBranch(repo, branch);
  const wt = path.join(tmp, 'held');
  git(repo, 'worktree', 'add', '-q', wt, branch);
  const bin = stubGh(tmp, { [branch]: [{ mergedAt: '2026-09-01T10:00:00Z', number: 504 }] });

  const dry = run(repo, bin, '--dry-run');
  assert.match(lineFor(dry, branch), /checked out in a worktree/, `held branch must be kept:\n${dry}`);

  run(repo, bin, '--yes');
  assert.ok(hasBranch(repo, branch), 'a held branch survives --yes');
});

test('the default branch is never deleted', () => {
  const { tmp, repo } = makeRepo();
  const bin = stubGh(tmp, { main: [{ mergedAt: '2026-09-01T10:00:00Z', number: 505 }] });
  run(repo, bin, '--yes');
  assert.ok(hasBranch(repo, 'main'), 'main survives whatever the host says about it');
});

test('--max bounds the branch sweep', () => {
  const { tmp, repo } = makeRepo();
  const branches = ['feature/one', 'feature/two', 'feature/three'];
  const prs = {};
  branches.forEach((b, i) => {
    squashedBranch(repo, b);
    prs[b] = [{ mergedAt: '2026-09-01T10:00:00Z', number: 600 + i }];
  });
  const bin = stubGh(tmp, prs);

  const out = run(repo, bin, '--yes', '--max', '2');
  const alive = branches.filter((b) => hasBranch(repo, b));
  assert.equal(alive.length, 1, `--max 2 must leave one branch:\n${out}`);
  assert.match(out, /--max 2 reached/);
});

// ---------------------------------------------------------------------------
// Kind 3: orphaned claim refs
// ---------------------------------------------------------------------------

test('an abandoned claim ref is swept', () => {
  // The scan already classifies it: a `deferred:`/`moved:` annotation in the
  // plan means reapable. The sweep acts on exactly that classification and
  // derives no second one.
  const { tmp, repo } = makeRepo();
  const branch = 'feature/claim-given-up';
  claimBranch(repo, branch);
  plan(repo, 'a-plan', branch, { deferred: true });
  const bin = stubGh(tmp, {});

  const dry = run(repo, bin, '--dry-run');
  assert.match(dry, /abandoned claim/, `an abandoned claim must be named:\n${dry}`);
  assert.ok(hasBranch(repo, branch), 'a dry run deletes nothing');

  run(repo, bin, '--yes');
  assert.ok(!hasBranch(repo, branch), 'under --yes the claim ref goes');
});

test('a bare `claimed:` is reported and left for a person', () => {
  // A slow worker and a dead one leave the identical empty branch, and one of
  // them is doing real work. Only what the scan calls reapable is swept.
  const { tmp, repo } = makeRepo();
  const branch = 'feature/claim-unresolved';
  claimBranch(repo, branch);
  plan(repo, 'a-plan', branch);
  const bin = stubGh(tmp, {});

  const dry = run(repo, bin, '--dry-run');
  assert.match(dry, /needs judgment/, `a bare claim must be reported:\n${dry}`);

  run(repo, bin, '--yes');
  assert.ok(hasBranch(repo, branch), 'a bare claim survives --yes — it is a person\'s call');
});

test('a real commit titled like a claim marker is not swept', () => {
  // The subject alone is not evidence. A human commit titled
  // "plot: claim handling refactor" carrying real files would otherwise read
  // as an empty claim and the sweep would delete real work.
  const { tmp, repo } = makeRepo();
  const branch = 'feature/claim-shaped-subject';
  git(repo, 'checkout', '-q', '-b', branch);
  fs.writeFileSync(path.join(repo, 'real.txt'), 'real work');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plot: claim handling refactor');
  git(repo, 'checkout', '-q', 'main');
  plan(repo, 'a-plan', branch, { deferred: true });
  const bin = stubGh(tmp, {});

  run(repo, bin, '--yes');
  assert.ok(hasBranch(repo, branch), 'a branch carrying files is not an empty claim');
});

// ---------------------------------------------------------------------------
// Kind 4: dirty trees nobody owns
// ---------------------------------------------------------------------------

test('a dirty tree nobody owns is named, and nothing is deleted from it', () => {
  // The population that was refused every run and never resolved. What this
  // adds is the NAME — the owner is `nobody` — because nothing ever said whose
  // the tree was.
  const { tmp, repo } = makeRepo();
  const branch = 'feature/dirty-desk';
  squashedBranch(repo, branch);
  const wt = path.join(tmp, 'dirty');
  git(repo, 'worktree', 'add', '-q', wt, branch);
  fs.writeFileSync(path.join(wt, 'half-done.txt'), 'work in progress');
  const bin = stubGh(tmp, {});

  const out = run(repo, bin, '--yes');
  assert.match(out, /LEFTOVER/, `an unowned dirty tree must be named:\n${out}`);
  assert.match(out, /owner: nobody/, 'and its owner must be named as nobody');
  assert.match(out, /dirty_trees=1/, 'and counted in the footer');

  assert.ok(fs.existsSync(path.join(wt, 'half-done.txt')),
    'under --yes NOTHING is deleted from a dirty tree — where the guard is wrong, destruction cannot be undone');
  assert.ok(fs.existsSync(wt), 'and the tree itself stays');
});

test('a dirty tree a live worker owns is not a leftover', () => {
  // A tree somebody is sitting at is a desk and its dirt is work in progress.
  // The pid is this process, which is by construction alive.
  const { tmp, repo } = makeRepo();
  const branch = 'feature/occupied-desk';
  squashedBranch(repo, branch);
  const wt = path.join(tmp, 'occupied');
  git(repo, 'worktree', 'add', '-q', wt, branch);
  fs.writeFileSync(path.join(wt, 'half-done.txt'), 'work in progress');
  fs.writeFileSync(path.join(wt, '.plot-worker.pid'), String(process.pid));
  const bin = stubGh(tmp, {});

  const out = run(repo, bin, '--dry-run');
  assert.match(out, /dirty_trees=0/, `a live worker owns its dirt:\n${out}`);
});

test('the main checkout is a person\'s desk, not a leftover', () => {
  // MEASURED WHILE WRITING THE SWEEP: the operator's own checkout carried 2
  // uncommitted files and no `.plot-worker.pid`, so it read as a tree nobody
  // owns — and it is the one tree on the estate somebody is certainly at.
  // `$ROOT` cannot be the test, because the script runs from whichever
  // worktree invoked it; the main checkout is the parent of `--git-common-dir`.
  const { tmp, repo } = makeRepo();
  fs.writeFileSync(path.join(repo, 'a-person-is-editing-this.txt'), 'work in progress');
  const bin = stubGh(tmp, {});

  const out = run(repo, bin, '--yes');
  assert.match(out, /dirty_trees=0/, `the main checkout is never a leftover:\n${out}`);
  assert.ok(fs.existsSync(path.join(repo, 'a-person-is-editing-this.txt')),
    'and its work is untouched');
});

test('a clean tree is not reported as a dirty leftover', () => {
  // The kind is "a dirty tree nobody owns". A clean unowned tree is the
  // reaper's question, and answering it here would be a second implementation
  // of it.
  const { tmp, repo } = makeRepo();
  const branch = 'feature/clean-desk';
  squashedBranch(repo, branch);
  const wt = path.join(tmp, 'clean');
  git(repo, 'worktree', 'add', '-q', wt, branch);
  const bin = stubGh(tmp, {});

  const out = run(repo, bin, '--dry-run');
  assert.match(out, /dirty_trees=0/, `a clean tree is not this kind:\n${out}`);
});

// ---------------------------------------------------------------------------
// The reaper's own five refusals are untouched
// ---------------------------------------------------------------------------

test('the five worktree refusals still refuse, with the new kinds present', () => {
  // The brief's condition: the reaper's five refusals are unchanged in both
  // the shell and the domain rule. A dispatch tree with uncommitted changes is
  // kept for `uncommitted-changes` and not swallowed by the dirty-tree kind,
  // which reports and never removes.
  const { tmp, repo } = makeRepo();
  const branch = 'feature/refusal-still-holds';
  squashedBranch(repo, branch);
  const wt = path.join(path.dirname(repo), 'plot-wt-' + branch.replace(/\//g, '-'));
  git(repo, 'worktree', 'add', '-q', wt, branch);
  fs.writeFileSync(path.join(wt, 'uncommitted.txt'), 'exists nowhere else');
  const bin = stubGh(tmp, { [branch]: [{ mergedAt: '2026-09-01T10:00:00Z', number: 700 }] });

  const out = run(repo, bin, '--yes');
  assert.match(out, /uncommitted/, `the refusal must still name itself:\n${out}`);
  assert.ok(fs.existsSync(wt), 'a dirty dispatch tree survives --yes');
  assert.ok(fs.existsSync(path.join(wt, 'uncommitted.txt')), 'and keeps its work');
});
