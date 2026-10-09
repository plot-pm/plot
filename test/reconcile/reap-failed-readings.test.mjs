// Contract test: a reading the reaper could not take keeps the desk.
//
// The reaper removes with `git worktree remove --force` and `git branch -D`,
// so every reading that failed or could not be asked must end as a `keep` row.
// Each test below makes one reading fail, and each passes only when the desk
// or branch survives.
//
// A failing shell reading is made by COPYING the shipped scripts directory and
// overriding one function at the end of the copy. The checkout's own scripts
// are never edited or linked.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsSrc = path.join(here, '..', '..', 'skills', 'plot', 'scripts');

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

const tmps = [];
const sleepers = [];
after(() => {
  for (const child of sleepers) child.kill();
  for (const t of tmps) fs.rmSync(t, { recursive: true, force: true });
});

/** A clone of an empty bare origin, so `origin/HEAD` is never set, with `main` pushed. */
const makeRepo = () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-reap-failed-'));
  tmps.push(tmp);
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# Repo\n\n## Plot Config\n\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), '.plot-worker*\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  git(repo, 'push', '-q', 'origin', 'main');
  return { tmp, repo };
};

/**
 * A `gh` answering `pr list` from a table and `repo view` with `defaultBranch`
 * when one is given; every other call fails.
 */
const stubGh = (tmp, prs, { defaultBranch = '' } = {}) => {
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env node
const argv = process.argv.slice(2);
if (argv[0] === 'repo' && argv[1] === 'view' && ${JSON.stringify(defaultBranch)} !== '') {
  process.stdout.write(${JSON.stringify(defaultBranch)} + '\\n');
  process.exit(0);
}
if (argv[0] !== 'pr' || argv[1] !== 'list') { process.exit(1); }
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

const merged = (branch, head) => ({ [branch]: [{ mergedAt: '2026-10-01T10:00:00Z', number: 900, headRefOid: head }] });

/** A dispatch desk on `branch` with one pushed commit; returns its path and head. */
const desk = (repo, branch, pid = '') => {
  const wt = path.join(path.dirname(repo), 'plot-wt-' + branch.replace(/\//g, '-'));
  git(repo, 'worktree', 'add', '-q', '-b', branch, wt);
  fs.writeFileSync(path.join(wt, 'work.txt'), branch);
  git(wt, 'add', 'work.txt');
  git(wt, 'commit', '-qm', `work on ${branch}`);
  git(wt, 'push', '-q', '-u', 'origin', branch);
  fs.writeFileSync(path.join(wt, '.plot-worker.pid'), `${pid}\n`);
  return { wt, head: git(wt, 'rev-parse', 'HEAD').trim() };
};

/** A copy of the shipped scripts with `override` appended to `script`, so one function fails. */
const scriptsWith = (tmp, script, override) => {
  const dir = path.join(tmp, 'scripts');
  fs.cpSync(scriptsSrc, dir, { recursive: true });
  fs.appendFileSync(path.join(dir, script), `\n${override}\n`);
  return dir;
};

const runReap = (cwd, bin, scripts, ...args) =>
  execFileSync('bash', [path.join(scripts, 'plot-reap.sh'), ...args], {
    encoding: 'utf8',
    cwd,
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      PLOT_AGENT_PROCESS: 'sleep',
      PLOT_AGENT_GRACE_SECONDS: '0',
    },
  });

const lineFor = (out, branch) => out.split('\n').find((l) => l.includes(` ${branch} `)) ?? '';

test('a branch that is an ancestor of the checked-out branch, with no PR, is kept when origin/HEAD is unset', () => {
  const { tmp, repo } = makeRepo();
  git(repo, 'checkout', '-q', '-b', 'feature/a');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a');
  git(repo, 'add', 'a.txt');
  git(repo, 'commit', '-qm', 'work on a');
  git(repo, 'checkout', '-q', '-b', 'feature/b');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'b');
  git(repo, 'add', 'b.txt');
  git(repo, 'commit', '-qm', 'work on b');
  git(repo, 'push', '-q', 'origin', 'feature/b');
  assert.throws(() => git(repo, 'symbolic-ref', '-q', 'refs/remotes/origin/HEAD'),
    'precondition: origin/HEAD is unset');

  const bin = stubGh(tmp, {});
  const out = runReap(repo, bin, scriptsSrc, '--yes');

  assert.match(lineFor(out, 'feature/a'), /^keep\s.*unlanded work — no merged PR/, out);
  assert.notEqual(git(repo, 'branch', '--list', 'feature/a').trim(), '', 'feature/a still exists');
});

test('a live pid whose worker-state reading fails keeps the desk', () => {
  const { tmp, repo } = makeRepo();
  const sleeper = spawn('sleep', ['300'], { stdio: 'ignore' });
  sleepers.push(sleeper);
  const branch = 'feature/state-unreadable';
  const { wt, head } = desk(repo, branch, String(sleeper.pid));
  const scripts = scriptsWith(tmp, 'plot-worker-state.sh', 'plot_worker_state() { return 1; }');
  const bin = stubGh(tmp, merged(branch, head));

  const out = runReap(repo, bin, scripts, '--yes');

  assert.match(lineFor(out, branch), /^keep\s.*worker alive \(pid unknown\)/, out);
  assert.ok(fs.existsSync(wt), 'the desk was not removed');
});

test('a dirt reading that fails keeps the desk', () => {
  const { tmp, repo } = makeRepo();
  const branch = 'feature/dirt-unreadable';
  const { wt, head } = desk(repo, branch);
  fs.writeFileSync(path.join(wt, 'half-done.txt'), 'work on the floor');
  const scripts = scriptsWith(tmp, 'plot-desk-dirt.sh', 'desk_dirt() { return 1; }');
  const bin = stubGh(tmp, merged(branch, head));

  const out = runReap(repo, bin, scripts, '--yes');

  assert.match(lineFor(out, branch), /^keep\s.*rule could not be asked — keeping/, out);
  assert.ok(fs.existsSync(path.join(wt, 'half-done.txt')), 'the uncommitted file survives');
});

test('a marker desk whose commits could not be counted is kept', () => {
  const { tmp, repo } = makeRepo();
  const branch = 'feature/marker-uncountable';
  const { wt, head } = desk(repo, branch);
  fs.writeFileSync(path.join(wt, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: which retry semantics?\n');
  // The host names a default branch the remote does not have, so the range
  // `origin/<default>..HEAD` cannot be read.
  const bin = stubGh(tmp, merged(branch, head), { defaultBranch: 'no-such-default' });

  const out = runReap(repo, bin, scriptsSrc, '--dry-run');

  assert.match(lineFor(out, branch), /^keep\s.*rule could not be asked — keeping/, out);
});

test('the desk the reaper runs from is never reaped', () => {
  const { tmp, repo } = makeRepo();
  const branch = 'feature/reaper-runs-here';
  const { wt, head } = desk(repo, branch);
  const bin = stubGh(tmp, merged(branch, head));

  const out = runReap(wt, bin, scriptsSrc, '--yes');

  assert.doesNotMatch(out, /^(would|reaped|FAILED)\s+feature\/reaper-runs-here\s/m, out);
  assert.match(out, /reapable=0 removed=0/, out);
  assert.ok(fs.existsSync(wt), 'the desk the reaper ran from still exists');
});
