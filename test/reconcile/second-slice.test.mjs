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
 * The scripts directory, copied, with `plot-fleet-scan.sh` wrapped in a shim
 * that hands over the next slice ONCE — `declaration-hop.test.mjs`'s shim, and
 * for its reasons: the loop reaches the scan exactly once per free window, so
 * writing `branch` there is the whole of what the registry does.
 */
function shimmedScripts(root, manifest, handOver) {
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
}

/**
 * A bare origin, a clone, and an approved two-wave plan: `feature/seam` gates
 * `feature/api`.
 *
 * The gating is the point, exactly as in `declaration-hop.test.mjs`: a second
 * branch that was eligible from the start would let the loop "hop" onto work
 * nothing ever blocked, and the hop is what this file is about.
 */
function sandbox() {
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
`);
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
`);
  git(work, 'add', '-A');
  git(work, 'commit', '-qm', 'plan');
  git(work, 'push', '-q', 'origin', 'main');
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
function runLoop(dir, wt, manifest, env = {}) {
  try {
    const stdout = execFileSync('bash', [path.join(dir, 'plot-worker-loop.sh')], {
      cwd: wt,
      encoding: 'utf8',
      timeout: 120000,
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

test('second slice: the loop creates a session once and resumes after', serial, () => {
  const sb = sandbox();
  try {
    const { wt } = claim(sb, 'feature/seam');
    const log = path.join(sb.root, 'seen');
    const home = path.join(sb.root, 'runtime-home');
    fs.mkdirSync(log, { recursive: true });
    fs.mkdirSync(home, { recursive: true });

    // PRECONDITION: wave 2 must be blocked, or the hop proves nothing.
    const before = execFileSync('bash', [scan, '--offline', 'secondslice'],
      { encoding: 'utf8', cwd: sb.work });
    assert.match(before, /Implementation — blocked/,
      'precondition: the second wave must be blocked, or the hop proves nothing');

    fs.mkdirSync(path.join(wt, '.plot'), { recursive: true });
    fs.writeFileSync(path.join(wt, '.plot', 'worker-prompt.sh'),
      recordingPrompt(sb.work, log, home));

    const manifest = manifestFile(sb, wt, 'feature/seam');
    const dir = shimmedScripts(sb.root, manifest, 'feature/api');
    runLoop(dir, wt, manifest, { PLOT_TRANSCRIPT_HOME: home });

    const read = (slice) => fs.readFileSync(path.join(log, `flag-${slice}.txt`), 'utf8')
      .split('\n').filter((l) => l !== '');

    // THE FIRST SLICE CREATES. No transcript exists under the handle yet, so
    // the loop asserts the id rather than continuing a conversation that is not
    // there — which is also the honest answer for an agent whose earlier prompt
    // never ran.
    const first = read('seam');
    assert.deepEqual(first, ['--session-id', SESSION],
      `the first slice creates the session\n${first.join(' ')}`);

    // THE SECOND SLICE RESUMES, and this is the whole bug. The prompt on
    // `feature/api` ran at all — which it could not before — and it was handed
    // `--resume` because the first slice left a transcript under the handle.
    assert.ok(fs.existsSync(path.join(log, 'flag-api.txt')),
      'the second slice ran a prompt at all — the failure this slice is about');
    const second = read('api');
    assert.deepEqual(second, ['--resume', SESSION],
      `the second slice resumes the same conversation\n${second.join(' ')}`);

    // THE HANDLE IS NEVER BLANK. `--resume` is optional-valued, so a blank
    // opens an interactive picker in a `-p` run with no terminal and hangs.
    for (const [slice, got] of [['seam', first], ['api', second]]) {
      assert.notEqual(got[1], '', `the ${slice} slice carries a handle beside its flag`);
      assert.notEqual(got[1], '<unset>', `the ${slice} slice has a handle to carry`);
    }

    // AND THE HOP WROTE `resumeId`. It had one writer, no readers and a twin
    // until this change; `session` stays fixed and stays the join key. Read
    // from the copy the second slice's prompt took, because the loop's exit
    // trap removes the manifest itself.
    const after = JSON.parse(fs.readFileSync(path.join(log, 'manifest-api.json'), 'utf8'));
    assert.equal(after.resumeId, SESSION, 'the hop writes the resume handle');
    assert.equal(after.session, SESSION, 'and leaves the join key alone');
    assert.equal(after.wavesCount, 2, 'the hop happened');
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
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
    const dir = shimmedScripts(sb.root, manifest, '');
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
    assert.match(ending.detail, /exited 1 without running/,
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
    assert.match(marker, /still claimed by this agent/,
      `the marker says the slice was kept\n${marker}`);

    // AND NOTHING WAS DECLARED. A declaration says a branch finished, and this
    // one never started; `seal_declaration` sits after the failure block and is
    // deliberately unreachable from it.
    assert.equal(fs.existsSync(path.join(wt, '.plot-worker.envelope.json')), false,
      'a branch that never ran declares nothing');
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});
