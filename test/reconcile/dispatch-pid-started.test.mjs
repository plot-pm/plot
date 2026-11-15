// The worker wrapper `start_worker` starts, `plot-worker-wrapper.mjs`, records
// the agent pid's OWN start time (`ps -o lstart`) beside `.plot-worker.pid`, so
// a later reuse of that pid by an unrelated process can be told apart from the
// run this sidecar names (#2757). This test runs the bundle directly, so an
// edit that drops the sidecar write (or breaks what it writes) fails here
// rather than only in a live dispatch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const dispatch = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-dispatch.sh');

const wrapper = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'board', 'plot-worker-wrapper.mjs');

/** Runs the wrapper on `sleep 1` to its end, with the environment `start_worker` exports. */
const runWrapper = (cwd, env) => execFileSync(process.execPath, [wrapper, 'sleep 1'], { cwd, env, stdio: 'ignore' });

test('dispatch wrapper: .plot-worker.pid.startedAt is written beside .plot-worker.pid, parseable by Date', () => {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-dispatch-pid-started-'));
  try {
    const pidFile = path.join(wt, '.plot-worker.pid');
    const pidStartedFile = path.join(wt, '.plot-worker.pid.startedAt');
    const wrapperPidFile = path.join(wt, '.plot-worker.wrapper.pid');
    const exitFile = path.join(wt, '.plot-worker.exit');

    runWrapper(wt, {
      ...process.env,
      PLOT_WORKTREE: wt,
      PLOT_BRANCH: 'feature/x',
      PLOT_MANIFEST_FILE: '',
      PLOT_STAMP_STARTED: '',
      PLOT_EXIT_FILE: exitFile,
      PLOT_PID_FILE: pidFile,
      PLOT_PID_STARTED_FILE: pidStartedFile,
      PLOT_WRAPPER_PID_FILE: wrapperPidFile,
      PLOT_SCRIPT_DIR: path.join(here, '..', '..', 'skills', 'plot', 'scripts'),
    });

    assert.ok(fs.existsSync(pidFile), '.plot-worker.pid was written');
    const started = fs.readFileSync(pidStartedFile, 'utf8');
    assert.notEqual(started, '', '.plot-worker.pid.startedAt is not empty');
    assert.ok(!Number.isNaN(Date.parse(started)), `.plot-worker.pid.startedAt is not Date-parseable: ${started}`);
  } finally {
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

/** One shell function's source from `plot-dispatch.sh`, from its `name() {` line to the first `}` line. */
const functionSource = (name) => {
  const lines = fs.readFileSync(dispatch, 'utf8').split('\n');
  const from = lines.findIndex((line) => line.startsWith(`${name}() {`));
  assert.notEqual(from, -1, `${name} moved — update this extractor`);
  const to = lines.findIndex((line, at) => at > from && line === '}');
  return lines.slice(from, to + 1).join('\n');
};

/** The `ps -o lstart=` shape in the C locale: `Mon Nov  9 08:42:51 2026`. */
const C_LSTART = /^\w{3} \w{3} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4}\s*$/;

test('dispatch manifest records the agent process name, claude when PLOT_AGENT_PROCESS is unset', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-dispatch-agent-process-'));
  try {
    const program = `${functionSource('json_escape')}\n${functionSource('write_agent_manifest')}\nwrite_agent_manifest "$1" s1 feature/x /w/x cmd`;
    const { PLOT_AGENT_PROCESS: _unset, ...env } = process.env;
    execFileSync('bash', ['-c', program, 'bash', path.join(dir, 'a.json')], { env });
    execFileSync('bash', ['-c', program, 'bash', path.join(dir, 'b.json')], { env: { ...env, PLOT_AGENT_PROCESS: 'codex' } });
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'a.json'), 'utf8')).agentProcess, 'claude');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'b.json'), 'utf8')).agentProcess, 'codex');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('dispatch wrapper stamps both start times in the C locale under a German operator locale', () => {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-dispatch-pid-started-c-'));
  try {
    const manifest = path.join(wt, 'm.json');
    fs.writeFileSync(manifest, '{\n  "session": "s1",\n  "pid": "",\n  "agentProcess": "claude",\n  "startedAt": "2026-11-09T08:00:00Z"\n}\n');
    runWrapper(wt, {
      ...process.env,
      LC_ALL: 'de_CH.UTF-8',
      LANG: 'de_CH.UTF-8',
      PLOT_WORKTREE: wt,
      PLOT_BRANCH: 'feature/x',
      PLOT_MANIFEST_FILE: manifest,
      PLOT_STAMP_STARTED: '2026-11-09T08:00:00Z',
      PLOT_EXIT_FILE: path.join(wt, '.plot-worker.exit'),
      PLOT_PID_FILE: path.join(wt, '.plot-worker.pid'),
      PLOT_PID_STARTED_FILE: path.join(wt, '.plot-worker.pid.startedAt'),
      PLOT_WRAPPER_PID_FILE: path.join(wt, '.plot-worker.wrapper.pid'),
      PLOT_SCRIPT_DIR: path.join(here, '..', '..', 'skills', 'plot', 'scripts'),
    });
    const recorded = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    assert.match(fs.readFileSync(path.join(wt, '.plot-worker.pid.startedAt'), 'utf8'), C_LSTART);
    assert.match(recorded.pidStartedAt, C_LSTART);
    assert.match(recorded.wrapperPidStartedAt, C_LSTART);
    assert.equal(recorded.agentProcess, 'claude');
  } finally {
    fs.rmSync(wt, { recursive: true, force: true });
  }
});
