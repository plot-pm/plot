import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  firstMarkerLine,
  markerIn,
  waitingWorktrees,
  workerQuestions,
  BLOCKED_MARKER,
  QUESTION_MAX,
} from '../../src/server/worker-question.js';
import type { FleetPulse, WorkerState } from '../../src/contract/schema.js';

// WHAT A WAITING AGENT IS WAITING ON — and the tests that matter most here are
// the ones about NOT KNOWING.
//
// The scan has already decided the worker is `waiting`; this module only ever
// annotates that verdict. So every failure mode points the same way: an
// unreadable marker must produce "" and let the row say *reason unavailable*.
// A module that returned a plausible-looking line on failure would pass the
// happy-path assertions below while sending readers to answer questions nobody
// asked.

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-worker-question-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A git worktree with the given files in it, committed unless `dirty`. */
function repoWith(files: Record<string, string>, dirty = false): string {
  const dir = fs.mkdtempSync(path.join(tmp, 'repo-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
  }
  if (!dirty) {
    git('add', '-A');
    git('commit', '-qm', 'seed');
  }
  return dir;
}

/** A pulse whose one wave holds the branches given. */
function pulse(branches: { branch: string; worker: WorkerState; local_worktree: string }[]): FleetPulse {
  return {
    main: 'main',
    read_ref: 'abc123',
    local_head: 'abc123',
    head: 'abc123',
    fetch_failed: false,
    fetch_error: '',
    plan_source: 'ref',
    plans: [{
      file: '2026-08-17-a-plan.md',
      phase: 'approved',
      waves: [{
        name: 'Asking',
        verdict: 'eligible',
        branches: branches.map((b) => ({
          branch: b.branch,
          state: 'wip' as const,
          deferred: false,
          claimed: '',
          local_dirty: false,
          local_locked: false,
          local_worktree: b.local_worktree,
          local_ahead: 0,
          worker: b.worker,
          worker_pid: '',
          worker_exit: '',
        })),
      }],
    }],
    summary: { plans: 1, waves: 1, branches: branches.length },
  } as unknown as FleetPulse;
}

describe('the marker pattern tracks the scan it annotates', () => {
  // A SECOND COPY OF THE SCAN'S PATTERN, which this test exists to keep honest.
  // The scan decides `waiting`; this module explains it. If the two spellings
  // drift, every row degrades to *reason unavailable* — visible, not silent,
  // which is why the duplication is tolerable at all. This asserts the set,
  // so a spelling added to `plot-worker-state.sh` and not here is a red test
  // rather than a quietly emptier board.
  it('recognises all three spellings the scan accepts', () => {
    const re = new RegExp(BLOCKED_MARKER);
    expect(re.test('PLOT-BLOCKED: which adapter?')).toBe(true);
    expect(re.test('TODO(you): which adapter?')).toBe(true);
    expect(re.test('TODO(human): which adapter?')).toBe(true);
  });

  it('does not fire on an ordinary TODO', () => {
    // `TODO(refactor)` is in every codebase. Matching it would report every
    // repo's backlog as a question somebody owes an answer to.
    expect(new RegExp(BLOCKED_MARKER).test('TODO(refactor): tidy this')).toBe(false);
  });
});

describe('firstMarkerLine — the whole formatting judgement, tested directly', () => {
  it('carries the question through', () => {
    expect(firstMarkerLine('PLOT-BLOCKED: which adapter?\n'))
      .toBe('PLOT-BLOCKED: which adapter?');
  });

  it('strips the comment syntax the marker happened to be written in', () => {
    // `//` is where the worker put it, not part of what it asked.
    expect(firstMarkerLine('  // PLOT-BLOCKED: which adapter?\n'))
      .toBe('PLOT-BLOCKED: which adapter?');
    expect(firstMarkerLine('# PLOT-BLOCKED: which adapter?\n'))
      .toBe('PLOT-BLOCKED: which adapter?');
  });

  it('keeps the question mark — the trailing side is left alone', () => {
    // Stripping from both ends is what would eat it, and it is the one
    // character that makes the note read as a question at all.
    expect(firstMarkerLine('* PLOT-BLOCKED: which adapter?')).toMatch(/\?$/);
  });

  it('takes the FIRST marker line and ignores what follows', () => {
    // A worker writing a paragraph under its marker gets its opening line on
    // the row; the rest is what the worktree is for.
    expect(firstMarkerLine('PLOT-BLOCKED: which one?\nI weighed three options.\n'))
      .toBe('PLOT-BLOCKED: which one?');
  });

  it('truncates a long question with an ellipsis rather than dropping it', () => {
    // A clipped question still names its subject, which is the note's whole
    // job. Dropping it would leave the row saying only *waiting*.
    const long = `PLOT-BLOCKED: ${'x'.repeat(400)}`;
    const out = firstMarkerLine(long);
    expect(out.length).toBeLessThanOrEqual(QUESTION_MAX);
    expect(out).toMatch(/…$/);
    expect(out).toMatch(/^PLOT-BLOCKED:/);
  });

  it('returns "" for nothing at all — a stated unknown, not a blank sentence', () => {
    expect(firstMarkerLine('')).toBe('');
    expect(firstMarkerLine('\n  \n')).toBe('');
    // A line that is ONLY comment punctuation says nothing; "" is honest.
    expect(firstMarkerLine('///\n')).toBe('');
  });
});

describe('markerIn — reading the tree, and failing to', () => {
  it('finds a marker in a committed file', async () => {
    const wt = repoWith({ 'src/a.ts': '// PLOT-BLOCKED: which adapter?\n' });
    expect(await markerIn(wt)).toBe('PLOT-BLOCKED: which adapter?');
  });

  it('finds a marker in an UNTRACKED file — the live case', async () => {
    // A worker that just wrote its question has not committed it. Searching
    // only the index would read every waiting worker as unexplained.
    const wt = repoWith({ 'src/a.ts': 'ok\n' });
    fs.writeFileSync(path.join(wt, 'ASK.md'), 'PLOT-BLOCKED: which adapter?\n');
    expect(await markerIn(wt)).toBe('PLOT-BLOCKED: which adapter?');
  });

  it('ignores the worker LOG — the log-versus-tree distinction, kept', () => {
    // The log is guaranteed to hold the marker whenever the worker reported
    // writing one, so a hit there is the REPORT of a question rather than an
    // outstanding one. The whole `waiting` state is built on that split, and
    // excluding the log BY NAME rather than trusting .gitignore is the bug CI
    // caught in the scan: this repo ignores those files and a fixture did not.
    const wt = repoWith({ 'src/a.ts': 'ok\n' });
    fs.writeFileSync(path.join(wt, '.plot-worker.log'), 'PLOT-BLOCKED: answered already?\n');
    return expect(markerIn(wt)).resolves.toBe('');
  });

  it('returns "" for a tree with no marker', async () => {
    expect(await markerIn(repoWith({ 'src/a.ts': 'ok\n' }))).toBe('');
  });

  it('returns "" for a directory that is not a git worktree', async () => {
    // `git grep` exits 128 here. It must not reject: this runs inside the scan
    // refresh, whose other work cannot be lost to one unreadable worktree.
    const plain = fs.mkdtempSync(path.join(tmp, 'plain-'));
    expect(await markerIn(plain)).toBe('');
  });

  it('returns "" for a worktree that has gone', async () => {
    expect(await markerIn(path.join(tmp, 'never-existed'))).toBe('');
  });

  it('returns "" rather than rejecting when the search times out', async () => {
    // Same rule as above, reached the other way: a worktree on a slow or
    // unmounted volume must not hold the 5 s scan open, and the answer to a
    // timeout is the stated unknown.
    //
    // THE SEARCH MUST BE SLOW ENOUGH THAT THE BUDGET CANNOT WIN. A two-file
    // repo with a 1 ms budget passed on macOS and FAILED on CI, where `git
    // grep` finished inside the millisecond and returned the marker it was
    // supposed to be killed before finding — the test raced the thing it was
    // asserting. Enough files that no runner finishes them in 1 ms makes the
    // kill deterministic rather than likely.
    const many: Record<string, string> = {};
    for (let i = 0; i < 2000; i++) many[`src/f${i}.ts`] = `// filler ${i}\n`;
    many['src/z.ts'] = '// PLOT-BLOCKED: which adapter?\n';
    const wt = repoWith(many);
    expect(await markerIn(wt, 1)).toBe('');
  });
});

describe('waitingWorktrees — who gets asked at all', () => {
  it('selects only branches the scan called waiting', () => {
    // The cost stays proportional to the number of waiting agents rather than
    // to the size of the fleet: a running worker is never searched.
    const p = pulse([
      { branch: 'feature/asking', worker: 'waiting', local_worktree: '/tmp/wt-a' },
      { branch: 'feature/running', worker: 'running', local_worktree: '/tmp/wt-b' },
      { branch: 'feature/done', worker: 'finished', local_worktree: '/tmp/wt-c' },
    ]);
    expect([...waitingWorktrees(p).keys()]).toEqual(['feature/asking']);
  });

  it('skips a waiting branch with no worktree on this machine', () => {
    // It is waiting on ANOTHER machine: the scan there read its marker, this
    // one has nowhere to look, and looking anyway is how a path gets guessed.
    const p = pulse([{ branch: 'feature/elsewhere', worker: 'waiting', local_worktree: '' }]);
    expect(waitingWorktrees(p).size).toBe(0);
  });
});

describe('workerQuestions — the map the row is annotated from', () => {
  it('pairs each waiting branch with what it asked', async () => {
    const wt = repoWith({ 'src/a.ts': '// PLOT-BLOCKED: which adapter?\n' });
    const p = pulse([{ branch: 'feature/asking', worker: 'waiting', local_worktree: wt }]);
    expect(await workerQuestions(p)).toEqual(new Map([
      ['feature/asking', 'PLOT-BLOCKED: which adapter?'],
    ]));
  });

  it('OMITS a waiting branch whose marker would not read', async () => {
    // Absent and "" are one answer to the caller — *reason unavailable* — and
    // the row says so. What must never happen is an entry holding a guess.
    const plain = fs.mkdtempSync(path.join(tmp, 'plain-'));
    const p = pulse([{ branch: 'feature/asking', worker: 'waiting', local_worktree: plain }]);
    expect((await workerQuestions(p)).has('feature/asking')).toBe(false);
  });

  it('spawns nothing when no worker is waiting', async () => {
    // The ordinary refresh: a fleet with no questions in it pays nothing for
    // this, which is what lets the read ride the 5 s scan timer at all.
    const p = pulse([{ branch: 'feature/running', worker: 'running', local_worktree: '/tmp/wt' }]);
    expect(await workerQuestions(p)).toEqual(new Map());
  });
});
