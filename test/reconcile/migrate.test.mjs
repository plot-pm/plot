// Contract test for `plot-dispatch.sh --migrate` — moving legacy worktrees into
// the configured `Worktree root:`.
//
// THE REFUSALS ARE THE FEATURE. `git worktree move` on a checkout an agent is
// writing to breaks it mid-run, so --migrate moves a worktree only when it has
// NO LIVE WORKER and NO UNLANDED WORK, and names every one it skipped with the
// reason. These are two INDEPENDENT conditions — a hand-made worktree with a
// dirty tree and no Plot worker record is not idle — so the tests drive both
// halves separately.
//
// --dry-run by default, like plot-reap.sh; --yes moves. A repo with no
// `Worktree root:` has nothing to migrate and must say so rather than invent a
// destination.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const dispatch = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-dispatch.sh');

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}

// Build a fresh repo with an origin and a `Worktree root:` config, unless
// `worktreeRoot` is null (the "nothing to migrate" case). Returns { tmp, repo }.
function makeRepo({ worktreeRoot = '.worktrees/' } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-migrate-'));
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  let config = '## Plot Config\n\n- **Plan directory:** plans/\n';
  if (worktreeRoot) config += `- **Worktree root:** ${worktreeRoot}\n`;
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), config);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  git(repo, 'push', '-q', 'origin', 'main');
  return { tmp, repo };
}

// A legacy worktree beside the repo, named `plot-wt-<flattened branch>`, on a
// branch pushed to origin so it has an upstream with nothing ahead. Returns the
// worktree path.
function legacyWorktree(repo, branch) {
  const parent = path.dirname(repo);
  const wt = path.join(parent, 'plot-wt-' + branch.replace(/\//g, '-'));
  git(repo, 'branch', branch);
  git(repo, 'worktree', 'add', '-q', wt, branch);
  git(wt, 'push', '-q', '-u', 'origin', branch);
  return wt;
}

function run(repo, ...args) {
  return execFileSync('bash', [dispatch, '--migrate', ...args], { encoding: 'utf8', cwd: repo });
}

// The verdict line for one worktree basename.
function verdictLine(out, basename) {
  return out.split('\n').find((l) => l.includes(basename)) ?? '';
}

let ctx = [];
after(() => { for (const t of ctx) fs.rmSync(t, { recursive: true, force: true }); });
function track(tmp) { ctx.push(tmp); }

test('--migrate: a repo declaring no Worktree root has nothing to migrate', () => {
  const { tmp, repo } = makeRepo({ worktreeRoot: null });
  track(tmp);
  // Even with a legacy worktree present, with no destination configured the
  // mode must say so rather than invent one — and move nothing.
  legacyWorktree(repo, 'feature/idle');
  const out = run(repo);
  assert.match(out, /no 'Worktree root:' configured/i);
  assert.doesNotMatch(out, /would move|moved/i);
  // The worktree is untouched.
  assert.ok(fs.existsSync(path.join(path.dirname(repo), 'plot-wt-feature-idle')));
});

test('--migrate: dry-run by default names the destination and moves nothing', () => {
  const { tmp, repo } = makeRepo();
  track(tmp);
  const wt = legacyWorktree(repo, 'feature/idle');
  const out = run(repo);
  assert.match(out, /would\b.*plot-wt-feature-idle/);
  assert.match(out, /\.worktrees\/feature-idle/);
  assert.match(out.trim().split('\n').at(-1) === '' ? out : out, /dry_run=1/);
  // Nothing moved.
  assert.ok(fs.existsSync(wt), 'dry-run must not move the worktree');
  assert.ok(!fs.existsSync(path.join(repo, '.worktrees', 'feature-idle')));
});

test('--migrate --yes moves an idle worktree into the configured root, no prefix', () => {
  const { tmp, repo } = makeRepo();
  track(tmp);
  const wt = legacyWorktree(repo, 'feature/idle');
  const out = run(repo, '--yes');
  assert.match(out, /moved\b.*plot-wt-feature-idle/);
  assert.match(out, /moved=1/);
  // The directory now lives under the root, named by the flattened branch with
  // NO plot-wt- prefix — the directory itself says what it is.
  assert.ok(!fs.existsSync(wt), 'the legacy worktree is gone');
  const dest = path.join(repo, '.worktrees', 'feature-idle');
  assert.ok(fs.existsSync(dest), 'the worktree lives under .worktrees/');
  // git agrees it is the same worktree, on the same branch.
  const list = git(repo, 'worktree', 'list');
  assert.match(list, /\.worktrees\/feature-idle.*\[feature\/idle\]/);
});

test('--migrate REFUSES a worktree with uncommitted work, naming the file', () => {
  const { tmp, repo } = makeRepo();
  track(tmp);
  const wt = legacyWorktree(repo, 'feature/dirty');
  fs.writeFileSync(path.join(wt, 'scratch.ts'), 'work on the floor\n');
  const out = run(repo, '--yes');
  const line = verdictLine(out, 'plot-wt-feature-dirty');
  assert.match(line, /keep/);
  assert.match(line, /uncommitted/i);
  assert.match(line, /scratch\.ts/, 'names WHAT it skipped, not just that it skipped');
  assert.ok(fs.existsSync(wt), 'a refused worktree is not moved');
});

test('--migrate REFUSES a worktree with unpushed commits', () => {
  const { tmp, repo } = makeRepo();
  track(tmp);
  const wt = legacyWorktree(repo, 'feature/unpushed');
  // A commit that never reached the upstream: work only this machine holds.
  fs.writeFileSync(path.join(wt, 'f.txt'), 'x\n');
  git(wt, 'add', '-A');
  git(wt, 'commit', '-qm', 'local only');
  const out = run(repo, '--yes');
  const line = verdictLine(out, 'plot-wt-feature-unpushed');
  assert.match(line, /keep/);
  assert.match(line, /unpushed/i);
  assert.ok(fs.existsSync(wt), 'a refused worktree is not moved');
});

test('--migrate REFUSES a worktree with a live worker, using the shared state', () => {
  const { tmp, repo } = makeRepo();
  track(tmp);
  const wt = legacyWorktree(repo, 'feature/live');
  // A real, live process, recorded exactly as dispatch records a worker: the
  // pid file plus a manifest carrying `startedAt` (in the past, so the pid
  // validates as current). plot_worker_state is the ONE liveness answer, and
  // this proves --migrate asks it rather than a bare `ps`.
  // The child's fds are detached from /dev/null. A `sleep &` that inherits this
  // process's stdout keeps node's test-runner pipe open, and the runner then
  // never exits — it hangs waiting for a stream that only closes when the sleep
  // dies. Redirecting all three fds lets execFileSync return AND lets node exit.
  const child = execFileSync('bash', ['-c', 'sleep 300 </dev/null >/dev/null 2>&1 & echo $!'],
    { encoding: 'utf8' }).trim();
  try {
    fs.writeFileSync(path.join(wt, '.plot-worker.pid'), child);
    fs.mkdirSync(path.join(repo, '.plot', 'agents'), { recursive: true });
    const real = fs.realpathSync(wt);
    fs.writeFileSync(path.join(repo, '.plot', 'agents', 'sess-live.json'),
      JSON.stringify({
        session: 'sess-live', branch: 'feature/live', worktree: real,
        command: 'sleep', pid: child, startedAt: '2020-01-01T00:00:00Z',
      }, null, 2) + '\n');
    const out = run(repo, '--yes');
    const line = verdictLine(out, 'plot-wt-feature-live');
    assert.match(line, /keep/);
    assert.match(line, /worker alive|pid/i);
    assert.ok(fs.existsSync(wt), 'a worktree with a live worker is never moved');
  } finally {
    try { process.kill(Number(child)); } catch { /* already gone */ }
  }
});

test('--migrate is idempotent: a second run finds nothing left to move', () => {
  const { tmp, repo } = makeRepo();
  track(tmp);
  legacyWorktree(repo, 'feature/idle');
  run(repo, '--yes');                 // first run moves it
  const out = run(repo, '--yes');     // second run
  assert.match(out, /moved=0/);
  // And the moved worktree still works where it now lives.
  assert.match(git(repo, 'worktree', 'list'), /\.worktrees\/feature-idle/);
});

test('--migrate: a moved worktree does not make the main repo dirty', () => {
  // The plan requires `.worktrees/` to be invisible to `git status`. A migrated
  // worktree living inside the repo must not show up as an untracked directory.
  const { tmp, repo } = makeRepo();
  track(tmp);
  // Ignore the root as an adopting repo would (the Rooted wave adds this line).
  fs.appendFileSync(path.join(repo, '.gitignore'), '.worktrees/\n');
  git(repo, 'add', '.gitignore');
  git(repo, 'commit', '-qm', 'ignore worktrees');
  legacyWorktree(repo, 'feature/idle');
  run(repo, '--yes');
  const status = git(repo, 'status', '--porcelain').trim();
  assert.doesNotMatch(status, /\.worktrees/,
    'the migrated worktree must not appear in git status');
});

test('--migrate --max bounds how many it moves in one run', () => {
  const { tmp, repo } = makeRepo();
  track(tmp);
  legacyWorktree(repo, 'feature/one');
  legacyWorktree(repo, 'feature/two');
  const out = run(repo, '--yes', '--max', '1');
  assert.match(out, /moved=1/);
});

test('--migrate never asks the host and never writes a ref', () => {
  // Migration moves CHECKOUTS. Like plot-reap.sh, it touches no branch and no
  // ref — every move is re-creatable with `git worktree move` back.
  const { tmp, repo } = makeRepo();
  track(tmp);
  legacyWorktree(repo, 'feature/idle');
  const before = git(repo, 'for-each-ref', '--format=%(refname)').trim();
  run(repo, '--yes');
  const afterRefs = git(repo, 'for-each-ref', '--format=%(refname)').trim();
  assert.equal(before, afterRefs, 'no ref is created or deleted by a migration');
});
