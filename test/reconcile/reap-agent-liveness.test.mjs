// Contract test: the reaper reads whether an AGENT runs at a desk, the answer
// `plot-dispatch.sh --stop` reads, and never removes commits only the desk holds.
//
// THE FIXTURE IS THE SPECIFICATION. A live wrapper with no agent under it, a
// clean tree, the branch pushed, and NO `.plot-worker.exit`: the wrapper has
// not exited, so there is no exit record to read. Measured before this change:
//
//   plot_worker_state    = [finished|23768|]
//   plot-reap.sh reading:  PLOT_PID='23768' -> 'worker alive (pid 23768)'
//
// The reaper asked `ps` about the wrapper and stopped there, so the desk could
// be neither stopped nor reaped. A fixture built around an exit record tests a
// mechanism two review rounds refuted, and passes without the fix.
//
// THE ASSERTIONS A NAIVE FIX PASSES WITHOUT:
//   * a live agent is still kept, and the refusal names the pid;
//   * unpushed commits are never reaped — with the remote branch DELETED, the
//     state every merged desk reaches after `git fetch --prune`, so a reading
//     against `@{upstream}` would count nothing and pass the guard vacuously;
//   * the dirty sweep's counter moves with the reap reading;
//   * `waiting` and `stalled` are discarded by name.
//
// `PLOT_AGENT_PROCESS=sleep` names the agent, as in `workerstate.test.mjs`, and
// `PLOT_AGENT_GRACE_SECONDS=0` makes a milliseconds-old wrapper askable.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const reap = path.join(scripts, 'plot-reap.sh');
const dispatch = path.join(scripts, 'plot-dispatch.sh');
const wstate = path.join(scripts, 'plot-worker-state.sh');

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

const tmps = [];
const wrappers = [];
after(() => {
  for (const pid of wrappers) { try { process.kill(Number(pid)); } catch { /* gone */ } }
  for (const t of tmps) fs.rmSync(t, { recursive: true, force: true });
});

/** A detached wrapper running `child`; returns its pid. */
const spawnWrapper = (child) => {
  const pid = execFileSync('bash', ['-c',
    `nohup sh -c ${JSON.stringify(child)} </dev/null >/dev/null 2>&1 & echo $!`,
  ], { encoding: 'utf8', timeout: 30_000 }).trim();
  wrappers.push(pid);
  return pid;
};

/** A wrapper whose agent has exited: the root alone, nothing named `sleep` under it. */
const deadAgentWrapper = () => spawnWrapper('exec sleep 300');
/** A wrapper with an agent under it. */
const liveAgentWrapper = () => spawnWrapper('sleep 300 & exec sleep 300');

const agentEnv = (bin) => ({
  ...process.env,
  PATH: `${bin}${path.delimiter}${process.env.PATH}`,
  PLOT_AGENT_PROCESS: 'sleep',
  PLOT_AGENT_GRACE_SECONDS: '0',
});

const makeRepo = () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-liveness-'));
  tmps.push(tmp);
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# Repo\n\n## Plot Config\n\n');
  // The worker's records are ignored in any adopting repository; without the
  // rule every desk reads as carrying `?? .plot-worker.pid`.
  fs.writeFileSync(path.join(repo, '.gitignore'), '.plot-worker*\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  git(repo, 'push', '-q', 'origin', 'main');
  return { tmp, repo };
};

/**
 * A dispatch desk on `branch` with one pushed commit, a wrapper recorded in
 * both pid files, and no exit record. `pruned` deletes the remote branch and
 * prunes the tracking ref, as the host does on merge.
 */
const desk = (repo, branch, wrapperPid, { pruned = true } = {}) => {
  const wt = path.join(path.dirname(repo), 'plot-wt-' + branch.replace(/\//g, '-'));
  git(repo, 'worktree', 'add', '-q', '-b', branch, wt);
  fs.writeFileSync(path.join(wt, 'work.txt'), branch);
  git(wt, 'add', 'work.txt');
  git(wt, 'commit', '-qm', `work on ${branch}`);
  git(wt, 'push', '-q', '-u', 'origin', branch);
  const head = git(wt, 'rev-parse', 'HEAD').trim();
  if (pruned) {
    git(repo, 'push', '-q', 'origin', '--delete', branch);
    git(repo, 'fetch', '-q', '--prune', 'origin');
  }
  fs.writeFileSync(path.join(wt, '.plot-worker.pid'), `${wrapperPid}\n`);
  fs.writeFileSync(path.join(wt, '.plot-worker.wrapper.pid'), `${wrapperPid}\n`);
  return { wt, head };
};

/** A `gh` answering `pr list` from a table; `failHeads` fails any call asking for `headRefOid`. */
const stubGh = (tmp, prs, { failHeads = false, log = '' } = {}) => {
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env node
const argv = process.argv.slice(2);
if (${JSON.stringify(log)}) { require('node:fs').appendFileSync(${JSON.stringify(log)}, argv.join(' ') + '\\n'); }
if (argv[0] !== 'pr' || argv[1] !== 'list') { process.exit(1); }
const json = argv[argv.indexOf('--json') + 1] || '';
if (${failHeads} && json.includes('headRefOid')) { process.exit(1); }
const table = ${JSON.stringify(prs)};
const head = argv[argv.indexOf('--head') + 1];
const state = argv[argv.indexOf('--state') + 1];
let all = table[head] || [];
if (state === 'open') { all = all.filter((p) => p.mergedAt === null); }
process.stdout.write(JSON.stringify(all));
`);
  fs.chmodSync(path.join(bin, 'gh'), 0o755);
  return bin;
};

/**
 * Lands a desk's branch on `main` as ONE squash commit and pushes it, as the
 * host does on a squash merge: the patch is upstream, the shas are not.
 */
const squashLand = (repo, branch) => {
  git(repo, 'merge', '-q', '--squash', branch);
  git(repo, 'commit', '-qm', `${branch} (#900)`);
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'fetch', '-q', '--prune', 'origin');
};

/** A host answer saying merged and naming a head this desk has never held. */
const squashed = (branch) => ({ [branch]: [{ mergedAt: '2026-09-27T10:00:00Z', number: 901,
  headRefOid: '0'.repeat(40) }] });

/** Commits one file at a desk under fixed author and committer dates; returns the short sha. */
const commitDated = (wt, file, { author, committer }) => {
  fs.writeFileSync(path.join(wt, file), file);
  git(wt, 'add', file);
  execFileSync('git', ['commit', '-qm', `add ${file}`], { cwd: wt,
    env: { ...process.env, GIT_AUTHOR_DATE: author, GIT_COMMITTER_DATE: committer } });
  return git(wt, 'rev-parse', '--short', 'HEAD').trim();
};

const merged = (branch, head) => ({ [branch]: [{ mergedAt: '2026-09-27T10:00:00Z', number: 900, headRefOid: head }] });

const runReap = (repo, bin, ...args) =>
  execFileSync('bash', [reap, ...args], { encoding: 'utf8', cwd: repo, env: agentEnv(bin) });

const lineFor = (out, branch) => out.split('\n').find((l) => l.includes(` ${branch} `)) ?? '';

/** What `plot_worker_state` answers for a desk, with the same agent name and grace. */
const workerState = (wt) => execFileSync('bash', ['-c',
  `source ${JSON.stringify(wstate)}; plot_worker_state ${JSON.stringify(wt)} ""`,
], { encoding: 'utf8', env: agentEnv(''), timeout: 30_000 }).split('\t');

test('a live wrapper whose agent exited, with no exit record, is reaped', () => {
  const { tmp, repo } = makeRepo();
  const branch = 'feature/agent-gone';
  const wrapper = deadAgentWrapper();
  const { wt, head } = desk(repo, branch, wrapper);
  const bin = stubGh(tmp, merged(branch, head));

  // The preconditions, or the test proves nothing: the wrapper answers
  // `kill -0`, and there is no exit record to read.
  assert.doesNotThrow(() => process.kill(Number(wrapper), 0), 'the wrapper is alive');
  assert.ok(!fs.existsSync(path.join(wt, '.plot-worker.exit')), 'no exit record exists');

  const dry = runReap(repo, bin, '--dry-run');
  assert.match(lineFor(dry, branch), /^would/, `an agent-less desk is not a live worker:\n${dry}`);
  assert.doesNotMatch(dry, new RegExp(`worker alive \\(pid ${wrapper}\\)`));

  runReap(repo, bin, '--yes');
  assert.ok(!fs.existsSync(wt), 'under --yes the desk is removed');
});

test('the reaper and --stop agree, and the agent-descendant reading is why', () => {
  // One fixture, two verbs. `--stop` kills only a `running` worker; the
  // reaper keeps only a `running` worker. What decides `running` on a live
  // wrapper is whether an agent descends from it — the same fixture with an
  // agent under the wrapper flips both verbs together.
  const { tmp, repo } = makeRepo();

  const gone = 'feature/stop-agrees-gone';
  const goneDesk = desk(repo, gone, deadAgentWrapper());
  const live = 'feature/stop-agrees-live';
  const liveWrapper = liveAgentWrapper();
  const liveDesk = desk(repo, live, liveWrapper);
  const bin = stubGh(tmp, { ...merged(gone, goneDesk.head), ...merged(live, liveDesk.head) });

  assert.equal(workerState(goneDesk.wt)[0], 'finished', 'no agent descends from the wrapper');
  assert.equal(workerState(liveDesk.wt)[0], 'running', 'an agent descends from the wrapper');

  const dry = runReap(repo, bin, '--dry-run');
  assert.match(lineFor(dry, gone), /^would/, dry);
  assert.match(lineFor(dry, live), /^keep.*worker alive/, dry);

  const stop = (branch) => spawnSync('bash', [dispatch, '--stop', branch],
    { encoding: 'utf8', cwd: repo, env: agentEnv(bin) });
  const stopGone = stop(gone);
  assert.match(stopGone.stdout, /is not running \(finished/,
    `--stop must read the same desk as not running:\n${stopGone.stdout}${stopGone.stderr}`);
  assert.doesNotThrow(() => process.kill(Number(fs.readFileSync(
    path.join(goneDesk.wt, '.plot-worker.pid'), 'utf8').trim()), 0),
  '--stop killed nothing on the agent-less desk');
});

test('a desk with a live agent is kept, and the refusal names the pid', () => {
  const { tmp, repo } = makeRepo();
  const branch = 'feature/agent-working';
  const wrapper = liveAgentWrapper();
  const { wt, head } = desk(repo, branch, wrapper);
  const bin = stubGh(tmp, merged(branch, head));

  const out = runReap(repo, bin, '--yes');
  assert.match(lineFor(out, branch), new RegExp(`^keep.*worker alive \\(pid ${wrapper}\\)`),
    `a live agent keeps its desk, naming the pid:\n${out}`);
  assert.ok(fs.existsSync(wt), 'and the desk survives --yes');
});

test('a merged desk holding a commit the PR did not carry is never reaped, and the commit is named', () => {
  // The upstream is DELETED, as the host deletes it on merge. A reading
  // against `@{upstream}` counts nothing here and reaps the commit away.
  const { tmp, repo } = makeRepo();
  const branch = 'feature/agent-gone-unpushed';
  const { wt, head } = desk(repo, branch, deadAgentWrapper());
  fs.writeFileSync(path.join(wt, 'late.txt'), 'committed after the push');
  git(wt, 'add', 'late.txt');
  git(wt, 'commit', '-qm', 'late work');
  const late = git(wt, 'rev-parse', '--short', 'HEAD').trim();
  assert.notEqual(spawnSync('git', ['rev-parse', '@{upstream}'], { cwd: wt }).status, 0,
    'precondition: the upstream is gone');
  const bin = stubGh(tmp, merged(branch, head));

  const out = runReap(repo, bin, '--yes');
  assert.match(lineFor(out, branch), new RegExp(`^keep.*unpushed commits: ${late}`),
    `the unpushed commit must be named:\n${out}`);
  assert.ok(fs.existsSync(path.join(wt, 'late.txt')), 'and the desk survives --yes');
});

test('a merged desk whose merged head this desk does not hold is reaped', () => {
  // THE SQUASH-MERGE SHAPE, and the case that made CI red on 2026-09-27.
  //
  // `pr_merged_heads` answers a head the desk does not contain — a squash merge
  // rewrites the commits, and a host answer may carry no head at all. So the
  // subtraction in `desk_unpushed` cannot run, and the bare
  // `rev-list --not --remotes` reports EVERY commit the branch ever had: the
  // desk would be held forever for having done the work that merged (#1033).
  //
  // Since #1038 the host's answer no longer decides alone: `git cherry` reads
  // each commit's PATCH against main. Here the desk's one commit was squashed
  // onto main, so its patch is upstream and the desk holds nothing unlanded.
  // A fixture whose "merged" work never reached main now tests a different
  // case — that is `an old-dated patch made today is kept` below.
  const { tmp, repo } = makeRepo();
  const branch = 'feature/agent-gone-squashed';
  const { wt } = desk(repo, branch, deadAgentWrapper());
  squashLand(repo, branch);
  const bin = stubGh(tmp, squashed(branch));

  const out = runReap(repo, bin, '--yes');
  assert.doesNotMatch(lineFor(out, branch), /unpushed commits/,
    `a desk whose every patch is upstream holds nothing unpushed:\n${out}`);
  assert.ok(!fs.existsSync(wt), `and the desk is reaped under --yes:\n${out}`);
});

// THE TWO ROUND-1 FIXTURES, together. No date comparison satisfies both: a
// committer date holds the rebased desk forever, and an author date reaps the
// old patch committed today. Patch-id consults no clock.

test('round-1 fixture A: merged work, desk rebased after the merge, is reaped', () => {
  const { tmp, repo } = makeRepo();
  const branch = 'feature/merged-then-rebased';
  const { wt } = desk(repo, branch, deadAgentWrapper());
  squashLand(repo, branch);
  // A rebase after the merge re-stamps the committer date past `mergedAt`
  // and gives the commit a new sha. The patch does not change.
  execFileSync('git', ['rebase', '-q', '--force-rebase', 'HEAD~1'], { cwd: wt,
    env: { ...process.env, GIT_COMMITTER_DATE: '2026-09-28T12:00:00Z' } });
  assert.ok(git(wt, 'log', '-1', '--format=%cI') > '2026-09-27T10:00:00Z',
    'precondition: the committer date is after the merge');
  const bin = stubGh(tmp, squashed(branch));

  const out = runReap(repo, bin, '--yes');
  assert.doesNotMatch(lineFor(out, branch), /unpushed commits/,
    `a rebase does not change a patch-id:\n${out}`);
  assert.ok(!fs.existsSync(wt), `and the desk is reaped under --yes:\n${out}`);
});

test('round-1 fixture B: an old-dated patch made today is kept, and only it is named', () => {
  const { tmp, repo } = makeRepo();
  const branch = 'feature/old-patch-today';
  const { wt } = desk(repo, branch, deadAgentWrapper());
  squashLand(repo, branch);
  // What `cherry-pick` or `git am` produces: an author date before the merge,
  // a commit made after it, on no remote ref.
  const late = commitDated(wt, 'old-patch.txt',
    { author: '2026-09-10T09:00:00Z', committer: '2026-09-28T12:00:00Z' });
  const bin = stubGh(tmp, squashed(branch));

  const out = runReap(repo, bin, '--yes');
  assert.match(lineFor(out, branch), new RegExp(`^keep.*unpushed commits: ${late}$`),
    `the one commit whose patch is not upstream is named, and the merged one is not:\n${out}`);
  assert.ok(fs.existsSync(path.join(wt, 'old-patch.txt')), 'and the desk survives --yes');
});

test('an unreadable base keeps a squash-merged desk', () => {
  // `git cherry` has no `origin/main` to read and fails. A failure to observe
  // is the case that loses work, so the rule reads `unknown` and refuses.
  const { tmp, repo } = makeRepo();
  const branch = 'feature/no-base';
  const { wt } = desk(repo, branch, deadAgentWrapper());
  git(repo, 'update-ref', '-d', 'refs/remotes/origin/main');
  git(repo, 'remote', 'set-url', 'origin', path.join(tmp, 'gone.git'));
  const bin = stubGh(tmp, squashed(branch));

  const out = runReap(repo, bin, '--yes');
  assert.match(lineFor(out, branch), /^keep.*unpushed commits: unknown/, out);
  assert.ok(fs.existsSync(wt), 'the desk survives --yes');
});

test('the patch-id reading asks the host nothing the merged-head reading does not', () => {
  // `git cherry` is local. Two desks, one reaching the patch-id reading (the
  // merged head is not in its history) and one the subtraction (it is): the
  // host is asked the same questions for each.
  const { tmp, repo } = makeRepo();
  const viaCherry = 'feature/counted-cherry';
  desk(repo, viaCherry, deadAgentWrapper());
  squashLand(repo, viaCherry);
  const viaHead = 'feature/counted-head';
  const held = desk(repo, viaHead, deadAgentWrapper());

  const count = (branch, prs) => {
    const log = path.join(tmp, `gh-${branch.replace(/\//g, '-')}.log`);
    const bin = stubGh(tmp, prs, { log });
    runReap(repo, bin, '--dry-run');
    return fs.readFileSync(log, 'utf8').split('\n').filter((l) => l.includes(`--head ${branch}`)).length;
  };
  const cherryCalls = count(viaCherry, { ...squashed(viaCherry), ...merged(viaHead, held.head) });
  const headCalls = count(viaHead, { ...squashed(viaCherry), ...merged(viaHead, held.head) });
  assert.ok(headCalls > 0, 'precondition: the host is asked about the desk at all');
  assert.equal(cherryCalls, headCalls, 'no host call is added for the patch-id reading');
});

test('a merged desk holding uncommitted changes is never reaped', () => {
  const { tmp, repo } = makeRepo();
  const branch = 'feature/agent-gone-dirty';
  const { wt, head } = desk(repo, branch, deadAgentWrapper());
  fs.writeFileSync(path.join(wt, 'half-done.txt'), 'exists nowhere else');
  const bin = stubGh(tmp, merged(branch, head));

  const out = runReap(repo, bin, '--yes');
  assert.match(lineFor(out, branch), /^keep.*uncommitted: \?\? half-done\.txt/, out);
  assert.ok(fs.existsSync(path.join(wt, 'half-done.txt')), 'the file survives --yes');
});

test('commits that could not be counted keep the desk', () => {
  // The host said merged and then could not name the head it merged. Without
  // the head, a commit on no remote ref cannot be told from one the PR
  // carried, and here a failure to observe is the case that loses work.
  const { tmp, repo } = makeRepo();
  const branch = 'feature/heads-unaskable';
  const { wt, head } = desk(repo, branch, deadAgentWrapper());
  const bin = stubGh(tmp, merged(branch, head), { failHeads: true });

  const out = runReap(repo, bin, '--yes');
  assert.match(lineFor(out, branch), /^keep.*unpushed commits: unknown/, out);
  assert.ok(fs.existsSync(wt), 'the desk survives --yes');
});

test('the dirty sweep reads the same liveness: an agent-less dirty desk is nobody\'s', () => {
  // The sweep's own reading site. A fix at the reap loop alone leaves the
  // sweep calling the wrapper an owner, and the desk is neither reaped (it is
  // dirty) nor named.
  const { tmp, repo } = makeRepo();
  const gone = 'feature/sweep-agent-gone';
  const goneDesk = desk(repo, gone, deadAgentWrapper());
  fs.writeFileSync(path.join(goneDesk.wt, 'half-done.txt'), 'work in progress');
  const bin = stubGh(tmp, {});

  const out = runReap(repo, bin, '--dry-run');
  assert.match(out, /dirty_trees=1/, `the agent-less desk is a dirty tree nobody owns:\n${out}`);
  assert.match(out, /owner: nobody/, out);

  const live = 'feature/sweep-agent-working';
  const liveDesk = desk(repo, live, liveAgentWrapper());
  fs.writeFileSync(path.join(liveDesk.wt, 'half-done.txt'), 'work in progress');
  const both = runReap(repo, bin, '--dry-run');
  assert.match(both, /dirty_trees=1/, `a desk with a live agent is not counted:\n${both}`);
});

test('`waiting` and `stalled` are discarded by name: the desk readings answer them', () => {
  // Both words are reached only once no agent runs, and both answer what the
  // agent still OWES. The reaper takes the process fact under them (not
  // live) and leaves the debt to the marker and dirt readings — so the
  // refusal names the marker or the path, never `worker alive`.
  const { tmp, repo } = makeRepo();
  const waiting = 'feature/discard-waiting';
  const w = desk(repo, waiting, deadAgentWrapper());
  fs.writeFileSync(path.join(w.wt, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: which retry semantics?\n');
  const stalled = 'feature/discard-stalled';
  const s = desk(repo, stalled, deadAgentWrapper());
  fs.writeFileSync(path.join(s.wt, 'half-done.txt'), 'work on the floor');
  const bin = stubGh(tmp, { ...merged(waiting, w.head), ...merged(stalled, s.head) });

  assert.equal(workerState(w.wt)[0], 'waiting', 'precondition: the classifier says waiting');
  assert.equal(workerState(s.wt)[0], 'stalled', 'precondition: the classifier says stalled');

  const out = runReap(repo, bin, '--yes');
  assert.match(lineFor(out, waiting), /^keep.*PLOT-BLOCKED marker/, out);
  assert.match(lineFor(out, stalled), /^keep.*uncommitted: \?\? half-done\.txt/, out);
  assert.doesNotMatch(out, /worker alive/, 'neither word is read as a live worker');

  // And the mapping says so in code, as its own arm, so widening it is an edit
  // somebody has to make on purpose.
  const source = fs.readFileSync(reap, 'utf8');
  assert.match(source, /^\s*waiting\|stalled\)\s*;;/m,
    'plot-reap.sh maps `waiting|stalled` in their own arm, to no pid');
});
