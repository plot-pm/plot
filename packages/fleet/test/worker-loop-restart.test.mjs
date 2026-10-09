// The BUILT `plot-worker-loop.mjs` restarting itself as a real process.
//
// A loop started from a desk cut before main's latest build moves to the main
// checkout's bundle before its first pass, restarts again when main moves,
// keeps its pid both times, and ends its free wait at the wait's original
// start plus the bound. A candidate that fails its `--self-check` restarts
// nothing: the loop keeps waiting under its own pid until the bound.
//
// The main checkout is a scratch repository holding the helper scripts and
// the built bundle; the desk is a worktree of it.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeTree as rmTree } from './rm-tree.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE = path.join(HERE, '..', 'dist', 'plot-worker-loop.mjs');
const SCRIPTS = path.join(HERE, '..', '..', '..', 'skills', 'plot', 'scripts');
const RELATIVE = path.join('skills', 'plot', 'scripts', 'board', 'plot-worker-loop.mjs');

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

/** A main checkout with the helper scripts and the built bundle, an `origin`, and a desk worktree cut from its first commit. */
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
  /** Commits a new build of main's bundle: the built bundle plus a line. */
  const build = (line) => {
    fs.appendFileSync(path.join(main, RELATIVE), `\n${line}\n`);
    git(main, 'commit', '--quiet', '-am', line);
  };
  return { main, desk, build };
};

/** The loop's environment: a free, hand-started loop, and no worker variable of the caller's. */
const loopEnv = (home, desk, boundSeconds) => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('PLOT_')) delete env[key];
  return {
    ...env,
    HOME: home,
    PLOT_WORKTREE: desk,
    PLOT_MANIFEST_FILE: '',
    PLOT_WORKER_BOUND: String(boundSeconds),
    PLOT_WAIT_BUDGET_SECONDS: String(boundSeconds),
    PLOT_WAIT_POLL_SECONDS: '1',
    PLOT_AGENT: '',
  };
};

/** Starts the desk's bundle as a process, with its log collected. */
const start = (desk, boundSeconds) => {
  const child = spawn(process.execPath, [path.join(desk, RELATIVE)], {
    cwd: desk,
    env: loopEnv(scratch('plot-restart-home-'), desk, boundSeconds),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const run = { child, log: '', startedAt: Date.now() };
  child.stdout.on('data', (chunk) => (run.log += chunk));
  child.stderr.on('data', (chunk) => (run.log += chunk));
  run.exited = new Promise((resolve) => child.on('exit', (code) => resolve({ code, at: Date.now() })));
  run.until = async (predicate, what) => {
    const deadline = Date.now() + 40_000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; log:\n${run.log}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };
  return run;
};

const RESTARTED = /restarted as pid (\d+) on (\S+), keeping (no free wait|the free wait from (\S+))/g;

describe('the built loop restarts on new code', { skip: !fs.existsSync(BUNDLE) && 'no built bundle; run pnpm build' }, () => {
  it('moves to main’s bundle before its first pass, restarts when main moves, keeps its pid and its wait bound', { timeout: 120_000 }, async () => {
    const BOUND = 20;
    const { main, desk, build } = repository();
    build('// main built after the desk was cut');
    const run = start(desk, BOUND);
    const restarts = () => [...run.log.matchAll(RESTARTED)];

    await run.until(() => restarts().length >= 1 && run.log.includes('free on'), 'the first restart and the free wait');
    // Main moves 8 s into the wait: a restart that restarted the wait's clock
    // would end it 8 s late, past the 6 s margin asserted below.
    await new Promise((resolve) => setTimeout(resolve, 8000));
    build('// main moved');
    await run.until(() => restarts().length >= 2, 'the second restart');
    const { code, at } = await run.exited;

    const [first, second] = restarts();
    assert.equal(code, 124, run.log);
    assert.equal(Number(first[1]), run.child.pid, 'the first restart keeps the pid');
    assert.equal(Number(second[1]), run.child.pid, 'the second restart keeps the pid');
    assert.equal(first[2], path.join(main, RELATIVE));
    assert.equal(first[3], 'no free wait');
    assert.equal(second[2], path.join(main, RELATIVE));
    const waited = at - Date.parse(second[4]);
    assert.ok(waited >= BOUND * 1000, `ended ${waited} ms after the wait started`);
    assert.ok(waited < BOUND * 1000 + 6000, `ended ${waited} ms after the wait started; the restart extended the bound`);
    assert.equal(run.log.match(/restarting on /g)?.length, 2, run.log);
  });

  it('keeps waiting under its own pid when main’s new bundle fails its --self-check', { timeout: 120_000 }, async () => {
    const BOUND = 12;
    const { desk, build } = repository();
    const run = start(desk, BOUND);
    await run.until(() => run.log.includes('free on'), 'the free wait');
    build('a broken build that does not parse (');
    await run.until(() => run.log.includes('failed its --self-check'), 'the rejected candidate');
    const { code, at } = await run.exited;

    assert.equal(code, 124, run.log);
    assert.ok(at - run.startedAt >= BOUND * 1000, `ended ${at - run.startedAt} ms after the start`);
    assert.equal(run.log.match(/failed its --self-check/g)?.length, 1, run.log);
    assert.doesNotMatch(run.log, /restarting on |restarted as pid/);
  });
});
