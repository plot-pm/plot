// Contract test for the wait for a PR's checks in
// skills/plot/scripts/plot-worker-loop.sh — `wait_for_checks` and its readers.
//
// This is the first slice of
// docs/plans/2026-10-02-an-agent-runs-the-tests-its-change-touches.md.
//
// The correction path reads a failed build only while the agent holds the
// slice. Measured 2026-10-02: the agent on #1168 opened its PR, let go of the
// slice, took another one in the same desk, and CI failed eight minutes later
// with no slice for the correction to reach.
//
// The functions are driven sourced, under `PLOT_WORKER_LOOP_SOURCED`, with the
// two network readings (`head_is_pushed`, `pr_is_open`) redefined. The verdict
// itself is asked of the real bundle, so the shell and the rule are tested as
// the pair the loop runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const loop = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-worker-loop.sh');
const BRANCH = 'feature/waits-for-checks';

/** A desk on BRANCH with one commit; returns its path and HEAD. */
const desk = () => {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-checks-wait-'));
  const git = (...args) => execFileSync('git', ['-C', wt, ...args], { encoding: 'utf8' });
  git('init', '-q', '-b', BRANCH);
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(wt, 'f'), '1');
  git('add', '-A');
  git('commit', '-q', '-m', 'c');
  return { wt, head: git('rev-parse', 'HEAD').trim() };
};

/** One BuildMonitor line, in the shape `plot-build-monitor.sh:publish` writes. */
const finding = (word, sha, branch = BRANCH) =>
  JSON.stringify({
    monitor: 'BuildMonitor',
    branch,
    worktree: '/x',
    finding: word,
    since: '2026-10-02T00:00:00Z',
    evidence: `the run at https://ci/run/1 for ${sha} concluded ${word === 'build passed' ? 'success' : 'failure'}`,
    measuredAt: '2026-10-02T00:00:00Z',
  });

/**
 * Run `wait_for_checks` in a desk.
 *
 * `pushed` and `prOpen` answer the two network readings. `late` is a line the
 * test appends to the findings file `lateAfter` seconds into the wait, standing
 * in for the BuildMonitor publishing while the loop polls.
 */
const wait = ({ wt, pushed = true, prOpen = true, lines = [], late = null, lateAfter = 2, waitSeconds = 30 }) => {
  const file = path.join(wt, '.plot-worker.monitor.build.jsonl');
  fs.writeFileSync(file, lines.map((l) => `${l}\n`).join(''));
  const script = `
    PLOT_WORKER_LOOP_SOURCED=1
    . ${JSON.stringify(loop)}
    PLOT_WORKTREE=${JSON.stringify(wt)}
    PLOT_BRANCH=${JSON.stringify(BRANCH)}
    command -v wait_for_checks >/dev/null 2>&1 || { echo UNDEFINED; exit 0; }
    head_is_pushed() { return ${pushed ? 0 : 1}; }
    pr_is_open() { return ${prOpen ? 0 : 1}; }
    ${late ? `( sleep ${lateAfter}; printf '%s\\n' ${JSON.stringify(late)} >> ${JSON.stringify(file)} ) &` : ''}
    wait_for_checks
    echo RETURNED
  `;
  const started = Date.now();
  const res = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, PLOT_CHECKS_POLL_SECONDS: '1', PLOT_CHECKS_WAIT_SECONDS: String(waitSeconds) },
  });
  assert.notEqual(res.stdout.trim(), 'UNDEFINED', 'wait_for_checks must be sourceable');
  assert.match(res.stdout, /RETURNED/, `wait_for_checks did not return:\n${res.stdout}${res.stderr}`);
  return { log: res.stderr, seconds: (Date.now() - started) / 1000 };
};

test('a pushed head with an open PR waits until the BuildMonitor reports a result for it', () => {
  const { wt, head } = desk();
  try {
    const { log, seconds } = wait({ wt, late: finding('build failed', head) });
    assert.match(log, /waiting for the checks on feature\/waits-for-checks/, log);
    assert.match(log, /CI answered on feature\/waits-for-checks/, log);
    assert.ok(seconds >= 2, `returned after ${seconds}s, before the result was published`);
  } finally {
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('a result already published for the head ends the wait at once', () => {
  const { wt, head } = desk();
  try {
    const { log, seconds } = wait({ wt, lines: [finding('build passed', head)] });
    assert.doesNotMatch(log, /waiting for the checks/, log);
    assert.ok(seconds < 5, `took ${seconds}s`);
  } finally {
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('a result for a superseded commit does not end the wait, and the wait expires at its bound', () => {
  const { wt } = desk();
  try {
    const { log } = wait({ wt, lines: [finding('build failed', 'b'.repeat(40))], waitSeconds: 2 });
    assert.match(log, /waiting for the checks/, log);
    assert.match(log, /no CI answer on feature\/waits-for-checks after 2s/, log);
  } finally {
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('a result for the branch the desk held before does not end the wait', () => {
  const { wt, head } = desk();
  try {
    const { log } = wait({ wt, lines: [finding('build passed', head, 'feature/the-slice-before')], waitSeconds: 2 });
    assert.match(log, /no CI answer/, log);
  } finally {
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('no wait where no CI result is coming: not pushed, no open PR, or the wait disabled', () => {
  const { wt } = desk();
  try {
    for (const args of [{ pushed: false }, { prOpen: false }, { waitSeconds: 0 }]) {
      const { log, seconds } = wait({ wt, ...args });
      assert.doesNotMatch(log, /waiting for the checks/, `${JSON.stringify(args)}: ${log}`);
      assert.ok(seconds < 5, `${JSON.stringify(args)} took ${seconds}s`);
    }
  } finally {
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('after the wait, a failed run for the head is the correction the loop hands back', () => {
  const { wt, head } = desk();
  try {
    wait({ wt, late: finding('build failed', head), lateAfter: 1 });
    const script = `
      PLOT_WORKER_LOOP_SOURCED=1
      . ${JSON.stringify(loop)}
      PLOT_WORKTREE=${JSON.stringify(wt)}
      if out=$(build_says_failed); then printf 'OWED %s' "$out"; else printf 'NOTHING'; fi
    `;
    const out = execFileSync('bash', ['-c', script], { encoding: 'utf8', timeout: 30_000 });
    assert.match(out, new RegExp(`^OWED the run at https://ci/run/1 for ${head} concluded failure`), out);
  } finally {
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test('the wait is asked before the correction check in the loop body', () => {
  // The order is the mechanism: asked after, the check reads a file CI has not
  // written to yet, which is how #1168's failure went unanswered.
  const body = fs.readFileSync(loop, 'utf8');
  const waitAt = body.indexOf('\n  wait_for_checks\n');
  const checkAt = body.indexOf('_correction=$(build_says_failed)');
  assert.ok(waitAt > 0, 'the loop body must call wait_for_checks');
  assert.ok(checkAt > waitAt, 'wait_for_checks must run before build_says_failed is asked');
});
