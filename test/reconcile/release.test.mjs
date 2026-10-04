// Contract test for `plot-dispatch.sh --release <branch>` — returning an
// abandoned slice to the queue by clearing BOTH records of its assignment.
//
// An assignment has two records: the claim ref `origin/<branch>`, which the
// scan and the registry's queue read, and the agent manifest's `branch` field,
// which the registry wrote when it handed the slice over. Deleting the ref by
// hand clears the first and leaves the second. Measured 2026-09-26:
// `feature/the-board-filters-to-my-work` was handed out twice after that hand
// repair, and the second agent logged `REGISTRY LOCK VIOLATION`.
//
// The refusals mirror `--restart`, in its order: the PR first, then a live
// worker, then real work, then a PLOT-BLOCKED marker. A refusal writes nothing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const dispatch = path.join(scripts, 'plot-dispatch.sh');
const scan = path.join(scripts, 'plot-fleet-scan.sh');

// `plot-config.sh` prefers an exported PLOT_REPO_ROOT over `git rev-parse`, so
// a suite running inside a dispatched worker's desk would read the host repo's
// config and write into the host's registry. `restart.test.mjs` carries the
// measurement.
delete process.env.PLOT_REPO_ROOT;

const BRANCH = 'feature/abandoned';
const SLUG = 'releasable';

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

const ctx = [];
const pids = [];
after(() => {
  for (const pid of pids) { try { process.kill(Number(pid)); } catch { /* gone */ } }
  for (const t of ctx) fs.rmSync(t, { recursive: true, force: true });
});

// A repo with an origin, an Approved plan naming one branch, and a brief on
// origin/main, so the scan offers the branch once nobody holds it.
const makeRepo = () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-release-'));
  ctx.push(tmp);
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'),
    '## Plot Config\n\n'
    + '- **Plan directory:** plans/\n'
    + '- **Main branch:** main\n'
    + '- **Worker command:** sleep 300 </dev/null >/dev/null 2>&1\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), '.plot/agents/\n.plot-worker.*\n');
  fs.mkdirSync(path.join(repo, 'plans'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'plans', `2026-09-26-${SLUG}.md`),
    '# Releasable\n\n## Status\n\n- **Phase:** Approved\n- **Type:** bug\n\n'
    + `## Branches\n\n### Abandoned\n\n- \`${BRANCH}\` — the abandoned work\n`);
  fs.mkdirSync(path.join(repo, '.plot', 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.plot', 'briefs', 'abandoned.md'), 'Build it.\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  git(repo, 'push', '-q', 'origin', 'main');
  return { tmp, repo };
};

// The claim exactly as `plot-worker-loop.sh` makes it: a desk cut from
// origin/main, an EMPTY commit, and a push. Returns the push's exit status and
// its stderr, since a rejected claim push is the event under test.
const claim = (repo, desk) => {
  git(repo, 'worktree', 'add', '-q', '-b', BRANCH, desk, 'origin/main');
  git(desk, 'commit', '--allow-empty', '-qm', `plot: claim ${BRANCH}`);
  const push = spawnSync('git', ['push', '-u', 'origin', BRANCH], { cwd: desk, encoding: 'utf8' });
  return { status: push.status, stderr: push.stderr };
};

// An agent manifest as the registry leaves it after a hand-over.
const manifestDir = (repo) => path.join(repo, '.plot', 'agents');
const writeManifest = (repo, session, { branch = BRANCH, worktree = '', pid = '' } = {}) => {
  fs.mkdirSync(manifestDir(repo), { recursive: true });
  const file = path.join(manifestDir(repo), `${session}.json`);
  fs.writeFileSync(file, JSON.stringify({
    session, resumeId: session, branch, worktree, command: 'sleep', pid,
    attempts: 0, startedAt: '2020-01-01T00:00:00Z',
  }, null, 2) + '\n');
  return file;
};
const manifestBranch = (file) => JSON.parse(fs.readFileSync(file, 'utf8')).branch;

const remoteRef = (repo) => {
  const r = spawnSync('git', ['ls-remote', '--heads', 'origin', BRANCH], { cwd: repo, encoding: 'utf8' });
  return r.stdout.trim();
};

// A `gh` shim on PATH, as in `restart.test.mjs`: `plot-host.sh` calls `gh` by
// bare name, so this controls the PR fact while the scripts under test stay
// the real ones. `fail` makes every `pr` call fail the way an outage does.
const ghShim = ({ state = null, fail = false } = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-release-gh-'));
  ctx.push(dir);
  const body = state
    ? `{"number":77,"state":"${state}","isDraft":false,"url":"https://example.invalid/pr/77","mergeCommit":{"oid":"abc123"}}`
    : null;
  let arms;
  if (fail) {
    arms = '  "pr "*) echo "HTTP 503: Service Unavailable" >&2; exit 1 ;;\n';
  } else if (body) {
    arms = `  "pr view") printf '%s' '${body}' ;;\n`
      + `  "pr list") printf '%s' '[{"mergedAt":${state === 'MERGED' ? '"2026-09-26T00:00:00Z"' : 'null'}}]' ;;\n`;
  } else {
    arms = '  "pr view") echo "no pull requests found" >&2; exit 1 ;;\n'
      + '  "pr list") echo "[]" ;;\n';
  }
  fs.writeFileSync(path.join(dir, 'gh'),
    '#!/usr/bin/env bash\ncase "$1 $2" in\n' + arms + '  *) echo "{}" ;;\nesac\n');
  fs.chmodSync(path.join(dir, 'gh'), 0o755);
  return dir;
};

// Run the dispatcher with output captured through files, not pipes: a
// detached worker would otherwise hold the pipe open (see `restart.test.mjs`).
const run = (repo, args, { gh = ghShim(), expectFail = false } = {}) => {
  const env = { ...process.env, PLOT_AGENT_PROCESS: 'sleep', PATH: `${gh}:${process.env.PATH}` };
  delete env.PLOT_REPO_ROOT;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-release-out-'));
  ctx.push(dir);
  const outFd = fs.openSync(path.join(dir, 'out'), 'w');
  const errFd = fs.openSync(path.join(dir, 'err'), 'w');
  let status = 0;
  try {
    execFileSync('bash', [dispatch, ...args], { cwd: repo, env, stdio: ['ignore', outFd, errFd] });
  } catch (e) {
    status = e.status ?? 1;
  } finally {
    fs.closeSync(outFd);
    fs.closeSync(errFd);
  }
  const stdout = fs.readFileSync(path.join(dir, 'out'), 'utf8')
    + fs.readFileSync(path.join(dir, 'err'), 'utf8');
  if (expectFail && status === 0) assert.fail(`expected a refusal, got:\n${stdout}`);
  if (!expectFail && status !== 0) assert.fail(`unexpected failure (${status}):\n${stdout}`);
  return { stdout, status };
};

// The registry's reading of the queue, asked the way a hand-over asks it:
// `--next` names the branch only when no claim ref exists.
const nextBranch = (repo) => {
  const r = spawnSync('bash', [scan, '--offline', '--next', SLUG], { cwd: repo, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
};

// A live worker's shape: a wrapper with an agent beneath it (`restart.test.mjs`
// explains why a bare `sleep` is not one).
const spawnLive = () => {
  const pid = execFileSync('bash', ['-c',
    "nohup sh -c 'sleep 300 & exec sleep 300' </dev/null >/dev/null 2>&1 & echo $!",
  ], { encoding: 'utf8' }).trim();
  pids.push(pid);
  return pid;
};

// ---------------------------------------------------------------------------
// The measured sequence
// ---------------------------------------------------------------------------

test('--release reproduces the measured sequence: assign, kill, release, re-assign, and the second claim push lands', () => {
  const { tmp, repo } = makeRepo();

  // Pass A hands the slice to agent 1, which claims it.
  const desk1 = path.join(tmp, 'desk-1');
  assert.equal(claim(repo, desk1).status, 0, 'agent 1 claims the branch');
  const manifest1 = writeManifest(repo, 'agent-1', { worktree: desk1, pid: '999999' });

  // Agent 1 dies: no live pid, and its desk is gone. The claim ref stays.
  git(repo, 'worktree', 'remove', '--force', desk1);
  git(repo, 'branch', '-D', BRANCH);
  assert.equal(nextBranch(repo), '', 'while the ref stands, the queue offers nothing');

  const res = run(repo, ['--release', BRANCH]);
  assert.match(res.stdout, /released feature\/abandoned/);
  assert.match(res.stdout, /summary: released=1 manifests=1 ref=deleted detached=0/);
  assert.equal(remoteRef(repo), '', 'the claim ref is gone');
  assert.equal(manifestBranch(manifest1), '', "agent 1's manifest no longer names the branch");

  // Pass B: the queue offers the slice again, and agent 2 takes it.
  assert.equal(nextBranch(repo), BRANCH, 'the released slice is claimable again');
  writeManifest(repo, 'agent-2');
  const second = claim(repo, path.join(tmp, 'desk-2'));
  assert.equal(second.status, 0, `the second claim push must land:\n${second.stderr}`);
  assert.doesNotMatch(second.stderr, /rejected/);
  assert.notEqual(remoteRef(repo), '', 'agent 2 now holds the claim');

  // Exactly one manifest names the branch: agent 2's.
  const named = fs.readdirSync(manifestDir(repo))
    .map((f) => JSON.parse(fs.readFileSync(path.join(manifestDir(repo), f), 'utf8')))
    .filter((m) => m.branch === BRANCH)
    .map((m) => m.session);
  assert.deepEqual(named, ['agent-2']);
});

test('negative control: deleting only the ref leaves the manifest naming the branch, and --release clears it', () => {
  const { tmp, repo } = makeRepo();
  const desk1 = path.join(tmp, 'desk-1');
  claim(repo, desk1);
  const manifest1 = writeManifest(repo, 'agent-1', { worktree: desk1, pid: '999999' });
  git(repo, 'worktree', 'remove', '--force', desk1);
  git(repo, 'branch', '-D', BRANCH);

  // The old hand repair.
  git(repo, 'push', '-q', 'origin', '--delete', BRANCH);
  assert.equal(remoteRef(repo), '');
  assert.equal(nextBranch(repo), BRANCH, 'the queue offers the slice');
  assert.equal(manifestBranch(manifest1), BRANCH,
    'the hand repair leaves the second record of the assignment in place');

  // THE STALE MANIFEST RE-CREATES NO REF. With agent 1 dead, nothing reads its
  // manifest to push, and the queue reads refs rather than manifests, so a
  // second agent's claim lands here too. The measured rejection therefore
  // needed another writer of the ref between the hand deletion and agent 2's
  // push; this sandbox holds none.
  writeManifest(repo, 'agent-2');
  const second = claim(repo, path.join(tmp, 'desk-2'));
  assert.equal(second.status, 0, `measured: the claim push lands after a hand deletion:\n${second.stderr}`);
  git(repo, 'push', '-q', 'origin', '--delete', BRANCH);
  fs.rmSync(path.join(manifestDir(repo), 'agent-2.json'));

  // --release repairs the half the hand deletion missed.
  const res = run(repo, ['--release', BRANCH]);
  assert.match(res.stdout, /ref=absent/);
  assert.equal(manifestBranch(manifest1), '');
});

test('--release with no manifest still releases the ref, and says so', () => {
  const { tmp, repo } = makeRepo();
  const desk1 = path.join(tmp, 'desk-1');
  claim(repo, desk1);
  git(repo, 'worktree', 'remove', '--force', desk1);
  git(repo, 'branch', '-D', BRANCH);

  const res = run(repo, ['--release', BRANCH]);
  assert.match(res.stdout, /no manifest in .* names feature\/abandoned/);
  assert.match(res.stdout, /manifests=0 ref=deleted/);
  assert.equal(remoteRef(repo), '');
});

test('--release clears only the branch field, and leaves every other manifest field as written', () => {
  const { tmp, repo } = makeRepo();
  const desk1 = path.join(tmp, 'desk-1');
  claim(repo, desk1);
  const manifest1 = writeManifest(repo, 'agent-1', { worktree: desk1, pid: '999999' });
  const other = writeManifest(repo, 'agent-other', { branch: 'feature/unrelated' });
  git(repo, 'worktree', 'remove', '--force', desk1);
  git(repo, 'branch', '-D', BRANCH);
  const before = JSON.parse(fs.readFileSync(manifest1, 'utf8'));

  run(repo, ['--release', BRANCH]);
  assert.deepEqual(JSON.parse(fs.readFileSync(manifest1, 'utf8')), { ...before, branch: '' });
  assert.equal(manifestBranch(other), 'feature/unrelated', 'a manifest naming another branch is untouched');
});

// ---------------------------------------------------------------------------
// The refusals — each leaves the ref, the manifests and the desk untouched
// ---------------------------------------------------------------------------

const assertUntouched = (repo, manifest, refBefore) => {
  assert.equal(remoteRef(repo), refBefore, 'the claim ref is untouched');
  assert.equal(manifestBranch(manifest), BRANCH, 'the manifest still names the branch');
};

for (const state of ['OPEN', 'MERGED']) {
  test(`--release REFUSES when a ${state} PR exists, and names it`, () => {
    const { tmp, repo } = makeRepo();
    claim(repo, path.join(tmp, 'desk-1'));
    const manifest = writeManifest(repo, 'agent-1');
    const refBefore = remoteRef(repo);

    const res = run(repo, ['--release', BRANCH], { gh: ghShim({ state }), expectFail: true });
    assert.match(res.stdout, /#77/);
    assert.match(res.stdout, /pull request/);
    assertUntouched(repo, manifest, refBefore);
  });
}

test('--release REFUSES when the host cannot be asked — silence is not "no PR"', () => {
  const { tmp, repo } = makeRepo();
  claim(repo, path.join(tmp, 'desk-1'));
  const manifest = writeManifest(repo, 'agent-1');
  const refBefore = remoteRef(repo);

  const res = run(repo, ['--release', BRANCH], { gh: ghShim({ fail: true }), expectFail: true });
  assert.match(res.stdout, /could not be asked|could not say/);
  assertUntouched(repo, manifest, refBefore);
});

test('--release REFUSES under --offline, which forbids the PR question', () => {
  const { tmp, repo } = makeRepo();
  claim(repo, path.join(tmp, 'desk-1'));
  const manifest = writeManifest(repo, 'agent-1');
  const refBefore = remoteRef(repo);

  const res = run(repo, ['--offline', '--release', BRANCH], { expectFail: true });
  assert.match(res.stdout, /--offline/);
  assertUntouched(repo, manifest, refBefore);
});

test('--release REFUSES a live worker and names its pid', () => {
  const { tmp, repo } = makeRepo();
  const desk = path.join(tmp, 'desk-1');
  claim(repo, desk);
  const pid = spawnLive();
  fs.writeFileSync(path.join(desk, '.plot-worker.pid'), pid);
  const manifest = writeManifest(repo, 'agent-1', { worktree: fs.realpathSync(desk), pid });
  const refBefore = remoteRef(repo);

  const res = run(repo, ['--release', BRANCH], { expectFail: true });
  assert.match(res.stdout, new RegExp(`pid ${pid}\\b`), 'the refusal names the live pid');
  assert.match(res.stdout, /--stop feature\/abandoned/);
  assertUntouched(repo, manifest, refBefore);
  assert.doesNotThrow(() => process.kill(Number(pid), 0), 'the live worker still runs');
});

test('--release REFUSES a live agent whose OWN desk holds a different branch, and names the agent', () => {
  // THE GAP `release_wt`-ONLY DETECTION MISSES: the agent was just handed
  // BRANCH and has not checked it out — its manifest names BRANCH, but its own
  // desk's HEAD is still the slice it was working before. `release_wt` is
  // empty, so the live-worker refusal that reads it never runs; this is the
  // refusal that must catch it instead, asked through the domain.
  const { tmp, repo } = makeRepo();
  claim(repo, path.join(tmp, 'desk-abandoned'));
  const ownDesk = path.join(tmp, 'own-desk');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature/other-slice', ownDesk, 'origin/main');
  const pid = spawnLive();
  fs.writeFileSync(path.join(ownDesk, '.plot-worker.pid'), pid);
  const manifest = writeManifest(repo, 'agent-1', { worktree: fs.realpathSync(ownDesk), pid });
  const refBefore = remoteRef(repo);

  const res = run(repo, ['--release', BRANCH], { expectFail: true });
  assert.match(res.stdout, /held by a live agent/);
  assert.match(res.stdout, /agent-1/);
  assertUntouched(repo, manifest, refBefore);
  assert.equal(
    spawnSync('git', ['symbolic-ref', '-q', 'HEAD'], { cwd: ownDesk, encoding: 'utf8' }).stdout.trim(),
    'refs/heads/feature/other-slice',
    "agent-1's own desk is untouched",
  );
});

test('--release REFUSES real work pushed to the remote branch', () => {
  const { tmp, repo } = makeRepo();
  const desk = path.join(tmp, 'desk-1');
  claim(repo, desk);
  fs.writeFileSync(path.join(desk, 'work.txt'), 'real work\n');
  git(desk, 'add', 'work.txt');
  git(desk, 'commit', '-qm', 'real work');
  git(desk, 'push', '-q', 'origin', BRANCH);
  git(repo, 'worktree', 'remove', '--force', desk);
  const manifest = writeManifest(repo, 'agent-1');
  const refBefore = remoteRef(repo);

  const res = run(repo, ['--release', BRANCH], { expectFail: true });
  assert.match(res.stdout, /origin\/feature\/abandoned carries 1 commit/);
  assertUntouched(repo, manifest, refBefore);
});

test('--release REFUSES a desk holding an unpushed commit — the measured victim\'s shape', () => {
  const { tmp, repo } = makeRepo();
  const desk = path.join(tmp, 'desk-1');
  claim(repo, desk);
  fs.writeFileSync(path.join(desk, 'work.txt'), 'unpushed work\n');
  git(desk, 'add', 'work.txt');
  git(desk, 'commit', '-qm', 'unpushed work');
  const manifest = writeManifest(repo, 'agent-1', { worktree: fs.realpathSync(desk), pid: '999999' });
  const refBefore = remoteRef(repo);

  const res = run(repo, ['--release', BRANCH], { expectFail: true });
  assert.match(res.stdout, /1 unpushed commit/);
  assert.match(res.stdout, new RegExp(fs.realpathSync(desk).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assertUntouched(repo, manifest, refBefore);
  assert.equal(git(desk, 'log', '-1', '--format=%s').trim(), 'unpushed work', 'the desk is untouched');
});

test('--release REFUSES a desk holding uncommitted changes', () => {
  const { tmp, repo } = makeRepo();
  const desk = path.join(tmp, 'desk-1');
  claim(repo, desk);
  fs.writeFileSync(path.join(desk, 'floor.txt'), 'on the floor\n');
  const manifest = writeManifest(repo, 'agent-1', { worktree: fs.realpathSync(desk), pid: '999999' });
  const refBefore = remoteRef(repo);

  const res = run(repo, ['--release', BRANCH], { expectFail: true });
  assert.match(res.stdout, /uncommitted changes: floor\.txt/);
  assertUntouched(repo, manifest, refBefore);
  assert.ok(fs.existsSync(path.join(desk, 'floor.txt')));
});

test('--release REFUSES a desk carrying a PLOT-BLOCKED marker', () => {
  const { tmp, repo } = makeRepo();
  const desk = path.join(tmp, 'desk-1');
  claim(repo, desk);
  // Ignored, so the marker is not also uncommitted work: this isolates the
  // marker refusal from the dirty-desk one.
  fs.mkdirSync(path.join(repo, '.git', 'info'), { recursive: true });
  fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), 'PLOT-BLOCKED*\n');
  fs.writeFileSync(path.join(desk, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: which format?\n');
  const manifest = writeManifest(repo, 'agent-1', { worktree: fs.realpathSync(desk), pid: '999999' });
  const refBefore = remoteRef(repo);

  const res = run(repo, ['--release', BRANCH], { expectFail: true });
  assert.match(res.stdout, /blocked on a question/);
  assert.match(res.stdout, /PLOT-BLOCKED\.md/);
  assertUntouched(repo, manifest, refBefore);
});

// ---------------------------------------------------------------------------
// The desk a release leaves behind
// ---------------------------------------------------------------------------
//
// Measured 2026-10-02: after `--release` deleted `origin/<branch>`, the dead
// agent's desk still held the branch with only its empty claim commit. The
// next agent handed the slice asked #1198's `checkoutYield` whether that
// checkout yields; with no upstream, `unpushedCommits` read `unknown`, so it
// kept, and the agent wrote PLOT-BLOCKED and ended. Fifteen agents in a row did
// that for two released slices.

const headRef = (desk) => spawnSync('git', ['symbolic-ref', '-q', 'HEAD'], { cwd: desk, encoding: 'utf8' }).stdout.trim();
const localBranch = (repo) => spawnSync('git', ['rev-parse', '-q', '--verify', `refs/heads/${BRANCH}`], { cwd: repo, encoding: 'utf8' }).stdout.trim();

test('--release detaches a clean desk holding only its claim commit at origin/main, and deletes the local branch', () => {
  const { tmp, repo } = makeRepo();
  const desk = path.join(tmp, 'desk-1');
  claim(repo, desk);
  const manifest = writeManifest(repo, 'agent-1', { worktree: fs.realpathSync(desk), pid: '999999' });

  const res = run(repo, ['--release', BRANCH]);
  assert.match(res.stdout, /detached the desk at .*desk-1 at origin\/main and deleted the local branch feature\/abandoned/);
  assert.doesNotMatch(res.stdout, /left as it is/);
  assert.match(res.stdout, /summary: released=1 manifests=1 ref=deleted detached=1/);
  assert.equal(headRef(desk), '', 'the desk is detached');
  assert.equal(git(desk, 'rev-parse', 'HEAD').trim(), git(repo, 'rev-parse', 'origin/main').trim(),
    'the desk sits at origin/main');
  assert.equal(localBranch(repo), '', 'the local branch is gone');
  assert.ok(fs.existsSync(desk), 'the worktree itself stays — the reaper owns removal');
  assert.equal(manifestBranch(manifest), '');
});

test('after that release, the next hand-over checks the branch out in a new desk', () => {
  const { tmp, repo } = makeRepo();
  const desk1 = path.join(tmp, 'desk-1');
  claim(repo, desk1);
  writeManifest(repo, 'agent-1', { worktree: fs.realpathSync(desk1), pid: '999999' });
  run(repo, ['--release', BRANCH]);

  assert.equal(nextBranch(repo), BRANCH, 'the released slice is claimable again');
  // The hand-over's own step: `git worktree add -b <branch>` from origin/main.
  // Before the fix git refused, because desk-1 still held the branch.
  const second = claim(repo, path.join(tmp, 'desk-2'));
  assert.equal(second.status, 0, `the second claim push must land:\n${second.stderr}`);
  assert.notEqual(remoteRef(repo), '', 'agent 2 now holds the claim');
});

test('--release leaves a desk holding a file-changing commit untouched, because it still refuses', () => {
  const { tmp, repo } = makeRepo();
  const desk = path.join(tmp, 'desk-1');
  claim(repo, desk);
  fs.writeFileSync(path.join(desk, 'work.txt'), 'unpushed work\n');
  git(desk, 'add', 'work.txt');
  git(desk, 'commit', '-qm', 'unpushed work');
  const manifest = writeManifest(repo, 'agent-1', { worktree: fs.realpathSync(desk), pid: '999999' });
  const refBefore = remoteRef(repo);

  const res = run(repo, ['--release', BRANCH], { expectFail: true });
  assert.match(res.stdout, /holds work for feature\/abandoned/);
  assert.doesNotMatch(res.stdout, /detached/);
  assertUntouched(repo, manifest, refBefore);
  assert.equal(headRef(desk), `refs/heads/${BRANCH}`, 'the desk still holds the branch');
  assert.notEqual(localBranch(repo), '', 'the local branch stays');
});

test('--release keeps a desk whose tree the desk-dirt reading counts, and says why', () => {
  const { tmp, repo } = makeRepo();
  const desk = path.join(tmp, 'desk-1');
  claim(repo, desk);
  // An editor leftover: `plot_worker_dirty` drops it, so release does not
  // refuse, while `desk_dirt` counts it, so the desk is not changed.
  fs.writeFileSync(path.join(desk, 'notes.swp'), 'leftover\n');
  writeManifest(repo, 'agent-1', { worktree: fs.realpathSync(desk), pid: '999999' });

  const res = run(repo, ['--release', BRANCH]);
  assert.match(res.stdout, /still holds feature\/abandoned and is left as it is: uncommitted changes/);
  assert.equal(headRef(desk), `refs/heads/${BRANCH}`, 'the desk still holds the branch');
  assert.notEqual(localBranch(repo), '', 'the local branch stays');
  assert.ok(fs.existsSync(path.join(desk, 'notes.swp')));
});

test('--release requires an explicit branch, and refuses a bare slug', () => {
  const { repo } = makeRepo();
  const res = run(repo, ['--release', SLUG], { expectFail: true });
  assert.match(res.stdout, /--release needs a branch name/);
});

// ---------------------------------------------------------------------------
// --stop keeps the claim; the two verbs say how they differ
// ---------------------------------------------------------------------------

test('--stop still keeps the claim and the assignment, and names --release', () => {
  const { tmp, repo } = makeRepo();
  const desk = path.join(tmp, 'desk-1');
  claim(repo, desk);
  const pid = spawnLive();
  fs.writeFileSync(path.join(desk, '.plot-worker.pid'), pid);
  const manifest = writeManifest(repo, 'agent-1', { worktree: fs.realpathSync(desk), pid });
  const refBefore = remoteRef(repo);

  const res = run(repo, ['--stop', BRANCH]);
  assert.match(res.stdout, new RegExp(`stopped feature/abandoned \\(pid ${pid}\\)`));
  assert.match(res.stdout, /plot-dispatch\.sh --release feature\/abandoned/);
  assertUntouched(repo, manifest, refBefore);
});

test('--help states the difference between --stop and --release', () => {
  const help = execFileSync('bash', [dispatch, '--help'], { encoding: 'utf8' });
  assert.match(help, /--release <br>/);
  assert.match(help, /--stop ends a worker and KEEPS the claim/);
  assert.match(help, /<slug> +the plan to fan out/, 'the help range still reaches the last option');
});
