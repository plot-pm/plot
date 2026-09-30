// Contract test for the budget ledger's TWO-GENERATION ROTATION — the writer,
// the reader, and what each does when the other dies mid-way.
//
// WHAT THIS FILE EXISTS TO PIN, and why a quiescent test cannot:
//
// 1. **No append is lost across a rotation.** The design it replaced rewrote the
//    file from a reader's live set and lost 59 of 600 concurrent appends in one
//    660 ms window. A rename loses nothing — but only if the reader reads both
//    generations, which is the property asserted here with real processes.
// 2. **The reader is exact across a rotation.** A reader that reads the previous
//    generation first passes every quiescent test and answers 0 for the live
//    generation under a real race. So the rotation is FORCED between the
//    reader's two reads, through a stubbed `cat` that renames on its first call.
// 3. **A rotator that dies leaves a record that repairs itself.** Killed before
//    its `mv` and killed after it are two different failures with two different
//    triggers, and only the second proves the odd-counter trigger.
//
// Every test sets `PLOT_BUDGET_HOME` and `HOME` to a scratch directory: a suite
// writing the operator's own ledger would be measuring their GitHub budget, and
// the ledger this slice bounds is the one it must not grow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const scripts = path.join(root, 'skills', 'plot', 'scripts');
const budget = path.join(scripts, 'plot-budget.sh');

/**
 * The generation length the shell declares, mirrored here.
 *
 * Read from the script rather than hardcoded, so a change to one is a failure
 * here rather than a silent disagreement.
 */
const GENERATION_MS = Number(
  /BUDGET_GENERATION_MS=(\d+)/.exec(readFileSync(budget, 'utf8'))?.[1] ?? '0',
);

/** A ledger directory nothing else writes to, and a `HOME` beside it. */
function makeHome() {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-budget-rot-'));
  mkdirSync(path.join(dir, 'home'), { recursive: true });
  return dir;
}

/** Runs a snippet with `plot-budget.sh` sourced, against a private ledger. */
function inBudget(home, snippet, env = {}) {
  const res = spawnSync('bash', ['-c', `. "${budget}"\n${snippet}`], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PLOT_BUDGET_HOME: home,
      HOME: path.join(home, 'home'),
      ...env,
    },
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** One ledger line for a key, at a chosen moment. */
function line(at, { spent = 1, bucket = 'graphql' } = {}) {
  return `b1\tgithub\tjwloka\t${bucket}\t${at}\t${spent}\t-\t-\t-\tunknown`;
}

/** Writes a generation from whole lines. */
function writeGeneration(home, name, lines) {
  writeFileSync(path.join(home, name), lines.map((l) => `${l}\n`).join(''));
}

/** How many lines a generation holds; a missing generation holds none. */
function count(home, name) {
  const file = path.join(home, name);
  if (!existsSync(file)) return 0;
  return readFileSync(file, 'utf8').split('\n').filter((l) => l !== '').length;
}

/** `budget_rate_read`'s answer, parsed. */
function read(home, now) {
  const res = inBudget(
    home,
    `budget_rate_read github jwloka graphql ${now === undefined ? '' : now}`,
  );
  assert.equal(res.code, 0, `the reader exited ${res.code}: ${res.stderr}`);
  const text = res.stdout.trim().split('\n').pop() ?? '';
  try {
    return JSON.parse(text);
  } catch {
    assert.fail(`the reader printed no JSON: ${JSON.stringify(res.stdout)}`);
  }
}

/** Now, in epoch milliseconds, as the shell reads it. */
function nowMs() {
  return Date.now();
}

// --- the reader tolerates every normal absence -------------------------------

test('budget-rotation: a ledger with no previous generation answers its true count', () => {
  // `budget.tsv.1` IS ABSENT ON EVERY MACHINE until its first rotation, so this
  // is the normal state rather than an edge. Answering 0 would grant headroom
  // the record never measured — the direction a budget must never fail in.
  const home = makeHome();
  const now = nowMs();
  writeGeneration(home, 'budget.tsv', [line(now - 1000, { spent: 7 })]);
  assert.equal(read(home, now).spent, 7);
});

test('budget-rotation: a ledger with no current generation answers its true count', () => {
  // `budget.tsv` IS ABSENT between a rotation and the next append.
  const home = makeHome();
  const now = nowMs();
  writeGeneration(home, 'budget.tsv.1', [line(now - 1000, { spent: 5 })]);
  assert.equal(read(home, now).spent, 5);
});

test('budget-rotation: a ledger with neither generation answers zero', () => {
  const home = makeHome();
  assert.equal(read(home, nowMs()).spent, 0);
});

test('budget-rotation: the missing-file fallback is never reached', () => {
  // THROUGH THE REAL `budget_rate_read`, not a copy of its `awk`. BSD awk
  // 20200816 and gawk both exit 2 before `END` on a missing input file, and the
  // `|| echo spent 0` fallback turns that into spent 0. A reader that passed
  // file names would pass every assertion above by ACCIDENT — answering 0 for a
  // ledger whose count happens to be 0 — so this asserts a NON-ZERO count with
  // one generation missing, which the fallback cannot produce.
  const home = makeHome();
  const now = nowMs();
  writeGeneration(home, 'budget.tsv', [line(now - 1000), line(now - 900)]);
  const answer = read(home, now);
  assert.equal(answer.spent, 2, 'the fallback answered, which means a name reached awk');
  assert.equal(answer.read, 2);
});

test('budget-rotation: the reader reads both generations', () => {
  const home = makeHome();
  const now = nowMs();
  writeGeneration(home, 'budget.tsv', [line(now - 100)]);
  writeGeneration(home, 'budget.tsv.1', [line(now - 200)]);
  assert.equal(read(home, now).spent, 2);
});

// --- the rotation itself -----------------------------------------------------

test('budget-rotation: a due rotation renames the current generation', () => {
  const home = makeHome();
  const now = nowMs();
  const old = now - GENERATION_MS - 1000;
  writeGeneration(home, 'budget.tsv', [line(old), line(old + 1)]);
  const res = inBudget(home, `budget_maybe_rotate ${now}`);
  assert.equal(res.code, 0);
  assert.equal(count(home, 'budget.tsv.1'), 2, 'the old generation did not become .1');
  assert.equal(count(home, 'budget.tsv'), 0);
  assert.equal(Number(readFileSync(path.join(home, 'budget.gen'), 'utf8').trim()) % 2, 0);
});

test('budget-rotation: a young generation is not rotated', () => {
  const home = makeHome();
  const now = nowMs();
  writeGeneration(home, 'budget.tsv', [line(now - 1000)]);
  inBudget(home, `budget_maybe_rotate ${now}`);
  assert.equal(count(home, 'budget.tsv'), 1);
  assert.equal(existsSync(path.join(home, 'budget.tsv.1')), false);
});

test('budget-rotation: a second rotation inside one generation is refused', () => {
  // THE ASSERTION A NAIVE IMPLEMENTATION PASSES WITHOUT. Round 3 forced a second
  // rotation 0.4 s after the first, past the age condition, and 3 of 600 lines
  // went in 5 of 5 trials. An implementation that checks the age only when it
  // DECIDES to rotate — rather than again immediately before the `mv` — passes
  // the one-rotation race above and fails here.
  const home = makeHome();
  const now = nowMs();
  const old = now - GENERATION_MS - 1000;
  writeGeneration(home, 'budget.tsv', [line(old), line(old + 1), line(old + 2)]);
  writeGeneration(home, 'budget.tsv.1', [line(old - 5)]);

  inBudget(home, `budget_maybe_rotate ${now}`);
  assert.equal(count(home, 'budget.tsv.1'), 3, 'the first rotation did not happen');

  // A fresh append, then a second rotation attempt in the same generation.
  inBudget(home, `budget_append github jwloka graphql 1 - - '' unknown`);
  assert.equal(count(home, 'budget.tsv'), 1);
  inBudget(home, `budget_maybe_rotate ${nowMs()}`);

  assert.equal(count(home, 'budget.tsv'), 1, 'the second rotation discarded the live line');
  assert.equal(count(home, 'budget.tsv.1'), 3, 'the second rotation replaced the kept generation');
});

test('budget-rotation: a rotator that reaches the mv late re-reads the age and refuses', () => {
  // THE CHECK IMMEDIATELY BEFORE THE `mv`, ASSERTED WHERE ONLY IT CAN DECIDE.
  // `budget_maybe_rotate` gates on the age before it takes the lock, so a
  // mutation of the pre-`mv` re-check alone survives the test above — measured:
  // it passed. This calls `budget_rotate` DIRECTLY with a `now` for which the
  // rotation was due when the decision was taken, against a ledger that has
  // since been rotated by somebody else. That is the second rotator arriving
  // behind the first, which is the case the re-check exists for: round 3 forced
  // one 0.4 s after the first and lost 3 of 600 lines in 5 of 5 trials.
  const home = makeHome();
  const now = nowMs();
  const old = now - GENERATION_MS - 1000;

  // The state after another rotator has just finished: a YOUNG current
  // generation holding the live window, and the old one kept as `.1`.
  writeGeneration(home, 'budget.tsv', [line(now - 10), line(now - 9), line(now - 8)]);
  writeGeneration(home, 'budget.tsv.1', [line(old), line(old + 1)]);

  // This rotator decided to rotate while the old generation was still current.
  const res = inBudget(home, `budget_rotate ${now}; echo "rc=$?"`);
  assert.match(res.stdout, /rc=1/, 'the late rotator rotated a young generation');

  assert.equal(count(home, 'budget.tsv'), 3, 'the live window was discarded');
  assert.equal(count(home, 'budget.tsv.1'), 2, 'the kept generation was replaced');
  assert.equal(existsSync(path.join(home, 'budget.lock')), false, 'the lock was left behind');
  const gen = Number(readFileSync(path.join(home, 'budget.gen'), 'utf8').trim());
  assert.equal(gen % 2, 0, `a refused rotation left the counter odd: ${gen}`);
});

test('budget-rotation: a reader reads at most two generations', () => {
  // AFTER THREE ROTATIONS the `read` field equals the line count of `budget.tsv`
  // plus `budget.tsv.1`, and nothing older than two generations is read. This is
  // the bound that replaced a timing claim, which measured machine load.
  const home = makeHome();
  let now = nowMs();
  for (let generation = 0; generation < 3; generation += 1) {
    const old = now - GENERATION_MS - 1000;
    writeGeneration(home, 'budget.tsv', [line(old), line(old + 1)]);
    inBudget(home, `budget_maybe_rotate ${now}`);
    now += 1000;
  }
  writeGeneration(home, 'budget.tsv', [line(now - 10), line(now - 9), line(now - 8)]);

  const answer = read(home, now);
  const onDisk = count(home, 'budget.tsv') + count(home, 'budget.tsv.1');
  assert.equal(answer.read, onDisk, 'the reader read more or less than the two generations');
  assert.ok(onDisk > 0);
});

// --- no append is lost -------------------------------------------------------

test('budget-rotation: four concurrent appenders lose nothing across one rotation', async () => {
  // REAL PROCESSES, because two promises in one process share a thread and prove
  // nothing about `O_APPEND`. Exactly ONE rotation fires: a forced second would
  // discard a generation by design, which is what the age condition refuses and
  // what the previous test asserts separately.
  const home = makeHome();
  const now = nowMs();
  const old = now - GENERATION_MS - 1000;
  // A generation old enough that the first appender to arrive rotates it.
  writeGeneration(home, 'budget.tsv', [line(old)]);

  const perWriter = 150;
  const writers = [0, 1, 2, 3].map(
    (index) =>
      new Promise((resolve) => {
        const child = spawn(
          'bash',
          [
            '-c',
            `. "${budget}"\nfor i in $(seq 1 ${perWriter}); do budget_append github jwloka graphql 1 - - '' unknown; done`,
          ],
          {
            env: {
              ...process.env,
              PLOT_BUDGET_HOME: home,
              HOME: path.join(home, 'home'),
            },
            stdio: 'ignore',
          },
        );
        child.on('exit', () => resolve(index));
      }),
  );
  await Promise.all(writers);

  const total = count(home, 'budget.tsv') + count(home, 'budget.tsv.1');
  // The seed line plus every append. A rename loses nothing, because an append
  // that races it lands in one of the two files and both are counted.
  assert.equal(
    total,
    perWriter * 4 + 1,
    `lost ${perWriter * 4 + 1 - total} of ${perWriter * 4} appends across the rotation`,
  );

  // And the reader sees all of them: `read` counts what one pass read.
  const answer = read(home, nowMs());
  assert.equal(answer.read, total, 'the reader did not read every line on disk');

  // TORN LINES ARE A SEPARATE FAILURE from lost ones, and a count alone cannot
  // see them.
  const all = ['budget.tsv', 'budget.tsv.1']
    .filter((name) => existsSync(path.join(home, name)))
    .flatMap((name) =>
      readFileSync(path.join(home, name), 'utf8').split('\n').filter((l) => l !== ''),
    );
  const torn = all.filter((l) => l.split('\t').length !== 10);
  assert.deepEqual(torn, [], 'a concurrent append was torn');
});

test('budget-rotation: a reader is exact with a rotation forced between its two reads', () => {
  // THE ASSERTION A NAIVE IMPLEMENTATION PASSES WITHOUT. A reader that reads
  // `.1` first passes every quiescent test above and answers 0 for the live
  // generation under a real race — measured in round 2. The rotation is injected
  // at exactly that point through a stubbed `cat` that renames on its FIRST call.
  const home = makeHome();
  const now = nowMs();
  writeGeneration(home, 'budget.tsv', [line(now - 100, { spent: 4 })]);
  writeGeneration(home, 'budget.tsv.1', [line(now - 200, { spent: 3 })]);

  // A `cat` that rotates AFTER its first call has finished, so the rename lands
  // strictly BETWEEN the reader's two reads.
  //
  // THE MOMENT IS THE WHOLE TEST. Renaming before the first read completes is a
  // different interleaving, and both orders survive it — measured: correct and
  // reversed both answered 4. Renaming between the reads separates them: the
  // correct order answers 8, having read the live generation twice, and the
  // reversed order answers 3, the live generation gone.
  const stub = mkdtempSync(path.join(tmpdir(), 'plot-budget-cat-'));
  const marker = path.join(stub, 'fired');
  writeFileSync(
    path.join(stub, 'cat'),
    `#!/usr/bin/env bash\n` +
      `/bin/cat "$@"; rc=$?\n` +
      `if [ ! -e "${marker}" ]; then\n` +
      `  : > "${marker}"\n` +
      `  mv -f "${home}/budget.tsv" "${home}/budget.tsv.1" 2>/dev/null || true\n` +
      `fi\n` +
      `exit $rc\n`,
  );
  chmodSync(path.join(stub, 'cat'), 0o755);

  const res = inBudget(home, `budget_rate_read github jwloka graphql ${now}`, {
    PATH: `${stub}:${process.env.PATH}`,
  });
  assert.equal(res.code, 0);
  const answer = JSON.parse(res.stdout.trim().split('\n').pop() ?? '{}');

  // THE ANSWER MAY OVER-COUNT AND MAY NEVER UNDER-COUNT. Current-first makes the
  // live generation read twice, which answers 8; `.1`-first skips it entirely
  // and answers 3. Measured against both, so this assertion discriminates.
  assert.ok(
    answer.spent >= 4,
    `the reader skipped the live generation: spent ${answer.spent}, expected at least 4`,
  );
  // AND THE LIVE GENERATION IS THERE TWICE, which is what current-first buys and
  // the only reading that distinguishes it from the order that loses it.
  assert.equal(
    answer.spent,
    8,
    `expected the live generation counted twice (8), got ${answer.spent}`,
  );
});

// --- a rotator that dies -----------------------------------------------------

test('budget-rotation: a rotator killed BEFORE its mv is broken by a later append', () => {
  // The lock stands with a dead owner and a young-looking record. A later
  // append whose rotation is due finds the lock held, checks it, breaks it, and
  // rotates — recording the break.
  const home = makeHome();
  const now = nowMs();
  const old = now - GENERATION_MS - 1000;
  writeGeneration(home, 'budget.tsv', [line(old), line(old + 1)]);

  // A lock left by a pid that is not alive, older than the stale bound.
  mkdirSync(path.join(home, 'budget.lock'));
  writeFileSync(path.join(home, 'budget.lock', 'owner'), `999999\t${now - 60_000}\n`);

  const res = inBudget(home, `budget_maybe_rotate ${now}`);
  assert.equal(res.code, 0);
  assert.equal(existsSync(path.join(home, 'budget.lock')), false, 'the stale lock survived');
  assert.equal(count(home, 'budget.tsv.1'), 2, 'the rotation did not happen after the break');

  const broken = path.join(home, 'budget-lock-broken.tsv');
  assert.equal(existsSync(broken), true, 'the break was not recorded');
  assert.equal(
    readFileSync(broken, 'utf8').split('\n').filter((l) => l !== '').length,
    1,
    'the break was recorded more or less than once',
  );
});

test('budget-rotation: a rotator killed AFTER its mv is repaired by the next reader', () => {
  // THE CASE ONLY THE ODD-COUNTER TRIGGER CATCHES, and the reason a trigger on a
  // due rotation alone is not enough: the `mv` already ran, so `budget.tsv` is
  // YOUNG and no rotation is due for a whole generation. Without this trigger
  // the lock and the odd counter would stand for 24 h — round 2 measured 50
  // later appends, each due to rotate, none of which rotated.
  const home = makeHome();
  const now = nowMs();
  // The state a rotator killed after its `mv` leaves: a young current
  // generation, a previous one, an ODD counter, and a lock with a dead owner.
  writeGeneration(home, 'budget.tsv', [line(now - 100)]);
  writeGeneration(home, 'budget.tsv.1', [line(now - GENERATION_MS - 1000)]);
  writeFileSync(path.join(home, 'budget.gen'), '3\n');
  mkdirSync(path.join(home, 'budget.lock'));
  writeFileSync(path.join(home, 'budget.lock', 'owner'), `999999\t${now - 60_000}\n`);

  const answer = read(home, now);

  assert.equal(existsSync(path.join(home, 'budget.lock')), false, 'the lock survived the read');
  const gen = Number(readFileSync(path.join(home, 'budget.gen'), 'utf8').trim());
  assert.equal(gen % 2, 0, `the counter is still odd: ${gen}`);
  assert.equal(
    readFileSync(path.join(home, 'budget-lock-broken.tsv'), 'utf8')
      .split('\n')
      .filter((l) => l !== '').length,
    1,
    'the break was recorded more or less than once',
  );
  // AND THE ANSWER IS SETTLED. A repaired record reads without `"rotating":true`.
  assert.equal(answer.rotating, undefined, 'a repaired record still answered as rotating');
  assert.equal(count(home, 'budget.tsv'), 1, 'the repair rotated a young generation');
});

test('budget-rotation: a breaker that moved a fresh live lock records nothing', () => {
  // THE CASE THE OWNER COMPARISON EXISTS FOR, and reaching it takes care because
  // TWO guards stand in front of it.
  //
  // A breaker arriving after the lock is simply gone returns at `[ -d "$lock" ]`.
  // A breaker whose swap lands before the staleness test is refused by
  // `budget_lock_held`, which re-reads the owner line, finds the fresh pid alive
  // and stops. Both were measured, and both leave the comparison unreached.
  //
  // The window is AFTER the staleness test and BEFORE the rename — which is
  // exactly what a descheduled breaker holds: a line it inspected while the lock
  // was stale, against a directory somebody else has since replaced. So
  // `budget_lock_held` is overridden to perform the swap and then answer
  // *stale*, which is what B believed when it inspected.
  //
  // Unguarded, B broke a lock it did not inspect: round 3 measured two breakers
  // both rotating, and 20 live-window lines reading as 0.
  const home = makeHome();
  const now = nowMs();
  const old = now - GENERATION_MS - 1000;
  writeGeneration(home, 'budget.tsv', Array.from({ length: 20 }, (_, i) => line(old + i)));

  // The stale lock B inspected.
  mkdirSync(path.join(home, 'budget.lock'));
  writeFileSync(path.join(home, 'budget.lock', 'owner'), `999999\t${now - 60_000}\n`);

  const res = inBudget(
    home,
    `budget_lock_held() {\n` +
      `  rm -rf "$PLOT_BUDGET_HOME/budget.lock"\n` +
      `  mkdir "$PLOT_BUDGET_HOME/budget.lock"\n` +
      `  printf '%s\\t%s\\n' "$$" "${now}" > "$PLOT_BUDGET_HOME/budget.lock/owner"\n` +
      `  return 1\n` +
      `}\n` +
      `budget_lock_break ${now}; echo "rc=$?"`,
  );

  assert.match(res.stdout, /rc=1/, 'the breaker claimed a break against a fresh live lock');

  const broken = path.join(home, 'budget-lock-broken.tsv');
  const breaks = existsSync(broken)
    ? readFileSync(broken, 'utf8').split('\n').filter((l) => l !== '').length
    : 0;
  assert.equal(breaks, 0, `${breaks} breaks were recorded against a fresh live lock`);

  // AND NO LINE IS LOST, because B did not rotate.
  const total = count(home, 'budget.tsv') + count(home, 'budget.tsv.1');
  assert.equal(total, 20, `${total} of 20 lines survived the breaker`);
});

test('budget-rotation: a live lock is never broken', () => {
  // THE GUARD IN FRONT OF THE COMPARISON, asserted on its own. A lock whose
  // owner is alive and young keeps it: breaking one on the strength of not
  // knowing would rotate under a live rotator, which is the loss rotation exists
  // to avoid.
  const home = makeHome();
  const now = nowMs();
  writeGeneration(home, 'budget.tsv', [line(now - GENERATION_MS - 1000)]);
  mkdirSync(path.join(home, 'budget.lock'));
  // This process: alive, and its start time is now.
  writeFileSync(path.join(home, 'budget.lock', 'owner'), `${process.pid}\t${now}\n`);

  const res = inBudget(home, `budget_lock_break ${now}; echo "rc=$?"`);
  assert.match(res.stdout, /rc=1/, 'a live lock was broken');
  assert.equal(existsSync(path.join(home, 'budget.lock')), true, 'a live lock was removed');
  assert.equal(existsSync(path.join(home, 'budget-lock-broken.tsv')), false);
});

// --- the generation outlives every window -----------------------------------

test('budget-rotation: the generation is longer than the widest spend window', () => {
  // READ FROM THE DOMAIN, never hardcoded as one hour. A later, longer window
  // must fail HERE rather than silently dropping lines that are still live: a
  // rotation discards a generation, and a window wider than a generation would
  // reach into the one just discarded.
  const rules = readFileSync(
    path.join(root, 'packages', 'domain', 'src', 'rules', 'budget-record.ts'),
    'utf8',
  );
  const declared = /export const FALLBACK_WINDOW_MS\s*=\s*([^;]+);/.exec(rules)?.[1];
  assert.ok(declared, 'FALLBACK_WINDOW_MS is no longer declared where this reads it');
  // eslint-disable-next-line no-eval
  const windowMs = eval(declared);
  assert.ok(Number.isFinite(windowMs) && windowMs > 0, `unreadable window: ${declared}`);

  assert.ok(
    GENERATION_MS > windowMs,
    `the generation (${GENERATION_MS} ms) no longer exceeds the spend window (${windowMs} ms), ` +
      'so a rotation can discard lines that are still inside a live window',
  );

  // The shell's own fallback window must agree with the domain's, which is the
  // pairing `plot-budget.sh` already states.
  const shell = Number(
    /BUDGET_FALLBACK_WINDOW_MS=(\d+)/.exec(readFileSync(budget, 'utf8'))?.[1] ?? '0',
  );
  assert.equal(shell, windowMs, 'the shell and the domain disagree about the spend window');
});
