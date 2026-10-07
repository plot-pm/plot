// Flow tests: the worker loop removes its manifest on ALL exit paths.
//
// Measured 2026-08-25: 13 live workers, 11 with an already-merged PR, all hung
// on the same unhandled rejection. The rows outlived the workers because the
// loop had no trap to clean up its manifest.
//
// This suite asserts the three exit paths that the loop has:
//   1. Normal end — `--next` returns 1, meaning no more work for this plan
//   2. Timeout — the bound fires and the worker is killed
//   3. SIGKILL — the worker is killed with `kill -9`; the trap CANNOT catch
//      this, so the reconciliation sweep must still clear these orphans
//
// The tests are flow tests (not unit tests) because they exercise the actual
// trap behavior in the real script, not a mock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'skills', 'plot', 'scripts');

/**
 * Create a test environment for the worker loop manifest cleanup tests.
 */
function makeTestEnv({ name }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `plot-manifest-test-${name}-`));

  // Create a mock registry directory and manifest file
  const registryDir = path.join(tmp, 'registry');
  fs.mkdirSync(registryDir, { recursive: true });
  // Named by its session, as `plot-dispatch.sh` names it: the JS loop clears
  // the assignment in `<registry>/<session>.json`.
  const manifestFile = path.join(registryDir, 'test-session.json');
  fs.writeFileSync(manifestFile, JSON.stringify({
    session: 'test-session',
    pid: process.pid,
    branch: 'test/branch',
    worktree: path.join(tmp, 'worktree'),
    startedAt: new Date().toISOString(),
    wavesCount: 1,
  }, null, 2));

  // Create a mock worktree directory
  const worktreeDir = path.join(tmp, 'worktree');
  fs.mkdirSync(worktreeDir, { recursive: true });

  // Initialize git in worktreeDir so git rev-parse works
  execFileSync('git', ['init', '-q'], { cwd: worktreeDir });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: worktreeDir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: worktreeDir });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: worktreeDir });
  // The JS loop resets a taken-up desk onto `origin/main` and pushes to `origin`,
  // which a real desk always has: a remote holding the base and the slice's branch.
  const remote = path.join(tmp, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', remote]);
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: worktreeDir });
  execFileSync('git', ['checkout', '-q', '-b', 'test/branch'], { cwd: worktreeDir });
  execFileSync('git', ['push', '-q', '-u', 'origin', 'test/branch:test/branch', 'HEAD:main'], { cwd: worktreeDir });
  execFileSync('git', ['fetch', '-q', 'origin'], { cwd: worktreeDir });
  // The config and the prompt file are the desk's own, as a real desk's `.plot/` is: not unlanded work.
  fs.mkdirSync(path.join(worktreeDir, '.git', 'info'), { recursive: true });
  fs.appendFileSync(path.join(worktreeDir, '.git', 'info', 'exclude'), 'CLAUDE.md\n.plot/\n');

  // Create .plot directory
  const plotDir = path.join(worktreeDir, '.plot');
  fs.mkdirSync(plotDir, { recursive: true });

  // Create a stub for plot-fleet-scan.sh that always returns exit 1 (no more work)
  const stubBin = path.join(tmp, 'stub-bin');
  fs.mkdirSync(stubBin, { recursive: true });
  const fleetStub = path.join(stubBin, 'plot-fleet-scan.sh');
  fs.writeFileSync(fleetStub, '#!/usr/bin/env bash\nexit 1\n');
  fs.chmodSync(fleetStub, 0o755);

  return {
    tmp,
    manifestFile,
    worktreeDir,
    plotDir,
    stubBin,
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}

/**
 * Run the worker loop in a controlled environment.
 * Returns the exit code.
 */
function runWorkerLoop(env, { promptContent, boundSeconds = 3600, timeout = 5000, extraEnv = {} }) {
  const loopScript = path.join(SCRIPTS, 'plot-worker-loop.sh');

  // Write the prompt file
  fs.writeFileSync(path.join(env.plotDir, 'worker-prompt.sh'), promptContent);

  // Create CLAUDE.md with Plot Config
  fs.writeFileSync(path.join(env.worktreeDir, 'CLAUDE.md'), `# Test

## Plot Config

- **Worker bound:** ${boundSeconds}
`);

  const envVars = {
    ...process.env,
    PLOT_MANIFEST_FILE: env.manifestFile,
    PLOT_BRANCH: 'test/branch',
    PLOT_WORKTREE: env.worktreeDir,
    PLOT_SLUG: 'test-slug',
    // Put our stub first in PATH so --next uses our stub
    PATH: `${env.stubBin}:${process.env.PATH}`,
    ...extraEnv,
  };

  const result = spawnSync('bash', [loopScript], {
    cwd: env.worktreeDir,
    env: envVars,
    timeout,
    stdio: 'pipe',
  });

  return result.status;
}

test('manifest removed on normal exit (--next returns no more work)', () => {
  const env = makeTestEnv({ name: 'normal' });
  try {
    // Verify manifest exists before
    assert.ok(fs.existsSync(env.manifestFile), 'precondition: manifest must exist before loop runs');

    // Prompt exits immediately; then --next returns 1 (our stub), triggering
    // normal exit. The JS loop asks no --next: it seals the slice and waits
    // free, so a 1s wait budget ends it by its own exit rather than by the
    // spawn timeout's signal.
    const exitCode = runWorkerLoop(env, {
      promptContent: 'exit 0\n',
      timeout: 20000,
      extraEnv: { PLOT_WAIT_BUDGET_SECONDS: '1', PLOT_WAIT_POLL_SECONDS: '1' },
    });
    assert.notEqual(exitCode, null, 'the loop must end by its own exit, not by the spawn timeout');

    // The manifest should be gone
    assert.ok(!fs.existsSync(env.manifestFile),
      'manifest must be removed when the loop exits normally (--next returns 1)');
  } finally {
    env.cleanup();
  }
});

test('manifest removed on timeout exit (bound fires)', () => {
  const env = makeTestEnv({ name: 'timeout' });
  try {
    // Verify manifest exists before
    assert.ok(fs.existsSync(env.manifestFile), 'precondition: manifest must exist before loop runs');

    // Prompt sleeps longer than the bound, triggering timeout
    // bound = 1 second, prompt sleeps for 999 seconds
    const exitCode = runWorkerLoop(env, {
      promptContent: 'sleep 999\n',
      boundSeconds: 1,
      timeout: 10000, // Give it time to fire the bound
    });

    // Exit 124 is timeout(1)'s convention, which our loop uses
    assert.equal(exitCode, 124, 'loop must exit 124 when the bound fires');

    // The manifest should be gone
    assert.ok(!fs.existsSync(env.manifestFile),
      'manifest must be removed when the bound fires and kills the worker');
  } finally {
    env.cleanup();
  }
});

test('manifest survives SIGKILL (no handler can run), and the reconcile sweep is there to clear it', async () => {
  // The other half of the property the two cases above hold: the JS loop
  // removes its manifest on a normal exit, on its bound, and on SIGTERM,
  // SIGINT or SIGHUP (`onStop` in `entry/worker-loop.ts`). SIGKILL reaches no
  // handler, so a killed loop leaves its manifest, and the reconciliation
  // sweep is what clears that orphan.
  const env = makeTestEnv({ name: 'sigkill' });
  const started = path.join(env.tmp, 'prompt.pid');
  let promptPid = 0;
  try {
    assert.ok(fs.existsSync(env.manifestFile), 'precondition: manifest must exist');

    // The prompt records its pid and then holds, so the loop is mid-slice
    // when it is killed. `exec` keeps that pid the one to clean up after.
    fs.writeFileSync(path.join(env.plotDir, 'worker-prompt.sh'), `echo $$ > ${started}\nexec sleep 999\n`);
    fs.writeFileSync(path.join(env.worktreeDir, 'CLAUDE.md'), '# Test\n\n## Plot Config\n\n- **Worker bound:** 3600\n');
    // The launcher `exec`s the bundle, so this pid is the JS loop's own.
    const loop = spawn('bash', [path.join(SCRIPTS, 'plot-worker-loop.sh')], {
      cwd: env.worktreeDir,
      env: {
        ...process.env,
        PLOT_MANIFEST_FILE: env.manifestFile,
        PLOT_BRANCH: 'test/branch',
        PLOT_WORKTREE: env.worktreeDir,
        PLOT_SLUG: 'test-slug',
        PATH: `${env.stubBin}:${process.env.PATH}`,
      },
      stdio: 'ignore',
    });
    const exited = new Promise((resolve) => loop.once('exit', (code, signal) => resolve(signal)));

    for (const deadline = Date.now() + 20_000; !fs.existsSync(started) && Date.now() < deadline;) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(fs.existsSync(started), 'precondition: the loop must reach its prompt before it is killed');
    promptPid = Number(fs.readFileSync(started, 'utf8').trim());

    loop.kill('SIGKILL');
    assert.equal(await exited, 'SIGKILL', 'the loop must end by the SIGKILL it was sent');

    assert.ok(fs.existsSync(env.manifestFile),
      'a SIGKILLed loop runs no handler, so its manifest must still be there for the sweep');

    // The reconciliation sweep must still exist (it handles SIGKILL cases)
    const reconcileScan = path.join(SCRIPTS, 'plot-reconcile-scan.sh');
    assert.ok(fs.existsSync(reconcileScan),
      'plot-reconcile-scan.sh must exist to handle SIGKILL orphans');
  } finally {
    if (promptPid > 0) {
      try { process.kill(promptPid, 'SIGKILL'); } catch { /* already gone */ }
    }
    env.cleanup();
  }
});
