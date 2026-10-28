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

/** How many squashed branches this file has cut; makes each one's content unique. */
let squashedCount = 0;

/**
 * A local branch carrying a commit that is NOT an ancestor of main — the
 * squash-merge shape, and the only shape whose merge state the host alone can
 * answer. No worktree is created: this is the population no script looks at.
 *
 * Each call writes distinct content. The same branch cut twice from the same
 * parent with the same content and message gets the same SHA when both commits
 * land in one second.
 */
const squashedBranch = (repo, branch) => {
  squashedCount += 1;
  git(repo, 'checkout', '-q', '-b', branch);
  fs.writeFileSync(path.join(repo, `${branch.replace(/\//g, '-')}.txt`), `${branch}\n${squashedCount}\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', `work on ${branch}`);
  git(repo, 'checkout', '-q', 'main');
};

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

/** The sha a pinned ref for `branch` resolves to, or null when none exists. */
function pinnedSha(repo, branch) {
  try {
    const refs = git(repo, 'for-each-ref', `refs/plot/reaped/${branch}/`, '--format=%(objectname) %(refname)')
      .trim()
      .split('\n')
      .filter(Boolean);
    if (refs.length === 0) return null;
    return refs[0].split(' ')[0];
  } catch {
    return null;
  }
}

/** Every pinned ref for `branch`, across every sha it has been reaped at. */
function pinnedRefs(repo, branch) {
  try {
    return git(repo, 'for-each-ref', `refs/plot/reaped/${branch}/`, '--format=%(refname)')
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Drops every reflog entry and runs a real gc, the survival bar a pin must clear. */
function gcHard(repo) {
  git(repo, 'reflog', 'expire', '--expire=now', '--all');
  git(repo, 'gc', '--prune=now', '-q');
}

/** Reads the TSV row's `at` timestamp for a ref, backdating it by `ageMs`. */
function backdatePin(repo, ref, ageMs) {
  const common = git(repo, 'rev-parse', '--git-common-dir').trim();
  const tsvPath = path.join(path.isAbsolute(common) ? common : path.join(repo, common), '.plot', 'state', 'reaped.tsv');
  const rows = fs.readFileSync(tsvPath, 'utf8').split('\n').filter(Boolean);
  const at = new Date(Date.now() - ageMs).toISOString();
  const rewritten = rows.map((line) => {
    const [r, sha] = line.split('\t');
    return r === ref ? `${r}\t${sha}\t${at}` : line;
  });
  fs.writeFileSync(tsvPath, `${rewritten.join('\n')}\n`);
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
  const tip = git(repo, 'rev-parse', branch).trim();
  const bin = stubGh(tmp, { [branch]: [{ mergedAt: '2026-09-01T10:00:00Z', number: 500 }] });

  const dry = run(repo, bin, '--dry-run');
  assert.match(lineFor(dry, branch), /^would/, `a merged branch must be swept:\n${dry}`);
  assert.ok(hasBranch(repo, branch), 'a dry run must delete nothing');

  const out = run(repo, bin, '--yes');
  assert.ok(!hasBranch(repo, branch), 'under --yes the local ref is actually deleted');
  assert.equal(pinnedSha(repo, branch), tip, 'the deleted tip is pinned under refs/plot/reaped');
  assert.match(out, new RegExp(`restore: git branch ${branch.replace(/\//g, '\\/')} refs/plot/reaped/${branch}/${tip}`),
    `the deleted row must print its restore command:\n${out}`);

  gcHard(repo);
  assert.equal(git(repo, 'cat-file', '-t', pinnedRefs(repo, branch)[0]).trim(), 'commit',
    'the pin must survive reflog expiry and a real gc');
  git(repo, 'branch', branch, pinnedRefs(repo, branch)[0]);
  assert.equal(git(repo, 'rev-parse', branch).trim(), tip, 'the restore command recreates the branch at the exact tip');
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

test('a branch with a commit after the merged PR head survives --yes', () => {
  // THE DEFECT SLICE 3 FIXES. The host says a PR for this branch merged, but a
  // commit was added to the local branch AFTER that PR's head — exactly the
  // shape the worktree kind's `unpushedCommits`/`unpushedPatches` guard refuses
  // for a checked-out branch. The branch kind must refuse it too, with no
  // worktree in the picture at all.
  const { tmp, repo } = makeRepo();
  const branch = 'feature/commits-after-the-merge';
  squashedBranch(repo, branch);
  const mergedHead = git(repo, 'rev-parse', branch).trim();

  // A commit made after the PR's head merged — never pushed, never reviewed.
  git(repo, 'checkout', '-q', branch);
  fs.writeFileSync(path.join(repo, 'after-the-merge.txt'), 'added after the PR merged\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'one more commit, after the PR merged');
  git(repo, 'checkout', '-q', 'main');

  const bin = stubGh(tmp, {
    [branch]: [{ mergedAt: '2026-09-01T10:00:00Z', number: 506, headRefOid: mergedHead }],
  });

  const dry = run(repo, bin, '--dry-run');
  assert.match(lineFor(dry, branch), /^keep/, `a tip past the merged head must be kept:\n${dry}`);
  assert.match(lineFor(dry, branch), /commits past the merged PR head/);

  run(repo, bin, '--yes');
  assert.ok(hasBranch(repo, branch), 'the local ref must survive --yes');
  assert.equal(git(repo, 'rev-parse', branch).trim(),
    git(repo, 'log', '-1', '--format=%H', branch).trim(),
    'nothing deleted the branch, so its tip is unchanged');
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

test('`feature` and `feature/x` are both pinned, with no ref clash', () => {
  // The brief's accepted edge case is a DIFFERENT clash — a branch whose leaf
  // is itself a sha matching another's leaf. A plain name/namespace pair like
  // this one must pin cleanly: refs/plot/reaped/feature/<sha> and
  // refs/plot/reaped/feature/x/<sha> are siblings, not a collision.
  //
  // Git's loose-ref storage cannot hold refs/heads/feature and
  // refs/heads/feature/x at once (one is a file where the other needs a
  // directory), so the two branches are reaped one at a time rather than
  // created together.
  const { tmp, repo } = makeRepo();
  squashedBranch(repo, 'feature');
  const tipA = git(repo, 'rev-parse', 'feature').trim();
  const binA = stubGh(tmp, { feature: [{ mergedAt: '2026-09-01T10:00:00Z', number: 700 }] });
  run(repo, binA, '--yes');
  assert.ok(!hasBranch(repo, 'feature'), 'feature is deleted');

  squashedBranch(repo, 'feature/x');
  const tipB = git(repo, 'rev-parse', 'feature/x').trim();
  const binB = stubGh(tmp, { 'feature/x': [{ mergedAt: '2026-09-01T10:00:00Z', number: 701 }] });
  run(repo, binB, '--yes');
  assert.ok(!hasBranch(repo, 'feature/x'), 'feature/x is deleted');

  assert.equal(pinnedSha(repo, 'feature'), tipA, 'feature is pinned at its own tip');
  assert.equal(pinnedSha(repo, 'feature/x'), tipB, 'feature/x is pinned at its own tip');
});

test('the same branch reaped twice at two different tips keeps two pins', () => {
  // A LOG, NOT A SET: a branch recreated and reaped again must not overwrite
  // the first pin — both tips stay recoverable.
  const { tmp, repo } = makeRepo();
  const branch = 'feature/reaped-twice';
  squashedBranch(repo, branch);
  const firstTip = git(repo, 'rev-parse', branch).trim();
  const bin = stubGh(tmp, { [branch]: [{ mergedAt: '2026-09-01T10:00:00Z', number: 702 }] });
  run(repo, bin, '--yes');
  assert.ok(!hasBranch(repo, branch));

  squashedBranch(repo, branch);
  const secondTip = git(repo, 'rev-parse', branch).trim();
  assert.notEqual(firstTip, secondTip, 'the second pass must be a genuinely different tip');
  run(repo, bin, '--yes');
  assert.ok(!hasBranch(repo, branch));

  const refs = pinnedRefs(repo, branch);
  assert.equal(refs.length, 2, `both tips must stay pinned:\n${refs.join('\n')}`);
  assert.ok(refs.includes(`refs/plot/reaped/${branch}/${firstTip}`));
  assert.ok(refs.includes(`refs/plot/reaped/${branch}/${secondTip}`));
});

test('a 31-day-old pinned ref and row are pruned on the next --yes run', () => {
  const { tmp, repo } = makeRepo();
  const branch = 'feature/pin-aged-out';
  squashedBranch(repo, branch);
  const bin = stubGh(tmp, { [branch]: [{ mergedAt: '2026-09-01T10:00:00Z', number: 703 }] });

  run(repo, bin, '--yes');
  const ref = pinnedRefs(repo, branch)[0];
  backdatePin(repo, ref, 31 * 24 * 60 * 60 * 1000);

  // A second, unrelated branch so the run has pruning work to do beyond the
  // aged pin itself.
  squashedBranch(repo, 'feature/unrelated');
  const bin2 = stubGh(tmp, { 'feature/unrelated': [{ mergedAt: '2026-09-01T10:00:00Z', number: 704 }] });
  run(repo, bin2, '--yes');

  assert.throws(() => git(repo, 'rev-parse', '--verify', ref), 'a 31-day-old pin must be pruned');
});

test('a 29-day-old pinned ref and row survive the prune', () => {
  const { tmp, repo } = makeRepo();
  const branch = 'feature/pin-still-young';
  squashedBranch(repo, branch);
  const bin = stubGh(tmp, { [branch]: [{ mergedAt: '2026-09-01T10:00:00Z', number: 705 }] });

  run(repo, bin, '--yes');
  const ref = pinnedRefs(repo, branch)[0];
  backdatePin(repo, ref, 29 * 24 * 60 * 60 * 1000);

  squashedBranch(repo, 'feature/unrelated2');
  const bin2 = stubGh(tmp, { 'feature/unrelated2': [{ mergedAt: '2026-09-01T10:00:00Z', number: 706 }] });
  run(repo, bin2, '--yes');

  assert.doesNotThrow(() => git(repo, 'rev-parse', '--verify', ref), 'a 29-day-old pin must survive');
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
  const tip = git(repo, 'rev-parse', branch).trim();
  plan(repo, 'a-plan', branch, { deferred: true });
  const bin = stubGh(tmp, {});

  const dry = run(repo, bin, '--dry-run');
  assert.match(dry, /abandoned claim/, `an abandoned claim must be named:\n${dry}`);
  assert.ok(hasBranch(repo, branch), 'a dry run deletes nothing');

  const out = run(repo, bin, '--yes');
  assert.ok(!hasBranch(repo, branch), 'under --yes the claim ref goes');
  assert.equal(pinnedSha(repo, branch), tip, 'the abandoned claim\'s tip is pinned before its delete');
  assert.match(out, new RegExp(`restore: git branch ${branch.replace(/\//g, '\\/')} refs/plot/reaped/${branch}/${tip}`),
    `the deleted claim row must print its restore command:\n${out}`);
});

test('a claim-only branch is kept by the branch kind and decided by the claim kind', () => {
  // Case 1 of the branch/claim cooperation rule (slice 3): every commit past
  // the default branch is an empty claim marker. The branch kind must not
  // decide this branch at all — it keeps it and names the claim kind as the
  // decider — and the claim kind's own section still carries its row.
  const { tmp, repo } = makeRepo();
  const branch = 'feature/claim-only-and-deferred';
  claimBranch(repo, branch);
  plan(repo, 'a-plan', branch, { deferred: true });
  const bin = stubGh(tmp, {});

  const dry = run(repo, bin, '--dry-run');
  const branchSection = dry.slice(dry.indexOf('-- local branches --'), dry.indexOf('-- orphaned claim refs --'));
  const claimSection = dry.slice(dry.indexOf('-- orphaned claim refs --'));

  const branchRows = branchSection.split('\n').filter((l) => l.includes(` ${branch} `) || l.includes(` ${branch}`));
  assert.equal(branchRows.length, 1, `exactly one branch-kind row for ${branch}:\n${branchSection}`);
  assert.match(branchRows[0], /^keep.*an empty claim; the claim kind decides/, branchRows[0]);

  const claimRows = claimSection.split('\n').filter((l) => l.includes(` ${branch} `) || l.includes(` ${branch}`));
  assert.equal(claimRows.length, 1, `exactly one claim-kind row for ${branch}:\n${claimSection}`);
});

test('a contained branch with no commits of its own is kept by both kinds', () => {
  // Case 2 of the cooperation rule: a branch at an ancestor of the default
  // branch (never diverged) is contained by ancestry but carries no commit of
  // its own. The branch kind keeps it after slice 3; `isWhollyEmptyClaim`
  // answers false on the empty range, so the claim kind skips it too — the
  // branch stays for a person, decided by neither kind.
  const { tmp, repo } = makeRepo();
  const branch = 'feature/never-diverged';
  git(repo, 'branch', branch, 'main');
  const bin = stubGh(tmp, { [branch]: [{ mergedAt: null, number: 507, open: true }] });

  const dry = run(repo, bin, '--dry-run');
  const branchSection = dry.slice(dry.indexOf('-- local branches --'), dry.indexOf('-- orphaned claim refs --'));
  const claimSection = dry.slice(dry.indexOf('-- orphaned claim refs --'));

  const branchRows = branchSection.split('\n').filter((l) => l.includes(` ${branch} `) || l.includes(` ${branch}`));
  assert.equal(branchRows.length, 1, `exactly one branch-kind keep row for ${branch}:\n${branchSection}`);
  assert.match(branchRows[0], /^keep/, branchRows[0]);

  const claimRows = claimSection.split('\n').filter((l) => l.includes(` ${branch} `) || l.includes(` ${branch}`));
  assert.equal(claimRows.length, 0, `no claim-kind row for ${branch}:\n${claimSection}`);

  run(repo, bin, '--yes');
  assert.ok(hasBranch(repo, branch), 'a contained branch with no commits of its own survives --yes');
});

/** A plan file in `docs/plans/` linked from no index, or only from `delivered/`. */
function plainPlan(repo, slug, branch, { phase = 'Released', annotation = 'deferred: moved to a-row-is-a-tuple', index = null } = {}) {
  const file = path.join(repo, 'docs', 'plans', `${slug}.md`);
  fs.writeFileSync(
    file,
    `# ${slug}\n\n## Status\n\n- **Phase:** ${phase}\n\n## Branches\n\n- \`${branch}\` — the work <!-- ${annotation} -->\n`,
  );
  if (index !== null) {
    fs.mkdirSync(path.join(repo, 'docs', 'plans', index), { recursive: true });
    fs.symlinkSync(path.join('..', `${slug}.md`), path.join(repo, 'docs', 'plans', index, `${slug}.md`));
  }
}

test('a claim deferred in a plan linked only from delivered/ is swept', () => {
  const { tmp, repo } = makeRepo();
  const branch = 'feature/claim-in-delivered';
  claimBranch(repo, branch);
  plainPlan(repo, 'a-delivered-plan', branch, { phase: 'Delivered', index: 'delivered' });
  const bin = stubGh(tmp, {});

  const dry = run(repo, bin, '--dry-run');
  assert.match(dry, /would +feature\/claim-in-delivered/, `the dry run must plan the removal:\n${dry}`);
  run(repo, bin, '--yes');
  assert.ok(!hasBranch(repo, branch), 'under --yes the claim ref goes');
});

test('a claim moved in a plan no index links is swept', () => {
  const { tmp, repo } = makeRepo();
  const branch = 'feature/claim-in-released';
  claimBranch(repo, branch);
  plainPlan(repo, 'a-released-plan', branch, { annotation: 'moved: elsewhere' });
  const bin = stubGh(tmp, {});

  run(repo, bin, '--yes');
  assert.ok(!hasBranch(repo, branch), 'a Released plan that neither index links still counts');
});

test('a deferred claim that an active plan schedules is kept', () => {
  const { tmp, repo } = makeRepo();
  const branch = 'feature/claim-still-wanted';
  claimBranch(repo, branch);
  plainPlan(repo, 'a-released-plan', branch);
  plan(repo, 'an-active-plan', branch);
  const bin = stubGh(tmp, {});

  const out = run(repo, bin, '--yes');
  assert.match(out, /needs judgment/, out);
  assert.ok(hasBranch(repo, branch), 'an active slice keeps the branch');
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

// ---------------------------------------------------------------------------
// A correction is not unlanded work
// ---------------------------------------------------------------------------
//
// `PLOT-CORRECTION.md` is written at the desk root by the worker loop, read by
// the agent, and worth nothing afterwards. Measured 2026-09-27: a desk whose PR
// had merged was kept for `?? PLOT-CORRECTION.md` alone. The cases below are
// the ones a naive fix passes without: the sweep's counter (a fix at the reap
// reading only), a nested file (an unanchored match), a correction beside a
// real file (a filter after `head`), and the blocked marker.

/** A dispatch desk on a squash-merged branch, recognised by its legacy name. */
function mergedDesk(repo, tmp, branch, number) {
  squashedBranch(repo, branch);
  const wt = path.join(path.dirname(repo), 'plot-wt-' + branch.replace(/\//g, '-'));
  git(repo, 'worktree', 'add', '-q', wt, branch);
  // The host says merged, so the patch is on main: a squash commit, which the
  // reaper's `git cherry` reading recognises by patch-id.
  git(repo, 'merge', '-q', '--squash', branch);
  git(repo, 'commit', '-qm', `${branch} (#${number})`);
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'fetch', '-q', 'origin');
  const bin = stubGh(tmp, { [branch]: [{ mergedAt: '2026-09-27T10:00:00Z', number }] });
  return { wt, bin };
}

test('a merged desk whose only dirt is a root PLOT-CORRECTION.md is reaped', () => {
  const { tmp, repo } = makeRepo();
  const branch = 'feature/corrected-and-merged';
  const { wt, bin } = mergedDesk(repo, tmp, branch, 801);
  fs.writeFileSync(path.join(wt, 'PLOT-CORRECTION.md'), 'Use the other helper.\n');

  const dry = run(repo, bin, '--dry-run');
  assert.doesNotMatch(dry, /uncommitted/, `a correction is not unlanded work:\n${dry}`);
  assert.match(dry, /dirty_trees=0/, `nor is the desk a dirty tree nobody owns:\n${dry}`);
  assert.ok(fs.existsSync(wt), 'a dry run removes nothing');

  run(repo, bin, '--yes');
  assert.ok(!fs.existsSync(wt), 'under --yes the corrected desk is reaped');
});

test('a tree whose only dirt is a root PLOT-CORRECTION.md is not a dirty leftover', () => {
  // The sweep's own population: not a dispatch tree, so the reaper does not
  // judge it, and the sweep is the only reader. It prints the desk under
  // "dirty trees nobody owns" unless it reads through the same filter.
  const { tmp, repo } = makeRepo();
  const branch = 'feature/corrected-unowned';
  squashedBranch(repo, branch);
  const wt = path.join(tmp, 'corrected');
  git(repo, 'worktree', 'add', '-q', wt, branch);
  fs.writeFileSync(path.join(wt, 'PLOT-CORRECTION.md'), 'Use the other helper.\n');
  const bin = stubGh(tmp, {});

  const out = run(repo, bin, '--dry-run');
  assert.match(out, /dirty_trees=0/, `a correction alone is not dirt:\n${out}`);
});

test('a PLOT-CORRECTION.md below the desk root still refuses, and is named', () => {
  // The match is anchored to the root. `docs/PLOT-CORRECTION.md` is a file
  // somebody wrote into the tree, and nothing says it exists anywhere else.
  const { tmp, repo } = makeRepo();
  const branch = 'feature/nested-correction';
  const { wt, bin } = mergedDesk(repo, tmp, branch, 802);
  // `docs/` holds a tracked file, so porcelain prints the path itself rather
  // than collapsing an untracked directory to `?? docs/` — which no filter on
  // the file name could ever match, and the test would pass for that reason.
  fs.mkdirSync(path.join(wt, 'docs'));
  fs.writeFileSync(path.join(wt, 'docs', 'README.md'), 'docs\n');
  git(wt, 'add', 'docs/README.md');
  git(wt, 'commit', '-qm', 'docs');
  fs.writeFileSync(path.join(wt, 'docs', 'PLOT-CORRECTION.md'), 'a document\n');

  const out = run(repo, bin, '--yes');
  assert.match(lineFor(out, branch), /uncommitted: \?\? docs\/PLOT-CORRECTION\.md/,
    `a nested file must still refuse, naming its path:\n${out}`);
  assert.ok(fs.existsSync(path.join(wt, 'docs', 'PLOT-CORRECTION.md')), 'and the file survives');
});

test('a correction beside a real file refuses, naming the real file', () => {
  const { tmp, repo } = makeRepo();
  const branch = 'feature/corrected-and-dirty';
  const { wt, bin } = mergedDesk(repo, tmp, branch, 803);
  // Porcelain sorts `PLOT-CORRECTION.md` before `z-work.txt`, so a filter
  // applied after `head -1` would name the correction or name nothing.
  fs.writeFileSync(path.join(wt, 'PLOT-CORRECTION.md'), 'Use the other helper.\n');
  fs.writeFileSync(path.join(wt, 'z-work.txt'), 'exists nowhere else');

  const out = run(repo, bin, '--yes');
  const line = lineFor(out, branch);
  assert.match(line, /uncommitted: \?\? z-work\.txt/, `the refusal names the real file:\n${out}`);
  assert.doesNotMatch(line, /PLOT-CORRECTION/, 'and never the correction');
  assert.ok(fs.existsSync(path.join(wt, 'z-work.txt')), 'the real file survives');
});

test('a blocked marker beside a correction still refuses as blocked', () => {
  // A blocked desk owes a person an answer; a correction owes nobody
  // anything. Excusing the one must not excuse the other.
  const { tmp, repo } = makeRepo();
  const branch = 'feature/corrected-and-blocked';
  const { wt, bin } = mergedDesk(repo, tmp, branch, 804);
  fs.writeFileSync(path.join(wt, 'PLOT-CORRECTION.md'), 'Use the other helper.\n');
  fs.writeFileSync(path.join(wt, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: which helper?\n');

  const out = run(repo, bin, '--yes');
  assert.match(lineFor(out, branch), /^keep/, `a blocked desk is kept:\n${out}`);
  assert.match(lineFor(out, branch), /blocked|PLOT-BLOCKED/i, 'for its marker');
  assert.ok(fs.existsSync(wt), 'and survives --yes');
});

test('the tool-error state file is not tracked, and no new ignore rule stands in for it', () => {
  // Tracked, the file reported ` M` in every desk whose tooling rewrote it,
  // and `.omc/` was already ignored — an ignore rule cannot cover a tracked
  // path. Untracking it lets the existing rule take over.
  const root = path.join(here, '..', '..');
  const tracked = execFileSync('git', ['ls-files', '--', 'packages/board/.omc'],
    { encoding: 'utf8', cwd: root }).trim();
  assert.equal(tracked, '', 'no .omc state is tracked');
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.doesNotMatch(ignore, /last-tool-error/, 'the existing `.omc/` rule covers it by itself');
});
