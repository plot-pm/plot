// A MOVED WORKER RECORDS ITSELF AT ONE DESK — asserted by making a real loop
// move to a new desk and reading both desks afterwards.
//
// The wrapper in `start_worker` writes `.plot-worker.pid` and
// `.plot-worker.wrapper.pid` into the desk an agent STARTS in. When the loop
// cannot reset that desk for its next slice, it cuts a `plot-wt-<branch>` desk
// and moves there. Measured 2026-10-02: the old desk still named the live loop
// pid, so `plot-worker-state.sh` read it as `running`, `plot-reap.sh` refused it
// as a live worker, and `--release` refused it too.
//
// The loop now copies both records to the new desk and EMPTIES them in the old
// one. Emptied rather than deleted: `.plot-worker.pid` is how `plot-reap.sh` and
// `plot-reconcile-scan.sh` §21 recognise a dispatch desk, and a desk without it
// is never reaped.
//
// The fixture is `declaration-hop.test.mjs`'s: a bare origin, a two-wave plan,
// and a shim that hands the second slice over once. The first slice leaves an
// untracked file behind, which holds the desk and forces the move. A `sleep`
// stands in for the agent, because the records name a pid that must be alive
// for the old reading (`running`) to be the defect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

const shimmedScripts = (root, manifest, handOver) => {
  const dir = path.join(root, 'scripts');
  fs.cpSync(scripts, dir, { recursive: true });
  const real = path.join(dir, 'plot-fleet-scan.real.sh');
  fs.renameSync(path.join(dir, 'plot-fleet-scan.sh'), real);
  const once = path.join(root, 'handed-over');
  fs.writeFileSync(path.join(dir, 'plot-fleet-scan.sh'), `#!/usr/bin/env bash
if [ -f ${JSON.stringify(manifest)} ] && [ ! -f ${JSON.stringify(once)} ]; then
  touch ${JSON.stringify(once)}
  node -e '
    const fs = require("fs");
    const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    m.branch = process.argv[2];
    fs.writeFileSync(process.argv[1], JSON.stringify(m, null, 2) + "\\n");
  ' ${JSON.stringify(manifest)} ${JSON.stringify(handOver)}
fi
exec bash ${JSON.stringify(real)} "\$@"
`, { mode: 0o755 });
  return dir;
};

const sandbox = (leave) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-movedpid-'));
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
- **Active index:** docs/plans/active/
- **Worker bound:** 600
`);
  fs.mkdirSync(path.join(work, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(work, 'docs', 'plans', '2026-10-02-movedpid.md'), `# Moved pid

## Status

- **Phase:** Approved
- **Type:** feature
- **Review:** pr
- **Impl:** own branches

## Branches

### Tracer
- \`feature/seam\` — thin slice

### Implementation
- \`feature/api\` — blocked behind the seam
`);
  // THE PROMPT IS TRACKED, as an adopting repository tracks it, so the desk
  // holds no untracked file of its own and only `left-behind.txt` can hold it.
  fs.mkdirSync(path.join(work, '.plot'), { recursive: true });
  fs.writeFileSync(path.join(work, '.plot', 'worker-prompt.sh'), prompt(work, leave));
  git(work, 'add', '-A');
  git(work, 'commit', '-qm', 'plan');
  git(work, 'push', '-q', 'origin', 'main');
  return { root, work };
};

const claim = (sb, branch) => {
  const wtRoot = path.join(sb.root, 'worktrees');
  fs.mkdirSync(wtRoot, { recursive: true });
  const wt = path.join(wtRoot, `plot-wt-${branch.replace(/\//g, '-')}`);
  git(sb.work, 'worktree', 'add', '-q', '-b', branch, wt, 'origin/main');
  git(wt, 'commit', '-q', '--allow-empty', '-m', `plot: claim ${branch}`);
  git(wt, 'push', '-qu', 'origin', branch);
  return { wt, wtRoot };
};

/**
 * The fixture agent lands its slice as a merge commit. With `leave` set, the
 * FIRST slice also leaves an untracked file on its desk, which is what holds
 * the desk and makes the loop cut a new one. It stages only its own file, so
 * the pid records never enter a commit.
 */
const prompt = (work, leave) => `set -e
echo "$PLOT_BRANCH" > "$PLOT_WORKTREE/work-\${PLOT_BRANCH##*/}.txt"
git -C "$PLOT_WORKTREE" add "work-\${PLOT_BRANCH##*/}.txt"
git -C "$PLOT_WORKTREE" commit -qm "work on $PLOT_BRANCH"
git -C "$PLOT_WORKTREE" push -q origin "$PLOT_BRANCH"
git -C ${work} fetch -q origin
git -C ${work} merge -q --no-ff -m "Merge $PLOT_BRANCH" "origin/$PLOT_BRANCH"
git -C ${work} push -q origin main
${leave ? 'if [ "$PLOT_BRANCH" = feature/seam ]; then echo left > "$PLOT_WORKTREE/left-behind.txt"; fi' : ''}
`;

/**
 * Drive one loop through two slices, the desk's records naming `agentPid`.
 * Returns the paths and the manifest directory the state reader needs.
 */
const runHop = (sb, agentPid) => {
  const { wt, wtRoot } = claim(sb, 'feature/seam');
  fs.writeFileSync(path.join(wt, '.plot-worker.pid'), String(agentPid));
  fs.writeFileSync(path.join(wt, '.plot-worker.wrapper.pid'), String(agentPid));

  // `pid` is the placeholder the dispatcher writes before the wrapper stamps
  // it, so every reading below comes from the desk files under test.
  const manifestDir = path.join(sb.work, '.plot', 'agents');
  fs.mkdirSync(manifestDir, { recursive: true });
  const manifest = path.join(manifestDir, 'sess-movedpid.json');
  fs.writeFileSync(manifest, JSON.stringify({
    session: 'sess-movedpid',
    resumeId: 'sess-movedpid',
    branch: 'feature/seam',
    worktree: wt,
    command: 'plot-worker-loop.sh',
    pid: '',
    attempts: 0,
    startedAt: '2026-10-02T09:00:00Z',
  }, null, 2) + '\n');
  const dir = shimmedScripts(sb.root, manifest, 'feature/api');

  // AN OLD MTIME, so a same-desk reset can be shown not to rewrite the file.
  const old = new Date('2026-01-01T00:00:00Z');
  fs.utimesSync(path.join(wt, '.plot-worker.pid'), old, old);

  try {
    execFileSync('bash', [path.join(dir, 'plot-worker-loop.sh')], {
      cwd: wt,
      encoding: 'utf8',
      timeout: 120000,
      env: {
        ...process.env,
        PLOT_BRANCH: 'feature/seam',
        PLOT_WORKTREE: wt,
        PLOT_SLUG: 'movedpid',
        PLOT_MANIFEST_FILE: manifest,
        PLOT_WAIT_POLL_SECONDS: '1',
        PLOT_WAIT_BUDGET_SECONDS: '6',
      },
    });
  } catch (err) {
    assert.equal(err.status, 124,
      `the loop may only end on its own bound here: ${err.stderr}`);
  }
  return { wt, newWt: path.join(wtRoot, 'plot-wt-feature-api'), manifestDir, mtime: old.getTime() };
};

/** `plot_worker_state`'s first field for a desk, read the way every caller reads it. */
const stateOf = (wt, manifestDir) => execFileSync('bash', ['-c',
  '. "$1/plot-worker-state.sh"; plot_worker_state "$2"', '_', scripts, wt], {
  encoding: 'utf8',
  env: { ...process.env, PLOT_MANIFEST_DIR: manifestDir, PLOT_AGENT_GRACE_SECONDS: '100000' },
}).split('\t')[0];

const read = (file) => fs.readFileSync(file, 'utf8');

const sleeper = () => spawn('sleep', ['300'], { stdio: 'ignore' });

test('moved worker: the new desk names the pid and the old desk names none', () => {
  const sb = sandbox(true);
  const agent = sleeper();
  try {
    const { wt, newWt, manifestDir } = runHop(sb, agent.pid);

    // PRECONDITION: the move happened. Without it there is nothing to assert.
    assert.ok(fs.existsSync(path.join(newWt, 'work-api.txt')),
      'the loop worked the second slice in a new desk');

    // THE DEFECT: before the fix the old desk read `running`.
    assert.equal(stateOf(wt, manifestDir), 'none',
      'the old desk reads as having no worker');

    // EMPTIED, NOT DELETED: the file is what recognises the old desk as a
    // dispatch desk, so the reaper can still find it.
    assert.ok(fs.existsSync(path.join(wt, '.plot-worker.pid')),
      'the old desk keeps its pid file, so it is still recognised as a dispatch desk');
    assert.equal(read(path.join(wt, '.plot-worker.pid')), '',
      'the old desk names no pid');
    assert.equal(read(path.join(wt, '.plot-worker.wrapper.pid')), '',
      'the old desk names no wrapper pid');

    assert.equal(read(path.join(newWt, '.plot-worker.pid')), String(agent.pid),
      'the new desk names the agent pid the wrapper recorded');
    assert.equal(read(path.join(newWt, '.plot-worker.wrapper.pid')), String(agent.pid),
      'the new desk names the wrapper pid the wrapper recorded');

    assert.equal(stateOf(newWt, manifestDir), 'running',
      'the new desk reads as running while the agent lives');
  } finally {
    agent.kill();
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});

test('moved worker: a same-desk reset leaves the pid file alone', () => {
  const sb = sandbox(false);
  const agent = sleeper();
  try {
    const { wt, newWt, manifestDir, mtime } = runHop(sb, agent.pid);

    assert.ok(fs.existsSync(path.join(wt, 'work-api.txt')),
      'the loop worked the second slice in the desk it already held');
    assert.equal(fs.existsSync(newWt), false, 'no second desk was cut');

    assert.equal(read(path.join(wt, '.plot-worker.pid')), String(agent.pid),
      'the desk still names the agent pid');
    assert.equal(fs.statSync(path.join(wt, '.plot-worker.pid')).mtimeMs, mtime,
      'the pid file was not rewritten');
    assert.equal(stateOf(wt, manifestDir), 'running', 'the desk still reads as running');
  } finally {
    agent.kill();
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});

/** `plot_monitor_subject` for a pid file, from the shared helper. */
const subjectOf = (pidFile) => execFileSync('bash', ['-c',
  '. "$1/plot-monitor-subject.sh"; plot_monitor_subject "$2"', '_', scripts, pidFile],
{ encoding: 'utf8' });

test('moved worker: a monitor watching an emptied desk leaves once the wrapper records the exit', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-movedpid-mon-'));
  try {
    const pidFile = path.join(root, '.plot-worker.pid');
    fs.writeFileSync(pidFile, '');
    // The startup window: no exit record yet, so the subject may still come.
    assert.equal(subjectOf(pidFile), 'starting');
    // The wrapper writes the exit into the desk the agent started in, which
    // after a move is the emptied one. That record ends the monitor.
    fs.writeFileSync(path.join(root, '.plot-worker.exit'), '0');
    assert.equal(subjectOf(pidFile), 'gone');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
