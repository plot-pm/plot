// What a running prompt receives from the loop, and what a stop during one
// leaves behind, driven through `plot-worker-loop.sh` on whichever loop
// `PLOT_TEST_WORKER_LOOP` names.
//
// THE SETTINGS FILE. `Agent settings` names a file the loop resolves once per
// agent start and hands every prompt as `PLOT_AGENT_SETTINGS`; the prompt
// interpolates `${PLOT_AGENT_SETTINGS:+--settings "$PLOT_AGENT_SETTINGS"}`.
//
// THE STOP. `plot-dispatch.sh --stop` sends SIGTERM to the loop. The loop
// removes its manifest before it exits, so the registry stops naming the agent
// at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { workerLoopLine } from './loop-switch.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const loop = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-worker-loop.sh');

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

// EVERY `PLOT_*` KEY OF AN OUTER WORKER IS DROPPED, as in
// `claim-push-rejection.test.mjs`: an outer `PLOT_BRANCH` or
// `PLOT_AGENT_SETTINGS` would reach the loop under test.
const RUN_STATE_KEYS = new Set(['PLOT_BUDGET_HOME', 'PLOT_PR_INDEX_HOME']);
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('PLOT_') || RUN_STATE_KEYS.has(key)),
);

/**
 * A bare origin, a clone whose committed prompt is `prompt`, and a detached
 * desk with a manifest handing the agent `feature/x`.
 */
const sandbox = (prompt, configLines = '') => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-prompt-launch-'));
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  git(root, 'init', '--bare', '-q', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, work);
  git(work, 'config', 'user.email', 'test@example.invalid');
  git(work, 'config', 'user.name', 'Plot Test');
  git(work, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(work, 'CLAUDE.md'), `# Fixture project

## Plot Config

- **Plan directory:** docs/plans/
- **Worker bound:** 120
${configLines}${workerLoopLine()}`);
  fs.mkdirSync(path.join(work, '.plot'), { recursive: true });
  fs.writeFileSync(path.join(work, '.plot', 'worker-prompt.sh'), prompt);
  fs.writeFileSync(path.join(work, '.plot', 'agent-settings.json'), '{ "enabledPlugins": { "other@market": false } }\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-qm', 'init');
  git(work, 'push', '-q', 'origin', 'main');

  const wt = path.join(root, 'desk');
  git(work, 'worktree', 'add', '-q', '--detach', wt, 'origin/main');
  const manifestDir = path.join(root, 'agents');
  fs.mkdirSync(manifestDir);
  const manifest = path.join(manifestDir, 'sess-launch.json');
  fs.writeFileSync(manifest, JSON.stringify({
    session: 'sess-launch',
    resumeId: 'sess-launch',
    branch: 'feature/x',
    worktree: wt,
    command: 'plot-worker-loop.sh',
    pid: '4242',
    attempts: 0,
    startedAt: '2026-10-06T09:00:00Z',
  }, null, 2) + '\n');
  return { root, work, wt, manifest };
};

const loopEnv = (sb) => ({
  ...cleanEnv,
  PLOT_WORKTREE: sb.wt,
  PLOT_MANIFEST_FILE: sb.manifest,
  PLOT_WAIT_POLL_SECONDS: '1',
  PLOT_WAIT_BUDGET_SECONDS: '3',
});

/** Waits for `file` to exist, polling every 100 ms, for up to `ms`. */
const appears = async (file, ms) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
};

test('the loop runs its prompt with --settings when the Agent settings file resolves', () => {
  const sb = sandbox(
    'echo "${PLOT_AGENT_SETTINGS:+--settings $PLOT_AGENT_SETTINGS}" > "$PLOT_WORKTREE/../settings-seen"\n' +
      'echo "PLOT-BLOCKED: stop here" > "$PLOT_WORKTREE/PLOT-BLOCKED.md"\n',
    '- **Agent settings:** .plot/agent-settings.json\n',
  );
  try {
    try {
      execFileSync('bash', [loop], { cwd: sb.wt, env: loopEnv(sb), timeout: 60_000, stdio: 'ignore' });
    } catch {
      // THE ENDING IS NOT THIS TEST'S QUESTION: the shell loop goes free and
      // ends on its wait budget, the JS loop ends `blocked`.
    }
    const seen = fs.readFileSync(path.join(sb.root, 'settings-seen'), 'utf8').trim();
    assert.equal(seen, `--settings ${fs.realpathSync(sb.work)}/.plot/agent-settings.json`);
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});

test('a SIGTERM while the prompt runs leaves no manifest behind', async () => {
  const sb = sandbox('echo $$ > "$PLOT_WORKTREE/../prompt-started"\nsleep 60\n');
  const started = path.join(sb.root, 'prompt-started');
  const child = spawn('bash', [loop], { cwd: sb.wt, env: loopEnv(sb), stdio: 'ignore' });
  const exited = new Promise((resolve) => child.on('exit', resolve));
  try {
    assert.ok(await appears(started, 30_000), 'the prompt started');
    child.kill('SIGTERM');
    await exited;
    assert.equal(fs.existsSync(sb.manifest), false, 'the stopped loop removed its manifest');
  } finally {
    child.kill('SIGKILL');
    const pid = Number(fs.existsSync(started) ? fs.readFileSync(started, 'utf8').trim() : '');
    if (pid > 0) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    }
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});
