// Contract test for the Bitbucket `mergeable` fold in
// skills/plot/scripts/plot-host.sh (`bb_fold_mergeable`/`bb_fold_mergeable_stream`).
//
// Bitbucket Cloud's REST API has no field for merge-conflict status, so the
// fold reads a local `git merge-tree --write-tree <base> <head>` instead,
// after the host's own JSON answer — never in place of it. A real sandbox
// repo (bare remote + clone, one clean branch and one conflicting branch)
// drives this through `pr-state <number>`, `pr-state <branch>` and
// `pr-list --rich`, because the fold's whole point is that a real git read
// tells `mergeable` from `conflicting` where the host cannot — a stubbed
// git would just assert the stub back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Same one-cleanup-site pattern as host.test.mjs: a leaked temp dir here is a
// stub sandbox or a bare/clone pair, not something worth a glob sweep.
function trackTemp(dir) {
  (trackTemp.paths ??= []).push(dir);
  return dir;
}
process.on('exit', () => {
  for (const dir of trackTemp.paths ?? []) rmSync(dir, { recursive: true, force: true });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const adapter = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-host.sh');

const BUDGET_ACCOUNT = 'bitbucket-mergeable-test-account';

// A `bb` stub that answers the capability probe (`--version`, `--help`) like
// the real CLI, then one fixed JSON body for every `pr view`/`pr list` call —
// mirroring host.test.mjs's `makeStubs`, but this file never varies the
// payload per state because every case here needs exactly one open PR row.
// A dedicated counter file (rather than parsing argv) lets a test assert "no
// extra host call" without caring about argv shape.
function makeCountingBbStub(prJson) {
  const dir = trackTemp(mkdtempSync(path.join(tmpdir(), 'plot-host-mt-stub-')));
  const countFile = path.join(dir, 'bb.count');
  writeFileSync(countFile, '0\n');
  const body = `#!/usr/bin/env bash
if [[ "\$*" == *"--version"* ]]; then echo "bb version 1.9.0"; exit 0; fi
if [[ "\$*" == *"--help"* ]]; then echo "bb pr list help"; exit 0; fi
c="\$(cat "${countFile}")"; echo "\$((c + 1))" > "${countFile}"
if [[ "\$*" == *"api "*"/pullrequests?state="* ]]; then
  printf '{"values":%s}' '${prJson.replace(/'/g, `'\\''`)}'
  exit 0
fi
printf '%s' '${prJson.replace(/'/g, `'\\''`)}'
`;
  writeFileSync(path.join(dir, 'bb'), body);
  chmodSync(path.join(dir, 'bb'), 0o755);
  return { dir, countFile };
}

function bbCallCount(countFile) {
  try {
    return Number(execFileSync('cat', [countFile], { encoding: 'utf8' }).trim());
  } catch {
    return 0;
  }
}

const budgetEnvFor = (stubDir) => ({
  PLOT_BUDGET_HOME: path.join(stubDir, 'budget-home'),
  PLOT_BUDGET_ACCOUNT: BUDGET_ACCOUNT,
});

function runInRepo(args, { repo, stubDir, env = {} }) {
  const res = spawnSync('bash', [adapter, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}`, ...budgetEnvFor(stubDir), PLOT_HOST: 'bitbucket', ...env },
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

// Builds a bare "origin" plus a working clone with three branches:
// `main` (two commits touching f.txt), `clean-branch` (adds a new file, no
// overlap with main) and `conflict-branch` (edits the same line of f.txt
// main's second commit also touched). Declares `## Plot Config` /
// `Git host: bitbucket` in the clone's CLAUDE.md so the adapter resolves the
// backend from cwd, the same convention makeJenkinsRepo uses in host.test.mjs.
function makeSandboxRepo() {
  const root = trackTemp(mkdtempSync(path.join(tmpdir(), 'plot-host-mt-sandbox-')));
  const bareDir = path.join(root, 'origin.git');
  const workDir = path.join(root, 'work');
  const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' });

  execFileSync('git', ['init', '-q', '--bare', bareDir]);
  execFileSync('git', ['clone', '-q', bareDir, workDir]);
  git(['config', 'user.email', 'test@example.test'], workDir);
  git(['config', 'user.name', 'Plot Test'], workDir);
  writeFileSync(path.join(workDir, 'CLAUDE.md'), '## Plot Config\n\n- **Git host:** bitbucket\n');
  writeFileSync(path.join(workDir, 'f.txt'), 'one\n');
  git(['add', '-A'], workDir);
  git(['commit', '-q', '-m', 'one'], workDir);
  git(['push', '-q', 'origin', 'HEAD:refs/heads/main'], workDir);

  // The branch point both feature branches fork from.
  git(['checkout', '-q', '-b', 'clean-branch'], workDir);
  writeFileSync(path.join(workDir, 'g.txt'), 'clean addition\n');
  git(['add', '-A'], workDir);
  git(['commit', '-q', '-m', 'clean addition'], workDir);
  const cleanSha = git(['rev-parse', 'HEAD'], workDir).trim();
  git(['push', '-q', 'origin', 'HEAD:refs/heads/clean-branch'], workDir);

  git(['checkout', '-q', 'main'], workDir);
  git(['checkout', '-q', '-b', 'conflict-branch'], workDir);
  writeFileSync(path.join(workDir, 'f.txt'), 'conflict-version\n');
  git(['add', '-A'], workDir);
  git(['commit', '-q', '-m', 'conflicting edit'], workDir);
  const conflictSha = git(['rev-parse', 'HEAD'], workDir).trim();
  git(['push', '-q', 'origin', 'HEAD:refs/heads/conflict-branch'], workDir);

  // Advance main with an overlapping edit so conflict-branch truly conflicts.
  git(['checkout', '-q', 'main'], workDir);
  writeFileSync(path.join(workDir, 'f.txt'), 'main-version\n');
  git(['add', '-A'], workDir);
  git(['commit', '-q', '-m', 'main-version'], workDir);
  git(['push', '-q', 'origin', 'HEAD:refs/heads/main'], workDir);

  // Back on main for the adapter's own cwd state; irrelevant to merge-tree,
  // which never touches the index or working tree.
  return { workDir, cleanSha, conflictSha };
}

function prRow({ id, state = 'OPEN', branch, baseBranch = 'main', headSha }) {
  return JSON.stringify({
    id,
    state,
    draft: false,
    source: { branch: { name: branch }, commit: { hash: headSha } },
    destination: { branch: { name: baseBranch } },
    links: { html: { href: `https://example.test/pr/${id}` } },
  });
}

function gitStatus(repo) {
  return execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' });
}

test('host: bitbucket pr-state by number reports mergeable for a clean branch', () => {
  const sandbox = makeSandboxRepo();
  const { dir } = makeCountingBbStub(prRow({ id: 1, branch: 'clean-branch', headSha: sandbox.cleanSha }));
  const before = gitStatus(sandbox.workDir);
  const out = runInRepo(['pr-state', '1'], { repo: sandbox.workDir, stubDir: dir });
  assert.equal(out.code, 0, out.stderr);
  const row = JSON.parse(out.stdout);
  assert.equal(row.mergeable, 'mergeable');
  assert.equal(row.mergeableReason, undefined);
  assert.equal(gitStatus(sandbox.workDir), before, 'merge-tree must not touch the index or working tree');
});

test('host: bitbucket pr-state by number reports conflicting for a conflicting branch', () => {
  const sandbox = makeSandboxRepo();
  const { dir } = makeCountingBbStub(prRow({ id: 2, branch: 'conflict-branch', headSha: sandbox.conflictSha }));
  const out = runInRepo(['pr-state', '2'], { repo: sandbox.workDir, stubDir: dir });
  assert.equal(out.code, 0, out.stderr);
  const row = JSON.parse(out.stdout);
  assert.equal(row.mergeable, 'conflicting');
  assert.equal(row.mergeableReason, undefined);
});

test('host: bitbucket pr-state by branch name reports the same mergeable reading as by number', () => {
  const sandbox = makeSandboxRepo();
  const { dir } = makeCountingBbStub(`[${prRow({ id: 3, branch: 'conflict-branch', headSha: sandbox.conflictSha })}]`);
  const out = runInRepo(['pr-state', 'conflict-branch'], { repo: sandbox.workDir, stubDir: dir });
  assert.equal(out.code, 0, out.stderr);
  assert.equal(JSON.parse(out.stdout).mergeable, 'conflicting');
});

test('host: bitbucket pr-list --rich distinguishes a clean branch from a conflicting one', () => {
  const sandbox = makeSandboxRepo();
  const rows = `[${prRow({ id: 10, branch: 'clean-branch', headSha: sandbox.cleanSha })}]`;
  const cleanStub = makeCountingBbStub(rows);
  const cleanOut = runInRepo(['pr-list', '--rich'], { repo: sandbox.workDir, stubDir: cleanStub.dir });
  assert.equal(cleanOut.code, 0, cleanOut.stderr);
  const cleanRows = cleanOut.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(cleanRows.find((r) => r.number === 10)?.mergeable, 'mergeable');

  const conflictRows = `[${prRow({ id: 11, branch: 'conflict-branch', headSha: sandbox.conflictSha })}]`;
  const conflictStub = makeCountingBbStub(conflictRows);
  const conflictOut = runInRepo(['pr-list', '--rich'], { repo: sandbox.workDir, stubDir: conflictStub.dir });
  assert.equal(conflictOut.code, 0, conflictOut.stderr);
  const cRows = conflictOut.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(cRows.find((r) => r.number === 11)?.mergeable, 'conflicting');
});

test('host: pr-list --rich on bitbucket never leaks the temporary base key', () => {
  const sandbox = makeSandboxRepo();
  const rows = `[${prRow({ id: 12, branch: 'clean-branch', headSha: sandbox.cleanSha })}]`;
  const { dir } = makeCountingBbStub(rows);
  const out = runInRepo(['pr-list', '--rich'], { repo: sandbox.workDir, stubDir: dir });
  assert.equal(out.code, 0, out.stderr);
  const row = out.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((r) => r.number === 12);
  assert.equal(row.base, undefined);
});

test('host: an unreachable head sha reads unknown with a reason, never conflicting', () => {
  const sandbox = makeSandboxRepo();
  const { dir } = makeCountingBbStub(
    prRow({ id: 20, branch: 'clean-branch', headSha: '0000000000000000000000000000000000dead' }),
  );
  const out = runInRepo(['pr-state', '20'], { repo: sandbox.workDir, stubDir: dir });
  assert.equal(out.code, 0, out.stderr);
  const row = JSON.parse(out.stdout);
  assert.equal(row.mergeable, 'unknown');
  assert.equal(row.mergeableReason, 'head commit 0000000000000000000000000000000000dead is not in the local clone');
});

test('host: a 12-character head hash, as Bitbucket reports it, still reads mergeable', () => {
  const sandbox = makeSandboxRepo();
  const { dir } = makeCountingBbStub(prRow({ id: 24, branch: 'clean-branch', headSha: sandbox.cleanSha.slice(0, 12) }));
  const out = runInRepo(['pr-state', '24'], { repo: sandbox.workDir, stubDir: dir });
  assert.equal(out.code, 0, out.stderr);
  const row = JSON.parse(out.stdout);
  assert.equal(row.mergeable, 'mergeable', row.mergeableReason);
});

test('host: a base branch the remote does not have reads unknown naming the base, never conflicting', () => {
  const sandbox = makeSandboxRepo();
  const { dir } = makeCountingBbStub(
    prRow({ id: 21, branch: 'clean-branch', baseBranch: 'does-not-exist', headSha: sandbox.cleanSha }),
  );
  const out = runInRepo(['pr-state', '21'], { repo: sandbox.workDir, stubDir: dir });
  assert.equal(out.code, 0, out.stderr);
  const row = JSON.parse(out.stdout);
  assert.equal(row.mergeable, 'unknown');
  assert.equal(row.mergeableReason, 'fetching origin/does-not-exist failed, so the local base may be stale');
});

test('host: a failed fetch (no origin remote) reads unknown, never conflicting', () => {
  const sandbox = makeSandboxRepo();
  execFileSync('git', ['remote', 'remove', 'origin'], { cwd: sandbox.workDir });
  const { dir } = makeCountingBbStub(prRow({ id: 22, branch: 'clean-branch', headSha: sandbox.cleanSha }));
  const out = runInRepo(['pr-state', '22'], { repo: sandbox.workDir, stubDir: dir });
  assert.equal(out.code, 0, out.stderr);
  const row = JSON.parse(out.stdout);
  assert.equal(row.mergeable, 'unknown');
  assert.notEqual(row.mergeable, 'conflicting');
});

// The remote is unreachable while `origin/main` is still in the clone: the
// stale ref must not be read, because main may have moved since it was fetched.
test('host: a failed fetch with a stale origin/<base> still present reads unknown, never mergeable', () => {
  const sandbox = makeSandboxRepo();
  execFileSync('git', ['remote', 'set-url', 'origin', path.join(sandbox.workDir, 'no-such-remote.git')], { cwd: sandbox.workDir });
  execFileSync('git', ['rev-parse', '--verify', 'origin/main'], { cwd: sandbox.workDir });
  const { dir } = makeCountingBbStub(prRow({ id: 25, branch: 'clean-branch', headSha: sandbox.cleanSha }));
  const out = runInRepo(['pr-state', '25'], { repo: sandbox.workDir, stubDir: dir });
  assert.equal(out.code, 0, out.stderr);
  const row = JSON.parse(out.stdout);
  assert.equal(row.mergeable, 'unknown');
  assert.equal(row.mergeableReason, 'fetching origin/main failed, so the local base may be stale');
});

// A `git` ahead of the real one on PATH that counts `fetch` calls, and refuses
// every fetch where `failFetch` is set.
function makeGitSpy({ failFetch = false } = {}) {
  const dir = trackTemp(mkdtempSync(path.join(tmpdir(), 'plot-host-mt-gitspy-')));
  const log = path.join(dir, 'fetch.log');
  writeFileSync(path.join(dir, 'git'), `#!/usr/bin/env bash
if [ "\$1" = fetch ]; then echo "\$*" >> "${log}"; ${failFetch ? 'exit 1' : ':'}; fi
exec /usr/bin/env PATH="${process.env.PATH}" git "$@"
`);
  chmodSync(path.join(dir, 'git'), 0o755);
  const fetches = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []);
  return { dir, fetches };
}

test('host: pr-list --rich fetches each distinct base once, however many rows name it', () => {
  const sandbox = makeSandboxRepo();
  const rows = `[${prRow({ id: 60, branch: 'clean-branch', headSha: sandbox.cleanSha })},`
    + `${prRow({ id: 61, branch: 'conflict-branch', headSha: sandbox.conflictSha })}]`;
  const { dir } = makeCountingBbStub(rows);
  const spy = makeGitSpy();
  const out = runInRepo(['pr-list', '--rich'], { repo: sandbox.workDir, stubDir: dir, env: { PATH: `${spy.dir}:${dir}:${process.env.PATH}` } });
  assert.equal(out.code, 0, out.stderr);
  const byNumber = new Map(out.stdout.trim().split('\n').map((l) => JSON.parse(l)).map((r) => [r.number, r]));
  assert.equal(byNumber.get(60).mergeable, 'mergeable');
  assert.equal(byNumber.get(61).mergeable, 'conflicting');
  assert.deepEqual(spy.fetches(), ['fetch -q origin +refs/heads/main:refs/remotes/origin/main']);
});

// A `node` ahead of the real one on PATH that fails only the mergeable bundle,
// so the fold has no reading to overlay.
function makeBrokenFoldNode() {
  const dir = trackTemp(mkdtempSync(path.join(tmpdir(), 'plot-host-mt-node-')));
  writeFileSync(path.join(dir, 'node'), `#!/usr/bin/env bash
case "\$1" in *plot-bitbucket-mergeable.mjs) exit 1 ;; esac
exec /usr/bin/env PATH="${process.env.PATH}" node "$@"
`);
  chmodSync(path.join(dir, 'node'), 0o755);
  return dir;
}

test('host: a fold with no reading keeps the pr-state and pr-list --rich rows unchanged', () => {
  const sandbox = makeSandboxRepo();
  const { dir } = makeCountingBbStub(`[${prRow({ id: 62, branch: 'clean-branch', headSha: sandbox.cleanSha })}]`);
  const env = { PATH: `${makeBrokenFoldNode()}:${dir}:${process.env.PATH}` };
  const list = runInRepo(['pr-list', '--rich'], { repo: sandbox.workDir, stubDir: dir, env });
  assert.equal(list.code, 0, list.stderr);
  const row = JSON.parse(list.stdout.trim());
  assert.equal(row.number, 62);
  assert.equal(row.mergeable, 'unknown');
  assert.equal(row.base, undefined);

  const state = runInRepo(['pr-state', 'clean-branch'], { repo: sandbox.workDir, stubDir: dir, env });
  assert.equal(state.code, 0, state.stderr);
  assert.equal(JSON.parse(state.stdout).number, 62);
  assert.equal(JSON.parse(state.stdout).mergeable, 'unknown');
});

test('host: old git reads unknown even for a cleanly-merging branch, never mergeable', () => {
  const sandbox = makeSandboxRepo();
  const { dir } = makeCountingBbStub(prRow({ id: 23, branch: 'clean-branch', headSha: sandbox.cleanSha }));
  // A PATH entry ahead of the real git, answering only --version with an old one.
  const oldGitDir = trackTemp(mkdtempSync(path.join(tmpdir(), 'plot-host-mt-oldgit-')));
  writeFileSync(path.join(oldGitDir, 'git'), `#!/usr/bin/env bash
if [ "\$1" = "--version" ]; then echo "git version 2.30.0"; exit 0; fi
exec /usr/bin/env PATH="${process.env.PATH}" git "$@"
`);
  chmodSync(path.join(oldGitDir, 'git'), 0o755);
  const out = runInRepo(['pr-state', '23'], {
    repo: sandbox.workDir,
    stubDir: dir,
    env: { PATH: `${oldGitDir}:${dir}:${process.env.PATH}` },
  });
  assert.equal(out.code, 0, out.stderr);
  const row = JSON.parse(out.stdout);
  assert.equal(row.mergeable, 'unknown');
  assert.match(row.mergeableReason, /2\.38/);
});

test('host: MERGED rows keep mergeable unknown and run no git merge-tree call', () => {
  const sandbox = makeSandboxRepo();
  const { dir } = makeCountingBbStub(prRow({ id: 30, state: 'MERGED', branch: 'clean-branch', headSha: sandbox.cleanSha }));
  const before = gitStatus(sandbox.workDir);
  const out = runInRepo(['pr-state', '30'], { repo: sandbox.workDir, stubDir: dir });
  assert.equal(out.code, 0, out.stderr);
  const row = JSON.parse(out.stdout);
  assert.equal(row.mergeable, 'unknown');
  assert.equal(gitStatus(sandbox.workDir), before);
});

test('host: NONE rows (no pull request) carry no mergeable key at all', () => {
  const sandbox = makeSandboxRepo();
  const { dir } = makeCountingBbStub('[]');
  const out = runInRepo(['pr-state', 'no-such-branch'], { repo: sandbox.workDir, stubDir: dir });
  assert.equal(out.code, 0, out.stderr);
  const row = JSON.parse(out.stdout);
  assert.equal(row.state, 'NONE');
  assert.equal(row.mergeable, undefined);
});

test('host: the fold charges no extra bb call — host call count is unchanged', () => {
  const sandbox = makeSandboxRepo();
  const { dir, countFile } = makeCountingBbStub(prRow({ id: 40, branch: 'clean-branch', headSha: sandbox.cleanSha }));
  const out = runInRepo(['pr-state', '40'], { repo: sandbox.workDir, stubDir: dir });
  assert.equal(out.code, 0, out.stderr);
  // One capability probe may run once (cached across the rest of the process);
  // the row-fetch itself is the single remaining call this command makes —
  // merge-tree is a local git read and must add zero.
  assert.ok(bbCallCount(countFile) <= 2, `expected at most 2 bb calls, got ${bbCallCount(countFile)}`);
});

test('host: pr-state and pr-list --rich leave a sandbox index and working tree untouched', () => {
  const sandbox = makeSandboxRepo();
  const before = gitStatus(sandbox.workDir);
  const { dir } = makeCountingBbStub(prRow({ id: 50, branch: 'conflict-branch', headSha: sandbox.conflictSha }));
  runInRepo(['pr-state', '50'], { repo: sandbox.workDir, stubDir: dir });
  runInRepo(['pr-list', '--rich'], { repo: sandbox.workDir, stubDir: dir });
  assert.equal(gitStatus(sandbox.workDir), before);
});
