// Contract test for WHICH PR the reaper reads when it asks the host whether a
// branch's work landed.
//
// THE DEFECT THIS FILE PINS. `pr_merged` asked the host with `--limit 1`, which
// returns only the NEWEST PR for the branch. Where a newer, unmerged PR sits in
// front of the real merge, the reaper reported `unlanded work — no merged PR`
// about a branch whose work was on main. Measured 2026-08-27 against the live
// host:
//
//   branch                              newest PR          the real merge
//   an-unreachable-host-says-so         #473 mergedAt=null  #446 merged
//   the-scan-sees-a-stale-sprint-tally  #464 mergedAt=null  #463 merged
//   a-plan-cites-a-jira-key             #476 mergedAt=null  #447 merged
//
// And the masking PRs are ones the fleet opened ITSELF, on already-merged
// waves, which closes a loop: a leftover worktree lets auto-dispatch adopt a
// merged branch, the worker opens a duplicate, that duplicate is newer, the
// reaper keeps the worktree — the input to step one.
//
// This is the same lesson the script already learned once and records at
// `pr_merged`: it reads `mergedAt` and never `state`, because a merged PR
// reports CLOSED. Reading only the NEWEST PR is that error one level out.
//
// WHY THIS FILE STUBS `gh` WHEN ITS SIBLINGS REFUSE TO. `reap-manifest.test.mjs`
// satisfies the merged gate by ANCESTRY and says so — hermetic, no host CLI
// needed. That works because ancestry is tried FIRST and short-circuits. But
// `pr_merged` is reached ONLY on the squash path, where by construction there
// is no ancestry to find. A test that avoids `gh` therefore cannot reach the
// line this file is about, and could not tell `--limit 1` from `--limit 100`.
// So the stub is not a shortcut here; it is the only way to exercise the
// branch. It is a real executable on PATH, not a shell function, because
// `pr_merged` gates on `command -v gh` before calling it.
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-reappr-'));
  ctx.push(tmp);
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# Repo\n\n## Plot Config\n\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  git(repo, 'push', '-q', 'origin', 'main');
  return { tmp, repo };
}

// A dispatch worktree holding work that is committed but NOT merged by
// ancestry — the squash-merge shape, and the only shape that reaches
// `pr_merged`. Nothing is merged into main, so `origin/main..branch` is
// non-empty and the host is the sole authority on whether it landed.
function squashedWorktree(repo, branch) {
  const wt = path.join(path.dirname(repo), 'plot-wt-' + branch.replace(/\//g, '-'));
  git(repo, 'branch', branch);
  git(repo, 'worktree', 'add', '-q', wt, branch);
  fs.writeFileSync(path.join(wt, 'work.txt'), branch);
  git(wt, 'add', '-A');
  git(wt, 'commit', '-qm', `work on ${branch}`);
  return wt;
}

// A `gh` on PATH that answers `pr list` from a per-branch table, honouring
// `--limit` exactly as the real CLI does: newest first, truncated to N.
//
// `prs` maps a branch to its PRs in NEWEST-FIRST order, mirroring the real
// response. A branch absent from the table answers `[]`.
function stubGh(tmp, prs) {
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const gh = path.join(bin, 'gh');
  fs.writeFileSync(gh, `#!/usr/bin/env node
const argv = process.argv.slice(2);
if (argv[0] !== 'pr' || argv[1] !== 'list') { process.exit(1); }
const table = ${JSON.stringify(prs)};
const head = argv[argv.indexOf('--head') + 1];
const li = argv.indexOf('--limit');
const limit = li === -1 ? 30 : Number(argv[li + 1]);
const all = table[head] || [];
process.stdout.write(JSON.stringify(all.slice(0, limit)));
`);
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

test('item 1: a branch whose merged PR is not its newest is reaped', () => {
  // The measured case. A closed duplicate (#473) is newer than the real merge
  // (#446); reading only the newest reports the branch as unlanded.
  const { tmp, repo } = makeRepo();
  const branch = 'bug/an-unreachable-host-says-so';
  squashedWorktree(repo, branch);
  const bin = stubGh(tmp, {
    [branch]: [
      { mergedAt: null, number: 473 },
      { mergedAt: '2026-08-26T16:53:12Z', number: 446 },
    ],
  });

  // `--dry-run` names the verdict; `--yes` is what actually clears the desk.
  // Both are asserted, because the reason this wave exists is an estate that
  // kept growing — a verdict nobody acts on is the state it was already in.
  const dry = run(repo, bin, '--dry-run');
  const line = dry.split('\n').find((l) => l.includes(branch)) ?? '';
  assert.match(line, /^would/, `a branch with a merged PR behind a newer one must be reapable:\n${dry}`);
  assert.match(line, /PR merged/, 'and must say the host is why');
  assert.doesNotMatch(line, /no merged PR/);

  const wt = path.join(path.dirname(repo), 'plot-wt-' + branch.replace(/\//g, '-'));
  assert.ok(fs.existsSync(wt), 'dry run must remove nothing');
  run(repo, bin, '--yes');
  assert.ok(!fs.existsSync(wt), 'under --yes the worktree is actually removed');
});

test('item 2: a branch with NO merged PR at all is still kept', () => {
  // The assertion that makes the change safe. Four such branches on the estate
  // the day this was written (`merged=0, open=0`) — genuinely unlanded work. A
  // fix that reaps them destroys work and would still pass item 1.
  const { tmp, repo } = makeRepo();
  const branch = 'bug/genuinely-unlanded';
  squashedWorktree(repo, branch);
  const bin = stubGh(tmp, {
    [branch]: [{ mergedAt: null, number: 900 }],
  });

  const out = run(repo, bin, '--dry-run');
  const line = out.split('\n').find((l) => l.includes(branch)) ?? '';
  assert.match(line, /^keep/, `an unmerged branch must be kept:\n${out}`);
  assert.match(line, /no merged PR/);

  // And it survives the mode that actually deletes. This is the assertion the
  // plan calls the one a careless fix fails: reaping here destroys work that
  // exists nowhere else.
  const wt = path.join(path.dirname(repo), 'plot-wt-' + branch.replace(/\//g, '-'));
  run(repo, bin, '--yes');
  assert.ok(fs.existsSync(wt), 'under --yes an unlanded worktree must SURVIVE');
});

test('item 2: a branch the host knows no PR for is kept', () => {
  // The empty-list case, distinct from "PRs exist but none merged". A reaper
  // that treated an empty answer as permission would remove the trees of work
  // that was never even proposed.
  const { tmp, repo } = makeRepo();
  const branch = 'bug/never-proposed';
  squashedWorktree(repo, branch);
  const bin = stubGh(tmp, {});

  const out = run(repo, bin, '--dry-run');
  const line = out.split('\n').find((l) => l.includes(branch)) ?? '';
  assert.match(line, /^keep/, `a branch with no PRs must be kept:\n${out}`);
  assert.match(line, /no merged PR/);
});

test('the reaper asks the host for more than one PR', () => {
  // Pins the CAUSE, not only the symptom. The tests above are satisfied by any
  // limit above one, but a future edit could quietly restore `--limit 1` while
  // they still passed on a fixture whose merge happened to come first. This
  // reads the limit the script actually sends.
  const { tmp, repo } = makeRepo();
  const branch = 'bug/records-the-limit';
  squashedWorktree(repo, branch);
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const seen = path.join(tmp, 'limit.txt');
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env node
const argv = process.argv.slice(2);
const li = argv.indexOf('--limit');
require('fs').writeFileSync(${JSON.stringify(seen)}, li === -1 ? 'none' : argv[li + 1]);
process.stdout.write('[]');
`);
  fs.chmodSync(path.join(bin, 'gh'), 0o755);

  run(repo, bin, '--dry-run');
  const limit = fs.readFileSync(seen, 'utf8').trim();
  assert.notEqual(limit, '1', 'asking for one PR is the defect this wave fixes');
  assert.ok(limit === 'none' || Number(limit) > 1,
    `the reaper must ask for more than one PR, got: ${limit}`);
});
