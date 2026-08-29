import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readTail,
  worktreeForBranch,
  TAIL_BYTES,
  WORKER_LOG_NAME,
} from '../../src/server/worker-log.js';
import {
  missWord,
  sizeLabel,
  EMPTY_LOG_WORD,
} from '../../src/app/components/WorkerLogModal.js';
import { showsWorkerLog } from '../../src/app/components/AgentList.js';
import { AgentRowSchema, type AgentRow, type FleetPulse } from '../../src/contract/schema.js';

// THE PATH IS DERIVED, NEVER SUPPLIED — and most of these tests are refusals
// aimed at an implementation that reads the log correctly and reaches the wrong
// file to do it.
//
// A board endpoint that joined a request string onto a directory would pass
// every "the log comes back" assertion below while being a file-read primitive
// pointed at the whole filesystem. So the positive cases are few and the
// traversal cases are many: each one sends a branch name that IS a path and
// asserts that nothing on disk was touched.

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-worker-log-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A pulse holding exactly the branches given, each with its worktree or "". */
function pulse(branches: { branch: string; local_worktree: string }[]): FleetPulse {
  return {
    main: 'main',
    read_ref: 'abc123',
    local_head: 'abc123',
    head: 'abc123',
    fetch_failed: false,
    fetch_error: '',
    plan_source: 'ref',
    plans: [
      {
        file: '2026-08-17-a-plan.md',
        phase: 'approved',
        slices: [
          {
            name: 'Log',
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
              worker: 'running' as const,
              worker_pid: '4242',
              worker_exit: '',
            })),
          },
        ],
      },
    ],
    summary: { plans: 1, waves: 1, branches: branches.length },
  } as unknown as FleetPulse;
}

describe('worktreeForBranch — a lookup, which is why there is no traversal', () => {
  it('resolves a branch the pulse reported a worktree for', () => {
    const p = pulse([{ branch: 'feature/x', local_worktree: '/tmp/wt-x' }]);
    expect(worktreeForBranch(p, 'feature/x')).toBe('/tmp/wt-x');
  });

  it('returns null for a branch the pulse does not mention', () => {
    const p = pulse([{ branch: 'feature/x', local_worktree: '/tmp/wt-x' }]);
    expect(worktreeForBranch(p, 'feature/y')).toBeNull();
  });

  // A branch with no LOCAL worktree — every detached worker, every teammate's
  // laptop. `""` is the pulse's own "not here", and treating it as a directory
  // would join the log name onto nothing and read `.plot-worker.log` relative
  // to the server's CWD.
  it('returns null where the branch is known but has no local worktree', () => {
    const p = pulse([{ branch: 'feature/x', local_worktree: '' }]);
    expect(worktreeForBranch(p, 'feature/x')).toBeNull();
  });

  // THE CASE THAT DECIDES THE DESIGN. Every one of these is a legal string to
  // send and none of them is a branch the pulse named, so each resolves to null
  // — not because it was screened, but because a lookup has nothing to match.
  // An implementation validating with a regex instead would have to get the
  // regex exactly right; this one cannot be got wrong.
  it.each([
    '../../../../etc/passwd',
    '/etc/passwd',
    'feature/x/../../../../etc',
    '..',
    'feature/x\0.txt',
    './feature/x',
  ])('refuses %j — it names no branch, so it resolves to no path', (evil) => {
    const p = pulse([{ branch: 'feature/x', local_worktree: '/tmp/wt-x' }]);
    expect(worktreeForBranch(p, evil)).toBeNull();
  });

  // A COLD CACHE IS NOT AN EMPTY MACHINE. No pulse has landed, so nothing is
  // known — and "no worktree is KNOWN" is the honest answer the caller turns
  // into `no-worktree`.
  it('returns null on a cold cache rather than guessing', () => {
    expect(worktreeForBranch(null, 'feature/x')).toBeNull();
  });
});

describe('readTail — bounded, and honest about the bound', () => {
  const withFile = (contents: string | Buffer, fn: (fd: number, size: number) => void) => {
    const p = path.join(tmp, 'log');
    fs.writeFileSync(p, contents);
    const fd = fs.openSync(p, 'r');
    try {
      fn(fd, fs.fstatSync(fd).size);
    } finally {
      fs.closeSync(fd);
    }
  };

  it('returns a short log whole, and says it did not truncate', () => {
    withFile('line one\nline two\n', (fd, size) => {
      const { text, truncated } = readTail(fd, size);
      expect(text).toBe('line one\nline two\n');
      expect(truncated).toBe(false);
    });
  });

  // AN EMPTY LOG READS AS EMPTY, not as missing. The three-way distinction the
  // whole endpoint exists for starts here: this is a successful read of zero
  // bytes.
  it('reads an empty log as empty text, untruncated', () => {
    withFile('', (fd, size) => {
      expect(readTail(fd, size)).toEqual({ text: '', truncated: false });
    });
  });

  it('returns only the tail of a log past the bound, and says so', () => {
    // Distinctive first and last lines, so the assertion is about WHICH end
    // came back rather than merely about the length.
    const body = `FIRST\n${'x'.repeat(TAIL_BYTES * 2)}\nLAST\n`;
    withFile(body, (fd, size) => {
      const { text, truncated } = readTail(fd, size);
      expect(truncated).toBe(true);
      expect(text.length).toBeLessThanOrEqual(TAIL_BYTES);
      expect(text).toContain('LAST');
      expect(text).not.toContain('FIRST');
    });
  });

  // THE BOUND IS ON THE READ. A tail taken by loading the file and slicing
  // would pass every assertion above; this one asserts the file is never read
  // whole, by making a whole read enormous and the tail tiny.
  it('costs the bound rather than the file — a 4 MB log returns at most TAIL_BYTES', () => {
    const big = Buffer.alloc(4 * 1024 * 1024, 0x61); // 'a' × 4 MB, no newlines
    withFile(Buffer.concat([big, Buffer.from('\nTAIL\n')]), (fd, size) => {
      const { text, truncated } = readTail(fd, size);
      expect(truncated).toBe(true);
      expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(TAIL_BYTES);
      expect(text).toBe('TAIL\n');
    });
  });

  // A mid-file seek lands mid-line. Returning the fragment would print half a
  // sentence as if it were a whole one, so it is dropped — and `truncated`
  // is what keeps the drop from being silent.
  it('drops the partial first line of a truncated tail', () => {
    const body = `${'z'.repeat(TAIL_BYTES)}PARTIAL\ncomplete line\n`;
    withFile(body, (fd, size) => {
      const { text } = readTail(fd, size);
      expect(text).not.toContain('PARTIAL');
      expect(text).toContain('complete line');
    });
  });

  // One enormous line with no newline anywhere in the tail: nothing complete
  // was captured, and "" says that. Returning the fragment would be worse —
  // a mid-UTF-8 cut renders as replacement glyphs.
  it('returns nothing rather than a fragment when the tail holds no newline', () => {
    withFile('q'.repeat(TAIL_BYTES * 2), (fd, size) => {
      expect(readTail(fd, size).text).toBe('');
    });
  });
});

// THE POINT OF THE WAVE, asserted rather than intended.
//
// The plan's argument for serving on demand is that a 4 s pulse carrying every
// agent's console output is a different product. That argument is only kept by
// the payload staying as it was — so this asserts the contract itself, not a
// sample of it.
describe('the pulse payload is unchanged', () => {
  it('adds no field to the agent row contract', () => {
    const keys = Object.keys(AgentRowSchema.shape);
    // Named individually rather than counted: a count passes when one field is
    // swapped for another, which is the drift this guards against.
    expect(keys).not.toContain('log');
    expect(keys).not.toContain('workerLog');
    expect(keys).not.toContain('logPath');
    expect(keys).not.toContain('worktree');
  });

  // The row carries no worktree and no log, which is WHY the endpoint resolves
  // the branch itself. If a later change adds either, the log's path could be
  // taken from the row — and from there from a request — so this failing is the
  // signal to re-read the security argument rather than to update the list
  // above.
  //
  // A FULLY POPULATED row, not a minimal one: defaults are where a new field
  // arrives silently, and a fixture that omitted them would keep passing while
  // the payload grew.
  it('carries neither the log nor the worktree that would locate it', () => {
    const row = AgentRowSchema.parse({
      repo: 'plot', branch: 'feature/x', plan: 'p', wave: 'w',
      state: 'wip', group: 'working', ageMinutes: 1, note: '', pr: null,
    });
    const wire = JSON.stringify(row);
    expect(wire).not.toContain(WORKER_LOG_NAME);
    // No absolute path anywhere in a row — the one shape a worktree would take.
    expect(wire).not.toMatch(/"[^"]*\/(Users|home|tmp|var)\//);
  });
});

// THE ROW OFFERS; THE SERVER ANSWERS. These pin the split down, because it is
// the part most likely to be "improved" into a bug: making the button
// conditional on activity would hide the log on exactly the quiet claimed rows
// a reader opens one to understand.
describe('showsWorkerLog — WORKING membership, and nothing else', () => {
  const row = (over: Partial<AgentRow> = {}): AgentRow =>
    AgentRowSchema.parse({
      repo: 'plot', branch: 'feature/x', plan: 'p', wave: 'w',
      state: 'wip', group: 'working', ageMinutes: 1, note: '', pr: null,
      ...over,
    });

  it('offers the log on a WORKING row', () => {
    expect(showsWorkerLog(row())).toBe(true);
  });

  // WORKING lists AGENTS; every other section lists results or processes, and
  // those have no console output to read.
  it.each(['waiting-on-you', 'waiting-on-machine', 'quiet', 'not-started'] as const)(
    'offers nothing on a %s row',
    (group) => {
      expect(showsWorkerLog(row({ group }))).toBe(false);
    },
  );

  // A CLAIMED BUT SILENT ROW STILL OFFERS IT — the case an activity-keyed
  // predicate would get wrong, and the case that most needs a log: nothing has
  // been written, nothing is dirty, and the reader's question is *what is it
  // doing*.
  it('offers the log on a WORKING row showing no local activity at all', () => {
    expect(showsWorkerLog(row({ localDirty: false, localLocked: false, localAhead: 0 }))).toBe(true);
  });
});

describe('the panel tells the three misses apart', () => {
  // The server's distinction is worth nothing if the client renders all three
  // as one blank box — so: three reasons, three different sentences, and the
  // empty log different again from all of them.
  it('gives every outcome its own words', () => {
    const said = [
      missWord('no-worktree'),
      missWord('no-log'),
      missWord('unreadable'),
      EMPTY_LOG_WORD,
    ];
    expect(new Set(said).size).toBe(4);
    for (const s of said) expect(s.length).toBeGreaterThan(0);
  });

  // Each sentence must say what to DO. "No log" alone sends a reader nowhere;
  // "the worktree is here, look in it" sends them somewhere.
  it('names the worktree in the no-log answer and the other machine in no-worktree', () => {
    expect(missWord('no-log')).toMatch(/worktree/i);
    expect(missWord('no-worktree')).toMatch(/machine/i);
  });
});

describe('sizeLabel — the truncation notice can name what is missing', () => {
  it.each([
    [512, '512 B'],
    [2048, '2 KB'],
    [5 * 1024 * 1024, '5.0 MB'],
  ])('renders %i as %s', (bytes, want) => {
    expect(sizeLabel(bytes)).toBe(want);
  });
});
