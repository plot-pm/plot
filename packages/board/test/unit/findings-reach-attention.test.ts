// The monitors' findings travel to the row and become attention entries.
//
// DRIVEN THROUGH `rowsFromPulse` AND REAL FILES, not from hand-built rows. The
// claim this slice makes is that a finding a monitor WROTE reaches a caller of
// `/api/attention`, and a hand-built `AgentRow` would assert the middle of that
// journey while skipping both ends. So every test below writes the NDJSON line
// the monitor scripts write, into a worktree the pulse names, and reads the
// entry out the far side.
//
// THE FOUR CLAIMS ARE THE PLAN'S `Done when`, one test each:
//
//   1. an `owes a review` branch appears on the attention surface
//   2. the entry names the branch and what to do
//   3. it clears when the PR is opened
//   4. a WorkerMonitor `idle` is distinguishable from an AgentMonitor finding
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findingItems, readingFor } from '../../src/server/attention.js';
import { rowsFromPulse } from '../../src/server/fleet.js';
import {
  AttentionItemSchema,
  type AgentRow,
  type Finding,
  type FleetPulse,
} from '../../src/contract/schema.js';

const QUIET = 30;

/** One desk per branch, so a test can write a monitor's log into it. */
let root = '';
const deskOf = (branch: string): string =>
  path.join(root, branch.replace(/\//g, '-'));

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-findings-'));
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/**
 * Write one finding into a desk's monitor log, exactly as the monitor scripts
 * do: one JSON object per line, appended.
 *
 * `plot-agent-monitor.sh:186` composes this line; the fields here are its
 * seven, in its order. A test that built the object differently would prove the
 * board can read a shape nothing writes.
 */
const publish = (branch: string, over: Partial<Finding> = {}): void => {
  const desk = deskOf(branch);
  fs.mkdirSync(desk, { recursive: true });
  const finding: Finding = {
    monitor: 'AgentMonitor',
    branch,
    worktree: desk,
    finding: 'owes a review',
    since: '2026-08-31T10:00:00Z',
    evidence:
      'the branch carries commits, the tree is clean and no PR exists; finished work is invisible',
    measuredAt: '2026-08-31T10:05:00Z',
    ...over,
  };
  const log =
    finding.monitor === 'WorkerMonitor'
      ? '.plot-worker.monitor.worker.jsonl'
      : finding.monitor === 'BuildMonitor'
        ? '.plot-worker.monitor.build.jsonl'
        : '.plot-worker.monitor.agent.jsonl';
  fs.appendFileSync(path.join(desk, log), `${JSON.stringify(finding)}\n`);
};

/** A pulse of claimed branches under an approved plan, each with its own desk. */
const pulseOf = (branches: string[]): FleetPulse =>
  ({
    main: 'main',
    head: 'abc1234',
    plans: [
      {
        file: '2026-08-30-two-monitors-watch-the-agent.md',
        phase: 'approved',
        slices: [
          {
            name: 'Attention',
            verdict: 'eligible',
            branches: branches.map((branch) => ({
              branch,
              state: 'claimed',
              deferred: false,
              claimed: '',
              worker: 'finished',
              worker_exit: '0',
              local_worktree: deskOf(branch),
            })),
          },
        ],
      },
    ],
    summary: {
      plans: 1,
      waves: 1,
      branches: branches.length,
      claimed: branches.length,
      eligible: 0,
      blocked: 0,
      deferred: 0,
    },
  }) as never;

const rowFor = (branch: string, branches = [branch]): AgentRow => {
  const pulse = pulseOf(branches);
  const ages = new Map<string, number | null>(branches.map((b) => [b, 1]));
  const rows = rowsFromPulse(pulse, ages, 'plot', QUIET);
  const row = rows.find((r) => r.branch === branch);
  if (!row) throw new Error(`no row for ${branch}`);
  return row;
};

describe('a finding reaches the row', () => {
  it('carries what the monitor published, verbatim', () => {
    const branch = 'feature/reaches-the-row';
    publish(branch);

    const row = rowFor(branch);

    expect(row.findings).toHaveLength(1);
    expect(row.findings[0]).toMatchObject({
      monitor: 'AgentMonitor',
      branch,
      finding: 'owes a review',
      since: '2026-08-31T10:00:00Z',
    });
  });

  // A BRANCH WITH NO DESK HAS NO MONITOR, and [] says *nothing was looked for*
  // rather than *nothing is wrong*. The absent-is-not-false rule the row's
  // other worktree-derived fields already follow.
  it('answers [] where no monitor ever wrote', () => {
    expect(rowFor('feature/never-watched').findings).toEqual([]);
  });

  // A worktree can be switched to another branch while its logs stay. Without
  // the branch test a leftover log would attribute one branch's debts to
  // another.
  it('ignores a log naming a different branch', () => {
    const branch = 'feature/switched-desk';
    publish(branch, { branch: 'feature/somebody-else' });

    expect(rowFor(branch).findings).toEqual([]);
  });
});

describe('an `owes a review` branch appears on the attention surface', () => {
  const branch = 'feature/owes-a-review';
  publish(branch);

  const items = findingItems(rowFor(branch));

  // DONE-WHEN 1. Before this, the row read `worker: finished` with no PR —
  // indistinguishable from a branch nobody had started, which is exactly how
  // finished work sat invisible twice in one session.
  it('produces one entry, on the agent\'s list', () => {
    expect(items).toHaveLength(1);
    expect(items[0].list).toBe('needsAgent');
    expect(items[0].item.verdict).toBe('owes-review');
  });

  // DONE-WHEN 2.
  it('names the branch and what to do', () => {
    expect(items[0].item.branch).toBe(branch);
    expect(items[0].item.action).toBe('open a PR for it');
  });

  // The audit rule this endpoint rests on, unchanged: the verdict names the
  // measurement it came from — here the monitor's, not a row field's.
  it('carries the monitor\'s own evidence', () => {
    expect(items[0].item.evidence).toContain('no PR exists');
  });

  it('is a valid attention item', () => {
    expect(AttentionItemSchema.parse(items[0].item)).toBeTruthy();
  });
});

// DONE-WHEN 3. Nothing marks the entry done: the AgentMonitor publishes
// `clear`, the domain drops the finding it retracts, and the entry disappears
// by not being derived again.
describe('it clears when the PR is opened', () => {
  it('stops producing the entry once the monitor retracts it', () => {
    const branch = 'feature/pr-arrives';
    publish(branch);
    expect(findingItems(rowFor(branch))).toHaveLength(1);

    publish(branch, {
      finding: 'clear',
      evidence: 'the owes a review finding no longer holds; this desk owes nothing measurable',
      since: '2026-08-31T10:10:00Z',
    });

    expect(rowFor(branch).findings).toEqual([]);
    expect(findingItems(rowFor(branch))).toEqual([]);
  });
});

// DONE-WHEN 4. A WorkerMonitor `idle` is a process to look at; an AgentMonitor
// finding is a debt to discharge. An entry that flattened them would make the
// reader re-derive which monitor spoke.
describe('a WorkerMonitor finding is distinguishable from an AgentMonitor one', () => {
  const branch = 'feature/both-monitors';
  publish(branch, {
    monitor: 'WorkerMonitor',
    finding: 'idle',
    evidence: 'two consecutive idle samples over an unchanged tree',
  });
  publish(branch, { finding: 'owes a review' });

  const items = findingItems(rowFor(branch));

  it('produces one entry per monitor, neither replacing the other', () => {
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.item.monitor).sort()).toEqual(['AgentMonitor', 'WorkerMonitor']);
  });

  it('names the monitor in the entry itself', () => {
    const idle = items.find((i) => i.item.monitor === 'WorkerMonitor');
    const owes = items.find((i) => i.item.monitor === 'AgentMonitor');

    expect(idle?.item.subject).toBe('the process');
    expect(owes?.item.subject).toBe('the desk');
  });

  it('gives them different verdicts and different moves', () => {
    const verdicts = items.map((i) => i.item.verdict);
    const actions = items.map((i) => i.item.action);

    expect(new Set(verdicts).size).toBe(2);
    expect(new Set(actions).size).toBe(2);
  });
});

describe('the scan\'s own verdicts are unchanged by any of this', () => {
  // A finding is ADDITIVE. The scan's reading of the same row is untouched, and
  // an entry read off a row names no monitor — naming one would claim a reading
  // nobody took.
  it('leaves a row-derived verdict naming no monitor', () => {
    const branch = 'feature/scan-still-answers';
    publish(branch, { monitor: 'WorkerMonitor', finding: 'gone', evidence: 'pid 4242 is gone' });

    const row = rowFor(branch);

    // `worker: finished` in the fixture — the scan's own answer, unmoved.
    expect(readingFor(row)?.verdict).toBe('review');
    expect(findingItems(row)[0].item.verdict).toBe('gone');
  });
});

describe('a log the board cannot trust', () => {
  // A board that died on one malformed line would be a board any stray write
  // could take down — the tolerance `decode` already applies to the socket.
  it('skips a line that is not a finding and keeps the ones that are', () => {
    const branch = 'feature/messy-log';
    const desk = deskOf(branch);
    fs.mkdirSync(desk, { recursive: true });
    const log = path.join(desk, '.plot-worker.monitor.agent.jsonl');
    fs.appendFileSync(log, 'not json at all\n');
    fs.appendFileSync(log, '{"monitor":"AgentMonitor"}\n');
    fs.appendFileSync(log, '\n');
    publish(branch);
    // A truncated tail — the ordinary case, since a monitor appends while the
    // board reads.
    fs.appendFileSync(log, '{"monitor":"Agent');

    expect(rowFor(branch).findings.map((f) => f.finding)).toEqual(['owes a review']);
  });
});
