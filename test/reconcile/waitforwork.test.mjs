// AN AGENT WAITS FOR WORK — asserted by finding it alive and free after the
// condition that used to kill it.
//
// `plot-worker-loop.sh:952` read `next_branch=$(… --next "$PLOT_SLUG") || break`
// until 2026-09-03, and the ask itself went on 2026-09-04 — the agent now reads
// the branch the registry handed it rather than shopping for one, so the wait
// polls its own manifest. No claimable slice ended the process, and two departures
// from the model rode on that one word: an agent had no idle state, and
// termination was a judgement the agent made about the ESTATE rather than a
// reading of ITSELF. Measured 2026-09-03 on the live estate: 0 live workers, 0
// manifests, 4 desks standing, and eligible work on the board.
//
// THE PROOF IS A LIVE PROCESS, NOT A LOG LINE. A test that only grepped the
// wait's message would pass on a loop that printed it and then exited — which
// is the exact defect, one sentence louder. So the loop runs DETACHED, and the
// assertions are taken while it is still running: the pid answers, and the
// manifest the registry would read names no branch. Those two facts are
// `isAgentFree`'s definition (`packages/domain/src/rules/free.ts`), so the agent
// is free by the rule as written rather than by a flag this slice invented.
//
// THEN IT IS STOPPED, because a waiting agent nothing can reach is a stalled
// one. The stop is the SIGTERM `plot-dispatch.sh --stop` sends — the dispatcher
// itself is not invoked, since its `--stop` reads a worktree path built from the
// branch name and the fixture's desks are laid out by the test rather than by
// dispatch. The signal is the contract; the path lookup is dispatch's own and
// has its own tests.
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Is this pid still there? `kill -0` without the signal. */
const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

/** Poll until `check()` is truthy or the deadline passes; returns the value. */
async function until(check, ms, what) {
  const deadline = Date.now() + ms;
  for (;;) {
    const got = await check();
    if (got) return got;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(200);
  }
}

/**
 * A bare origin, a clone, and an approved two-wave plan whose second wave is
 * BLOCKED behind the first — the same shape `free-window.test.mjs` uses.
 *
 * THE DIFFERENCE IS WHAT THE AGENT DOES. There, the fixture agent MERGES its
 * slice, which opens the second wave and makes the worker hop. Here it does not
 * merge: the second wave stays blocked, nothing writes a branch into the
 * manifest, and the loop reaches the line under test with nothing handed to it.
 */
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-waitwork-'));
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
  fs.writeFileSync(path.join(work, 'docs', 'plans', '2026-09-03-waitwork.md'), `# Wait for work

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
  git(work, 'add', '-A');
  git(work, 'commit', '-qm', 'plan');
  git(work, 'push', '-q', 'origin', 'main');
  return { root, origin, work };
}

/** Claim a branch the way the dispatcher does, and hand the worker a desk. */
function claim(sb, branch) {
  const wtRoot = path.join(sb.root, 'worktrees');
  fs.mkdirSync(wtRoot, { recursive: true });
  const wt = path.join(wtRoot, `plot-wt-${branch.replace(/\//g, '-')}`);
  git(sb.work, 'worktree', 'add', '-q', '-b', branch, wt, 'origin/main');
  git(wt, 'commit', '-q', '--allow-empty', '-m', `plot: claim ${branch}`);
  git(wt, 'push', '-qu', 'origin', branch);
  return { wt, wtRoot };
}

/**
 * The fixture agent: it commits and pushes its slice, and STOPS THERE.
 *
 * NOTHING IS MERGED, deliberately. The second wave stays blocked, so the
 * registry has nothing to hand over and the loop reaches the wait. It pushes
 * because a desk holding unpushed commits is `stalled` rather than free, and
 * this test is about the agent that finished cleanly and was handed nothing.
 */
const prompt = () => `set -e
echo "$PLOT_BRANCH" > "$PLOT_WORKTREE/work-\${PLOT_BRANCH##*/}.txt"
git -C "$PLOT_WORKTREE" add -A
git -C "$PLOT_WORKTREE" commit -qm "work on $PLOT_BRANCH"
git -C "$PLOT_WORKTREE" push -q origin "$PLOT_BRANCH"
`;

test('a free agent waits instead of exiting, and can still be stopped', async () => {
  const sb = sandbox();
  let child;
  try {
    const { wt } = claim(sb, 'feature/seam');

    // PRECONDITION: wave 2 must be blocked, or the loop never reaches the wait.
    const before = execFileSync('bash',
      [path.join(scripts, 'plot-fleet-scan.sh'), '--offline', 'waitwork'],
      { encoding: 'utf8', cwd: sb.work });
    assert.match(before, /Implementation — blocked/,
      'precondition: the second wave must be blocked, or the registry would have work to hand over');

    const manifestDir = path.join(sb.work, '.plot', 'agents');
    fs.mkdirSync(manifestDir, { recursive: true });
    const manifest = path.join(manifestDir, 'sess-waitwork.json');
    fs.writeFileSync(manifest, JSON.stringify({
      session: 'sess-waitwork',
      resumeId: 'sess-waitwork',
      branch: 'feature/seam',
      worktree: wt,
      command: 'plot-worker-loop.sh',
      pid: '4242',
      wrapperPid: '4241',
      attempts: 0,
      startedAt: '2026-09-03T09:00:00Z',
    }, null, 2) + '\n');

    fs.mkdirSync(path.join(wt, '.plot'), { recursive: true });
    fs.writeFileSync(path.join(wt, '.plot', 'worker-prompt.sh'), prompt());

    const logPath = path.join(sb.root, 'loop.log');
    const log = fs.openSync(logPath, 'a');
    child = spawn('bash', [path.join(scripts, 'plot-worker-loop.sh')], {
      cwd: wt,
      stdio: ['ignore', log, log],
      env: {
        ...process.env,
        PLOT_BRANCH: 'feature/seam',
        PLOT_WORKTREE: wt,
        PLOT_SLUG: 'waitwork',
        PLOT_MANIFEST_FILE: manifest,
        // A 2s poll rather than the 60s default: the test asserts the loop is
        // STILL THERE across several passes, and the default would make that a
        // five-minute test to prove a property one pass already shows.
        PLOT_WAIT_POLL_SECONDS: '2',
      },
    });

    // THE WAIT WAS ENTERED, and it said what it is waiting on. The message is
    // the operator's only view of a process doing nothing, so it is asserted —
    // but it is the weakest of the three claims here, and the two below are
    // what make it mean anything.
    const logged = await until(
      () => {
        const text = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
        return text.includes('free on waitwork') ? text : null;
      },
      90000, 'the loop to report itself free');
    assert.match(logged, /nothing handed over yet/,
      'the wait says what it is waiting FOR — an assignment, not a branch to shop for');
    assert.match(logged, /feature\/seam has still to land/,
      'and it still names the branch whose landing would open the blocked slice');
    assert.match(logged, /--stop/, 'the wait tells an operator how to end it');

    // IT IS STILL RUNNING. This is the assertion the old `|| break` fails: the
    // process that printed the line above must still be there when it is read.
    assert.ok(alive(child.pid), 'the agent is alive after finding no claimable slice');

    // AND IT IS FREE, by `isAgentFree` — alive, and the manifest the registry
    // reads names no branch. Read from disk while the loop runs, because the
    // exit trap removes the file and a reading taken afterwards would be about
    // an absence.
    const held = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    assert.equal(held.branch, '', 'a waiting agent holds no slice');
    assert.equal(held.worktree, wt, 'it is still sitting at its desk');
    assert.equal(held.session, 'sess-waitwork', 'its identity survives the wait');

    // IT WAITS ACROSS PASSES rather than falling out on the second silence. The
    // re-read can come back empty forever here — nothing merges in this fixture
    // and nothing writes an assignment — and three polls at 2s is enough to
    // catch a loop that exits on one.
    await sleep(7000);
    assert.ok(alive(child.pid), 'the agent is still waiting several polls later');

    // IT CAN STILL BE STOPPED. This is the SIGTERM `plot-dispatch.sh --stop`
    // sends. A wait nothing can interrupt would be a stall wearing the word
    // "waiting", so the interruption is part of the property, not a teardown.
    process.kill(child.pid, 'SIGTERM');
    await until(() => !alive(child.pid), 15000, 'the stopped agent to exit');

    // THE MANIFEST WENT WITH IT. The exit trap removes the registration on
    // every path, so a stopped agent stops appearing in the registry — the same
    // guarantee every other ending already carries.
    assert.equal(fs.existsSync(manifest), false,
      'a stopped agent deregisters, exactly as one that ended any other way does');
  } finally {
    if (child && child.pid && alive(child.pid)) {
      try { process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ }
    }
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});
