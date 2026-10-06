// The BUILT `plot-worker-loop.mjs` restarting itself as a real process: a
// loop started from a desk's bundle moves to the main checkout's bundle before
// its first pass, restarts again when main moves, keeps its pid both times, and
// ends its free wait at the wait's original start plus the bound.
//
// The main checkout is a scratch repository holding the helper scripts and the
// built bundle; the desk is a worktree of it whose bundle differs by one line.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmTree } from './helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE = path.join(HERE, '..', 'dist', 'plot-worker-loop.mjs');
const SCRIPTS = path.join(HERE, '..', '..', '..', 'skills', 'plot', 'scripts');
const RELATIVE = path.join('skills', 'plot', 'scripts', 'board', 'plot-worker-loop.mjs');
const WAIT_BOUND_SECONDS = 12;

const made = [];
after(() => {
  for (const dir of made) rmTree(dir);
});

const scratch = (prefix) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  made.push(dir);
  return dir;
};

const git = (cwd, ...args) => execFileSync('git', args, { cwd }).toString().trim();

/** A main checkout with the helper scripts and the built bundle, an `origin`, and a desk worktree whose bundle differs. */
const repository = () => {
  const main = scratch('plot-restart-main-');
  git(main, 'init', '--quiet', '-b', 'main');
  git(main, 'config', 'user.email', 't@t.example');
  git(main, 'config', 'user.name', 't');
  const scripts = path.join(main, 'skills', 'plot', 'scripts');
  fs.mkdirSync(path.join(scripts, 'board'), { recursive: true });
  for (const entry of fs.readdirSync(SCRIPTS, { withFileTypes: true })) {
    if (entry.isFile()) fs.copyFileSync(path.join(SCRIPTS, entry.name), path.join(scripts, entry.name));
  }
  fs.copyFileSync(BUNDLE, path.join(main, RELATIVE));
  git(main, 'add', '-A');
  git(main, 'commit', '--quiet', '-m', 'main');
  const origin = scratch('plot-restart-origin-');
  git(origin, 'init', '--quiet', '--bare', '-b', 'main');
  git(main, 'remote', 'add', 'origin', origin);
  git(main, 'push', '--quiet', 'origin', 'main');
  git(main, 'remote', 'set-head', 'origin', 'main');
  const desk = path.join(scratch('plot-restart-desks-'), 'desk');
  git(main, 'worktree', 'add', '--quiet', '-b', 'infra/desk', desk);
  fs.appendFileSync(path.join(desk, RELATIVE), '\n// the desk build\n');
  git(desk, 'commit', '--quiet', '-am', 'desk build');
  return { main, desk };
};

/** The loop's environment: a free, hand-started loop, and no worker variable of the caller's. */
const loopEnv = (home, desk) => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('PLOT_')) delete env[key];
  return {
    ...env,
    HOME: home,
    PLOT_WORKTREE: desk,
    PLOT_MANIFEST_FILE: '',
    PLOT_WORKER_BOUND: String(WAIT_BOUND_SECONDS),
    PLOT_WAIT_BUDGET_SECONDS: String(WAIT_BOUND_SECONDS),
    PLOT_WAIT_POLL_SECONDS: '1',
    PLOT_AGENT: '',
  };
};

const RESTARTED = /restarted as pid (\d+) on (\S+), keeping (no free wait|the free wait from (\S+))/g;

describe('the built loop restarts on new code', { skip: !fs.existsSync(BUNDLE) && 'no built bundle; run pnpm build' }, () => {
  it('moves to main’s bundle before its first pass, restarts when main moves, keeps its pid and its wait bound', { timeout: 90_000 }, async () => {
    const { main, desk } = repository();
    const mainBundle = path.join(main, RELATIVE);
    const child = spawn(process.execPath, [path.join(desk, RELATIVE)], {
      cwd: desk,
      env: loopEnv(scratch('plot-restart-home-'), desk),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    child.stdout.on('data', (chunk) => (log += chunk));
    child.stderr.on('data', (chunk) => (log += chunk));
    const exited = new Promise((resolve) => child.on('exit', (code) => resolve({ code, at: Date.now() })));
    const restarts = () => [...log.matchAll(RESTARTED)];
    const until = async (predicate, what) => {
      const deadline = Date.now() + 30_000;
      while (!predicate()) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; log:\n${log}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };

    await until(() => restarts().length >= 1 && log.includes('free on'), 'the first restart and the free wait');
    // Main moves 4 s into the wait, so a restart that restarted the wait's
    // clock would end it 4 s late, past the 3 s margin asserted below.
    await new Promise((resolve) => setTimeout(resolve, 4000));
    fs.appendFileSync(mainBundle, '\n// main moved\n');
    git(main, 'commit', '--quiet', '-am', 'main moved');
    await until(() => restarts().length >= 2, 'the second restart');
    const { code, at } = await exited;

    const [first, second] = restarts();
    assert.equal(code, 124, log);
    assert.equal(Number(first[1]), child.pid, 'the first restart keeps the pid');
    assert.equal(Number(second[1]), child.pid, 'the second restart keeps the pid');
    assert.equal(first[2], mainBundle);
    assert.equal(first[3], 'no free wait');
    assert.equal(second[2], mainBundle);
    const waitStarted = Date.parse(second[4]);
    assert.ok(at - waitStarted >= WAIT_BOUND_SECONDS * 1000, `ended ${at - waitStarted} ms after the wait started`);
    assert.ok(at - waitStarted < WAIT_BOUND_SECONDS * 1000 + 3000, `ended ${at - waitStarted} ms after the wait started; the restart extended the bound`);
    assert.equal(log.match(/restarting on /g)?.length, 2, log);
  });
});
