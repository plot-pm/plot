// `start_worker` STARTS EVERY AGENT THROUGH `plot-worker-start.mjs`.
//
// The entry starts `plot-worker-wrapper.mjs` through the `Detached` port and
// exits. These tests call `start_worker` the way `dispatch.test.mjs`'s `staff`
// helper does and read the launched processes: the wrapper's command line, its
// process group, and what a stub `node` of another major leaves behind.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const scripts = path.join(root, 'skills', 'plot', 'scripts');
const dispatch = path.join(scripts, 'plot-dispatch.sh');
const pinned = fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim().replace(/^v/, '').split('.')[0];

const temps = [];
const groups = [];

after(() => {
  for (const pgid of groups) {
    try {
      process.kill(-pgid, 'SIGKILL');
    } catch {
      // the group already ended
    }
  }
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const until = async (what, read, ms = 15_000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
};

const readOr = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
};

/** A repository whose `Worker command` is `command`, with one desk per branch. */
const repoWith = (command, branches) => {
  const t = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-worker-start-')));
  temps.push(t);
  const repo = path.join(t, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'),
    `## Plot Config\n\n- **Plan directory:** plans/\n- **Agent registry:** ${path.join(t, 'agents')}\n- **Worker command:** ${command}\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  const desks = branches.map((branch) => {
    const wt = path.join(t, branch.replaceAll('/', '-'));
    git(repo, 'worktree', 'add', '-q', '-b', branch, wt, 'main');
    return wt;
  });
  return { t, repo, desks };
};

/** Calls `start_worker` for one desk and returns its status and what it printed. */
const startWorker = (repo, branch, wt, env = {}) => {
  const childEnv = { ...process.env, ...env };
  delete childEnv.PLOT_REPO_ROOT;
  delete childEnv.PLOT_AGENT;
  const run = spawnSync('bash', ['-c', `
    PLOT_DISPATCH_SOURCED=1
    . ${JSON.stringify(dispatch)}
    repo_root=$(git rev-parse --show-toplevel)
    start_worker ${JSON.stringify(branch)} ${JSON.stringify(wt)}
  `], { cwd: repo, env: childEnv, encoding: 'utf8', timeout: 60_000 });
  return { status: run.status, out: `${run.stdout}${run.stderr}`, signal: run.signal };
};

const pidIn = (file) =>
  until(path.basename(file), () => {
    const text = readOr(file);
    return text !== undefined && /^\d+$/.test(text) ? Number(text) : undefined;
  });

const ps = (field, pid) => {
  const run = spawnSync('ps', ['-o', `${field}=`, '-p', String(pid)], { encoding: 'utf8' });
  return run.status === 0 ? run.stdout.trim() : '';
};

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test('the start and wrapper bundles are built', () => {
  for (const name of ['plot-worker-start.mjs', 'plot-worker-wrapper.mjs']) {
    assert.ok(fs.existsSync(path.join(scripts, 'board', name)), `${name} is missing; run pnpm build:board`);
  }
});

test('every dispatch runs through the node wrapper: only the brief run keeps `nohup sh -c`', () => {
  const lines = fs.readFileSync(dispatch, 'utf8').split('\n')
    .map((line, at) => ({ line, at: at + 1 }))
    .filter(({ line }) => line.includes('nohup sh -c'));
  assert.equal(lines.length, 1, lines.map(({ at, line }) => `${at}: ${line}`).join('\n'));
  assert.match(lines[0].line, /plot-brief/);
});

test('a dispatch starts plot-worker-wrapper.mjs, which leads the group of itself and its agent', async () => {
  const { repo, desks: [wt] } = repoWith('sleep 300', ['feature/start-one']);
  const run = startWorker(repo, 'feature/start-one', wt);
  assert.equal(run.status, 0, run.out);
  assert.match(run.out, /started worker \(log: /);

  const wrapper = await pidIn(path.join(wt, '.plot-worker.wrapper.pid'));
  groups.push(wrapper);
  const agent = await pidIn(path.join(wt, '.plot-worker.pid'));

  assert.match(ps('command', wrapper), /plot-worker-wrapper\.mjs sleep 300/);
  assert.equal(ps('pgid', wrapper), String(wrapper));
  assert.equal(ps('pgid', agent), String(wrapper));

  process.kill(-wrapper, 'SIGTERM');
  const code = await until('the exit record', () => readOr(path.join(wt, '.plot-worker.exit')));
  assert.equal(code, '143');
  assert.match(readOr(path.join(wt, '.plot-worker.monitor.worker.jsonl')) ?? '', /"finding":"gone"/);
});

test("a stop of one desk's group leaves a second desk's agent alive", async () => {
  const { repo, desks: [one, two] } = repoWith('sleep 300', ['feature/start-a', 'feature/start-b']);
  assert.equal(startWorker(repo, 'feature/start-a', one).status, 0);
  assert.equal(startWorker(repo, 'feature/start-b', two).status, 0);
  const wrapperOne = await pidIn(path.join(one, '.plot-worker.wrapper.pid'));
  const wrapperTwo = await pidIn(path.join(two, '.plot-worker.wrapper.pid'));
  groups.push(wrapperOne, wrapperTwo);
  const agentOne = await pidIn(path.join(one, '.plot-worker.pid'));
  const agentTwo = await pidIn(path.join(two, '.plot-worker.pid'));

  process.kill(-wrapperOne, 'SIGTERM');
  assert.equal(await until('desk one exit record', () => readOr(path.join(one, '.plot-worker.exit'))), '143');

  assert.equal(alive(agentOne), false, 'the stopped desk keeps no agent');
  assert.equal(alive(agentTwo), true, "the second desk's agent survives the first desk's stop");
  assert.equal(readOr(path.join(two, '.plot-worker.exit')), undefined);
});

test('a stub node of another major starts no wrapper, prints both majors, and start_worker reports it', () => {
  const { t, repo, desks: [wt] } = repoWith('sleep 300', ['feature/start-wrong-node']);
  const other = String(Number(pinned) - 2);
  const bin = path.join(t, 'bin');
  fs.mkdirSync(bin);
  const preload = path.join(t, 'other-major.mjs');
  fs.writeFileSync(preload, [
    `Object.defineProperty(process, 'version', { value: 'v${other}.1.0' });`,
    `Object.defineProperty(process, 'versions', { value: { ...process.versions, node: '${other}.1.0' } });`,
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(bin, 'node'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} --import ${JSON.stringify(preload)} "$@"\n`);
  fs.chmodSync(path.join(bin, 'node'), 0o755);

  const run = startWorker(repo, 'feature/start-wrong-node', wt, { PATH: `${bin}:${process.env.PATH}` });

  assert.equal(run.status, 1, run.out);
  assert.match(run.out, /refusing to start feature\/start-wrong-node — the worker wrapper did not start/);
  assert.match(run.out, new RegExp(`node on PATH is ${other}, Plot pins ${pinned}`));
  assert.doesNotMatch(run.out, /started worker/);
  assert.equal(fs.existsSync(path.join(wt, '.plot-worker.wrapper.pid')), false, 'no wrapper started');
  assert.equal(fs.existsSync(path.join(wt, '.plot-worker.pid')), false, 'no agent started');
});
