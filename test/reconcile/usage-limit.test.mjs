// THE LOOP WAITS OUT A USAGE LIMIT — asserted against a real loop, with a fake
// harness, and never a real one.
//
// Measured 2026-10-01 in #1141: a harness that stopped on the account's usage
// limit exited like a prompt that could not start. The loop spent three
// retries in 974 ms and wrote a `PLOT-BLOCKED` marker telling a person to fix
// a prompt file that worked — on a desk holding two pushed commits and ten
// uncommitted files, while the same message said the desk was untouched.
//
// NEVER SPEND REAL USAGE. Every fixture here is a shell script that PRINTS the
// limit line and exits; no `claude` is invoked, no account is touched, and the
// reset time is computed from the test's own clock. A test that reproduced the
// defect by exhausting an account would cost hours per run and could not be
// run at all on a fresh one.
//
// THE CLOCK IS A SEAM AND THE MARGIN IS ZERO. `PLOT_CLOCK_OFFSET_SECONDS`
// moves the loop's `clock_now` past a reset the message can actually state,
// and `PLOT_LIMIT_MARGIN_SECONDS=0` removes the minute of grace a production
// wait adds. Both are test seams for `PLOT_START_ATTEMPT_BUDGET`'s stated
// reason: a test proving the WAIT would otherwise have to spend the wait.
//
// WHAT IS ASSERTED IS THAT A WAIT WAS SERVED, never how long it lasted. The
// loop's job is to classify the exit, record the limit, hold the slice and
// resume it; how many seconds the sleep runs for is `promptExit`'s arithmetic
// and is tested against the rule directly in
// `packages/domain/test/prompt-exit.test.ts`.
//
// THE FIXTURES ARE SHARED WITH `second-slice.test.mjs`, whose `sandbox`,
// `claim`, `manifestFile`, `copiedScripts` and `runLoop` build the same
// two-wave plan, the same desk and the same manifest. They are rebuilt here
// rather than imported because that file exports nothing — a module-level
// export would change what `node --test` collects there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const ENDING = '.plot-worker.ending.json';
const LIMITED = '.plot-worker.limited';

// SERIAL, for `second-slice.test.mjs`'s reason: every test spawns a real loop
// against a real fleet scan, and the timing assertions below are only sharp
// while the spawned processes are not starving each other.
const serial = { concurrency: false };

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

const SESSION = '5c7c41bd-ae8f-45ec-a220-2a23b5f1a16b';

/**
 * A reset the message can actually state, and the clock that makes the wait
 * short without making it something else.
 *
 * **THE OFFSET MUST LAND IN A WINDOW, AND THE WINDOW IS NARROW.** The rule
 * resolves the stated wall clock ON THE DATE OF NOW, and a resolved instant
 * more than `PAST_RESET_GRACE_SECONDS` (120 s) behind now resolves to TOMORROW
 * instead — 24 h out, which the `Worker bound` then refuses as `past-bound`.
 * So for a reset `R` seconds ahead and a clock offset `O`:
 *
 *     O > R          or the loop really sleeps, and the suite waits with it
 *     O - R <= 120   or the reset resolves to tomorrow and `past-bound` fires
 *
 * Measured: `R = 120, O = 240` sits exactly on the second bound and the
 * minute-rounding of the stated time pushed three tests over it — the log read
 * `until 2026-10-03`, a day out, on a fixture meant to wait two minutes.
 *
 * SO THE RESET IS TEN MINUTES OUT AND THE OFFSET CLEARS IT BY THIRTY SECONDS.
 * The stated time is TRUNCATED TO ITS MINUTE, so the gap between the loop's
 * clock and the resolved instant grows by however many seconds into the minute
 * the test happened to start. Computed across all sixty:
 *
 *     offset = reset + 30  ->  gap 30..89   both bounds clear
 *     offset = reset + 60  ->  gap 60..119  one second from `past-bound`
 *     offset = reset + 90  ->  gap 90..149  fails for half the minute
 *
 * `+60` was tried first and three waits in one run resolved to the next day.
 * `+30` is the middle of the safe band rather than its edge.
 */
const RESET_AHEAD = 600;
const PAST_THE_RESET = { PLOT_CLOCK_OFFSET_SECONDS: String(RESET_AHEAD + 30) };

/**
 * Shell that prints a limit line whose reset is `RESET_AHEAD` seconds past the
 * LOOP'S clock, computed when the prompt runs.
 *
 * **A SECOND LIMIT CANNOT USE A BAKED-IN LINE.** A line composed once, up
 * front, states a time relative to the moment the fixture is WRITTEN, and the
 * loop reads it with a clock already offset by `PAST_THE_RESET` — so by the
 * second prompt the stated time is ~630 s behind the loop's now, resolves to
 * tomorrow, and the wait the test is asserting becomes `past-bound`. Measured
 * in run 6: a fixture meant to wait twice logged `until 2026-10-03`, four
 * hours out.
 *
 * So the line is composed IN THE PROMPT, against the REAL clock — never the
 * offset one. Adding the offset here would cancel it: the reset would sit
 * `ahead` seconds past the loop's own now on every prompt, and the loop would
 * sleep the full `ahead` for real. Measured: a desk wrote a record 1094 s in
 * the future and the suite waited it out.
 *
 * `date` is asked for the 12-hour fields directly, which keeps the shell free
 * of any 12-hour arithmetic of its own.
 */
const limitLineAtRuntime = (limit = 'session limit', ahead = RESET_AHEAD) => `
  _at=$(( $(date +%s) + ${ahead} ))
  _hhmm=$(date -r "$_at" '+%-I:%M%p' 2>/dev/null || date -d "@$_at" '+%-I:%M%p')
  _zone=$(readlink /etc/localtime | sed 's#.*zoneinfo/##')
  printf "You've hit your ${limit} \u00b7 resets %s (%s)\\n" \
    "$(printf '%s' "$_hhmm" | tr 'A-Z' 'a-z')" "$_zone"
`;

/**
 * The scripts directory, copied, so a test can remove a bundle without touching
 * the checkout. Nothing is handed over: every test here ends on the slice it
 * holds, and a loop that hands nothing over waits on its own bound.
 */
function copiedScripts(root) {
  const dir = path.join(root, 'scripts');
  fs.cpSync(scripts, dir, { recursive: true });
  return dir;
}

/** A bare origin, a clone, and an approved plan whose first slice is eligible. */
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-limit-'));
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
- **Worker bound:** 1800
`);
  fs.mkdirSync(path.join(work, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(work, 'docs', 'plans', '2026-10-01-limit.md'), `# Limit

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
  // The JS loop refuses to take up a desk that holds untracked files, so the
  // fixture's own `.plot/` and `.plot-worker.*` stay out of `git status`.
  // A fresh clone has no `.git/info/` yet, so it is made before the append.
  fs.mkdirSync(`${work}/.git/info`, { recursive: true });
  fs.appendFileSync(`${work}/.git/info/exclude`, '.plot/\n.plot-worker.*\n');
  return { root, origin, work };
}

/** Claim the branch the way the dispatcher does, and cut the desk. */
function claim(sb, branch) {
  const wtRoot = path.join(sb.root, 'worktrees');
  fs.mkdirSync(wtRoot, { recursive: true });
  const wt = path.join(wtRoot, `plot-wt-${branch.replace(/\//g, '-')}`);
  git(sb.work, 'worktree', 'add', '-q', '-b', branch, wt, 'origin/main');
  git(wt, 'commit', '-q', '--allow-empty', '-m', `plot: claim ${branch}`);
  git(wt, 'push', '-qu', 'origin', branch);
  return { wt, wtRoot };
}

function manifestFile(sb, wt, branch) {
  const dir = path.join(sb.work, '.plot', 'agents');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${SESSION}.json`);
  fs.writeFileSync(file, JSON.stringify({
    session: SESSION, resumeId: SESSION, branch, worktree: wt,
    command: 'plot-worker-loop.sh', pid: '4242', wrapperPid: '4241',
    attempts: 0, wavesCount: 1, startedAt: '2026-10-01T09:00:00Z',
  }, null, 2) + '\n');
  return file;
}

/** Write the desk's prompt file. */
function writePrompt(wt, body) {
  fs.mkdirSync(path.join(wt, '.plot'), { recursive: true });
  fs.writeFileSync(path.join(wt, '.plot', 'worker-prompt.sh'), body);
}

function runLoop(dir, wt, manifest, env = {}, timeout = 120000) {
  try {
    const stdout = execFileSync('bash', [path.join(dir, 'plot-worker-loop.sh')], {
      cwd: wt, encoding: 'utf8', timeout,
      env: {
        ...process.env,
        PLOT_BRANCH: 'feature/seam', PLOT_WORKTREE: wt, PLOT_SLUG: 'limit',
        PLOT_MANIFEST_FILE: manifest, PLOT_SESSION_ID: SESSION,
        PLOT_WAIT_POLL_SECONDS: '1', PLOT_WAIT_BUDGET_SECONDS: '4',
        PLOT_LIMIT_MARGIN_SECONDS: '0',
        ...env,
      },
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return { status: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

/**
 * A prompt that meets the limit on its first invocation and works on the next.
 *
 * THE COUNTER IS A FILE, because each invocation is a fresh `bash -c` and a
 * variable would not survive it. The second run commits, pushes and merges —
 * which is what lets the loop finish the slice and leave, so the test does not
 * depend on the wait budget to end.
 */
const limitThenWork = (work, log) => `set -e
n=$(cat "${log}/runs" 2>/dev/null || echo 0)
n=$((n + 1)); printf '%s' "$n" > "${log}/runs"
if [ "$n" = "1" ]; then
  ${limitLineAtRuntime()}
  exit 1
fi
echo "worked" > "$PLOT_WORKTREE/work.txt"
git -C "$PLOT_WORKTREE" add -A
git -C "$PLOT_WORKTREE" commit -qm "work on $PLOT_BRANCH"
git -C "$PLOT_WORKTREE" push -q origin "$PLOT_BRANCH"
git -C ${work} fetch -q origin
git -C ${work} merge -q --no-ff -m "Merge $PLOT_BRANCH" "origin/$PLOT_BRANCH"
git -C ${work} push -q origin main
`;

// ---------------------------------------------------------------------------
// 1 — THE WAIT HAPPENS, AND THE SLICE RESUMES
// ---------------------------------------------------------------------------

test('a limit with a reset ahead waits and resumes the same slice', serial, () => {
  const sb = sandbox();
  try {
    const { wt } = claim(sb, 'feature/seam');
    const log = path.join(sb.root, 'seen');
    fs.mkdirSync(log, { recursive: true });
    writePrompt(wt, limitThenWork(sb.work, log));
    const manifest = manifestFile(sb, wt, 'feature/seam');
    const dir = copiedScripts(sb.root);
    const r = runLoop(dir, wt, manifest, PAST_THE_RESET);

    // THE PROMPT RAN TWICE: once into the limit, once to completion.
    assert.equal(fs.readFileSync(path.join(log, 'runs'), 'utf8'), '2',
      `the limit was waited out and the slice resumed\n${r.stderr}`);
    assert.match(r.stderr, /usage limit on feature\/seam until .*; waiting/,
      `the wait is reported\n${r.stderr}`);

    // `attempts` IS NOT RAISED. The budget stops a spin on a broken
    // invocation; a limit is the opposite reading, and spending the budget
    // here is what ended a working agent in 974 ms.
    assert.doesNotMatch(r.stderr, /retrying \(/,
      `a limit is not a retry\n${r.stderr}`);
    assert.doesNotMatch(r.stderr, /the prompt failed to run/,
      `and it is not reported as a failure to run\n${r.stderr}`);

    // THE SLICE FINISHED, so the work landed.
    assert.ok(fs.existsSync(path.join(wt, 'work.txt')),
      `the resumed prompt did the work\n${r.stderr}`);

    // AND THE RECORD IS GONE. A worker that left is waiting for nothing.
    assert.equal(fs.existsSync(path.join(wt, LIMITED)), false,
      'the limit record is removed when the worker ends');
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});

test('an empty PLOT_HARNESS still waits', serial, () => {
  const sb = sandbox();
  try {
    const { wt } = claim(sb, 'feature/seam');
    const log = path.join(sb.root, 'seen');
    fs.mkdirSync(log, { recursive: true });
    writePrompt(wt, limitThenWork(sb.work, log));
    const manifest = manifestFile(sb, wt, 'feature/seam');
    const dir = copiedScripts(sb.root);

    // `plot-dispatch.sh:1516` EXPORTS `PLOT_HARNESS="$launch_harness"`, and
    // `launch_harness` IS EMPTY on every launch with no charter — which is
    // every launch on this estate today. A loop reading the raw variable would
    // look up no patterns and read every limit as a broken prompt: the defect,
    // one line below its own fix.
    const r = runLoop(dir, wt, manifest, { ...PAST_THE_RESET, PLOT_HARNESS: '' });

    assert.equal(fs.readFileSync(path.join(log, 'runs'), 'utf8'), '2',
      `an empty harness name falls back to claude and still waits\n${r.stderr}`);
    assert.match(r.stderr, /usage limit on feature\/seam/, r.stderr);
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});

test('a limit after a resumed prompt that committed waits again', serial, () => {
  const sb = sandbox();
  try {
    const { wt } = claim(sb, 'feature/seam');
    const log = path.join(sb.root, 'seen');
    fs.mkdirSync(log, { recursive: true });

    // THE COUNTERPART TO `no-progress`, and what keeps that gate narrow: a
    // prompt that WORKED between two limits is making progress, so the second
    // limit is waited out like the first. Runs 1 and 2 meet the limit; run 2
    // commits first, which is what separates it from the test above.
    writePrompt(wt, `set -e
n=$(cat "${log}/runs" 2>/dev/null || echo 0)
n=$((n + 1)); printf '%s' "$n" > "${log}/runs"
if [ "$n" = "1" ]; then
  ${limitLineAtRuntime()}
  exit 1
fi
if [ "$n" = "2" ]; then
  echo "partial $n" > "$PLOT_WORKTREE/partial.txt"
  git -C "$PLOT_WORKTREE" add -A
  git -C "$PLOT_WORKTREE" commit -qm "partial work"
  ${limitLineAtRuntime()}
  exit 1
fi
echo "done" > "$PLOT_WORKTREE/work.txt"
git -C "$PLOT_WORKTREE" add -A
git -C "$PLOT_WORKTREE" commit -qm "work"
git -C "$PLOT_WORKTREE" push -q origin "$PLOT_BRANCH"
git -C ${sb.work} fetch -q origin
git -C ${sb.work} merge -q --no-ff -m "Merge" "origin/$PLOT_BRANCH"
git -C ${sb.work} push -q origin main
`);
    const manifest = manifestFile(sb, wt, 'feature/seam');
    const dir = copiedScripts(sb.root);
    const r = runLoop(dir, wt, manifest, PAST_THE_RESET);

    assert.equal(fs.readFileSync(path.join(log, 'runs'), 'utf8'), '3',
      `a committing prompt earns a second wait\n${r.stderr}`);
    // THE WAIT LINE ENDS `; waiting`, the same count the test above takes, so
    // an ending line naming the limit is never counted as a wait.
    const waits = (r.stderr.match(/usage limit on feature\/seam until [^\n;]*; waiting/g) ?? []).length;
    assert.equal(waits, 2, `both limits were waited out\n${r.stderr}`);
    assert.doesNotMatch(r.stderr, /no-progress/,
      `progress was made, so that gate never fires\n${r.stderr}`);
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3 — A STATUS-0 EXIT, AND WHERE THE LINE SITS
// ---------------------------------------------------------------------------

test('a status-0 run whose last line is the limit waits', serial, () => {
  const sb = sandbox();
  try {
    const { wt } = claim(sb, 'feature/seam');
    const log = path.join(sb.root, 'seen');
    fs.mkdirSync(log, { recursive: true });

    // A `-p` RUN PRINTS THE AGENT'S FINAL MESSAGE AND EXITS 0. Reading the
    // status alone would send this down the finished-slice path and seal a
    // declaration for work the limit stopped — which is why the exit is
    // classified before the status is tested.
    writePrompt(wt, `set -e
n=$(cat "${log}/runs" 2>/dev/null || echo 0)
n=$((n + 1)); printf '%s' "$n" > "${log}/runs"
if [ "$n" = "1" ]; then
  ${limitLineAtRuntime()}
  exit 0
fi
echo "worked" > "$PLOT_WORKTREE/work.txt"
git -C "$PLOT_WORKTREE" add -A
git -C "$PLOT_WORKTREE" commit -qm "work"
git -C "$PLOT_WORKTREE" push -q origin "$PLOT_BRANCH"
git -C ${sb.work} fetch -q origin
git -C ${sb.work} merge -q --no-ff -m "Merge" "origin/$PLOT_BRANCH"
git -C ${sb.work} push -q origin main
`);
    const manifest = manifestFile(sb, wt, 'feature/seam');
    const dir = copiedScripts(sb.root);
    const r = runLoop(dir, wt, manifest, PAST_THE_RESET);

    assert.equal(fs.readFileSync(path.join(log, 'runs'), 'utf8'), '2',
      `a status-0 limit is still a limit\n${r.stderr}`);
    assert.match(r.stderr, /usage limit on feature\/seam/, r.stderr);
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});

test('a status-0 run that quotes the limit line earlier finishes the slice', serial, () => {
  const sb = sandbox();
  try {
    const { wt } = claim(sb, 'feature/seam');
    const log = path.join(sb.root, 'seen');
    fs.mkdirSync(log, { recursive: true });

    // PLANS, PANEL FILES AND FIXTURES ON THIS ESTATE QUOTE THE #1141 LINE
    // VERBATIM — this very test file does. An agent that finished a slice
    // while quoting it must read `ran`, or every such slice would wait up to
    // 24 h on work that is already done.
    writePrompt(wt, `set -e
n=$(cat "${log}/runs" 2>/dev/null || echo 0)
n=$((n + 1)); printf '%s' "$n" > "${log}/runs"
${limitLineAtRuntime()}
echo "I quoted the limit line above while reporting on the fix."
echo "worked" > "$PLOT_WORKTREE/work.txt"
git -C "$PLOT_WORKTREE" add -A
git -C "$PLOT_WORKTREE" commit -qm "work"
git -C "$PLOT_WORKTREE" push -q origin "$PLOT_BRANCH"
git -C ${sb.work} fetch -q origin
git -C ${sb.work} merge -q --no-ff -m "Merge" "origin/$PLOT_BRANCH"
git -C ${sb.work} push -q origin main
`);
    const manifest = manifestFile(sb, wt, 'feature/seam');
    const dir = copiedScripts(sb.root);
    const r = runLoop(dir, wt, manifest, PAST_THE_RESET);

    assert.equal(fs.readFileSync(path.join(log, 'runs'), 'utf8'), '1',
      `the slice finished and no wait was served\n${r.stderr}`);
    assert.doesNotMatch(r.stderr, /usage limit on/,
      `a quoted line is not a limit\n${r.stderr}`);
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});

