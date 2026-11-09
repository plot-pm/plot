// THE NODE WORKER WRAPPER LEAVES THE RECORDS THE SH WRAPPER LEAVES.
//
// `plot-worker-wrapper.mjs` replaces the inline `sh -c` wrapper in
// `plot-dispatch.sh`'s `start_worker`. This file runs both against the same
// stub agents and compares what each leaves in the desk: `.plot-worker.exit`,
// `.plot-worker.pid`, `.plot-worker.wrapper.pid`, the WorkerMonitor line and
// the manifest stamp, with pids, times, `lstart` text and desk paths masked.
//
// The `sh` wrapper is read out of `plot-dispatch.sh` itself, so this test runs
// the bytes `start_worker` runs. Each wrapper is started detached, which makes
// it the leader of its own process group, as `set -m` does in `start_worker`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.resolve(here, '..', '..', 'skills', 'plot', 'scripts');
const dispatch = path.join(scripts, 'plot-dispatch.sh');
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

/**
 * The `sh -c` word `start_worker` runs, as a bash script taking the agent
 * command as `$1`. The word holds `'"$cmd"'`, so bash interpolates the command
 * exactly as it does inside `start_worker`.
 */
const shWrapperScript = (() => {
  let file;
  return () => {
    if (file !== undefined) return file;
    const src = fs.readFileSync(dispatch, 'utf8');
    // The brief run's `exec nohup sh -c` comes first in the file; the worker
    // wrapper's word is the one that opens by writing the wrapper pid.
    const open = 'exec nohup sh -c ';
    const at = src.indexOf(`${open}'printf "%s" "$$" > "$PLOT_WRAPPER_PID_FILE"`);
    assert.notEqual(at, -1, 'the worker wrapper moved in plot-dispatch.sh');
    const close = `> "$PLOT_EXIT_FILE"'`;
    const end = src.indexOf(close, at);
    assert.notEqual(end, -1, 'the end of the sh wrapper moved in plot-dispatch.sh');
    const word = src.slice(at + open.length, end + close.length);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-sh-wrapper-'));
    temps.push(dir);
    file = path.join(dir, 'sh-wrapper.bash');
    fs.writeFileSync(file, `cmd="$1"\nexec sh -c ${word}\n`);
    return file;
  };
})();

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
  PLOT_AGENT_MONITOR: '',
  PLOT_EXIT_FILE: path.join(desk, '.plot-worker.exit'),
  PLOT_PID_FILE: path.join(desk, '.plot-worker.pid'),
  PLOT_PID_STARTED_FILE: path.join(desk, '.plot-worker.pid.startedAt'),
  PLOT_WRAPPER_PID_FILE: path.join(desk, '.plot-worker.wrapper.pid'),
  PLOT_SCRIPT_DIR: scripts,
  ...extra,
});

/** Starts one wrapper, `sh` or `node`, detached, on a fresh desk. */
const launch = (kind, command, extra = {}) => {
  const d = makeDesk();
  const log = fs.openSync(path.join(d.root, 'wrapper.log'), 'a');
  const [file, args] = kind === 'sh' ? ['bash', [shWrapperScript(), command]] : [process.execPath, [bundle, command]];
  const child = spawn(file, args, { cwd: d.desk, env: wrapperEnv(d, extra), detached: true, stdio: ['ignore', log, log] });
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

/** Runs one scenario under both wrappers and returns both record sets. */
const both = async (command, act = async () => undefined) => {
  const out = {};
  for (const kind of ['sh', 'node']) {
    const run = launch(kind, command);
    await act(run);
    out[kind] = await records(run);
  }
  return out;
};

test('the bundle is built', () => {
  assert.ok(fs.existsSync(bundle), `${bundle} is missing; run pnpm build:board`);
});

test('exit 0: both wrappers leave the same records, and a clear line', async () => {
  const { sh, node } = await both('true');

  assert.deepEqual(node, sh);
  assert.equal(node.exit, '0');
  assert.equal(node.pid, '<agent>');
  assert.equal(node.wrapperPid, '<wrapper>');
  assert.match(node.finding, /"finding":"clear"/);
  assert.match(node.manifest, /"pid": "<agent>",\n  "pidStartedAt": "<lstart>",\n  "wrapperPid": "<wrapper>",/);
});

test('exit 3: both wrappers leave the same records, and a gone line', async () => {
  const { sh, node } = await both('exit 3');

  assert.deepEqual(node, sh);
  assert.equal(node.exit, '3');
  assert.match(node.finding, /"finding":"gone".*exited 3/);
});

test('SIGKILL to the agent: both wrappers write 137', async () => {
  const { sh, node } = await both('sleep 300', async (run) => {
    process.kill(await agentPid(run), 'SIGKILL');
  });

  assert.deepEqual(node, sh);
  assert.equal(node.exit, '137');
  assert.match(node.finding, /"finding":"gone".*exited 137/);
});

test('SIGTERM to the agent: both wrappers write 143', async () => {
  const { sh, node } = await both('sleep 300', async (run) => {
    process.kill(await agentPid(run), 'SIGTERM');
  });

  assert.deepEqual(node, sh);
  assert.equal(node.exit, '143');
  assert.match(node.finding, /"finding":"gone".*exited 143/);
});

test("SIGTERM to the wrapper's group: the agent ends, and the wrapper writes 143 and the gone line", async () => {
  const { sh, node } = await both('sleep 300', async (run) => {
    await agentPid(run);
    process.kill(-run.wrapper, 'SIGTERM');
  });

  assert.deepEqual(node, sh);
  assert.equal(node.exit, '143');
  assert.match(node.finding, /"finding":"gone".*exited 143/);
});

test("a launch under a German locale writes both start times in the C locale's lstart form", async () => {
  const run = launch('node', 'sleep 1', { LANG: 'de_CH.UTF-8', LC_ALL: 'de_CH.UTF-8', LC_TIME: 'de_CH.UTF-8' });
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
  test(`the agent tree reads alike under both wrappers: ${command}`, async () => {
    for (const kind of ['sh', 'node']) {
      const run = launch(kind, command);
      const pid = await agentPid(run);
      const answer = await until(`a present agent under the ${kind} wrapper`, () => (agentAlive(pid) === 0 ? 0 : undefined), 10_000);
      assert.equal(answer, 0, `${kind} wrapper on ${process.platform}`);
      process.kill(-run.wrapper, 'SIGTERM');
      await records(run);
    }
  });
}
