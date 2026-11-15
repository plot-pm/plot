// THE NODE WORKER WRAPPER LEAVES THE DESK RECORDS `start_worker` PROMISES.
//
// `plot-worker-wrapper.mjs` is the wrapper `start_worker` starts. This file runs
// it against stub agents and compares what it leaves in the desk with the
// records the inline `sh` wrapper it replaced left (measured equal on #3325):
// `.plot-worker.exit`, `.plot-worker.pid`, `.plot-worker.wrapper.pid`, the
// WorkerMonitor line and the manifest stamp, with pids, times, `lstart` text
// and desk paths masked. Each wrapper is started detached, which makes it the
// leader of its own process group, as `plot-worker-start.mjs` does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.resolve(here, '..', '..', 'skills', 'plot', 'scripts');
const workerState = path.join(scripts, 'plot-worker-state.sh');
const bundle = path.join(scripts, 'board', 'plot-worker-wrapper.mjs');

const STAMP_STARTED = '2026-11-09T08:00:00Z';
const BRANCH = 'feature/wrapper-parity';

/** The C locale's `lstart` form, `Mon Nov  9 08:07:06 2026`, with the trailing padding macOS `ps` prints. */
const C_LSTART = /^[A-Z][a-z]{2} [A-Z][a-z]{2} [ \d]\d \d{2}:\d{2}:\d{2} \d{4} *$/;

const temps = [];
const groups = [];

test.after(() => {
  for (const pgid of groups) {
    try {
      process.kill(-pgid, 'SIGKILL');
    } catch {
      // the group already ended
    }
  }
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

/** A desk with a first-dispatch manifest beside it. */
const makeDesk = () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-wrapper-desk-')));
  temps.push(root);
  const desk = path.join(root, 'desk');
  fs.mkdirSync(desk);
  const manifest = path.join(root, 'session.json');
  fs.writeFileSync(manifest, [
    '{',
    '  "session": "wrapper-parity",',
    `  "branch": "${BRANCH}",`,
    `  "worktree": "${desk}",`,
    '  "command": "stub",',
    '  "pid": "",',
    `  "startedAt": "${STAMP_STARTED}"`,
    '}',
    '',
  ].join('\n'));
  return { root, desk, manifest };
};

/** The environment `start_worker` exports for one desk. */
const wrapperEnv = ({ desk, manifest }, extra = {}) => ({
  ...process.env,
  PLOT_BRANCH: BRANCH,
  PLOT_WORKTREE: desk,
  PLOT_MANIFEST_FILE: manifest,
  PLOT_STAMP_STARTED: STAMP_STARTED,
  PLOT_EXIT_FILE: path.join(desk, '.plot-worker.exit'),
  PLOT_PID_FILE: path.join(desk, '.plot-worker.pid'),
  PLOT_PID_STARTED_FILE: path.join(desk, '.plot-worker.pid.startedAt'),
  PLOT_WRAPPER_PID_FILE: path.join(desk, '.plot-worker.wrapper.pid'),
  PLOT_SCRIPT_DIR: scripts,
  ...extra,
});

/** Starts the wrapper detached on a fresh desk. */
const launch = (command, extra = {}) => {
  const d = makeDesk();
  const log = fs.openSync(path.join(d.root, 'wrapper.log'), 'a');
  const child = spawn(process.execPath, [bundle, command], { cwd: d.desk, env: wrapperEnv(d, extra), detached: true, stdio: ['ignore', log, log] });
  fs.closeSync(log);
  child.unref();
  groups.push(child.pid);
  return { ...d, wrapper: child.pid };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Waits until `read()` answers something other than `undefined`. */
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

/** The agent pid, once the wrapper has written it. */
const agentPid = (run) =>
  until('the agent pid', () => {
    const text = readOr(path.join(run.desk, '.plot-worker.pid'));
    return text !== undefined && /^\d+$/.test(text) ? Number(text) : undefined;
  });

/** Waits for the exit record, then reads the desk's records with pids, times and paths masked. */
const records = async (run) => {
  await until('the exit record', () => readOr(path.join(run.desk, '.plot-worker.exit')));
  const agent = readOr(path.join(run.desk, '.plot-worker.pid'));
  const mask = (text) => {
    if (text === undefined) return '<absent>';
    let out = text
      .replaceAll(run.desk, '<desk>')
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/g, '<time>')
      .replace(/"(pidStartedAt|wrapperPidStartedAt)": "[^"]*"/g, (_m, key) => `"${key}": "<lstart>"`);
    out = out.replace(new RegExp(`\\b${run.wrapper}\\b`, 'g'), '<wrapper>');
    if (agent !== undefined && agent !== '') out = out.replace(new RegExp(`\\b${agent}\\b`, 'g'), '<agent>');
    return out;
  };
  const read = (name) => mask(readOr(path.join(run.desk, name)));
  return {
    exit: read('.plot-worker.exit'),
    pid: read('.plot-worker.pid'),
    wrapperPid: read('.plot-worker.wrapper.pid'),
    finding: read('.plot-worker.monitor.worker.jsonl'),
    manifest: mask(readOr(run.manifest)),
  };
};

/** Runs one scenario and returns its record set. */
const one = async (command, act = async () => undefined) => {
  const run = launch(command);
  await act(run);
  return records(run);
};

/** The masked records the `sh` wrapper left for an agent that ended with `code`, plus the token line. */
const expected = (code) => {
  const [finding, evidence] = code === 0
    ? ['clear', 'the agent pid <agent> exited 0; the worker is finished']
    : ['gone', `the agent pid <agent> exited ${code}; the wrapper that started it is unattended`];
  return {
    exit: String(code),
    pid: '<agent>',
    wrapperPid: '<wrapper>',
    finding: `{"monitor":"WorkerMonitor","branch":"${BRANCH}","worktree":"<desk>","finding":"${finding}",`
      + `"since":"<time>","evidence":"${evidence}","measuredAt":"<time>"}\n`,
    manifest: [
      '{',
      '  "session": "wrapper-parity",',
      `  "branch": "${BRANCH}",`,
      '  "worktree": "<desk>",',
      '  "command": "stub",',
      '  "pid": "<agent>",',
      '  "pidStartedAt": "<lstart>",',
      '  "wrapperPid": "<wrapper>",',
      '  "wrapperPidStartedAt": "<lstart>",',
      '  "workerMonitorPid": "",',
      '  "agentMonitorPid": "",',
      // The one line the `sh` wrapper never wrote: the node wrapper's liveness token.
      '  "token": "<desk>/.plot-worker.token.fifo",',
      '  "startedAt": "<time>"',
      '}',
      '',
    ].join('\n'),
  };
};

test('the bundle is built', () => {
  assert.ok(fs.existsSync(bundle), `${bundle} is missing; run pnpm build:board`);
});

test('exit 0: the wrapper leaves the sh wrapper\'s records, and a clear line', async () => {
  assert.deepEqual(await one('true'), expected(0));
});

test('exit 3: the wrapper leaves the sh wrapper\'s records, and a gone line', async () => {
  assert.deepEqual(await one('exit 3'), expected(3));
});

test('SIGKILL to the agent: the wrapper writes 137', async () => {
  const node = await one('sleep 300', async (run) => {
    process.kill(await agentPid(run), 'SIGKILL');
  });

  assert.deepEqual(node, expected(137));
});

test('SIGTERM to the agent: the wrapper writes 143', async () => {
  const node = await one('sleep 300', async (run) => {
    process.kill(await agentPid(run), 'SIGTERM');
  });

  assert.deepEqual(node, expected(143));
});

test("SIGTERM to the wrapper's group: the agent ends, and the wrapper writes 143 and the gone line", async () => {
  const node = await one('sleep 300', async (run) => {
    await agentPid(run);
    process.kill(-run.wrapper, 'SIGTERM');
  });

  assert.deepEqual(node, expected(143));
});

test("a launch under a German locale writes both start times in the C locale's lstart form", async () => {
  const run = launch('sleep 1', { LANG: 'de_CH.UTF-8', LC_ALL: 'de_CH.UTF-8', LC_TIME: 'de_CH.UTF-8' });
  await records(run);

  const manifest = JSON.parse(fs.readFileSync(run.manifest, 'utf8'));
  assert.match(fs.readFileSync(path.join(run.desk, '.plot-worker.pid.startedAt'), 'utf8'), C_LSTART);
  assert.match(manifest.pidStartedAt, C_LSTART);
  assert.match(manifest.wrapperPidStartedAt, C_LSTART);
  assert.equal(manifest.pidStartedAt, fs.readFileSync(path.join(run.desk, '.plot-worker.pid.startedAt'), 'utf8'));
});

/** `plot_worker_agent_alive` for a pid, looking for an agent named `sleep`, with no grace. */
const agentAlive = (pid) =>
  Number(execFileSync('bash', ['-c',
    `source ${JSON.stringify(workerState)}; PLOT_AGENT_PROCESS=sleep PLOT_AGENT_GRACE_SECONDS=0 `
    + `plot_worker_agent_alive ${JSON.stringify(String(pid))}; echo $?`],
  { encoding: 'utf8', timeout: 30_000 }).trim());

for (const command of ['sleep 300 & wait', "sh -c 'sleep 300; true'"]) {
  test(`the agent tree under the node wrapper reads present: ${command}`, async () => {
    const run = launch(command);
    const pid = await agentPid(run);
    const answer = await until('a present agent under the node wrapper', () => (agentAlive(pid) === 0 ? 0 : undefined), 10_000);
    assert.equal(answer, 0, `node wrapper on ${process.platform}`);
    process.kill(-run.wrapper, 'SIGTERM');
    await records(run);
  });
}
