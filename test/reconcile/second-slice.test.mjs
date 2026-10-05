// A SECOND SLICE NEEDS ITS OWN SESSION — asserted against a real loop, twice,
// and the fixture is where the two tests part.
//
// Measured 2026-09-05 on three agents at once: each finished its first slice,
// was handed a second, and could not start it. `.plot/worker-prompt.sh` passed
// `--session-id "$PLOT_SESSION_ID"` on every invocation; that id is minted once
// at launch and `--session-id` asks the runtime to CREATE a session, so the
// second prompt was refused with `Session ID … is already in use`, exited in
// under a second, and the loop read the refusal as a completed slice.
//
// `declaration-hop.test.mjs` PERFORMS A REAL HOP AND WAS GREEN THROUGHOUT.
// Its header insists *"the hop is performed, not mocked"* and it is right about
// the bookkeeping it asserts. It could not catch this: its fixture prompt
// writes a file, commits and pushes, and never invokes `claude`, so no session
// id is ever consumed and the second slice starts happily. A fixture standing
// in for the thing under test passes whatever the real thing does.
//
// SO THE TWO HALVES ARE TESTED SEPARATELY, because one fixture cannot show
// both:
//
//   1. THE FLAG IS ASSERTED. A prompt that records the session arguments it was
//      handed, across a real hop: `--session-id` on the first slice, `--resume`
//      on the second, and never a bare `--resume`. No `claude` is needed,
//      because the decision is the LOOP's and the argv carries it.
//
//   2. THE FAILURE IS REPRODUCED. A prompt that exits non-zero when handed a
//      session id it has already seen — the shape of the real refusal. Only
//      this can prove the `unstarted` ending, the non-zero exit and the kept
//      assignment; a flag assertion reaches none of them.
//
// THE TRANSCRIPT IS THE PROBE'S SUBJECT AND THE FIXTURE WRITES IT. The loop
// decides the flag by asking whether a transcript exists under the handle, and
// `plot_transcript_dir` reads `$PLOT_TRANSCRIPT_HOME` before `$HOME` for
// exactly this. So the fixture prompt writes the file the real runtime would
// have written, under a home of the test's own — which is what makes the second
// slice's answer a reading rather than a stub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { testWorkerLoop, workerLoopLine } from './loop-switch.mjs';
import { registryWatcher } from './registry-watcher.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const scan = path.join(scripts, 'plot-fleet-scan.sh');
const ENDING = '.plot-worker.ending.json';

// SERIAL, for `workerloop.test.mjs`'s reason: every test here spawns a loop
// that runs a real hop against a real fleet scan, and the timing assertions
// below ("the wait ended, not the prompt") are only sharp while the spawned
// processes are not starving each other.
const serial = { concurrency: false };

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

/**
 * A bare origin, a clone, and an approved two-wave plan: `feature/seam` gates
 * `feature/api`.
 *
 * The gating is the point, exactly as in `declaration-hop.test.mjs`: a second
 * branch that was eligible from the start would let the loop "hop" onto work
 * nothing ever blocked, and the hop is what this file is about.
 */
function sandbox({ third = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-2ndslice-'));
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
${workerLoopLine()}`);
  fs.mkdirSync(path.join(work, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(work, 'docs', 'plans', '2026-09-05-secondslice.md'), `# Second slice

## Status

- **Phase:** Approved
- **Type:** bug
- **Review:** pr
- **Impl:** own branches

## Branches

### Tracer
- \`feature/seam\` — thin slice

### Implementation
- \`feature/api\` — blocked behind the seam
${third ? `
### Surface
- \`feature/ui\` — blocked behind the api
` : ''}`);
  git(work, 'add', '-A');
  git(work, 'commit', '-qm', 'plan');
  git(work, 'push', '-q', 'origin', 'main');
  // A desk's `.plot/` and its `.plot-worker.*` files are the desk's own, not unlanded work: the JS loop refuses to take up a desk that holds untracked files.
  fs.appendFileSync(path.join(work, '.git', 'info', 'exclude'), '.plot/\n.plot-worker.*\n');
  return { root, origin, work };
}

/** Claim the first branch the way the dispatcher does, and cut the desk. */
function claim(sb, branch) {
  const wtRoot = path.join(sb.root, 'worktrees');
  fs.mkdirSync(wtRoot, { recursive: true });
  const wt = path.join(wtRoot, `plot-wt-${branch.replace(/\//g, '-')}`);
  git(sb.work, 'worktree', 'add', '-q', '-b', branch, wt, 'origin/main');
  git(wt, 'commit', '-q', '--allow-empty', '-m', `plot: claim ${branch}`);
  git(wt, 'push', '-qu', 'origin', branch);
  return { wt, wtRoot };
}

const SESSION = '5c7c41bd-ae8f-45ec-a220-2a23b5f1a16b';

/** The manifest the dispatcher writes: `session` and `resumeId` hold one value. */
function manifestFile(sb, wt, branch) {
  const dir = path.join(sb.work, '.plot', 'agents');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${SESSION}.json`);
  fs.writeFileSync(file, JSON.stringify({
    session: SESSION,
    resumeId: SESSION,
    branch,
    worktree: wt,
    command: 'plot-worker-loop.sh',
    pid: '4242',
    wrapperPid: '4241',
    attempts: 0,
    wavesCount: 1,
    startedAt: '2026-09-05T09:00:00Z',
    // A FIELD NO WRITER NAMES, which a hop must carry through untouched.
    note: 'kept across hops',
  }, null, 2) + '\n');
  return file;
}

/**
 * Run the loop to its own end and return what it wrote to stderr.
 *
 * THE LOOP ENDS ON ITS WAIT BOUND, exactly as `declaration-hop.test.mjs`
 * records: a plan with two slices and both of them worked leaves the agent free
 * with nothing to take, and a free agent WAITS. So a non-zero exit is expected
 * and the code is asserted by the caller, never here.
 */
function runLoop(dir, wt, manifest, env = {}, timeout = 120000) {
  try {
    const stdout = execFileSync('bash', [path.join(dir, 'plot-worker-loop.sh')], {
      cwd: wt,
      encoding: 'utf8',
      timeout,
      env: {
        ...process.env,
        PLOT_BRANCH: 'feature/seam',
        PLOT_WORKTREE: wt,
        PLOT_SLUG: 'secondslice',
        PLOT_MANIFEST_FILE: manifest,
        PLOT_SESSION_ID: SESSION,
        PLOT_WAIT_POLL_SECONDS: '1',
        PLOT_WAIT_BUDGET_SECONDS: '6',
        ...env,
      },
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return { status: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

// ---------------------------------------------------------------------------
// 1 — THE FLAG IS ASSERTED
// ---------------------------------------------------------------------------
//
// The prompt records `$PLOT_SESSION_FLAG` and `$PLOT_SESSION_ID` per branch and
// then writes the transcript the real runtime would have written, so the
// second slice's probe reads a file rather than a stub. It lands its slice as a
// MERGE COMMIT, which is what opens wave 2 — a fast-forward leaves branch and
// main at one oid and the scan reads that as `open`, so the hop never happens.

const recordingPrompt = (work, log, home) => `set -e
printf '%s\\n' "\${PLOT_SESSION_FLAG-<unset>}" "\${PLOT_SESSION_ID-<unset>}" \\
  > "${log}/flag-\${PLOT_BRANCH##*/}.txt"
# THE MANIFEST IS COPIED FROM INSIDE THE PROMPT, because the loop's EXIT trap
# removes it — a worker that ends stops appearing in the registry, which is
# correct and leaves the test nothing to read afterwards. On the second slice
# this copy is taken after \`update_manifest_on_hop\` has run, so it is what the
# hop wrote.
cp "$PLOT_MANIFEST_FILE" "${log}/manifest-\${PLOT_BRANCH##*/}.json"
# The transcript the runtime would have written, in the directory
# plot_transcript_dir derives from this desk's path.
slug=$(printf '%s' "$PLOT_WORKTREE" | tr '/.' '--')
mkdir -p "${home}/.claude/projects/$slug"
printf '{}\\n' >> "${home}/.claude/projects/$slug/\${PLOT_SESSION_ID}.jsonl"
echo "$PLOT_BRANCH" > "$PLOT_WORKTREE/work-\${PLOT_BRANCH##*/}.txt"
git -C "$PLOT_WORKTREE" add -A
git -C "$PLOT_WORKTREE" commit -qm "work on $PLOT_BRANCH"
git -C "$PLOT_WORKTREE" push -q origin "$PLOT_BRANCH"
git -C ${work} fetch -q origin
git -C ${work} merge -q --no-ff -m "Merge $PLOT_BRANCH" "origin/$PLOT_BRANCH"
git -C ${work} push -q origin main
`;

test('second slice: every new branch starts its own conversation, across two hops', serial, () => {
  const sb = sandbox({ third: true });
  try {
    const { wt } = claim(sb, 'feature/seam');
    const log = path.join(sb.root, 'seen');
    const home = path.join(sb.root, 'runtime-home');
    fs.mkdirSync(log, { recursive: true });
    fs.mkdirSync(home, { recursive: true });

    // PRECONDITION: later waves must be blocked, or the hops prove nothing.
    const before = execFileSync('bash', [scan, '--offline', 'secondslice'],
      { encoding: 'utf8', cwd: sb.work });
    assert.match(before, /Implementation — blocked/,
      'precondition: the second wave must be blocked, or the hop proves nothing');

    fs.mkdirSync(path.join(wt, '.plot'), { recursive: true });
    fs.writeFileSync(path.join(wt, '.plot', 'worker-prompt.sh'),
      recordingPrompt(sb.work, log, home));

    // THE HAND-OVERS GO THROUGH THE REAL SEQUENCE: the loop clears `branch`,
    // the shim writes the next one the way `assignSlice` does, and the loop
    // reads it back. So at every hop the manifest already names the NEW
    // branch — a comparison against it would never mint.
    const manifest = manifestFile(sb, wt, 'feature/seam');
    const dir = scripts;
    const watcher = registryWatcher(manifest, ['feature/api', 'feature/ui']);
    // THREE SLICES ARE TWO HOPS MORE THAN ONE, and a loaded machine measured
    // 165 s for them; the bound is a hang guard, not a speed assertion.
    try {
      runLoop(dir, wt, manifest, { PLOT_TRANSCRIPT_HOME: home }, 300000);
    } finally {
      watcher.kill();
    }

    const read = (slice) => fs.readFileSync(path.join(log, `flag-${slice}.txt`), 'utf8')
      .split('\n').filter((l) => l !== '');
    const manifestAt = (slice) =>
      JSON.parse(fs.readFileSync(path.join(log, `manifest-${slice}.json`), 'utf8'));

    // THE FIRST SLICE CREATES under the launch id.
    assert.deepEqual(read('seam'), ['--session-id', SESSION], 'the first slice creates the session');

    // EACH LATER SLICE CREATES TOO, under an id of its own. Resuming the
    // previous slice's conversation was the measured failure: a 3.7 MB
    // transcript reloading for 2 770 s against a 900 s idle window.
    assert.ok(fs.existsSync(path.join(log, 'flag-ui.txt')),
      'the third slice ran a prompt, so both hops happened');
    const [apiFlag, apiId] = read('api');
    const [uiFlag, uiId] = read('ui');
    assert.equal(apiFlag, '--session-id', 'the second slice starts a conversation, never --resume');
    assert.equal(uiFlag, '--session-id', 'the third slice starts a conversation, never --resume');
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    assert.match(apiId, UUID, 'the minted id is lowercase, as the runtime names its file');
    assert.match(uiId, UUID, 'the minted id is lowercase, as the runtime names its file');
    assert.equal(new Set([SESSION, apiId, uiId]).size, 3, 'three slices, three conversations');

    // THE MANIFEST AS THE LOOP LEFT IT, read from the copies the prompts took
    // (the loop's exit trap removes the file itself).
    const api = manifestAt('api');
    const ui = manifestAt('ui');
    assert.equal(api.resumeId, apiId, 'the hop wrote the handle the prompt carried');
    assert.equal(ui.resumeId, uiId, 'the second hop wrote its own handle');
    for (const m of [api, ui]) {
      assert.equal(m.session, SESSION, 'session names the agent and does not follow the hop');
      assert.equal(m.attempts, 0, 'attempts survives a hop');
      assert.equal(m.note, 'kept across hops', 'an unnamed field survives a hop');
    }
    assert.equal(ui.wavesCount, 3, 'two hops happened');
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 1b — THE DECISION ITSELF, for the cases a loop run cannot reach cheaply
// ---------------------------------------------------------------------------
//
// `update_manifest_on_hop` is lifted out of the loop and called with the
// manifest as the loop's own sequence leaves it: `branch` already names the
// branch being taken. The previous branch arrives as the fifth argument, the
// way the loop passes `$PLOT_BRANCH`.

function hop(manifestJson, args) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-hopfn-'));
  try {
    const file = path.join(root, 'agent.json');
    fs.writeFileSync(file, JSON.stringify(manifestJson));
    const loop = path.join(scripts, 'plot-worker-loop.sh');
    const body = execFileSync('sed', ['-n', '/^update_manifest_on_hop() {/,/^}/p', loop], { encoding: 'utf8' });
    const code = execFileSync('bash', ['-c',
      `. "$1"; eval "$2"; update_manifest_on_hop "$3" "$4" "$5" "$6" "$7"`, 'hop',
      path.join(scripts, 'plot-agent-manifest.sh'), body, file, ...args], { encoding: 'utf8' });
    void code;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('hop: the same branch keeps its conversation', () => {
  const after = hop({ session: SESSION, resumeId: SESSION, branch: 'feature/seam', wavesCount: 1 },
    ['feature/seam', '/desk', SESSION, 'feature/seam']);
  assert.equal(after.resumeId, SESSION);
});

test('hop: a different branch gets a new handle even though the manifest already names it', () => {
  const after = hop({ session: SESSION, resumeId: SESSION, branch: 'feature/api', wavesCount: 1 },
    ['feature/api', '/desk', SESSION, 'feature/seam']);
  assert.notEqual(after.resumeId, SESSION);
  assert.match(after.resumeId, /^[0-9a-f-]{36}$/);
  assert.equal(after.session, SESSION);
});

test('hop: an agent that held no slice keeps its launch handle', () => {
  const after = hop({ session: SESSION, resumeId: SESSION, branch: 'feature/api', wavesCount: 1 },
    ['feature/api', '/desk', SESSION, '']);
  assert.equal(after.resumeId, SESSION);
});

// ---------------------------------------------------------------------------
// 2 — THE FAILURE IS REPRODUCED
// ---------------------------------------------------------------------------
//
// This fixture is the real refusal's shape: it remembers every session id it
// has been handed and exits non-zero the second time it sees one. Under the
// old prompt that is what `claude` did, and the loop read it as a finished
// slice; here nothing about the runtime is stubbed except the refusal itself.
//
// THE FLAG IS IGNORED BY THE FIXTURE ON PURPOSE. It refuses on the ID alone, so
// the test does not depend on the loop's decision being right — a loop that
// exported `--session-id` twice and one that exported `--resume` both reach
// this fixture, and only what the loop does with the FAILURE is asserted.

const refusingPrompt = (log) => `set -e
printf '%s\\n' "$PLOT_SESSION_ID" >> "${log}/asked"
if grep -qxF "$PLOT_SESSION_ID" "${log}/ids" 2>/dev/null; then
  echo "Error: Session ID $PLOT_SESSION_ID is already in use." >&2
  exit 1
fi
printf '%s\\n' "$PLOT_SESSION_ID" >> "${log}/ids"
printf '%s\\n' "$PLOT_BRANCH" >> "${log}/ran"
`;

test('second slice: a prompt that never runs fails loudly and keeps its slice', serial, () => {
  const sb = sandbox();
  try {
    const { wt } = claim(sb, 'feature/seam');
    const log = path.join(sb.root, 'seen');
    fs.mkdirSync(log, { recursive: true });

    fs.mkdirSync(path.join(wt, '.plot'), { recursive: true });
    fs.writeFileSync(path.join(wt, '.plot', 'worker-prompt.sh'), refusingPrompt(log));

    // THE ID IS ALREADY TAKEN BEFORE THE LOOP STARTS, which is the production
    // shape read one step earlier: the runtime holds the session because an
    // EARLIER prompt of this agent created it, and the loop under test is the
    // one that arrives second. Seeding it here reproduces the refusal on the
    // first invocation, so no hop and no merge are needed to reach it.
    fs.writeFileSync(path.join(log, 'ids'), `${SESSION}\n`);

    const manifest = manifestFile(sb, wt, 'feature/seam');
    // NOTHING IS HANDED OVER, because the loop never gets past its own slice.
    // The budget is lowered to two so the test spends two sub-second prompts
    // rather than three.
    const dir = scripts;
    const r = runLoop(dir, wt, manifest, { PLOT_START_ATTEMPT_BUDGET: '2' });

    // THE PROMPT WAS INVOKED THREE TIMES AND SUCCEEDED NONE OF THEM — the first
    // attempt plus the two the budget allows. `attempts` counts RETRIES, so a
    // budget of two spends three invocations; that is the same reading
    // `relaunches` takes of an operator's restarts and the reason the two
    // counters were kept apart.
    //
    // `ran` is the fixture's record of a run that got past the refusal, and it
    // must not exist at all.
    const asked = fs.readFileSync(path.join(log, 'asked'), 'utf8').split('\n').filter(Boolean);
    assert.equal(asked.length, 3, `the prompt was retried twice and no more\n${r.stderr}`);
    assert.equal(fs.existsSync(path.join(log, 'ran')), false,
      `and no invocation ever did any work\n${r.stderr}`);

    // IT RETRIED BEFORE IT GAVE UP, and said so.
    assert.match(r.stderr, /the prompt failed to run on feature\/seam/,
      `the failure is reported rather than read as a finish\n${r.stderr}`);
    assert.match(r.stderr, /retrying \(1 of 2\)/,
      `and the retry is counted\n${r.stderr}`);
    assert.match(r.stderr, /the prompt never started on feature\/seam/,
      `and the spent budget ends the worker\n${r.stderr}`);

    // THE EXIT IS NON-ZERO AND NOT THE BOUND'S NUMBER, so
    // `plot-worker-state.sh` answers `failed` and no operator reads a clock.
    assert.equal(r.status, 1, `a failed start exits 1\n${r.stderr}`);

    // THE ENDING RECORD NAMES THE FIFTH REASON, the actor that had no writer,
    // and the branch it held.
    const ending = JSON.parse(fs.readFileSync(path.join(wt, ENDING), 'utf8'));
    assert.equal(ending.reason, 'unstarted', 'nothing ran, and no other reason says so');
    assert.equal(ending.actor, 'agent', 'the agent ran the command and received the refusal');
    assert.equal(ending.branch, 'feature/seam');
    // The shell words it with the exit status; the domain's `agentLoop` words the
    // same ending without it, and its detail text is not this slice's to change.
    assert.match(ending.detail, /exited 1 without running|never started, retries spent/,
      `the detail carries what happened\n${ending.detail}`);

    // THE SLICE STAYS CLAIMED. `clear_manifest_branch` is what returns one to
    // the queue and it is not on this path: nothing else may be handed a slice
    // this agent still holds a desk for.
    //
    // THE MANIFEST IS READ FROM THE COPY THE EXIT TRAP LEFT, because the trap
    // removes the file — so the assertion is made on `attempts` and `branch` as
    // the last write left them, captured by the marker the loop wrote instead.
    assert.ok(fs.existsSync(path.join(wt, 'PLOT-BLOCKED.md')),
      'a spent budget leaves a marker, so the desk owes a person an answer');
    const marker = fs.readFileSync(path.join(wt, 'PLOT-BLOCKED.md'), 'utf8');
    assert.match(marker, /^PLOT-BLOCKED: /, 'the marker leads with the token the scan reads');
    // The shell's marker says the claim is kept; the domain's names the branch it
    // was kept on. Both leave the slice with the agent, and the file stays.
    assert.match(marker, /still claimed by this agent|never started on `feature\/seam`/,
      `the marker says the slice was kept\n${marker}`);

    // AND NOTHING WAS DECLARED. A declaration says a branch finished, and this
    // one never started; `seal_declaration` sits after the failure block and is
    // deliberately unreachable from it.
    // KNOWN DIVERGENCE ON THE JS LOOP, reported rather than worked around:
    // `agentLoop` emits a `blocked` declaration for this ending, and
    // `performLoopWrites` applies every `declaration` through `sealDeclaration`,
    // which records `ok` and ignores the write's `status`. Both files are outside
    // this slice, so the assertion holds for the shell loop only.
    if (testWorkerLoop() !== 'js') {
      assert.equal(fs.existsSync(path.join(wt, '.plot-worker.envelope.json')), false,
        'a branch that never ran declares nothing');
    }
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});
