// Flow tests: a worker HOPS — it finishes one slice and starts the next.
//
// NO WORKER HAD EVER HOPPED IN THIS REPO when these tests were written. The
// path exists (`plot-worker-loop.sh` loops, asks `--next`, creates the
// worktree, rewrites its manifest) and had never once executed: on 2026-08-30
// seven workers exited 124 and not one reached the `--next` call, because the
// wall-clock bound killed them first. The loop's own message said so —
// "ending worker without hopping". `a-working-agent-is-not-a-hung-one` moved
// the verdict to the WorkerMonitor, and this suite is the evidence the hop
// works at all.
//
// ASSERTED FROM OUTSIDE, NEVER BY READING THE SCRIPT. "the function that would
// hop is called" is what a green suite over a dead path looks like — the shape
// this repo already shipped once, in worker-loop-manifest.test.mjs's SIGKILL
// test, which matches the loop's source with a regex. The assertion here is
// that one worker RAN ON TWO BRANCHES IN SEQUENCE, observed from a file the
// worker's own prompt appended to on each slice.
//
// THE FIXTURE NEEDS TWO WAVES, and that is the whole difficulty. A plan with
// one eligible branch proves nothing and passes: `--next` returns nothing, the
// worker exits correctly, and the suite is green having hopped over no work.
// So the plan here has a Tracer wave gating an Implementation wave, and the
// fixture agent LANDS its slice — which is what makes the second wave eligible
// between the two `--next` calls.
//
// THE LANDING IS A MERGE COMMIT, not a fast-forward. Measured while writing
// this suite: pushing the branch tip straight onto main leaves branch and main
// at the SAME oid, which `branch_state` reads as `open` — deliberately, since
// "reset to main" and "merged" are indistinguishable by ancestry
// (plot-fleet-scan.sh, "ZERO AHEAD CARRIES TWO SHAPES"). A fast-forward fixture
// therefore never opens wave 2 and the worker never hops, which reads exactly
// like the hop being broken.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeSandbox, runScript, SCRIPTS, sh } from './helpers.mjs';

const CONFIG = [
  '- **Plan directory:** docs/plans/',
  '- **Active index:** docs/plans/active/',
  // A bound large enough that it cannot fire during the test. The floor is not
  // under test here — the Reading slice owns it — and a bound that fired would
  // end the worker before the hop, which is the 2026-08-30 failure itself.
  '- **Worker bound:** 600',
].join('\n');

/**
 * An approved two-wave plan on origin: `feature/seam` gates `feature/api`.
 *
 * The gating is the point. `feature/api` is BLOCKED until the tracer merges,
 * so the worker's second `--next` can only answer once its first slice landed.
 */
function twoWavePlan(work, { slug, date = '2026-08-31' }) {
  const rel = `docs/plans/${date}-${slug}.md`;
  fs.mkdirSync(path.join(work, 'docs', 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(work, 'docs', 'plans', 'delivered'), { recursive: true });
  fs.writeFileSync(path.join(work, rel), `# Hop flow

## Status

- **Phase:** Approved
- **Type:** feature
- **Review:** pr
- **Impl:** own branches
- **Approved:** ${date}, alice, in-session

## Branches

### Tracer
- \`feature/seam\` — proves the seam

### Implementation
- \`feature/api\` — endpoint
`);
  fs.symlinkSync(`../${date}-${slug}.md`, path.join(work, 'docs', 'plans', 'active', `${slug}.md`));
  sh(work, 'git add -A && git commit -qm plan && git push -q origin main');
  return rel;
}

/**
 * Claim a branch the way `plot-dispatch.sh` does — worktree, empty claim
 * commit, push — and write the manifest the dispatcher would have written.
 * Returns the worktree path and the manifest path.
 *
 * Dispatch itself is not called: it would START a worker, and this suite needs
 * to run the loop in the foreground with its own prompt and read its exit code.
 */
function claimAsDispatcher(sb, branch) {
  const wtRoot = path.join(sb.root, 'wt');
  const registry = path.join(sb.root, 'registry');
  fs.mkdirSync(wtRoot, { recursive: true });
  fs.mkdirSync(registry, { recursive: true });
  const wt = path.join(wtRoot, `plot-wt-${branch.replace(/\//g, '-')}`);
  sh(sb.work, `git worktree add -q -b ${branch} ${wt} origin/main`);
  sh(wt, `git commit -q --allow-empty -m "plot: claim ${branch}"`);
  sh(wt, `git push -qu origin ${branch}`);
  const manifest = path.join(registry, 'worker-hop.json');
  fs.writeFileSync(manifest, `${JSON.stringify({
    session: 'hop-session',
    pid: process.pid,
    branch,
    worktree: wt,
    startedAt: '2026-08-31T00:00:00Z',
    wavesCount: 1,
  }, null, 2)}\n`);
  return { wt, manifest, wtRoot };
}

/**
 * The fixture agent. It does what a real one does at the end of a slice —
 * commit, push, and land the work — plus two things a real one does not: it
 * records which branch it ran on, and it snapshots the manifest it is running
 * under.
 *
 * THE SNAPSHOT IS TAKEN FROM INSIDE because the manifest does not outlive the
 * worker: `_cleanup_on_exit` removes it on every exit path, so a test reading
 * the registry after the loop returns finds nothing. The prompt is the only
 * observer alive during the second slice, and what it reads is the registry
 * entry a board would have rendered at that moment.
 *
 * `land: false` writes an agent that finishes WITHOUT landing anything — the
 * shape that leaves the next wave blocked.
 */
function fixturePrompt({ ranFile, snapshotDir, work, manifest, land = true }) {
  return `# Fixture agent — see worker-hops.test.mjs
set -e
printf '%s\\n' "$PLOT_BRANCH" >> ${ranFile}
cp ${manifest} ${snapshotDir}/manifest-\${PLOT_BRANCH##*/}.json 2>/dev/null || true
echo "$PLOT_BRANCH" > "$PLOT_WORKTREE/work-\${PLOT_BRANCH##*/}.txt"
git -C "$PLOT_WORKTREE" add -A
git -C "$PLOT_WORKTREE" commit -qm "work on $PLOT_BRANCH"
git -C "$PLOT_WORKTREE" push -q origin "$PLOT_BRANCH"
${land ? `# Land it the way a merged PR does: a merge commit on the default branch.
# A fast-forward would leave branch and main at one oid, which reads \`open\`.
git -C ${work} fetch -q origin
git -C ${work} merge -q --no-ff -m "Merge $PLOT_BRANCH" "origin/$PLOT_BRANCH"
git -C ${work} push -q origin main` : '# This agent lands nothing: the next wave stays blocked.'}
`;
}

/**
 * Run the real loop in the foreground, as the wrapper's command would.
 *
 * THE LOOP NO LONGER ENDS ON A SILENT `--next`. Since
 * `an-agent-waits-for-work` an agent with nothing to take reports itself free
 * and WAITS, so every fixture here — each of which runs out of slices by
 * design — would hold this call open until its timeout. The wait is bounded to
 * one poll, and the loop then ends on its own bound the way a real one does
 * after `Worker bound`.
 *
 * SO `execFileSync` THROWING STOPPED BEING THE ASSERTION. It threw on any
 * non-zero exit, and 124 now means two different things: a watcher truncated a
 * prompt, or a free agent waited out its bound having finished cleanly. The
 * exit code cannot tell them apart, so the caller is handed the STDERR instead
 * and asks the message — which was written to name the ending.
 *
 * @returns `{ stdout, stderr, code }` — `code` 0 or 124 on any healthy path
 */
function runLoop({ wt, manifest, branch, slug, timeout = 120000 }) {
  try {
    const stdout = execFileSync('bash', [path.join(SCRIPTS, 'plot-worker-loop.sh')], {
      cwd: wt,
      encoding: 'utf8',
      timeout,
      env: {
        ...process.env,
        PLOT_BRANCH: branch,
        PLOT_WORKTREE: wt,
        PLOT_SLUG: slug,
        PLOT_MANIFEST_FILE: manifest,
        PLOT_WAIT_POLL_SECONDS: '1',
        PLOT_WAIT_BUDGET_SECONDS: '1',
      },
    });
    return { stdout, stderr: '', code: 0 };
  } catch (err) {
    if (err.status !== 124) throw err;
    return {
      stdout: err.stdout ? String(err.stdout) : '',
      stderr: err.stderr ? String(err.stderr) : '',
      code: 124,
    };
  }
}

test('flow: a worker finishes one slice and starts the next — one agent, two branches', () => {
  // The claim this whole plan exists to make good. Nothing about it is read
  // from the loop's source: the evidence is a file the worker appended to once
  // per slice, and the desk it did that from.
  //
  // THE DESK IS ONE, since `an-agent-decides-create-or-reset`. The hop used to
  // cut a worktree per branch and leave the previous one on disk; the agent now
  // takes over the desk it holds, so what proves the hop is the SECOND LINE in
  // `ran.txt` and the ABSENCE of a second directory.
  const sb = makeSandbox({ name: 'worker-hop', config: CONFIG });
  try {
    twoWavePlan(sb.work, { slug: 'hopflow' });
    const { wt, manifest, wtRoot } = claimAsDispatcher(sb, 'feature/seam');

    // Precondition — and it is the trap this fixture exists to avoid. If wave 2
    // were eligible from the start, the worker would "hop" onto a branch that
    // was never gated and the test would prove nothing.
    const before = runScript('plot-fleet-scan.sh', ['--offline', 'hopflow'], { cwd: sb.work });
    assert.match(before, /Implementation — blocked/,
      'precondition: the second wave must be blocked, or the hop proves nothing');

    const ranFile = path.join(sb.root, 'ran.txt');
    const snapshotDir = path.join(sb.root, 'snapshots');
    fs.mkdirSync(snapshotDir, { recursive: true });
    fs.mkdirSync(path.join(wt, '.plot'), { recursive: true });
    fs.writeFileSync(path.join(wt, '.plot', 'worker-prompt.sh'),
      fixturePrompt({ ranFile, snapshotDir, work: sb.work, manifest }));

    runLoop({ wt, manifest, branch: 'feature/seam', slug: 'hopflow' });

    // THE HOP: one worker, two branches, in that order.
    const ran = fs.readFileSync(ranFile, 'utf8').trim().split('\n');
    assert.deepEqual(ran, ['feature/seam', 'feature/api'],
      'the worker must run its prompt on the second branch after finishing the first');

    // And it ran both slices at ONE desk. A `plot-wt-feature-api` here would be
    // the abandoned checkout this plan exists to stop: measured 2026-09-02, 2
    // agents holding 11 worktrees.
    assert.equal(fs.existsSync(path.join(wtRoot, 'plot-wt-feature-api')), false,
      'the hop must reset the desk it holds, not cut a second one');

    // The claim on the second branch is a REF on origin, the same exclusion
    // dispatch relies on — not a note the worker kept to itself.
    assert.match(sh(sb.work, 'git ls-remote --heads origin feature/api'), /feature\/api/,
      'the hop must claim the next branch by pushing its ref');

    sb.cleanup();
  } catch (e) {
    sb.cleanup();
    throw e;
  }
});

test('flow: the manifest after the hop names the second branch and its worktree', () => {
  // The registry must show where the worker IS, not where it started. Read
  // from a snapshot the agent took while running on the second slice, because
  // the manifest is removed on exit and cannot be read afterwards.
  const sb = makeSandbox({ name: 'worker-hop-manifest', config: CONFIG });
  try {
    twoWavePlan(sb.work, { slug: 'hopmanifest' });
    const { wt, manifest } = claimAsDispatcher(sb, 'feature/seam');

    const ranFile = path.join(sb.root, 'ran.txt');
    const snapshotDir = path.join(sb.root, 'snapshots');
    fs.mkdirSync(snapshotDir, { recursive: true });
    fs.mkdirSync(path.join(wt, '.plot'), { recursive: true });
    fs.writeFileSync(path.join(wt, '.plot', 'worker-prompt.sh'),
      fixturePrompt({ ranFile, snapshotDir, work: sb.work, manifest }));

    runLoop({ wt, manifest, branch: 'feature/seam', slug: 'hopmanifest' });

    const first = JSON.parse(fs.readFileSync(path.join(snapshotDir, 'manifest-seam.json'), 'utf8'));
    const after = JSON.parse(fs.readFileSync(path.join(snapshotDir, 'manifest-api.json'), 'utf8'));

    assert.equal(after.branch, 'feature/api', 'the manifest must name the branch hopped to');
    // THE DESK DID NOT MOVE, and the manifest must still name it. `worktree` is
    // written on every hop so the field's contract stays *where the agent is*;
    // on a reset that write lands the same value, and the registry's transcript
    // join and liveness check — both keyed on this path — keep working.
    assert.equal(after.worktree, wt,
      'the manifest must name the desk the agent actually holds');
    assert.equal(after.wavesCount, 2, 'wavesCount counts the slices this worker has taken');

    // SAME WORKER, NEW PLACE. A hop is one session continuing, so the identity
    // fields must not move — a changed session or pid would make the board show
    // a second worker and the cap count a slot that was never taken.
    assert.equal(after.session, first.session, 'a hop must not change the session');
    assert.equal(after.pid, first.pid, 'a hop must not change the pid');
    assert.equal(after.startedAt, first.startedAt, 'a hop must not restart the clock');

    sb.cleanup();
  } catch (e) {
    sb.cleanup();
    throw e;
  }
});

test('flow: a worker with no next branch reports itself free and waits', () => {
  // `--next` exits 1 for "nothing to start", which is a NORMAL state — the
  // fleet is simply out of work for this plan. THE LOOP USED TO BREAK ON IT.
  //
  // `an-agent-waits-for-work` changed what that means. Measured 2026-09-03 on
  // the live estate: 0 live workers, 0 manifests, 4 desks standing, and
  // eligible work on the board — every agent had exited on this condition and
  // none had failed. "No work exists for my plan" is a judgement about the
  // ESTATE, made by the one party with no standing to make it, so the agent now
  // reports itself free and waits to be handed something.
  //
  // THIS TEST THEREFORE ASSERTS THE OPPOSITE OF ITS OLD SELF, and the two facts
  // it kept are the ones that did not change: exactly one slice ran, and the
  // agent deregistered when it finally ended. What is new is the middle — it
  // said it was free before it ended, and it ended on its bound rather than on
  // the silence.
  //
  // The fixture agent here lands nothing, so the second wave stays blocked and
  // the only branch on offer is the one already claimed.
  const sb = makeSandbox({ name: 'worker-no-next', config: CONFIG });
  try {
    twoWavePlan(sb.work, { slug: 'nonext' });
    const { wt, manifest } = claimAsDispatcher(sb, 'feature/seam');

    const ranFile = path.join(sb.root, 'ran.txt');
    const snapshotDir = path.join(sb.root, 'snapshots');
    fs.mkdirSync(snapshotDir, { recursive: true });
    fs.mkdirSync(path.join(wt, '.plot'), { recursive: true });
    fs.writeFileSync(path.join(wt, '.plot', 'worker-prompt.sh'),
      fixturePrompt({ ranFile, snapshotDir, work: sb.work, manifest, land: false }));

    const r = runLoop({ wt, manifest, branch: 'feature/seam', slug: 'nonext' });

    // IT SAID IT WAS FREE, and it named what it was waiting on. The second wave
    // is blocked behind `feature/seam`, which this fixture never lands — so the
    // outlook is `not-yet` and the blocker is nameable, which is the whole
    // difference between waiting and stalling.
    assert.match(r.stderr, /free on nonext/,
      'a worker offered nothing reports itself free rather than exiting on the silence');
    assert.match(r.stderr, /feature\/seam has still to land/,
      'the wait names the branch whose landing would open the blocked slice');

    // AND IT ENDED ON ITS BOUND, not on the silence. The two are different
    // endings and the message keeps them apart: this one says nothing was cut
    // short, because no prompt was running when the bound ran out.
    assert.equal(r.code, 124, 'a wait that runs out ends the worker on the bound');
    assert.match(r.stderr, /the wait ran out on nonext/,
      'the ending names the wait, not one of the three prompt readings');

    const ran = fs.readFileSync(ranFile, 'utf8').trim().split('\n');
    assert.deepEqual(ran, ['feature/seam'],
      'a worker with no next branch must run exactly one slice and take no other');

    // And it deregistered: ending is not the same as vanishing.
    assert.ok(!fs.existsSync(manifest),
      'the manifest must be removed when the worker ends');

    sb.cleanup();
  } catch (e) {
    sb.cleanup();
    throw e;
  }
});
