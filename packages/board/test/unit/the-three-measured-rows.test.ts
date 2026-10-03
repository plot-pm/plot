import { describe, it, expect } from 'vitest';
import { branchState, type BranchReadings } from '@plot-pm/domain';
import { rowsFromPulse } from '../../src/server/fleet.js';
import type { PrRecord } from '../../src/server/fleet.js';
import type { BranchState, FleetReading, WorkerState } from '../../src/contract/schema.js';

// THE THREE ROWS MEASURED 2026-09-30, rebuilt as fixtures. Each state is
// derived by the domain rule from the readings the row had, then placed by
// `rowsFromPulse`.

const QUIET = 30;

const TEMP_ROOT = 'bug/the-suites-own-their-temp-root';
const DECLARES_BOUND = 'bug/every-state-file-declares-its-bound';
const STATE_SWEEP = 'bug/a-state-sweep-is-one-request';

const readings = (over: Partial<BranchReadings>): BranchReadings => ({
  deferredByPlan: false,
  refTip: null,
  mainTip: 'main999',
  mergeSubjectFound: false,
  hostReach: 'ok',
  pr: 'none',
  prListComplete: false,
  commitsAhead: 0,
  realCommitsAhead: 0,
  waits: [],
  ...over,
});

// A ref pushed at an older tip of main, no commit of its own, `pr-state` NONE,
// and a PR list cut at its limit — this repository's list is never complete.
const tempRoot = branchState(readings({ refTip: 'old111' }));
// No ref anywhere; its prerequisite has no pull request.
const declaresBound = branchState(
  readings({ waits: [{ branch: 'bug/a-missing-prerequisite', pr: 'none' }] }),
);
// Two file-touching commits beyond main and a PR it closed itself.
const stateSweep = branchState(
  readings({ refTip: 'sweep222', commitsAhead: 3, realCommitsAhead: 2, pr: 'CLOSED' }),
);

const branch = (
  name: string,
  state: BranchState,
  worker: WorkerState,
  waitsOn: readonly string[] = [],
) => ({
  branch: name, state, deferred: false, claimed: '', waits_on: waitsOn,
  worker, worker_pid: worker === 'running' ? '4242' : '', worker_exit: '',
});

const pulse = (): FleetReading => ({
  generated: new Date().toISOString(),
  root: '/repo',
  main: 'main',
  head: 'abc1234',
  plans: [
    {
      file: '2026-09-30-the-suites-own-their-temp-root.md',
      phase: 'approved',
      slices: [{ name: 'Owned', verdict: 'eligible', branches: [branch(TEMP_ROOT, tempRoot, 'none')] }],
    },
    {
      file: '2026-09-30-every-state-file-declares-its-bound.md',
      phase: 'approved',
      slices: [{
        name: 'Declared',
        verdict: 'eligible',
        branches: [branch(DECLARES_BOUND, declaresBound, 'none', ['bug/a-missing-prerequisite'])],
      }],
    },
    {
      file: '2026-09-30-a-state-sweep-is-one-request.md',
      phase: 'approved',
      slices: [{ name: 'Swept', verdict: 'eligible', branches: [branch(STATE_SWEEP, stateSweep, 'running')] }],
    },
  ],
  summary: { plans: 3, waves: 3, branches: 3, claimed: 1, eligible: 3, blocked: 0, deferred: 0 },
} as never);

const closedPr = {
  number: 1089, url: '', head: STATE_SWEEP, state: 'CLOSED', draft: false, checks: 'none',
  mergeable: 'mergeable', failing_checks: [],
} as unknown as PrRecord;

const rows = rowsFromPulse(
  pulse(), new Map([[STATE_SWEEP, 40]]), 'plot', QUIET, new Map(), '', null, Date.now(),
  null, null, null, null, new Map([[STATE_SWEEP, closedPr]]),
);

const groupOf = (name: string): string | undefined => rows.find((r) => r.branch === name)?.group;

describe('the three measured rows', () => {
  it('derive the states the readings determine', () => {
    expect([tempRoot, declaresBound, stateSweep]).toEqual(['unknown', 'blocked', 'wip']);
  });

  it('an empty claim behind main lands in NOT STARTED, not DONE', () => {
    expect(groupOf(TEMP_ROOT)).toBe('not-started');
  });

  it('a slice with no branch lands in NOT STARTED, not WAITING ON YOU', () => {
    expect(groupOf(DECLARES_BOUND)).toBe('not-started');
  });

  it('a live agent behind a closed PR lands in WORKING, not DONE', () => {
    expect(groupOf(STATE_SWEEP)).toBe('working');
  });
});
