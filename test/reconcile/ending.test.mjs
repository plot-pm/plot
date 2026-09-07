// Contract test for the ending record — the channel `_ended_detail` never had.
//
// It was set at `plot-worker-loop.sh:827` and `:839` and written NOWHERE: no
// file, no stdout. One `case` read it to print a sentence to stderr, so the
// distinction it drew lived for the length of a log line and reached no reader
// that outlived the process. `.plot-worker.exit` records THAT a worker ended;
// nothing recorded WHY.
//
// WHAT IS ASSERTED HERE is the pair of shell halves — `write_ending` produces a
// record the domain's `readEnding` accepts, and `plot_worker_ending` reads it
// back. The domain's own suite (`packages/domain/test/ending.test.ts`) holds
// what the four reasons MEAN; this holds that the shell and the domain agree on
// the bytes between them, which is the seam neither can check alone.
//
// THE FUNCTIONS ARE SOURCED, NOT DRIVEN THROUGH A FULL LOOP. A real hop is what
// `declaration-hop.test.mjs` exists for, and it costs a bare origin, a clone and
// two waves; the property here is about one file's contents and does not need
// one. `PLOT_WORKER_LOOP_SOURCED=1` returns from `plot-worker-loop.sh` before it
// resolves a prompt or launches anything, so sourcing it under that variable
// takes `write_ending` and nothing else — the idiom `prompt-resolution.test.mjs`
// already follows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const loop = path.join(scripts, 'plot-worker-loop.sh');
const state = path.join(scripts, 'plot-worker-state.sh');

const ENDING = '.plot-worker.ending.json';

const desk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plot-ending-'));

/** Source the loop and call `write_ending` with the five arguments it takes. */
const writeEnding = (wt, reason, actor, branch, detail) =>
  execFileSync('bash', ['-c',
    `PLOT_WORKER_LOOP_SOURCED=1
. "$1" >/dev/null 2>&1
write_ending "$2" "$3" "$4" "$5" "$6"`,
    'bash', loop, wt, reason, actor, branch, detail],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** Source the state script and ask it for the desk's ending record. */
const readEnding = (wt) => {
  try {
    return execFileSync('bash', ['-c',
      `. "$1" >/dev/null 2>&1; plot_worker_ending "$2"`, 'bash', state, wt],
      { encoding: 'utf8' });
  } catch {
    return null; // non-zero: no record. Absence is its own answer.
  }
};

test('ending: the worker records why it stopped, not merely that it did', (t) => {
  const wt = desk();
  t.after(() => fs.rmSync(wt, { recursive: true, force: true }));

  writeEnding(wt, 'quiet', 'monitor', 'feature/x', 'the WorkerMonitor reported idle');

  const record = JSON.parse(fs.readFileSync(path.join(wt, ENDING), 'utf8'));
  assert.deepEqual(record, {
    reason: 'quiet',
    actor: 'monitor',
    branch: 'feature/x',
    detail: 'the WorkerMonitor reported idle',
  });
});

test('ending: a bound expiry and a context exhaustion are different endings', (t) => {
  // The assertion the plan makes. Before this record both were the same one —
  // a worker ended for two reasons and both were time.
  const clock = desk();
  const context = desk();
  t.after(() => {
    fs.rmSync(clock, { recursive: true, force: true });
    fs.rmSync(context, { recursive: true, force: true });
  });

  writeEnding(clock, 'bound', 'bound', 'feature/x', 'exceeded the 28800s bound');
  writeEnding(context, 'spent', 'monitor', 'feature/x', 'the context ran out');

  const a = JSON.parse(readEnding(clock));
  const b = JSON.parse(readEnding(context));

  assert.notDeepEqual(a, b);
  assert.equal(a.reason, 'bound');
  assert.equal(b.reason, 'spent');
});

test('ending: the floor writes two different reasons under one actor', (t) => {
  // The reason is not the actor and neither follows from the other. The same
  // watchdog ends a worker for `bound` and for `unreadable`; what differs is
  // what could be read WHILE it ran.
  const readable = desk();
  const blind = desk();
  t.after(() => {
    fs.rmSync(readable, { recursive: true, force: true });
    fs.rmSync(blind, { recursive: true, force: true });
  });

  writeEnding(readable, 'bound', 'bound', 'feature/x', 'exceeded the 28800s bound');
  writeEnding(blind, 'unreadable', 'bound', 'feature/x', 'exceeded the 28800s bound');

  const a = JSON.parse(readEnding(readable));
  const b = JSON.parse(readEnding(blind));

  assert.equal(a.actor, b.actor, 'the floor fired in both');
  assert.notEqual(a.reason, b.reason, 'and the reasons must not collapse');
});

test('ending: an absent record is absent, and says so by exiting non-zero', (t) => {
  // Load-bearing. A SIGKILLed worker never reaches the write, and every worker
  // that ran before this record existed leaves none either. The reader must not
  // manufacture one.
  const wt = desk();
  t.after(() => fs.rmSync(wt, { recursive: true, force: true }));

  assert.equal(readEnding(wt), null);
  assert.equal(fs.existsSync(path.join(wt, ENDING)), false);
});

test('ending: a record with no reason or no actor is refused, not written', (t) => {
  const wt = desk();
  t.after(() => fs.rmSync(wt, { recursive: true, force: true }));

  writeEnding(wt, '', 'bound', 'feature/x', 'detail');
  assert.equal(readEnding(wt), null, 'no reason, so nothing is recorded');

  writeEnding(wt, 'bound', '', 'feature/x', 'detail');
  assert.equal(readEnding(wt), null, 'no actor, so nothing is recorded');
});

test('ending: a worker holding no branch still records why it ended', (t) => {
  // A worker may end before it claims anything. The branch is an absence, and
  // the reason is still worth recording — which is the opposite of the
  // declaration's rule, where no branch means no file at all.
  const wt = desk();
  t.after(() => fs.rmSync(wt, { recursive: true, force: true }));

  writeEnding(wt, 'bound', 'bound', '', 'exceeded the 28800s bound');

  const record = JSON.parse(readEnding(wt));
  assert.equal(record.branch, '');
  assert.equal(record.reason, 'bound');
});

test('ending: the record never counts as work left on the floor', (t) => {
  // Measured before, for the family this joins: a worktree holding nothing but
  // a clean exit record read `stalled` — which is EVERY worker that finished
  // tidily. `PLOT_WORKER_RECORD` matches the `.plot-worker.` prefix, so this
  // file is already excluded; the assertion pins it, because a rename that
  // dropped the prefix would reintroduce the bug silently.
  const kept = execFileSync('bash', ['-c',
    `. "$1" >/dev/null 2>&1; plot_worker_dirty_filter "$2"`, 'bash', state,
    `?? ${ENDING}\n?? packages/domain/src/real.ts`],
    { encoding: 'utf8' });

  assert.ok(!kept.includes(ENDING), 'the ending record is not work');
  assert.ok(kept.includes('packages/domain/src/real.ts'), 'a source file still is');
});

test('ending: the record is ignored by git, like the rest of its family', (t) => {
  // A `git add -A` in a worker's worktree would otherwise carry it into the
  // repo — caught once before it landed, for `.plot-worker.log`.
  const ignore = fs.readFileSync(path.join(here, '..', '..', '.gitignore'), 'utf8');
  assert.ok(ignore.split('\n').includes(ENDING));
});
