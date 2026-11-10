// Contract test for `plot_monitor_subject` in skills/plot/scripts/plot-monitor-subject.sh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const subjectScript = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-monitor-subject.sh');

/** `plot_monitor_subject` for a pid file, with a fresh shell per call. */
const subjectOf = (pidFile) => execFileSync('bash', ['-c',
  `. ${JSON.stringify(subjectScript)}; plot_monitor_subject "$1"`, '_', pidFile],
{ encoding: 'utf8' });

test('a pid file with no trailing newline reads alive, then gone once the pid is dead', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-amon-nonl-'));
  const agent = spawn('sleep', ['30'], { stdio: 'ignore' });
  try {
    const pidFile = path.join(root, '.plot-worker.pid');
    fs.writeFileSync(pidFile, String(agent.pid));
    assert.equal(subjectOf(pidFile), 'alive');
    // A zombie still answers `kill -0`, so wait for node to reap the child.
    const exited = new Promise((resolve) => agent.once('exit', resolve));
    agent.kill();
    await exited;
    assert.equal(subjectOf(pidFile), 'gone');
  } finally {
    agent.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a half-written or missing pid file keeps its answers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-amon-half-'));
  try {
    const pidFile = path.join(root, '.plot-worker.pid');
    fs.writeFileSync(pidFile, '');
    assert.equal(subjectOf(pidFile), 'starting');
    fs.writeFileSync(path.join(root, '.plot-worker.exit'), '0');
    assert.equal(subjectOf(pidFile), 'gone');
    fs.rmSync(path.join(root, '.plot-worker.exit'));
    fs.rmSync(pidFile);
    assert.equal(subjectOf(pidFile), 'starting', 'no pid file, desk present');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert.equal(subjectOf(path.join(root, '.plot-worker.pid')), 'gone', 'desk removed');
});
