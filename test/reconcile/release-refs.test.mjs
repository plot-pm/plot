// Contract test for the REMOTE REFS a delivered plan releases — and, more
// importantly, for the ones it must never touch.
//
// WHY THE REFUSALS OUTNUMBER THE DELETIONS HERE. Deleting a merged ref is
// recoverable in principle and cheap in practice; deleting an UNLANDED one
// destroys work that exists nowhere else, and unlike a wrongly-removed worktree
// there is no `git worktree add` that brings it back. So the assertions below
// are weighted the way the risk is: one test that refs are released, four that
// they are kept.
//
// `Done when` items pinned here:
//
//   item 11 — a delivered plan's merged branches lose their remote refs.
//   item 12 — an unlanded branch keeps its ref, ALWAYS. Asserted SEPARATELY
//             from item 11 and on a plan holding one merged and one unmerged
//             branch, because a sweep that deletes everything passes item 11
//             and is exactly the failure this wave must not have.
//   item 13 — a branch checked out in a worktree is not deleted, even merged.
//
// Plus the two guards measured by hand on 2026-08-28, when ten merged refs were
// deleted and two were deliberately kept:
//
//   changeset-release/main  merged, but Changesets recreates and reuses it, so
//                           an OPEN PR sits on a branch an older PR merged.
//   a checked-out branch    removing the ref pulls it from under a checkout.
//
// WHY `gh` IS STUBBED. The merge gate is `pr_merged`, which asks the host —
// there is no ancestry path to satisfy instead, because the whole population
// this script acts on is squash-merged branches that stay "ahead of main"
// forever. A test that avoided `gh` could not reach the gate at all. The stub
// is a real executable on PATH, not a shell function, because `pr_merged` gates
// on `command -v gh` before calling it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const release = path.join(scripts, 'plot-release-refs.sh');

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}

const ctx = [];
after(() => { for (const t of ctx) fs.rmSync(t, { recursive: true, force: true }); });

// A repo with a real `origin` — a bare clone, so `git push origin --delete` is
// exercised for real rather than stubbed. The refs this test asserts about are
// actual refs in an actual remote.
function makeRepo(planBody) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-refs-'));
  ctx.push(tmp);
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# Repo\n\n## Plot Config\n\n');
  fs.mkdirSync(path.join(repo, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'plans', '2026-08-28-a-plan.md'), planBody);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  git(repo, 'push', '-q', 'origin', 'main');
  return { tmp, repo };
}

/** A branch that exists on the remote — the thing this script may delete. */
function pushBranch(repo, branch) {
  git(repo, 'branch', branch);
  git(repo, 'push', '-q', 'origin', branch);
}

/** Does the REMOTE still carry this ref? The only end state that matters. */
function remoteHas(repo, branch) {
  const out = git(repo, 'ls-remote', '--heads', 'origin', branch);
  return out.trim().length > 0;
}

// A `gh` answering `pr list` from a per-branch table, honouring `--state` the
// way the real CLI does: `open` filters to PRs with no `mergedAt` and no closure,
// `all` returns everything.
function stubGh(tmp, prs) {
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const gh = path.join(bin, 'gh');
  fs.writeFileSync(gh, `#!/usr/bin/env node
const argv = process.argv.slice(2);
if (argv[0] !== 'pr' || argv[1] !== 'list') { process.exit(1); }
const table = ${JSON.stringify(prs)};
const head = argv[argv.indexOf('--head') + 1];
const si = argv.indexOf('--state');
const state = si === -1 ? 'open' : argv[si + 1];
let all = table[head] || [];
if (state === 'open') all = all.filter((p) => p.state === 'open');
process.stdout.write(JSON.stringify(all));
`);
  fs.chmodSync(gh, 0o755);
  return bin;
}

function run(repo, bin, ...args) {
  return execFileSync('bash', [release, ...args], {
    encoding: 'utf8',
    cwd: repo,
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
  });
}

const merged = (n) => ({ number: n, state: 'closed', mergedAt: '2026-08-27T10:00:00Z' });
const open = (n) => ({ number: n, state: 'open', mergedAt: null });
const closedUnmerged = (n) => ({ number: n, state: 'closed', mergedAt: null });

/** A waved plan naming the given branches, in the dialect this repo writes. */
function wavedPlan(waves) {
  const body = waves
    .map(([name, branch, note]) =>
      `### ${name} (Branch: ${branch}, PR: #1)\n\n${note ?? 'A wave.'}\n`)
    .join('\n');
  return `# A plan\n
## Status\n
- **Phase:** Delivered
- **Type:** feature
- **Delivered:** 2026-08-28\n
## Waves\n
${body}`;
}

test('items 11 and 12: the merged ref goes, the unlanded one stays', () => {
  // THE CENTRAL ASSERTION, and deliberately ONE test over a plan holding both
  // kinds. Split into two plans, a sweep that deleted everything would pass the
  // first and fail only the second — here it cannot pass at all, because the
  // same run must reach opposite verdicts about two branches of one plan.
  const { tmp, repo } = makeRepo(wavedPlan([
    ['Landed', 'feature/has-merged'],
    ['Open', 'feature/never-merged'],
  ]));
  pushBranch(repo, 'feature/has-merged');
  pushBranch(repo, 'feature/never-merged');
  const bin = stubGh(tmp, {
    'feature/has-merged': [merged(101)],
    'feature/never-merged': [closedUnmerged(102)],
  });

  const dry = run(repo, bin, 'a-plan');
  assert.match(dry.split('\n').find((l) => l.includes('has-merged')) ?? '', /^would/,
    `a merged branch must be releasable:\n${dry}`);
  assert.match(dry.split('\n').find((l) => l.includes('never-merged')) ?? '', /^keep/,
    `an unlanded branch must be kept:\n${dry}`);
  assert.ok(remoteHas(repo, 'feature/has-merged'), 'the default mode deletes nothing');

  const out = run(repo, bin, '--yes', 'a-plan');
  assert.ok(!remoteHas(repo, 'feature/has-merged'),
    `item 11: a merged branch must lose its remote ref:\n${out}`);
  assert.ok(remoteHas(repo, 'feature/never-merged'),
    `item 12: an unlanded branch keeps its ref, ALWAYS:\n${out}`);
});

test('item 12: a branch the host knows no PR for keeps its ref', () => {
  // The empty-answer case, distinct from "PRs exist but none merged". A script
  // that read an empty list as permission would delete the refs of work that
  // was never even proposed.
  const { tmp, repo } = makeRepo(wavedPlan([['Only', 'feature/never-proposed']]));
  pushBranch(repo, 'feature/never-proposed');
  const bin = stubGh(tmp, {});

  const out = run(repo, bin, '--yes', 'a-plan');
  assert.ok(remoteHas(repo, 'feature/never-proposed'),
    `a branch with no PRs at all must keep its ref:\n${out}`);
  assert.match(out, /no merged PR/);
});

test('item 12: an unreachable host deletes nothing', () => {
  // Silence is not permission. With no `gh` on PATH at all, `pr_merged` returns
  // false for every branch and every ref survives — the same direction the
  // reaper fails in, and the only safe one when the act cannot be undone.
  const { tmp, repo } = makeRepo(wavedPlan([['Only', 'feature/host-is-down']]));
  pushBranch(repo, 'feature/host-is-down');
  const bin = path.join(tmp, 'empty-bin');
  fs.mkdirSync(bin, { recursive: true });

  const out = execFileSync('bash', [release, '--yes', 'a-plan'], {
    encoding: 'utf8',
    cwd: repo,
    // A PATH carrying git and the shell but NO gh.
    env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
  });
  assert.ok(remoteHas(repo, 'feature/host-is-down'),
    `a host that cannot be asked must release nothing:\n${out}`);
});

test('item 12: a deferred branch keeps its ref even when its PR merged', () => {
  // The `/plot-implement` rule, enforced. A given-up branch is annotated
  // `deferred:` and `/plot-reconcile` needs the ref PLUS that annotation to tell
  // deliberate abandonment from a dead worker. Checked before the host is asked,
  // so no merge state can overturn a decision a person recorded.
  const plan = `# A plan\n
## Status\n
- **Phase:** Delivered
- **Type:** feature\n
## Waves\n
### Kept (Branch: feature/given-up, PR: #1) <!-- deferred: not needed after all -->\n
A wave that was shelved.\n`;
  const { tmp, repo } = makeRepo(plan);
  pushBranch(repo, 'feature/given-up');
  const bin = stubGh(tmp, { 'feature/given-up': [merged(103)] });

  const out = run(repo, bin, '--yes', 'a-plan');
  assert.ok(remoteHas(repo, 'feature/given-up'),
    `a deferred branch keeps its ref regardless of merge state:\n${out}`);
  assert.match(out, /deferred/);
});

test('guard: an OPEN PR vetoes deletion even where an older PR merged', () => {
  // The `changeset-release/main` case, measured 2026-08-28 — merged repeatedly,
  // because Changesets RECREATES and reuses that same branch for each release,
  // so a live release PR sits on a ref whose own older PR merged. The merge gate
  // alone says "delete" about a branch somebody is actively using.
  //
  // Exercised on a `feature/` branch rather than on `changeset-release/main`
  // itself, and the reason is worth recording: `plot-plan-meta.sh` only yields
  // branches matching the configured `--prefixes`, so `changeset-release/...`
  // never reaches this script from a plan at all. That is a SECOND barrier, not
  // a reason to drop this one — the prefixes are a config value an adopting
  // project can widen, and this guard is what holds when they do. Asserting it
  // through a branch the parser drops would test the parser instead.
  const { tmp, repo } = makeRepo(wavedPlan([['Release', 'feature/release-train']]));
  pushBranch(repo, 'feature/release-train');
  const bin = stubGh(tmp, {
    'feature/release-train': [open(200), merged(150)],
  });

  const out = run(repo, bin, '--yes', 'a-plan');
  assert.ok(remoteHas(repo, 'feature/release-train'),
    `a branch with a live PR must keep its ref:\n${out}`);
  assert.match(out, /open PR/);
});

test('item 13: a branch checked out in a worktree is not deleted, even merged', () => {
  // Measured 2026-08-28: `bug/a-head-counts-its-own-waves` was merged AND
  // checked out. Deleting the ref pulls the branch out from under the checkout.
  const { repo, tmp } = makeRepo(wavedPlan([['Sat', 'feature/somebody-is-on-it']]));
  pushBranch(repo, 'feature/somebody-is-on-it');
  const wt = path.join(tmp, 'a-worktree');
  git(repo, 'worktree', 'add', '-q', wt, 'feature/somebody-is-on-it');
  const bin = stubGh(tmp, { 'feature/somebody-is-on-it': [merged(104)] });

  const out = run(repo, bin, '--yes', 'a-plan');
  assert.ok(remoteHas(repo, 'feature/somebody-is-on-it'),
    `a ref a checkout is sitting on must survive:\n${out}`);
  assert.match(out, /checked out/);
});

test('the default branch is never deleted, by either of two barriers', () => {
  // TWO barriers, asserted as two facts, because only one of them is reachable
  // in this repo's configuration and both must hold.
  //
  // FIRST: `plot-plan-meta.sh` matches branches against the configured
  // `Branch prefixes`, so a plan naming `main` or `changeset-release/main`
  // yields nothing at all — those names never enter the candidate set.
  // Discovered while writing this file.
  const { tmp, repo } = makeRepo(wavedPlan([
    ['Bad', 'main'],
    ['Release', 'changeset-release/main'],
  ]));
  const bin = stubGh(tmp, { main: [merged(1)], 'changeset-release/main': [merged(2)] });

  const out = run(repo, bin, '--yes', 'a-plan');
  assert.ok(remoteHas(repo, 'main'), `main must survive:\n${out}`);
  assert.match(out, /releasable=0 deleted=0/,
    `a prefixless branch must not even be a candidate:\n${out}`);

  // SECOND: the guard itself. The prefixes are a CONFIG value, so a project
  // that declared `main` as one would hand it straight to the loop — and then
  // the merge gate would pass, since main's PRs are merged by definition.
  // Declaring it here is the only way to reach that line, and reaching it is
  // the point: this is the barrier that holds when the first one is widened.
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'),
    '# Repo\n\n## Plot Config\n\n- **Branch prefixes:** main/, feature/\n');
  const widened = run(repo, bin, '--yes', 'a-plan');
  assert.ok(remoteHas(repo, 'main'),
    `the guard must refuse the default branch even when a prefix admits it:\n${widened}`);
});

test('re-running is a no-op rather than a failure', () => {
  // The delivery path may call this more than once — a scan fires every few
  // seconds. A ref already gone is the END STATE this script asks for, so it
  // reports success rather than an error somebody has to read.
  const { tmp, repo } = makeRepo(wavedPlan([['Landed', 'feature/twice']]));
  pushBranch(repo, 'feature/twice');
  const bin = stubGh(tmp, { 'feature/twice': [merged(105)] });

  run(repo, bin, '--yes', 'a-plan');
  const second = run(repo, bin, '--yes', 'a-plan');
  assert.doesNotMatch(second, /FAILED/, `a second run must not fail:\n${second}`);
  assert.match(second, /already absent|released/);
});
