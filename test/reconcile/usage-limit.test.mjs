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
// `claim`, `manifestFile`, `shimmedScripts` and `runLoop` build the same
// two-wave plan, the same desk and the same manifest. They are rebuilt here
// rather than imported because that file exports nothing — a module-level
// export would change what `node --test` collects there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
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
 * The limit line as the harness prints it, for a reset `ahead` seconds from
 * now.
 *
 * THE ZONE IS THE MACHINE'S OWN and the time is formatted in it, because
 * `promptExit` resolves the stated wall clock IN THE NAMED ZONE. A fixed zone
 * with a fixed time would resolve to a different instant on every machine the
 * suite runs on, and the assertion is about the loop rather than about
 * `Intl`'s zone table.
 *
 * `Intl` IS ASKED FOR BOTH HALVES, so the hour, the meridiem and the zone name
 * agree by construction — a hand-rolled 12-hour conversion is where an
 * off-by-twelve at noon and midnight would live.
 *
 * **THE HARNESS STATES MINUTES AND NEVER SECONDS**, which is what makes the
 * clock offset necessary rather than convenient. A reset "two seconds ahead"
 * formats as the CURRENT minute — measured 22 s into one, `+2 s` printed
 * `4:01am`, which resolves to `04:01:00` and is 22 s in the PAST. The rule's
 * grace then resolves it to now and the wait is zero, so a test written that
 * way asserts a wait it never served. So the reset is stated in whole minutes
 * and `PLOT_CLOCK_OFFSET_SECONDS` moves the loop past it; `RESET_AHEAD` below
 * states the window both must land in.
 */
function limitLine(ahead, limit = 'session limit') {
  const at = new Date((nowSeconds() + ahead) * 1000);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(at);
  const get = (type) => parts.find((p) => p.type === type).value;
  const meridiem = get('dayPeriod').toLowerCase().replace(/\s/g, '');
  return `You've hit your ${limit} · resets ${get('hour')}:${get('minute')}${meridiem} (${zone})`;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

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
 * SO THE RESET IS TEN MINUTES OUT AND THE OFFSET CLEARS IT BY SIXTY SECONDS,
 * which leaves a whole minute of slack on BOTH bounds: the reset is far enough
 * ahead that rounding cannot put it in the past, and the offset is close
 * enough behind the grace that it cannot reach tomorrow. The sleep that
 * remains is zero, because the offset clock is already past the reset.
 */
const RESET_AHEAD = 600;
const PAST_THE_RESET = { PLOT_CLOCK_OFFSET_SECONDS: String(RESET_AHEAD + 60) };

/** The scripts directory, copied, with the fleet scan handing over one slice. */
function shimmedScripts(root, manifest, handOver) {
  const dir = path.join(root, 'scripts');
  fs.cpSync(scripts, dir, { recursive: true });
  const real = path.join(dir, 'plot-fleet-scan.real.sh');
  fs.renameSync(path.join(dir, 'plot-fleet-scan.sh'), real);
  const queue = path.join(root, 'hand-overs');
  fs.writeFileSync(queue, [handOver].flat().join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'plot-fleet-scan.sh'), `#!/usr/bin/env bash
next=$(head -n1 ${JSON.stringify(queue)})
if [ -f ${JSON.stringify(manifest)} ] && [ -n "$next" ]; then
  tail -n +2 ${JSON.stringify(queue)} > ${JSON.stringify(queue)}.rest
  mv ${JSON.stringify(queue)}.rest ${JSON.stringify(queue)}
  node -e '
    const fs = require("fs");
    const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    m.branch = process.argv[2];
    fs.writeFileSync(process.argv[1], JSON.stringify(m, null, 2) + "\\n");
  ' ${JSON.stringify(manifest)} "$next"
fi
exec bash ${JSON.stringify(real)} "\$@"
`, { mode: 0o755 });
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
const limitThenWork = (work, log, ahead) => `set -e
n=$(cat "${log}/runs" 2>/dev/null || echo 0)
n=$((n + 1)); printf '%s' "$n" > "${log}/runs"
if [ "$n" = "1" ]; then
  printf '%s\\n' ${JSON.stringify(limitLine(ahead))}
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
    writePrompt(wt, limitThenWork(sb.work, log, 2));
    const manifest = manifestFile(sb, wt, 'feature/seam');
    const dir = shimmedScripts(sb.root, manifest, '');
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
    writePrompt(wt, limitThenWork(sb.work, log, 2));
    const manifest = manifestFile(sb, wt, 'feature/seam');
    const dir = shimmedScripts(sb.root, manifest, '');

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

test('a limit record names the reset while the desk waits', serial, () => {
  const sb = sandbox();
  try {
    const { wt } = claim(sb, 'feature/seam');
    const log = path.join(sb.root, 'seen');
    fs.mkdirSync(log, { recursive: true });

    // THE RECORD IS READ WHILE IT EXISTS, which only the waiting prompt can
    // do: the loop removes it when the worker ends, so a test reading the desk
    // afterwards would find nothing. The second invocation copies it aside.
    writePrompt(wt, `set -e
n=$(cat "${log}/runs" 2>/dev/null || echo 0)
n=$((n + 1)); printf '%s' "$n" > "${log}/runs"
if [ "$n" = "1" ]; then
  printf '%s\\n' ${JSON.stringify(limitLine(RESET_AHEAD))}
  exit 1
fi
cp "$PLOT_WORKTREE/${LIMITED}" "${log}/limited.tsv"
echo "worked" > "$PLOT_WORKTREE/work.txt"
git -C "$PLOT_WORKTREE" add -A
git -C "$PLOT_WORKTREE" commit -qm "work"
git -C "$PLOT_WORKTREE" push -q origin "$PLOT_BRANCH"
git -C ${sb.work} fetch -q origin
git -C ${sb.work} merge -q --no-ff -m "Merge" "origin/$PLOT_BRANCH"
git -C ${sb.work} push -q origin main
`);
    const manifest = manifestFile(sb, wt, 'feature/seam');
    const dir = shimmedScripts(sb.root, manifest, '');
    const r = runLoop(dir, wt, manifest, PAST_THE_RESET);

    const record = fs.readFileSync(path.join(log, 'limited.tsv'), 'utf8').trim();
    const [epoch, iso, line] = record.split('\t');
    assert.match(epoch, /^\d+$/, `the reset epoch is a number\n${record}`);
    assert.match(iso, /^\d{4}-\d{2}-\d{2}T/, `and the same instant as ISO text\n${record}`);
    assert.match(line, /You've hit your session limit/, `and the limit line\n${record}`);

    // BOTH SPELLINGS OF ONE INSTANT, so the monitor and `--status` compare
    // integers and print text without either parsing a date.
    assert.equal(Math.floor(Date.parse(iso) / 1000), Number(epoch),
      'the two fields are the same instant');
    assert.ok(r.status !== undefined);
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 2 — A LIMIT THE LOOP MAY NOT WAIT OUT
// ---------------------------------------------------------------------------

test('a limit with no reset ends at once and names the desk', serial, () => {
  const sb = sandbox();
  try {
    const { wt } = claim(sb, 'feature/seam');

    // THE DESK HOLDS WORK, which is #1141's shape: two pushed commits and ten
    // uncommitted files while the message said the desk was untouched. One
    // real commit beyond the empty claim, and two source files on the floor,
    // are enough to prove the counts are READ rather than asserted.
    fs.writeFileSync(path.join(wt, 'landed.txt'), 'committed work\n');
    git(wt, 'add', '-A');
    git(wt, 'commit', '-qm', 'real work');
    fs.writeFileSync(path.join(wt, 'floor-a.ts'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(wt, 'floor-b.ts'), 'export const b = 2;\n');

    // NO RESET IN THE LINE, so the rule answers `no-reset` and no wait is
    // allowed. A spend cap lands here too, which is right: the marker names
    // the limit and asks for a person.
    writePrompt(wt, `printf '%s\\n' "You've hit your monthly spend limit"
exit 1
`);
    const manifest = manifestFile(sb, wt, 'feature/seam');
    const dir = shimmedScripts(sb.root, manifest, '');
    const r = runLoop(dir, wt, manifest);

    assert.equal(r.status, 1, `a limit that cannot be waited out exits 1\n${r.stderr}`);
    assert.match(r.stderr, /usage limit on feature\/seam with no reset time \(no-reset\)/,
      `the absent reset is named rather than guessed\n${r.stderr}`);

    // IT IS NOT A RETRY. The budget is untouched: the invocation worked.
    assert.doesNotMatch(r.stderr, /retrying \(/, `a limit never retries\n${r.stderr}`);

    // THE ENDING IS `limited` AND NOT `unstarted`. They are kept apart because
    // the repair differs: one is a prompt file to fix, the other needs time.
    const ending = JSON.parse(fs.readFileSync(path.join(wt, ENDING), 'utf8'));
    assert.equal(ending.reason, 'limited', 'the harness stopped; nothing failed to start');
    assert.equal(ending.actor, 'agent', 'the agent ran the command and received the limit');
    assert.equal(ending.branch, 'feature/seam');

    // THE MARKER NAMES NO PROMPT FIX. That sentence is `unstarted`'s and it is
    // false here — telling a person to fix a working prompt is the defect.
    const marker = fs.readFileSync(path.join(wt, 'PLOT-BLOCKED.md'), 'utf8');
    assert.match(marker, /^PLOT-BLOCKED: /, 'the marker leads with the token the scan reads');
    assert.doesNotMatch(marker, /fix the invocation in the prompt file/,
      `a limit asks for time, never a prompt fix\n${marker}`);
    assert.match(marker, /nothing to fix in the prompt/,
      `and says so\n${marker}`);
    assert.match(marker, /monthly spend limit/, `the limit is named\n${marker}`);
    assert.match(marker, /--restart feature\/seam/,
      `and the repair is the restart\n${marker}`);

    // THE COUNTS ARE READ, and both readings are narrower than they look.
    //
    // ONE COMMIT, NOT TWO. The count is `origin/<main>..HEAD -- .`, and the
    // dispatcher's claim commit is `--allow-empty`: it touches no path, so the
    // path limit excludes it. Measured — the same range without `-- .` answers
    // 2. That is the right reading rather than an accident: an empty claim is
    // not work on the desk, and a sentence naming it would overstate what a
    // person would find there.
    //
    // THREE ENTRIES, NOT TWO FILES. `git status --porcelain` COLLAPSES AN
    // UNTRACKED DIRECTORY TO ONE LINE, so `.plot/` — holding the prompt the
    // fixture wrote — is a third entry beside the two source files. A desk's
    // dirt count is entries rather than files; that is what
    // `plot_worker_dirty` has always produced and `plot-fleet-scan.sh` has
    // always consumed, and a different number here would be a second count
    // beside the estate's own.
    assert.match(marker, /The desk holds 1 commit and 3 uncommitted files\./,
      `the desk's contents are counted, not asserted away\n${marker}`);
    assert.match(r.stderr, /The desk holds 1 commit and 3 uncommitted files\./,
      `and the log says the same\n${r.stderr}`);

    // AND NO RECORD SURVIVES. The desk is not waiting; it is blocked.
    assert.equal(fs.existsSync(path.join(wt, LIMITED)), false,
      'an ended worker leaves no waiting record');
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});

test('a reset past the Worker bound ends rather than waits', serial, () => {
  const sb = sandbox();
  try {
    const { wt } = claim(sb, 'feature/seam');
    // THE BOUND IS 1800 s IN THE FIXTURE'S CONFIG and the reset is four hours
    // out, so the wait would outlive the worker that is serving it.
    writePrompt(wt, `printf '%s\\n' ${JSON.stringify(limitLine(4 * 3600))}
exit 1
`);
    const manifest = manifestFile(sb, wt, 'feature/seam');
    const dir = shimmedScripts(sb.root, manifest, '');
    const r = runLoop(dir, wt, manifest);

    assert.equal(r.status, 1, `a reset past the bound exits 1\n${r.stderr}`);
    assert.match(r.stderr, /\(past-bound\)/,
      `the gate that refused the wait is named\n${r.stderr}`);
    const ending = JSON.parse(fs.readFileSync(path.join(wt, ENDING), 'utf8'));
    assert.equal(ending.reason, 'limited');

    // A DESK CARRYING ONLY AN EMPTY CLAIM NAMES NO COMMIT, because
    // `rev-list -- .` excludes a commit that touched no path — which is
    // exactly what the dispatcher's `--allow-empty` claim is. The one entry is
    // `.plot/`, the directory the fixture wrote its prompt into, and the
    // SINGULAR form is what this case asserts.
    const marker = fs.readFileSync(path.join(wt, 'PLOT-BLOCKED.md'), 'utf8');
    assert.match(marker, /The desk holds 1 uncommitted file\./,
      `an empty claim is not work, and one entry is singular\n${marker}`);
    assert.doesNotMatch(marker, /commit/,
      `no commit is named for a desk that only claimed\n${marker}`);
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});

test('a limit that returns with no commit since the wait ends on no-progress', serial, () => {
  const sb = sandbox();
  try {
    const { wt } = claim(sb, 'feature/seam');
    const log = path.join(sb.root, 'seen');
    fs.mkdirSync(log, { recursive: true });

    // EVERY INVOCATION MEETS THE LIMIT AND COMMITS NOTHING. The first wait is
    // allowed; the second exit is inside the progress window with no commit
    // since the recorded `HEAD`, so the rule answers `no-progress` — a limit
    // that does not lift cannot hold an agent forever.
    writePrompt(wt, `n=$(cat "${log}/runs" 2>/dev/null || echo 0)
n=$((n + 1)); printf '%s' "$n" > "${log}/runs"
printf '%s\\n' ${JSON.stringify(limitLine(RESET_AHEAD))}
exit 1
`);
    const manifest = manifestFile(sb, wt, 'feature/seam');
    const dir = shimmedScripts(sb.root, manifest, '');
    const r = runLoop(dir, wt, manifest, PAST_THE_RESET);

    assert.equal(r.status, 1, `the second limit ends the worker\n${r.stderr}`);
    assert.match(r.stderr, /\(no-progress\)/,
      `and names the gate that refused the second wait\n${r.stderr}`);

    // IT WAITED ONCE AND NOT TWICE. Two prompts ran: the one that met the
    // limit and the one that resumed and met it again.
    assert.equal(fs.readFileSync(path.join(log, 'runs'), 'utf8'), '2',
      `the loop waited once, resumed, and refused the second wait\n${r.stderr}`);
    const waits = (r.stderr.match(/usage limit on feature\/seam until/g) ?? []).length;
    assert.equal(waits, 1, `exactly one wait was served\n${r.stderr}`);
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
  printf '%s\\n' ${JSON.stringify(limitLine(RESET_AHEAD))}
  exit 1
fi
if [ "$n" = "2" ]; then
  echo "partial $n" > "$PLOT_WORKTREE/partial.txt"
  git -C "$PLOT_WORKTREE" add -A
  git -C "$PLOT_WORKTREE" commit -qm "partial work"
  printf '%s\\n' ${JSON.stringify(limitLine(RESET_AHEAD))}
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
    const dir = shimmedScripts(sb.root, manifest, '');
    const r = runLoop(dir, wt, manifest, PAST_THE_RESET);

    assert.equal(fs.readFileSync(path.join(log, 'runs'), 'utf8'), '3',
      `a committing prompt earns a second wait\n${r.stderr}`);
    const waits = (r.stderr.match(/usage limit on feature\/seam until/g) ?? []).length;
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
  printf '%s\\n' ${JSON.stringify(limitLine(RESET_AHEAD))}
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
    const dir = shimmedScripts(sb.root, manifest, '');
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
printf '%s\\n' ${JSON.stringify(limitLine(RESET_AHEAD))}
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
    const dir = shimmedScripts(sb.root, manifest, '');
    const r = runLoop(dir, wt, manifest, PAST_THE_RESET);

    assert.equal(fs.readFileSync(path.join(log, 'runs'), 'utf8'), '1',
      `the slice finished and no wait was served\n${r.stderr}`);
    assert.doesNotMatch(r.stderr, /usage limit on/,
      `a quoted line is not a limit\n${r.stderr}`);
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4 — TODAY'S PATHS SURVIVE
// ---------------------------------------------------------------------------

test('a missing bundle keeps today\'s retries', serial, () => {
  const sb = sandbox();
  try {
    const { wt } = claim(sb, 'feature/seam');
    const log = path.join(sb.root, 'seen');
    fs.mkdirSync(log, { recursive: true });
    writePrompt(wt, `n=$(cat "${log}/runs" 2>/dev/null || echo 0)
n=$((n + 1)); printf '%s' "$n" > "${log}/runs"
printf '%s\\n' ${JSON.stringify(limitLine(RESET_AHEAD))}
exit 1
`);
    const manifest = manifestFile(sb, wt, 'feature/seam');
    const dir = shimmedScripts(sb.root, manifest, '');

    // THE BUNDLE IS REMOVED, which is an adopting checkout that never built
    // it. An unaskable rule takes today's path — `unstarted` for a non-zero
    // status — rather than stopping a worker on a classification nobody could
    // make.
    fs.rmSync(path.join(dir, 'board', 'plot-prompt-exit.mjs'));
    const r = runLoop(dir, wt, manifest, { ...PAST_THE_RESET, PLOT_START_ATTEMPT_BUDGET: '2' });

    assert.equal(fs.readFileSync(path.join(log, 'runs'), 'utf8'), '3',
      `the first attempt plus the two the budget allows\n${r.stderr}`);
    assert.match(r.stderr, /retrying \(1 of 2\)/, `today's retry is intact\n${r.stderr}`);
    assert.match(r.stderr, /the prompt never started on feature\/seam/, r.stderr);
    const ending = JSON.parse(fs.readFileSync(path.join(wt, ENDING), 'utf8'));
    assert.equal(ending.reason, 'unstarted',
      'without a classifier the exit is what it always was');
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});

test('a plain failure keeps today\'s retries and names what the desk holds', serial, () => {
  const sb = sandbox();
  try {
    const { wt } = claim(sb, 'feature/seam');
    const log = path.join(sb.root, 'seen');
    fs.mkdirSync(log, { recursive: true });

    // A DIRTY DESK WITH A FILE THE LOOP ITSELF WROTE. `.plot-worker.log` and
    // the rest of that prefix must not be counted as work on the floor, or
    // every ending would report dirt of its own making.
    fs.writeFileSync(path.join(wt, 'floor.ts'), 'export const x = 1;\n');
    fs.writeFileSync(path.join(wt, '.plot-worker.scratch'), 'loop leftovers\n');

    writePrompt(wt, `n=$(cat "${log}/runs" 2>/dev/null || echo 0)
n=$((n + 1)); printf '%s' "$n" > "${log}/runs"
echo "Error: Session ID is already in use." >&2
exit 1
`);
    const manifest = manifestFile(sb, wt, 'feature/seam');
    const dir = shimmedScripts(sb.root, manifest, '');
    const r = runLoop(dir, wt, manifest, { PLOT_START_ATTEMPT_BUDGET: '2' });

    assert.equal(fs.readFileSync(path.join(log, 'runs'), 'utf8'), '3',
      `a failure that is not a limit still retries\n${r.stderr}`);
    assert.match(r.stderr, /retrying \(1 of 2\)/, r.stderr);
    const ending = JSON.parse(fs.readFileSync(path.join(wt, ENDING), 'utf8'));
    assert.equal(ending.reason, 'unstarted');

    // THE SENTENCE NAMES THE DESK AND COUNTS ONLY REAL WORK: one commit (the
    // claim) and one file (`floor.ts`), never the `.plot-worker.` leftovers.
    // `floor.ts` and `.plot/` are two entries; `.plot-worker.scratch` is a
    // third file on disk and is NOT among them, which is the assertion — the
    // loop's own records must never be counted as work on the floor. No commit
    // is named: the claim is empty and `rev-list -- .` excludes it.
    assert.match(r.stderr, /The desk holds 2 uncommitted files\./,
      `the loop's own files are not work on the floor\n${r.stderr}`);
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5 — THE BOUND, AND WHAT IS LEFT RUNNING
// ---------------------------------------------------------------------------

test('the bound ends a captured prompt and leaves no prompt process', serial, () => {
  const sb = sandbox();
  try {
    const { wt } = claim(sb, 'feature/seam');
    const log = path.join(sb.root, 'seen');
    fs.mkdirSync(log, { recursive: true });

    // `$!` MUST STAY ON THE PROMPT. The capture is a process substitution and
    // never `… | tee … &`, which would move `$!` to `tee`: the bound's
    // `_kill_tree` would kill the tee and ORPHAN the agent. All three round-2
    // jurors measured that, and this is the assertion they asked for.
    //
    // THE SENTINEL IS THE PROMPT'S OWN PID, written at launch. `ps` liveness
    // alone cannot be asserted here — a detached child is reaped when the
    // harness exits — so the test reads the pid the prompt recorded and asks
    // whether THAT process survives the bound.
    writePrompt(wt, `printf '%s' "$$" > "${log}/prompt.pid"
sleep 120
`);
    // THE BOUND IS A CONFIG KEY AND NOT AN ENVIRONMENT VARIABLE, so the
    // fixture declares three seconds the way an adopting project would —
    // IN THE DESK, which is where the loop reads its config from. Writing it
    // in the clone would leave the desk reading the 600 it was cut with.
    const claudeMd = path.join(wt, 'CLAUDE.md');
    fs.writeFileSync(claudeMd,
      fs.readFileSync(claudeMd, 'utf8').replace('**Worker bound:** 1800', '**Worker bound:** 3'));
    git(wt, 'add', '-A');
    git(wt, 'commit', '-qm', 'a three second bound');

    const manifest = manifestFile(sb, wt, 'feature/seam');
    const dir = shimmedScripts(sb.root, manifest, '');
    const r = runLoop(dir, wt, manifest, {}, 90000);

    assert.equal(r.status, 124, `the bound's own exit code\n${r.stderr}`);
    assert.match(r.stderr, /the bound expired|nobody could tell/,
      `the bound reported it\n${r.stderr}`);

    const pid = Number(fs.readFileSync(path.join(log, 'prompt.pid'), 'utf8').trim());
    assert.ok(Number.isFinite(pid) && pid > 0, 'the prompt recorded its pid');
    let alive = true;
    try { process.kill(pid, 0); } catch { alive = false; }
    assert.equal(alive, false,
      `no prompt process survives the bound — $! stayed on the prompt, not on tee (pid ${pid})`);
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});

test('--stop during a wait ends the loop within one step', serial, async () => {
  const sb = sandbox();
  try {
    const { wt } = claim(sb, 'feature/seam');
    const log = path.join(sb.root, 'seen');
    fs.mkdirSync(log, { recursive: true });

    // THE WAIT IS LONG AND THE STOP ARRIVES INSIDE IT. A wait implemented as
    // one `sleep` for the whole interval would hold the agent for an hour
    // after the SIGTERM; the steps are at most 60 s and each is
    // `_wait_sleep_pid`, which the exit trap reaps — so the loop leaves at
    // once rather than at the reset.
    writePrompt(wt, `printf 'started\\n' > "${log}/started"
printf '%s\\n' ${JSON.stringify(limitLine(3600))}
exit 1
`);
    const manifest = manifestFile(sb, wt, 'feature/seam');
    const dir = shimmedScripts(sb.root, manifest, '');

    const child = spawn('bash', [path.join(dir, 'plot-worker-loop.sh')], {
      cwd: wt,
      env: {
        ...process.env,
        PLOT_BRANCH: 'feature/seam', PLOT_WORKTREE: wt, PLOT_SLUG: 'limit',
        PLOT_MANIFEST_FILE: manifest, PLOT_SESSION_ID: SESSION,
        PLOT_WAIT_POLL_SECONDS: '1', PLOT_WAIT_BUDGET_SECONDS: '600',
        PLOT_LIMIT_MARGIN_SECONDS: '0',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });

    // Wait until the loop is demonstrably inside the wait.
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline && !/usage limit on feature\/seam/.test(stderr)) {
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.match(stderr, /usage limit on feature\/seam/,
      `the loop reached the wait\n${stderr}`);

    const sentAt = Date.now();
    child.kill('SIGTERM');
    const code = await new Promise((resolve) => child.on('exit', (c, s) => resolve(c ?? s)));
    const took = (Date.now() - sentAt) / 1000;

    // ONE STEP IS 60 s, so a margin above it proves the loop is not sleeping
    // to the reset an hour away.
    assert.ok(took < 65, `the loop left within one step, not at the reset (${took}s)`);
    assert.ok(code !== undefined, `it exited (${code})`);
    assert.equal(fs.existsSync(path.join(wt, LIMITED)), false,
      'a stopped worker leaves no waiting record behind');
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 6 — WHAT THE OTHER READERS SAY
// ---------------------------------------------------------------------------

test('--status names a future reset and not a past one', serial, () => {
  const sb = sandbox();
  try {
    const { wt } = claim(sb, 'feature/seam');

    // `--status` READS A RUNNING WORKER'S DESK, so the pid file and manifest
    // must name a live process. This process is the stand-in: it is alive, and
    // what is asserted is which SENTENCE the reading produces.
    fs.writeFileSync(path.join(wt, '.plot-worker.pid'), String(process.pid));
    fs.writeFileSync(path.join(wt, '.plot-worker.log'), 'log\n');
    const agents = path.join(sb.work, '.plot', 'agents');
    fs.mkdirSync(agents, { recursive: true });
    fs.writeFileSync(path.join(agents, `${SESSION}.json`), JSON.stringify({
      session: SESSION, branch: 'feature/seam', worktree: wt,
      pid: String(process.pid), startedAt: new Date().toISOString(),
    }, null, 2) + '\n');

    // THE DESK ROOT IS A CONFIG KEY, resolved through `plot_desk_root` — so
    // the fixture declares it rather than the test exporting an environment
    // variable no reader honours.
    const claudeMd = path.join(sb.work, 'CLAUDE.md');
    fs.appendFileSync(claudeMd, `- **Worktree root:** ${path.join(sb.root, 'worktrees')}\n`);

    const statusOut = () => {
      try {
        return execFileSync('bash', [path.join(scripts, 'plot-fleetctl.sh'), '--status'], {
          cwd: sb.work, encoding: 'utf8', timeout: 60000,
        });
      } catch (err) {
        return (err.stdout ?? '') + (err.stderr ?? '');
      }
    };

    // A FUTURE RESET IS NAMED AS A WAIT, because `quiet 2400s` on a worker
    // doing exactly what it should reads as one that stopped.
    const ahead = nowSeconds() + 3600;
    fs.writeFileSync(path.join(wt, LIMITED),
      `${ahead}\t${new Date(ahead * 1000).toISOString()}\tYou've hit your session limit\n`);
    assert.match(statusOut(), /waiting on a usage limit until /,
      'a live wait is named as a wait');

    // A PAST RESET IS NOT. A record outliving its reset — a worker SIGKILLed
    // mid-wait leaves no trap to remove it — would otherwise report a wait
    // nothing is serving, for as long as the desk stands.
    const behind = nowSeconds() - 3600;
    fs.writeFileSync(path.join(wt, LIMITED),
      `${behind}\t${new Date(behind * 1000).toISOString()}\tYou've hit your session limit\n`);
    assert.doesNotMatch(statusOut(), /waiting on a usage limit/,
      'a reset that has passed falls back to the quiet reading');
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});

// THE MONITOR'S READING IS ASSERTED ON `sample_verdict` DIRECTLY, and that is
// a deliberate narrowing rather than a shortcut.
//
// Driving the whole monitor to an `idle` finding needs FOUR conditions at once
// — two consecutive quiet passes in ONE process (`prev_verdict` is an
// in-process variable and nothing is written down), an unchanged tree between
// them, commits on the branch, and a live pid whose child burns no CPU. A test
// that arranged all four would be asserting the monitor's two-sample rule,
// which this slice does not touch; and one that arranged them badly passes
// whether or not the record is read at all — the first version of this test
// did exactly that, publishing nothing in BOTH arms.
//
// What this slice changes is one subtraction inside `sample_verdict`. So the
// function is sourced and asked, with and without the record, and the two
// answers must differ: that is the discriminating assertion, and it is the
// smallest one that is.
test('sample_verdict reads a waiting desk as busy and a silent one as quiet', serial, () => {
  const sb = sandbox();
  try {
    const { wt } = claim(sb, 'feature/seam');
    const home = path.join(sb.root, 'runtime-home');
    const slug = wt.replace(/[/.]/g, '-');
    const tdir = path.join(home, '.claude', 'projects', slug);
    fs.mkdirSync(tdir, { recursive: true });

    // A TRANSCRIPT AN HOUR OLD, which is what a waiting agent's desk looks
    // like: the loop sleeps, so nothing writes.
    const tfile = path.join(tdir, `${SESSION}.jsonl`);
    fs.writeFileSync(tfile, '{}\n');
    const old = nowSeconds() - 3600;
    fs.utimesSync(tfile, old, old);

    // A PID THAT IS ALIVE AND HAS NO CHILD ON A CORE — a `sleep`, which is
    // precisely the shape of a worker inside the wait.
    const sleeper = spawn('sleep', ['120'], { stdio: 'ignore' });
    try {
      fs.writeFileSync(path.join(wt, '.plot-worker.pid'), String(sleeper.pid));

      // THE MONITOR IS NOT SOURCEABLE — it runs its loop at the bottom of the
      // file — so its FUNCTIONS are taken and its loop is not. `sed` stops at
      // the first line that is neither a comment nor a definition after the
      // last function, which is where the script's own body begins.
      //
      // Reaching in like this is the cost of asserting one function of a
      // script that is a program rather than a library. The alternative was
      // adding a source guard to shipped code for a test's benefit, which the
      // brief's "no new script, the decision stays in the bundle" rules out in
      // spirit: this slice may not reshape the monitor to be easier to test.
      const ask = () => execFileSync('bash', ['-c', `
        set -u
        S=${JSON.stringify(scripts)}
        . "$S/plot-worker-state.sh"
        . "$S/plot-transcript-quiet.sh"
        . "$S/plot-monitor-subject.sh"
        worktree=${JSON.stringify(wt)}
        branch=feature/seam
        pid_file="$worktree/.plot-worker.pid"
        monitor='WorkerMonitor'
        interval=1
        findings="$worktree/.plot-worker.monitor.worker.jsonl"
        prev_verdict=''
        prev_tree=''
        : "\${PLOT_MONITOR_QUIET_SECONDS:=1}"
        # Every function definition, and nothing that runs at load.
        eval "$(sed -n '/^[a-z_]*() {/,/^}/p' "$S/plot-worker-monitor.sh")"
        sample_verdict
      `], {
        encoding: 'utf8', timeout: 30000,
        env: {
          ...process.env,
          PLOT_BRANCH: 'feature/seam', PLOT_WORKTREE: wt, PLOT_SESSION_ID: SESSION,
          PLOT_TRANSCRIPT_HOME: home, PLOT_MONITOR_QUIET_SECONDS: '1',
          PLOT_PID_FILE: path.join(wt, '.plot-worker.pid'),
        },
      }).trim();

      // THE CONTROL: no record, an hour of silence, nothing on a core. The
      // transcript alone says this agent stopped.
      const silent = ask();
      assert.notEqual(silent, 'busy',
        `control: a silent desk with no limit record is not busy (got ${silent})`);

      // THE SAME DESK, WAITING. Silence is measured from the reset instead,
      // the subtraction clamps to 0, and the verdict flips.
      const ahead = nowSeconds() + 3600;
      fs.writeFileSync(path.join(wt, LIMITED),
        `${ahead}\t${new Date(ahead * 1000).toISOString()}\tYou've hit your session limit\n`);
      assert.equal(ask(), 'busy',
        'a desk waiting on a reset an hour ahead is busy, not quiet');

      // AND A RECORD WHOSE RESET HAS PASSED CHANGES NOTHING, so a worker
      // SIGKILLed mid-wait cannot hold its desk out of every finding forever.
      const behind = nowSeconds() - 3600;
      fs.writeFileSync(path.join(wt, LIMITED),
        `${behind}\t${new Date(behind * 1000).toISOString()}\tYou've hit your session limit\n`);
      assert.equal(ask(), silent,
        'a reset that has passed reads exactly as no record at all');
    } finally {
      sleeper.kill('SIGKILL');
    }
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});
