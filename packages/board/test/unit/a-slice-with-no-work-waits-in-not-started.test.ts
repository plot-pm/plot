import { describe, it, expect } from 'vitest';
import { classify, rowsFromPulse } from '../../src/server/fleet.js';
import type { PrRecord } from '../../src/server/fleet.js';
import type { AgentRow, BranchState, FleetReading, WorkerState } from '../../src/contract/schema.js';

// A SLICE NOBODY WORKED ON READS NOT STARTED.
//
// `blocked`, `waiting` and `unknown` fell to the `wip` tail of `classifyGroup`
// and read *commits, no PR ever opened*. Measured 2026-09-30:
// `bug/every-state-file-declares-its-bound` had no ref anywhere, state
// `blocked`, and sat in WAITING ON YOU as *commits, no PR ever opened, age
// unknown*. And a closed PR sent a row to DONE while its agent was still live:
// `bug/a-state-sweep-is-one-request` opened #1089 from its claim commit, closed
// it 38 s later, and kept working under a DONE heading.

const QUIET = 30;

/**
 * `classify` with the arguments this suite varies spelled by NAME. The list is
 * positional and 21 long; building every call here means an insertion breaks
 * one helper rather than every case.
 */
const classifyBranch = (over: {
  state: BranchState;
  worker?: WorkerState;
  waitsOn?: readonly string[];
  ageMinutes?: number | null;
  localAhead?: number;
}) => classify(
  over.state, 'eligible', over.ageMinutes === undefined ? null : over.ageMinutes, QUIET, null,
  false, over.localAhead ?? 0, 'approved',
  over.worker ?? 'none', '', over.worker === 'running' ? '4242' : '', false,
  [], '', false, '', false, '', false, false,
  over.waitsOn ?? [],
);

describe('a branch no worker holds waits in NOT STARTED, with its own sentence', () => {
  for (const worker of ['none', 'elsewhere'] as const) {
    it(`blocked, worker ${worker}: names the prerequisite and its missing PR`, () => {
      const r = classifyBranch({ state: 'blocked', worker, waitsOn: ['bug/zero-ahead-is-not-merged'] });
      expect(r.group).toBe('not-started');
      expect(r.note).toBe('waits for bug/zero-ahead-is-not-merged, which has no pull request');
    });

    it(`waiting, worker ${worker}: names the prerequisite`, () => {
      const r = classifyBranch({ state: 'waiting', worker, waitsOn: ['feature/first'] });
      expect(r.group).toBe('not-started');
      expect(r.note).toBe('waits for feature/first');
    });

    it(`unknown, worker ${worker}: says the host's answer is incomplete`, () => {
      const r = classifyBranch({ state: 'unknown', worker });
      expect(r.group).toBe('not-started');
      expect(r.note).toBe("state unknown — the host's answer is incomplete");
    });
  }

  it('never reads any of the three as abandoned', () => {
    for (const state of ['blocked', 'waiting', 'unknown'] as const) {
      for (const ageMinutes of [null, 5, 5000]) {
        const r = classifyBranch({ state, waitsOn: ['feature/first'], ageMinutes });
        expect(r.note, `${state} at age ${ageMinutes}`).not.toContain('no PR ever opened');
        expect(r.group, `${state} at age ${ageMinutes}`).toBe('not-started');
      }
    }
  });

  it('states an empty waits_on as an unnamed prerequisite rather than a blank', () => {
    expect(classifyBranch({ state: 'waiting' }).note).toBe('waits for an unnamed prerequisite');
  });

  it('names every declared prerequisite, not only those still holding the slice', () => {
    // THE PULSE CARRIES NO PER-PREREQUISITE VERDICT, only the plan's
    // declaration — so the sentence names every `waits:` branch the plan
    // declares, whether or not it is the one still blocking.
    const two = classifyBranch({ state: 'waiting', waitsOn: ['bug/a', 'bug/b'] });
    expect(two.note).toBe('waits for bug/a and bug/b');

    const three = classifyBranch({ state: 'waiting', waitsOn: ['bug/a', 'bug/b', 'bug/c'] });
    expect(three.note).toBe('waits for bug/a, bug/b and bug/c');
  });

  it('blocked with several prerequisites: "one of which" rather than "which"', () => {
    // WITH ONE PREREQUISITE "which has no pull request" NAMES IT UNAMBIGUOUSLY.
    // With several, only one of them may be the typo, so the sentence says so
    // rather than accusing the whole list.
    const r = classifyBranch({ state: 'blocked', waitsOn: ['bug/a', 'bug/b'] });
    expect(r.note).toBe('waits for bug/a and bug/b, one of which has no pull request');
  });
});

describe('a live agent outranks the branch state', () => {
  // The arms sit AFTER the worker block. Placed before it, a running agent on a
  // `waiting` branch would read NOT STARTED — this is the assertion that sees it.
  for (const state of ['blocked', 'waiting', 'unknown'] as const) {
    it(`${state} with a running worker reads WORKING`, () => {
      expect(classifyBranch({ state, worker: 'running', waitsOn: ['feature/first'] }).group).toBe('working');
    });
  }
});

describe('the wip tail still answers for wip', () => {
  it('a wip branch with commits, no PR and no worker still reads abandoned', () => {
    // The control: a tail guard that swallowed `wip` itself would pass every
    // assertion above.
    const r = classifyBranch({ state: 'wip', ageMinutes: 5000 });
    expect(r.group).toBe('waiting-on-you');
    expect(r.note).toContain('no PR ever opened');
  });
});

describe('a state the classifier does not recognise', () => {
  it('returns NOT STARTED naming the word, never the wip tail', () => {
    const r = classifyBranch({ state: 'rebasing' as BranchState, ageMinutes: 5000 });
    expect(r.group).toBe('not-started');
    expect(r.note).toBe('state rebasing not recognised');
  });
});

describe('a closed PR yields to a live agent', () => {
  const BRANCH = 'bug/a-state-sweep-is-one-request';

  const pulseWith = (worker: WorkerState): FleetReading => ({
    generated: new Date().toISOString(),
    root: '/repo',
    main: 'main',
    head: 'abc1234',
    plans: [{
      file: '2026-09-30-a-state-sweep-is-one-request.md',
      phase: 'approved',
      slices: [{
        name: 'Swept',
        verdict: 'eligible',
        branches: [{
          branch: BRANCH, state: 'wip', deferred: false, claimed: '',
          worker, worker_pid: worker === 'running' ? '4242' : '', worker_exit: '',
        }],
      }],
    }],
    summary: { plans: 1, waves: 1, branches: 1, claimed: 1, eligible: 0, blocked: 0, deferred: 0 },
  } as never);

  const closedPr = {
    number: 1089, url: '', head: BRANCH, state: 'CLOSED', draft: false, checks: 'none',
    mergeable: 'mergeable', failing_checks: [],
  } as unknown as PrRecord;

  const rowFor = (worker: WorkerState): AgentRow => {
    const row = rowsFromPulse(
      pulseWith(worker), new Map([[BRANCH, 40]]), 'plot', QUIET, new Map(), '', null, Date.now(),
      null, null, null, null, new Map([[BRANCH, closedPr]]),
    ).find((r) => r.branch === BRANCH);
    if (!row) throw new Error(`no row built for ${BRANCH}`);
    return row;
  };

  for (const worker of ['running', 'waiting'] as const) {
    it(`worker ${worker}: stays in its open group with no closed-pr kind`, () => {
      const row = rowFor(worker);
      expect(row.group).toBe('working');
      expect(row.quietKind ?? null).not.toBe('closed-pr');
      expect(row.note).toContain('PR closed without merging');
    });
  }

  for (const worker of ['none', 'elsewhere', 'finished'] as const) {
    it(`worker ${worker}: stays in DONE as before`, () => {
      // The second half: a change that dropped closed PRs out of DONE
      // altogether would pass the two cases above.
      const row = rowFor(worker);
      expect(row.group).toBe('done');
      expect(row.quietKind).toBe('closed-pr');
    });
  }
});

describe('a waiting or blocked branch reads as unbegun on its row', () => {
  // `waiting` and `blocked` reach NOT STARTED through `classifyGroup`, and three
  // predicates read only `open` as unbegun. Measured 2026-10-05 on
  // `fleet-agents-run-through-the-agent-sdk`: every slice row carried
  // `state: waiting` and rendered with no status word and no age.
  const PLAN = '2026-10-01-a-plan-with-waits.md';
  const DAY = 86_400_000;
  const NOW = Date.parse('2026-10-06T12:00:00Z');

  const pulseWith = (state: BranchState): FleetReading => ({
    generated: new Date(NOW).toISOString(),
    root: '/repo',
    main: 'main',
    head: 'abc1234',
    plans: [{
      file: PLAN,
      phase: 'approved',
      slices: [
        {
          name: 'First',
          verdict: 'eligible',
          branches: [{
            branch: 'feature/first', state: 'open', deferred: false, claimed: '',
            worker: 'none', worker_pid: '', worker_exit: '',
          }],
        },
        {
          name: 'Second',
          verdict: 'blocked',
          branches: [{
            branch: 'feature/second', state, deferred: false, claimed: '',
            worker: 'none', worker_pid: '', worker_exit: '', waits_on: ['feature/first'],
          }],
        },
      ],
    }],
    summary: { plans: 1, waves: 2, branches: 2, claimed: 0, eligible: 1, blocked: 1, deferred: 0 },
  } as never);

  const secondRow = (state: BranchState): AgentRow => {
    const row = rowsFromPulse(
      pulseWith(state), new Map(), 'plot', QUIET, new Map(), '',
      new Map([[PLAN, NOW - 4 * DAY]]), NOW,
    ).find((r) => r.branch === 'feature/second');
    if (!row) throw new Error('no row built for feature/second');
    return row;
  };

  for (const state of ['waiting', 'blocked'] as const) {
    it(`${state}: carries the plan clock, waits on time, and names its blocker`, () => {
      const row = secondRow(state);
      expect(row.group).toBe('not-started');
      expect(row.unbegun).toBe(true);
      expect(row.waitingDays).toBe(4);
      expect(row.waitingOn).toBe('time');
      expect(row.blockedBy).toBe('First');
    });

    it(`${state}: keeps the note that names the prerequisite`, () => {
      expect(secondRow(state).note).toContain('waits for feature/first');
    });
  }

  it('open: is unbegun with the slice note, as before', () => {
    const row = secondRow('open');
    expect(row.unbegun).toBe(true);
    expect(row.waitingDays).toBe(4);
    expect(row.waitingOn).toBe('time');
    expect(row.note).not.toContain('waits for');
  });

  it('unknown: is not unbegun, because the host could not say the branch is empty', () => {
    const row = secondRow('unknown');
    expect(row.unbegun).toBe(false);
    expect(row.waitingDays).toBeNull();
    expect(row.waitingOn).toBeNull();
  });
});
