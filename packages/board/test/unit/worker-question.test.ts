import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  firstMarkerLine,
  markerIn,
  waitingWorktrees,
  workerQuestions,
  QUESTION_MAX,
} from '../../src/server/worker-question.js';
import type { FleetPulse, WorkerState } from '../../src/contract/schema.js';

// WHAT A WAITING AGENT IS WAITING ON — read from the marker FILE the worker
// wrote, not grepped from the contents of every file in the tree.
//
// The scan has already decided the worker is `waiting`; this module only ever
// annotates that verdict. So every failure mode points the same way: an
// unreadable marker must produce "" and let the row say *reason unavailable*.
// A module that returned a plausible-looking line on failure would pass the
// happy-path assertions below while sending readers to answer questions nobody
// asked. The old contents grep did worse than that — it manufactured a question
// out of a document that merely mentioned the marker — and reading the file by
// name is what makes that impossible.

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-worker-question-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/**
 * A worktree directory holding the given files. No git init is needed: the
 * marker is now a FILE the reader finds by name, not a string the reader greps
 * out of the tree, so there is nothing for git to track. `files` maps a
 * relative path to its contents; parent directories are created as needed.
 */
function treeWith(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(tmp, 'wt-'));
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
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

describe('markerIn — reading the marker file, and failing to', () => {
  it('reads a PLOT-BLOCKED file at the worktree root', async () => {
    // THE LIVE CASE: a blocked worker wrote a PLOT-BLOCKED.md and stopped. The
    // file's first line is the question, and it needs no git — the worker may
    // not have committed anything.
    const wt = treeWith({ 'PLOT-BLOCKED.md': 'PLOT-BLOCKED: which adapter?\n' });
    expect(await markerIn(wt)).toBe('PLOT-BLOCKED: which adapter?');
  });

  it('accepts any PLOT-BLOCKED* name, not one fixed filename', async () => {
    // The `Worker command` says "write PLOT-BLOCKED: into a file" without naming
    // it; workers have been observed writing `PLOT-BLOCKED.md`. A prefix match
    // accepts what they produce.
    const wt = treeWith({ 'PLOT-BLOCKED.txt': 'PLOT-BLOCKED: which adapter?\n' });
    expect(await markerIn(wt)).toBe('PLOT-BLOCKED: which adapter?');
  });

  it('strips the comment syntax a marker file was written with', async () => {
    // A worker that wrote its marker into a source-shaped file still gets the
    // question, not the punctuation — firstMarkerLine's job, reached through
    // the file read.
    const wt = treeWith({ 'PLOT-BLOCKED': '// PLOT-BLOCKED: which retry semantics?\n' });
    expect(await markerIn(wt)).toBe('PLOT-BLOCKED: which retry semantics?');
  });

  it('does NOT read the marker out of a file that merely mentions it', async () => {
    // THE DEFECT THIS CHANGE REMOVES. A doc, a brief, a test fixture that
    // contains the string `PLOT-BLOCKED:` is not a question — and grepping
    // contents surfaced exactly such a mention as a worker's question. A file
    // read by name cannot: `NOTES.md` is not a `PLOT-BLOCKED*` file.
    const wt = treeWith({ 'NOTES.md': 'we write PLOT-BLOCKED: to signal a stop\n' });
    expect(await markerIn(wt)).toBe('');
  });

  it('ignores the worker LOG — it is not a PLOT-BLOCKED* file', async () => {
    // The log is guaranteed to hold the marker token whenever the worker
    // reported writing one, so a hit there is the REPORT of a question rather
    // than an outstanding one. The old grep had to exclude it by name; a prefix
    // match on `PLOT-BLOCKED*` never sees `.plot-worker.log` at all.
    const wt = treeWith({ '.plot-worker.log': 'I wrote a PLOT-BLOCKED: marker asking about retries\n' });
    expect(await markerIn(wt)).toBe('');
  });

  it('does NOT descend into subdirectories — root only', async () => {
    // Every observed marker sits at the root, and matching at depth would
    // re-admit the looseness this change removes. A marker in a subdir is not
    // found, mirroring `plot_worker_blocked`.
    const wt = treeWith({ 'src/PLOT-BLOCKED.md': 'PLOT-BLOCKED: buried\n' });
    expect(await markerIn(wt)).toBe('');
  });

  it('returns "" for a tree with no marker file', async () => {
    expect(await markerIn(treeWith({ 'src/a.ts': 'ok\n' }))).toBe('');
  });

  it('returns "" for a worktree that has gone — and does not reject', async () => {
    // This runs inside the scan refresh, whose other work cannot be lost to one
    // unreadable worktree. A `readdir` on a missing directory throws; markerIn
    // must resolve "", never reject.
    await expect(markerIn(path.join(tmp, 'never-existed'))).resolves.toBe('');
  });

  it('treats an empty marker file as a stated unknown', async () => {
    // A PLOT-BLOCKED file with nothing readable in it is the marker present but
    // the question unreadable — "", which the row renders as *reason
    // unavailable* rather than as a blank question.
    const wt = treeWith({ 'PLOT-BLOCKED.md': '\n  \n' });
    expect(await markerIn(wt)).toBe('');
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
    const wt = treeWith({ 'PLOT-BLOCKED.md': 'PLOT-BLOCKED: which adapter?\n' });
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
