import { describe, it, expect } from 'vitest';
import { classify, rowsFromPulse } from '../../src/server/fleet.js';
import { approvedSpikeKey, approvedSpikeOf, spikeBranchMerged } from '../../src/server/board.js';
import type { BranchState, FleetReading, PlanMeta, WorkerState } from '../../src/contract/schema.js';

// A DESIGN PLAN'S BRANCHES WAIT ON ITS APPROVAL, EXCEPT THE APPROVED SPIKE.
//
// `docs/plans/2026-10-12-design-work-proves-the-path.md`, *Where a Design
// plan's other branches sit on the board*: `draftPlacement` answers for
// `design`, except the branch `spikeOf` names once the `Spike approved:` record
// exists, which takes the arm of a dispatchable branch.

const QUIET = 30;
const STATES: readonly BranchState[] = ['open', 'claimed', 'wip', 'blocked', 'waiting', 'deferred', 'unknown'];
const AGES: readonly (number | null)[] = [null, 5, 5000];
const WORKERS: readonly WorkerState[] = ['none', 'elsewhere', 'running'];

const place = (state: BranchState, age: number | null, worker: WorkerState, planPhase: string, approvedSpike: boolean) => classify(
  state, 'eligible', age, QUIET, null,
  false, 0, planPhase,
  worker, '', worker === 'running' ? '4242' : '', false,
  [], '', false, '', false, '', false, false,
  [], null, null, null,
  approvedSpike,
);

describe('classify — the approved spike of a Design plan', () => {
  it('places every swept spike row as the same row of an approved plan', () => {
    const differ: string[] = [];
    for (const state of STATES) {
      for (const age of AGES) {
        for (const worker of WORKERS) {
          const spike = place(state, age, worker, 'design', true);
          const approved = place(state, age, worker, 'approved', false);
          if (spike.group !== approved.group || spike.note !== approved.note) {
            differ.push(JSON.stringify({ state, age, worker, spike, approved }));
          }
        }
      }
    }
    expect(differ).toEqual([]);
  });

  it('places an open spike branch in NOT STARTED, not in DONE', () => {
    const r = place('open', null, 'none', 'design', true);
    expect(r.group).toBe('not-started');
    expect(r.note).not.toContain('the board cannot place');
  });

  it('places a non-spike branch of the same plan in WAITING ON YOU', () => {
    const r = place('open', null, 'none', 'design', false);
    expect(r.group).toBe('waiting-on-you');
    expect(r.note).toBe(place('open', null, 'none', 'draft', false).note);
  });

  it('never places a non-spike branch of a Design plan in NOT STARTED', () => {
    const offenders: string[] = [];
    for (const state of STATES) {
      for (const age of AGES) {
        for (const worker of WORKERS) {
          if (place(state, age, worker, 'design', false).group === 'not-started') offenders.push(`${state}/${age}/${worker}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('ignores the flag outside design', () => {
    expect(place('open', null, 'none', 'draft', true)).toEqual(place('open', null, 'none', 'draft', false));
  });
});

const SPIKE = 'feature/the-spike';
const REST = 'feature/the-rest';
const FILE = '2026-10-12-greenhouse.md';

const branch = (name: string) => ({
  branch: name, state: 'open', deferred: false, claimed: '', waits_on: [],
  worker: 'none', worker_pid: '', worker_exit: '',
});

const pulse = (): FleetReading => ({
  generated: new Date().toISOString(),
  root: '/repo',
  main: 'main',
  head: 'abc1234',
  plans: [{
    file: FILE,
    phase: 'design',
    slices: [
      { name: 'The spike', verdict: 'eligible', branches: [branch(SPIKE)] },
      { name: 'The rest', verdict: 'unapproved', branches: [branch(REST)] },
    ],
  }],
  summary: { plans: 1, waves: 2, branches: 2, claimed: 0, eligible: 1, blocked: 0, deferred: 0 },
} as never);

const rowsWith = (approvedSpikes: ReadonlySet<string> | null) => rowsFromPulse(
  pulse(), new Map(), 'plot', QUIET, new Map(), '', null, Date.now(),
  null, null, null, null, null, '', null, null, undefined, null, null, undefined,
  approvedSpikes,
);
const groupOf = (rows: ReturnType<typeof rowsWith>, name: string) => rows.find((r) => r.branch === name)?.group;

describe('rowsFromPulse — a Design plan with an approved spike', () => {
  it('places the approved spike as dispatchable work and the rest as waiting on the approval', () => {
    const rows = rowsWith(new Set([approvedSpikeKey(`docs/plans/${FILE}`, SPIKE)]));
    expect(groupOf(rows, SPIKE)).toBe('not-started');
    expect(groupOf(rows, REST)).toBe('waiting-on-you');
  });

  it('places both branches as waiting on the approval when no spike is approved', () => {
    const rows = rowsWith(null);
    expect(groupOf(rows, SPIKE)).toBe('waiting-on-you');
    expect(groupOf(rows, REST)).toBe('waiting-on-you');
  });
});

const meta = (over: Partial<PlanMeta> = {}) => ({
  file: `/repo/docs/plans/${FILE}`,
  phase: 'design',
  spike_approved_raw: '2026-10-12, jwloka, in-session',
  slices: [
    { name: 'The spike', branches: [{ branch: SPIKE, spike: true }] },
    { name: 'The rest', branches: [{ branch: REST, spike: false }] },
  ],
  ...over,
}) as unknown as PlanMeta;

describe('approvedSpikeOf', () => {
  it('names the spike of a Design plan that records its approval', () => {
    expect(approvedSpikeOf(meta())).toBe(SPIKE);
  });

  it('names nothing before the spike is approved', () => {
    expect(approvedSpikeOf(meta({ spike_approved_raw: '' }))).toBeUndefined();
  });

  it('names nothing outside design', () => {
    expect(approvedSpikeOf(meta({ phase: 'approved' }))).toBeUndefined();
  });
});

describe('spikeBranchMerged', () => {
  const reading = (state: string): FleetReading => ({
    ...pulse(),
    plans: [{ ...pulse().plans[0], slices: [{ name: 'The spike', verdict: 'complete', branches: [{ ...branch(SPIKE), state }] }] }],
  } as never);

  it('reads the spike merged where the pulse says so', () => {
    expect(spikeBranchMerged(meta(), reading('merged'))).toBe(true);
  });

  it('reads an unmerged spike as not merged', () => {
    expect(spikeBranchMerged(meta(), reading('open'))).toBe(false);
  });

  it('reads no pulse as not merged', () => {
    expect(spikeBranchMerged(meta(), null)).toBe(false);
  });

  it('reads a plan the pulse does not hold as not merged', () => {
    expect(spikeBranchMerged(meta({ file: '/repo/docs/plans/another.md' }), reading('merged'))).toBe(false);
  });

  it('reads a plan with no single spike as not merged', () => {
    const plain = meta({ slices: [{ name: 'The spike', branches: [{ branch: SPIKE, spike: false }] }] as never });
    expect(spikeBranchMerged(plain, reading('merged'))).toBe(false);
  });
});
