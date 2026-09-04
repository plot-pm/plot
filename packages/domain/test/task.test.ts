import { describe, expect, it } from 'vitest';
import { taskState, type TaskReadings, type UnpushedReading } from '../src/rules/task.js';

/**
 * A worktree whose worker exited leaving nothing behind. Each test names only
 * what it changes, so the reading under test is the only difference from the
 * tree that reads `finished`.
 */
const clean = (over: Partial<TaskReadings> = {}): TaskReadings => ({
  hasPr: false,
  blocked: false,
  dirty: false,
  unpushed: false,
  ...over,
});

describe('taskState', () => {
  it('reads a tree with nothing left behind as finished', () => {
    expect(taskState(clean())).toBe('finished');
  });

  it('reads a marker as waiting', () => {
    expect(taskState(clean({ blocked: true }))).toBe('waiting');
  });

  it('reads uncommitted work as stalled', () => {
    expect(taskState(clean({ dirty: true }))).toBe('stalled');
  });

  it('reads committed-but-unpushed work as stalled', () => {
    // Committing clears dirtiness, so without this arm a worker that tidied up
    // and stopped before pushing reads `finished` with nobody able to see its
    // commits.
    expect(taskState(clean({ unpushed: true }))).toBe('stalled');
  });
});

describe('the order is the rule', () => {
  it('lets a PR outrank every local signal', () => {
    // Work that reached review has left the worker's hands, so a scratch file
    // and an open question beside a merged PR are not unfinished work.
    expect(taskState({ hasPr: true, blocked: true, dirty: true, unpushed: true }))
      .toBe('finished');
  });

  it('reads a blocked worker with work on the floor as waiting, not stalled', () => {
    // A worker asking a question has almost always left the work it was doing
    // uncommitted beside the question. Measured: a guard restarted one branch
    // TWICE while its worker waited on an answer, and the second restart re-ran
    // work the first had finished.
    expect(taskState(clean({ blocked: true, dirty: true }))).toBe('waiting');
    expect(taskState(clean({ blocked: true, dirty: true, unpushed: true })))
      .toBe('waiting');
  });
});

describe('an unpushed reading of null is unanswerable, not zero', () => {
  it('does not read a branch with no upstream as stalled', () => {
    // The measured failure this null exists for: a fallback counting against
    // the default branch reported EVERY clean branch `stalled` in a repo with
    // no remote, because `rev-list --count '..HEAD'` with an empty left side
    // counts the whole history.
    expect(taskState(clean({ unpushed: null }))).toBe('finished');
  });

  it('still lets the readings above it decide', () => {
    expect(taskState(clean({ unpushed: null, hasPr: true }))).toBe('finished');
    expect(taskState(clean({ unpushed: null, blocked: true }))).toBe('waiting');
    expect(taskState(clean({ unpushed: null, dirty: true }))).toBe('stalled');
  });
});

describe('every combination of the four readings', () => {
  // THE WHOLE TRUTH TABLE — 2 × 2 × 2 × 3 = 24 rows, which is what moving the
  // decision out of shell buys: in `plot-worker-state.sh` a combination could
  // only be reached by building the worktree that produces it, and a live PR
  // over a dirty tree was never one this estate would produce on demand.
  //
  // The expectation is written as the ordered cascade rather than as a table of
  // literals, because a table of 24 answers is a second implementation of the
  // rule and would drift with it.
  const bools = [false, true];
  const unpushedReadings: UnpushedReading[] = [false, true, null];

  for (const hasPr of bools) {
    for (const blocked of bools) {
      for (const dirty of bools) {
        for (const unpushed of unpushedReadings) {
          const readings: TaskReadings = { hasPr, blocked, dirty, unpushed };
          const expected = hasPr
            ? 'finished'
            : blocked
              ? 'waiting'
              : dirty || unpushed === true
                ? 'stalled'
                : 'finished';
          it(`answers ${expected} for ${JSON.stringify(readings)}`, () => {
            expect(taskState(readings)).toBe(expected);
          });
        }
      }
    }
  }
});
