// A reused pid must not read as a live worker (#2757, #2697).
//
// `plot_pid_is_current` tells a live worker's pid from an unrelated process
// that now holds the same number, by comparing a recorded start time against
// the live process's own `ps -o lstart`. The reaper asks the same question
// through `isRecordedProcess` before it prints `worker alive (pid N)`. This
// file drives the shell function directly, through `plot_worker_state`'s bare
// `.plot-worker.pid` fallback, through `plot-agent-state.mjs` against
// `plot_worker_readings`, and through `plot-reap.sh --dry-run` over a manifest.
//
// No test relies on real pid reuse. Every "reused pid" case spawns a live
// `sleep` and records a start time an hour away from its real one: the shape
// a reused pid produces (a live process whose recorded start lies elsewhere in
// time) without waiting for the kernel to recycle a number. Each test awaits
// its child's exit in teardown.
//
// The reaper cases run the built `plot-reap.mjs`: run `pnpm build:board`
// first, and restore the generated bundles before a push.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const shared = path.join(scripts, 'plot-worker-state.sh');
const reap = path.join(scripts, 'plot-reap.sh');
const agentStateBundle = path.join(scripts, 'board', 'plot-agent-state.mjs');

/** A pid that is valid, numeric, and certainly not running. */
const DEAD = 2147483646;

const tmps = [];
after(() => {
  for (const t of tmps) fs.rmSync(t, { recursive: true, force: true });
});

const tmpDir = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmps.push(dir);
  return dir;
};

/** The real `ps -o lstart=` text for a live pid, as the shell under test reads it. */
const lstartOf = (pid) => execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim();

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * The pid's `ps -o lstart=` text, shifted by `deltaSeconds`.
 *
 * `ps -o lstart=` prints local time with no zone, and `Date.parse` reads a
 * string of that shape as local time, so the shift and the formatting both
 * stay in the local zone and add no offset of their own.
 */
const lstartShifted = (pid, deltaSeconds) => {
  const shifted = new Date(Date.parse(lstartOf(pid)) + deltaSeconds * 1000);
  return `${WEEKDAYS[shifted.getDay()]} ${MONTHS[shifted.getMonth()]} ${pad2(shifted.getDate())} `
    + `${pad2(shifted.getHours())}:${pad2(shifted.getMinutes())}:${pad2(shifted.getSeconds())} ${shifted.getFullYear()}`;
};

/** An ISO-8601 stamp in the shape `plot-dispatch.sh` writes, shifted from the pid's real start. */
const isoShifted = (pid, deltaSeconds) =>
  new Date(Date.parse(lstartOf(pid)) + deltaSeconds * 1000).toISOString().replace(/\.\d+Z$/, 'Z');

/** Runs `body` with a live `sleep` child, and awaits the child's exit afterwards. */
const withChild = async (body) => {
  const child = spawn('sleep', ['300'], { stdio: 'ignore' });
  try {
    return await body(child);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const gone = once(child, 'exit');
      child.kill('SIGKILL');
      await gone;
    }
  }
};

/** `plot_pid_is_current $1 $2 $3`'s exit code, via the real shell function. */
const isCurrent = (pid, startedAt, pidStartedAt) => {
  const args = [pid, startedAt ?? '', pidStartedAt ?? ''].map((a) => JSON.stringify(String(a)));
  const script = `source ${JSON.stringify(shared)}; plot_pid_is_current ${args.join(' ')}; echo $?`;
  return Number(execFileSync('bash', ['-c', script], { encoding: 'utf8', timeout: 30_000 }).trim());
};

// ---------------------------------------------------------------------------
// plot_pid_is_current, direct.
// ---------------------------------------------------------------------------

test('plot_pid_is_current: a live pid whose recorded start is 1h earlier reads stale', () => withChild((child) => {
  assert.equal(isCurrent(child.pid, '2026-01-01T00:00:00Z', lstartShifted(child.pid, -3600)), 1,
    'a process recorded an hour before it really started must not read as current');
}));

test('plot_pid_is_current: a live pid whose recorded start matches reads current', () => withChild((child) => {
  assert.equal(isCurrent(child.pid, '2026-01-01T00:00:00Z', lstartOf(child.pid)), 0,
    'the process that was actually recorded must read as current');
}));

test('plot_pid_is_current: a recorded start within the 3s skew reads current on either side', () => withChild((child) => {
  assert.equal(isCurrent(child.pid, '2026-01-01T00:00:00Z', lstartShifted(child.pid, -2)), 0,
    'a recorded start 2s early is inside the window');
  assert.equal(isCurrent(child.pid, '2026-01-01T00:00:00Z', lstartShifted(child.pid, 2)), 0,
    'a recorded start 2s late is inside the window');
}));

test('plot_pid_is_current: the 3s edge reads current, 4s reads stale, on either side', () => withChild((child) => {
  assert.equal(isCurrent(child.pid, '2026-01-01T00:00:00Z', lstartShifted(child.pid, -3)), 0, '3s early is inside');
  assert.equal(isCurrent(child.pid, '2026-01-01T00:00:00Z', lstartShifted(child.pid, 3)), 0, '3s late is inside');
  assert.equal(isCurrent(child.pid, '2026-01-01T00:00:00Z', lstartShifted(child.pid, -4)), 1, '4s early is outside');
  assert.equal(isCurrent(child.pid, '2026-01-01T00:00:00Z', lstartShifted(child.pid, 4)), 1, '4s late is outside');
}));

test('plot_pid_is_current: with no per-pid start, a startedAt 60s before the child reads current', () => withChild((child) => {
  // A slow-starting worker: the dispatcher stamped `startedAt` 60 s before the
  // agent started. No `pidStartedAt` is given, so the one-sided lower bound
  // against `startedAt` decides, as it did before per-pid starts existed.
  assert.equal(isCurrent(child.pid, isoShifted(child.pid, -60), undefined), 0,
    'a startedAt that predates a slow-starting worker must still read current');
}));

test('plot_pid_is_current: a dead pid reads stale, with or without a recorded start', () => {
  assert.equal(isCurrent(DEAD, '', ''), 1, 'a dead pid with nothing recorded reads stale');
  assert.equal(isCurrent(DEAD, '2026-01-01T00:00:00Z', 'Mon Jan  1 00:00:00 2026'), 1,
    'a dead pid with a recorded start reads stale');
});

// ---------------------------------------------------------------------------
// plot_worker_state through the bare .plot-worker.pid fallback, and the pair
// `plot_worker_readings` + `agentState` against `plot_worker_state`.
// ---------------------------------------------------------------------------

/** A bare desk: `.plot-worker.pid` and, when given, its `.startedAt` sidecar. No manifest. */
const bareDesk = (pid, pidStartedAt) => {
  const wt = tmpDir('plot-pidreuse-');
  fs.writeFileSync(path.join(wt, '.plot-worker.pid'), `${pid}\n`);
  if (pidStartedAt !== undefined) fs.writeFileSync(path.join(wt, '.plot-worker.pid.startedAt'), pidStartedAt);
  return wt;
};

/** `plot_worker_state`'s state word and `plot_worker_readings`' line for one desk, in one shell. */
const shellOf = (wt) => {
  const script = `source ${JSON.stringify(shared)}; export PLOT_MANIFEST_DIR=; `
    + `plot_worker_state ${JSON.stringify(wt)} ''; printf '\\n'; plot_worker_readings ${JSON.stringify(wt)}`;
  const [state, readings] = execFileSync('bash', ['-c', script], { encoding: 'utf8', timeout: 30_000 }).split('\n');
  return { state: state.split('\t')[0], readings };
};

/** What `agentState` answers for one readings line, through its built entry point. */
const ruleOf = (readings) =>
  execFileSync(process.execPath, [agentStateBundle], { input: `${readings}\n`, encoding: 'utf8', timeout: 30_000 }).trim();

test('plot_worker_state: a bare pid file recording a start 1h early reads not-running', () => withChild((child) => {
  const wt = bareDesk(child.pid, lstartShifted(child.pid, -3600));
  assert.notEqual(shellOf(wt).state, 'running',
    'a live pid with a per-pid start an hour off its real start must not read running');
}));

test('plot_worker_state: a bare pid file with a matching per-pid start reads running', () => withChild((child) => {
  const wt = bareDesk(child.pid, lstartOf(child.pid));
  assert.equal(shellOf(wt).state, 'running', 'the process that was actually recorded must still read running');
}));

test('plot_worker_state: a bare pid file with no recorded start reads running', () => withChild((child) => {
  // No sidecar: the shape every desk had before per-pid starts existed.
  const wt = bareDesk(child.pid, undefined);
  assert.equal(shellOf(wt).state, 'running', 'a live pid with nothing recorded must read running, as before');
}));

test('agentState and plot_worker_state answer the same word on both arms and the 3s edge', () => withChild((child) => {
  const rows = [
    { name: 'two-sided, matching', pidStartedAt: lstartOf(child.pid), want: 'running' },
    { name: 'two-sided, 1h early', pidStartedAt: lstartShifted(child.pid, -3600), want: 'ended' },
    { name: 'two-sided, 1h late', pidStartedAt: lstartShifted(child.pid, 3600), want: 'ended' },
    { name: 'two-sided, 3s early', pidStartedAt: lstartShifted(child.pid, -3), want: 'running' },
    { name: 'two-sided, 4s early', pidStartedAt: lstartShifted(child.pid, -4), want: 'ended' },
    { name: 'two-sided, 3s late', pidStartedAt: lstartShifted(child.pid, 3), want: 'running' },
    { name: 'two-sided, 4s late', pidStartedAt: lstartShifted(child.pid, 4), want: 'ended' },
    { name: 'none recorded', pidStartedAt: undefined, want: 'running' },
  ];
  for (const row of rows) {
    const { state, readings } = shellOf(bareDesk(child.pid, row.pidStartedAt));
    assert.equal(state, row.want, `${row.name} :: shell="${state}" readings="${readings}"`);
    assert.equal(ruleOf(readings), state, `${row.name} :: rule="${ruleOf(readings)}" shell="${state}"`);
  }
}));

// ---------------------------------------------------------------------------
// The reaper, through `plot-reap.sh --dry-run` over a manifest.
// ---------------------------------------------------------------------------

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

/** The `ps` the stub hands everything but `lstart` to. */
const realPs = execFileSync('bash', ['-c', 'command -v ps'], { encoding: 'utf8' }).trim();

/**
 * A repo with one merged desk and a manifest naming it. `manifest` holds the
 * manifest's pid fields. `unreadableStart` puts a `ps` on `PATH` that fails
 * every `lstart` question and answers every other one.
 */
const reapFixture = (manifest, { unreadableStart = false, ignoreWorkerFiles = true, deskFiles = {} } = {}) => {
  const tmp = tmpDir('plot-pidreuse-reap-');
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# Repo\n\n## Plot Config\n\n- **Agent registry:** `registry`\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), `${ignoreWorkerFiles ? '.plot-worker*\n' : ''}registry/\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  git(repo, 'push', '-q', 'origin', 'main');

  const branch = 'feature/reused-pid';
  const wt = path.join(tmp, 'plot-wt-feature-reused-pid');
  git(repo, 'worktree', 'add', '-q', '-b', branch, wt);
  fs.writeFileSync(path.join(wt, 'work.txt'), branch);
  git(wt, 'add', 'work.txt');
  git(wt, 'commit', '-qm', `work on ${branch}`);
  git(wt, 'push', '-q', '-u', 'origin', branch);
  const head = git(wt, 'rev-parse', 'HEAD').trim();
  for (const [name, text] of Object.entries(deskFiles)) fs.writeFileSync(path.join(wt, name), text);

  const registry = path.join(repo, 'registry');
  fs.mkdirSync(registry);
  fs.writeFileSync(path.join(registry, 'sess-reused.json'), `${JSON.stringify({
    session: 'sess-reused', branch, worktree: wt, command: 'sleep', ...manifest,
  }, null, 2)}\n`);

  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  const merged = { [branch]: [{ mergedAt: '2026-10-27T10:00:00Z', number: 900, headRefOid: head }] };
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env node
const argv = process.argv.slice(2);
if (argv[0] !== 'pr' || argv[1] !== 'list') process.exit(1);
const table = ${JSON.stringify(merged)};
const head = argv[argv.indexOf('--head') + 1];
const state = argv[argv.indexOf('--state') + 1];
let all = table[head] || [];
if (state === 'open') all = all.filter((p) => p.mergedAt === null);
process.stdout.write(JSON.stringify(all));
`);
  fs.chmodSync(path.join(bin, 'gh'), 0o755);
  if (unreadableStart) {
    fs.writeFileSync(path.join(bin, 'ps'),
      `#!/bin/sh\ncase "$*" in *lstart*) exit 1 ;; esac\nexec ${JSON.stringify(realPs)} "$@"\n`);
    fs.chmodSync(path.join(bin, 'ps'), 0o755);
  }
  const out = execFileSync('bash', [reap, '--dry-run'], {
    encoding: 'utf8',
    cwd: repo,
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
  });
  return out.split('\n').find((l) => l.includes(` ${branch} `)) ?? out;
};

test('reaper: a manifest pid whose recorded start is 1h before the child names no live worker', () => withChild((child) => {
  const line = reapFixture({
    pid: String(child.pid),
    startedAt: isoShifted(child.pid, -3600),
    pidStartedAt: lstartShifted(child.pid, -3600),
  });
  assert.doesNotMatch(line, new RegExp(`worker alive \\(pid ${child.pid}\\)`),
    `a reused pid must not read as a live worker:\n${line}`);
  assert.match(line, /^would/, `and the merged desk is reapable:\n${line}`);
}));

test('reaper: the same child with a manifest startedAt 1h in the future names no live worker', () => withChild((child) => {
  // The shell already reads this pid as stale against `startedAt`; what this
  // catches is a reaper that falls back to `kill -0` alone.
  const line = reapFixture({
    pid: String(child.pid),
    startedAt: isoShifted(child.pid, 3600),
    pidStartedAt: lstartShifted(child.pid, -3600),
  });
  assert.doesNotMatch(line, new RegExp(`worker alive \\(pid ${child.pid}\\)`),
    `a reused pid must not read as a live worker through the fallback:\n${line}`);
  assert.match(line, /^would/, `and the merged desk is reapable:\n${line}`);
}));

test('reaper keeps: a recorded start within 3s of the child\'s start', () => withChild((child) => {
  const line = reapFixture({
    pid: String(child.pid),
    startedAt: isoShifted(child.pid, 0),
    pidStartedAt: lstartShifted(child.pid, -2),
  });
  assert.match(line, new RegExp(`^keep.*worker alive \\(pid ${child.pid}\\)`), line);
}));

test('reaper keeps: a slow-starting worker, startedAt 60s before the child with a matching per-pid start', () => withChild((child) => {
  const line = reapFixture({
    pid: String(child.pid),
    startedAt: isoShifted(child.pid, -60),
    pidStartedAt: lstartOf(child.pid),
  });
  assert.match(line, new RegExp(`^keep.*worker alive \\(pid ${child.pid}\\)`), line);
}));

test('reaper keeps: a live wrapperPid whose recorded start predates a relaunched startedAt', () => withChild((child) => {
  const line = reapFixture({
    pid: String(DEAD),
    startedAt: isoShifted(child.pid, 600),
    pidStartedAt: '',
    wrapperPid: String(child.pid),
    wrapperPidStartedAt: lstartOf(child.pid),
  });
  assert.match(line, new RegExp(`^keep.*worker alive \\(pid ${child.pid}\\)`), line);
}));

test('reaper keeps: a manifest pid with no recorded start', () => withChild((child) => {
  const line = reapFixture({ pid: String(child.pid), startedAt: isoShifted(child.pid, -60) });
  assert.match(line, new RegExp(`^keep.*worker alive \\(pid ${child.pid}\\)`), line);
}));

test('reaper keeps: a live pid whose start cannot be read', () => withChild((child) => {
  // The recorded start is an hour off, so a readable start would free the
  // desk. A start `ps` cannot answer reads alive: a wrong not-alive runs
  // `git worktree remove --force` under a live agent.
  const line = reapFixture({
    pid: String(child.pid),
    startedAt: isoShifted(child.pid, -3600),
    pidStartedAt: lstartShifted(child.pid, -3600),
  }, { unreadableStart: true });
  assert.match(line, new RegExp(`^keep.*worker alive \\(pid ${child.pid}\\)`), line);
}));

test('reaper: a desk holding only the start-time sidecar reads clean, with no ignore rule for it', () => withChild((child) => {
  // An adopting repository's `.gitignore` names no `.plot-worker*` file, so
  // the fixture ignores none. The worker is gone; the sidecar it left is the
  // desk's only untracked file and is not work.
  const line = reapFixture({ pid: String(DEAD), startedAt: isoShifted(child.pid, 0), pidStartedAt: '' }, {
    ignoreWorkerFiles: false,
    deskFiles: { '.plot-worker.pid.startedAt': lstartOf(child.pid) },
  });
  assert.doesNotMatch(line, /uncommitted/, `the sidecar alone is not uncommitted work:\n${line}`);
  assert.match(line, /^would/, `and the merged desk is reapable:\n${line}`);
}));
