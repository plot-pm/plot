// The SDK runner in the BUILT `plot-worker-loop.mjs`: one fixture run through
// its SDK path against a stand-in `claude`, the group stop of
// `plot-dispatch.sh --stop` reaching the loop and `claude` (#1084), and the SDK
// in this bundle and in no other.
//
// The stand-in `claude` (`fixtures/fake-claude/claude`) speaks the SDK's
// stream-json protocol, so these runs go through the bundled
// `@anthropic-ai/claude-agent-sdk` and its spawn exactly as a live run does.
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
const SHIPPED = path.join(HERE, '..', '..', '..', 'skills', 'plot', 'scripts', 'board');
const SCRIPTS = path.join(SHIPPED, '..');
const FAKE_BIN = path.join(HERE, 'fixtures', 'fake-claude');
const STANDIN = path.join(HERE, 'fixtures', 'sdk-standin.mjs');

const made = [];
after(() => {
  for (const dir of made) rmTree(dir);
});

/** A desk with its own HOME, so no operator settings file reaches the run. */
const desk = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-sdk-bundle-'));
  made.push(dir);
  return dir;
};

/** The stand-in's environment: the fake `claude` first on PATH, and nothing of a worker's own. */
const standinEnv = (dir, extra) => {
  const env = { ...process.env, PATH: `${FAKE_BIN}${path.delimiter}${process.env.PATH}`, HOME: dir, ...extra };
  for (const key of ['PLOT_REPO_ROOT', 'PLOT_UNATTENDED', 'PLOT_MANIFEST_FILE', 'PLOT_WRAPPER_PID_FILE']) delete env[key];
  return env;
};

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const until = async (check, ms) => {
  const stop = Date.now() + ms;
  while (Date.now() < stop) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
};

describe('the built plot-worker-loop.mjs runs one turn through its SDK path', () => {
  it('hands back the fixture turn, with the gate options and the merged env reaching claude', () => {
    const dir = desk();
    const log = path.join(dir, 'fake.log');
    const out = execFileSync(process.execPath, [STANDIN, BUNDLE, SCRIPTS, dir, '60'], {
      cwd: dir,
      env: standinEnv(dir, { FAKE_CLAUDE_LOG: log, FAKE_CLAUDE_NEXT: 'checks' }),
      encoding: 'utf8',
      timeout: 60_000,
    });
    const run = JSON.parse(out.trim().split('\n').at(-1));
    assert.equal(run.ok, true);
    assert.deepEqual(run.value.end, { answer: 'ran', handBack: { next: 'checks', summary: 'fixture run' } });
    assert.equal(run.value.sessionId, '11111111-1111-4111-8111-111111111111');
    assert.equal(run.value.turns, 1);

    const seen = JSON.parse(fs.readFileSync(log, 'utf8').trim());
    const argv = seen.argv.join(' ');
    assert.match(argv, /--disallowedTools Monitor,ScheduleWakeup,CronCreate,TaskStop,ListAgents/);
    assert.match(argv, /--setting-sources=user,project,local/);
    assert.match(argv, /--model sonnet/);
    assert.match(argv, /--settings \{"autoCompactWindow":200000\}/);
    assert.equal(seen.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS, '1');
    assert.equal(seen.env.PLOT_BRANCH, 'infra/the-fixture');
    assert.equal(seen.env.HOME, dir);
    assert.ok(seen.env.PATH.startsWith(FAKE_BIN), `PATH must reach claude: ${seen.env.PATH}`);
  });
});

describe('a group stop ends the loop and claude', () => {
  it('kill -TERM -<pgid> ends the stand-in loop, claude, and claude\'s own child', async () => {
    const dir = desk();
    const pidFile = path.join(dir, 'claude.pids');
    // THE STAND-IN LEADS ITS OWN GROUP, as `start_worker`'s `set -m` gives the
    // loop one; the SDK's child must join that group, never its own.
    const loop = spawn(process.execPath, [STANDIN, BUNDLE, SCRIPTS, dir, '600'], {
      cwd: dir,
      env: standinEnv(dir, { FAKE_CLAUDE_MODE: 'hang', FAKE_CLAUDE_PIDS: pidFile }),
      detached: true,
      stdio: 'ignore',
    });
    try {
      assert.ok(await until(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').includes('\n'), 20_000), 'claude must start');
      const [claude, grandchild] = fs.readFileSync(pidFile, 'utf8').trim().split(' ').map(Number);
      const pgid = (pid) => execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim();
      assert.equal(pgid(claude), String(loop.pid), 'claude must stay in the loop\'s process group');
      process.kill(-loop.pid, 'SIGTERM');
      assert.ok(await until(() => !alive(loop.pid), 10_000), 'the loop must end');
      assert.ok(await until(() => !alive(claude), 10_000), 'claude must end');
      assert.ok(await until(() => !alive(grandchild), 10_000), "claude's child must end");
    } finally {
      try {
        process.kill(-loop.pid, 'SIGKILL');
      } catch {
        /* the group is gone */
      }
    }
  });
});

describe('the SDK is in plot-worker-loop.mjs and in no other bundle', () => {
  const marker = 'spawnClaudeCodeProcess';
  const bundles = fs.readdirSync(SHIPPED).filter((name) => name.endsWith('.mjs'));

  it('plot-worker-loop.mjs carries it, without a platform binary package', () => {
    const text = fs.readFileSync(path.join(SHIPPED, 'plot-worker-loop.mjs'), 'utf8');
    assert.ok(text.includes(marker));
    assert.ok(!/claude-agent-sdk-(darwin|linux|win32)/.test(text));
  });

  it('plot-registryd.mjs and every other bundle carry none of it', () => {
    assert.ok(bundles.includes('plot-registryd.mjs'));
    const carrying = bundles.filter((name) => name !== 'plot-worker-loop.mjs' && fs.readFileSync(path.join(SHIPPED, name), 'utf8').includes(marker));
    assert.deepEqual(carrying, []);
  });
});
