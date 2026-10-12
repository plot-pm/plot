import { describe, expect, it } from 'vitest';

import { cardControls } from '../src/rules/card-controls.js';
import { carriesSpikeFlag, controllerRefusal } from '../src/rules/controller-gate.js';
import {
  receiptOf,
  spikeApprovalOf,
  spikeReceiptKey,
  spikeTransitionOf,
  stateTransitionRefusal,
  stateTransitionsOf,
} from '../src/rules/state-transition.js';
import { approveSpike as transition } from '../src/transitions/plan.js';
import {
  approveSpike,
  decided,
  refused,
  type ApproveInput,
  type ApproveReadings,
} from '../src/workflows/index.js';

const SPIKE = [{ name: 'The spike', branches: [{ branch: 'feature/spike', spike: true }] }, { name: 'The rest', branches: [{ branch: 'feature/rest' }] }];

const readings = (over: Partial<ApproveReadings> = {}): ApproveReadings => ({
  slug: 'a-plan',
  file: 'docs/plans/2026-10-12-a-plan.md',
  parsed: true,
  phase: 'design',
  review: 'pr',
  impl: 'own-branches',
  branches: ['feature/spike', 'feature/rest'],
  slices: SPIKE,
  sprint: '',
  sprintFile: '',
  approvedRecord: '',
  spikeApprovedRecord: '',
  pr: { number: 42, state: 'OPEN', draft: false, branch: 'idea/a-plan' },
  ...over,
});
const input = (over: Partial<ApproveInput> = {}): ApproveInput => ({
  on: '2026-10-12',
  who: 'jwloka',
  channel: 'plan-PR #42 merged',
  people: ['jwloka'],
  ...over,
});

describe('approveSpike — the writes', () => {
  it('merges the plan PR, records Spike approved and clears only the spike hold', () => {
    const out = approveSpike(readings(), input());
    expect(decided(out)).toBe(true);
    if (!decided(out)) return;
    expect(out.writes.map((w) => w.kind)).toEqual(['pr-merge', 'plan-record', 'hold-clear', 'commit', 'push']);
    expect(out.writes[1]).toMatchObject({ field: 'Spike approved', value: '2026-10-12, jwloka, plan-PR #42 merged' });
    expect(out.writes[2]).toMatchObject({ branch: 'feature/spike' });
    expect(out.detail.spike).toBe('feature/spike');
    expect(out.writes.some((w) => w.kind === 'plan-phase')).toBe(false);
  });

  it('merges nothing for an in-session plan or a merged PR', () => {
    for (const over of [{ review: 'in-session' }, { pr: { number: 42, state: 'MERGED' as const, draft: false, branch: 'idea/a-plan' } }]) {
      const out = approveSpike(readings(over), input());
      expect(decided(out) && out.writes.map((w) => w.kind)).toEqual(['plan-record', 'hold-clear', 'commit', 'push']);
    }
  });

  it('pushes to the work branch and merges nothing for a plan that rides it', () => {
    const out = approveSpike(readings({ impl: 'same-branch' }), input());
    expect(decided(out) && out.writes.map((w) => w.kind)).toEqual(['plan-record', 'hold-clear', 'commit', 'push']);
    expect(decided(out) && out.writes[3]).toEqual({ kind: 'push', branch: '', onto: '' });
  });

  it('reads absent slices and an absent record as none', () => {
    const { slices: _slices, spikeApprovedRecord: _record, ...rest } = readings();
    const out = approveSpike(rest, input());
    expect(refused(out) && out.reason).toBe('spike-none');
  });

  it('marks a draft PR ready before it merges', () => {
    const out = approveSpike(readings({ pr: { number: 42, state: 'OPEN', draft: true, branch: 'idea/a-plan' } }), input());
    expect(decided(out) && out.writes.map((w) => w.kind).slice(0, 2)).toEqual(['pr-ready', 'pr-merge']);
  });
});

describe('approveSpike — the refusals', () => {
  const reason = (r: ApproveReadings, i: ApproveInput = input()) => {
    const out = approveSpike(r, i);
    return refused(out) ? out.reason : 'decided';
  };

  it('refuses a plan with no spike, many spikes, or a spike that is not first', () => {
    expect(reason(readings({ slices: [{ name: 'A', branches: [{ branch: 'b' }] }] }))).toBe('spike-none');
    expect(
      reason(readings({ slices: [{ name: 'A', branches: [{ branch: 'a', spike: true }, { branch: 'b', spike: true }] }] })),
    ).toBe('spike-none');
    expect(reason(readings({ slices: [SPIKE[1], SPIKE[0]] }))).toBe('spike-not-first');
    expect(
      reason(readings({ slices: [{ name: 'A', branches: [{ branch: 'a', spike: true }, { branch: 'b' }] }] })),
    ).toBe('spike-not-first');
  });

  it('refuses a recorded approval, a plan outside Design, and a missing or undeclared person', () => {
    expect(reason(readings({ spikeApprovedRecord: '2026-10-12, jwloka, in-session' }))).toBe('spike-approved');
    expect(reason(readings({ phase: 'approved' }))).toBe('state-wrong');
    expect(reason(readings({ phase: 'draft' }))).toBe('state-wrong');
    expect(reason(readings(), input({ who: ' ' }))).toBe('review-human');
    expect(reason(readings(), input({ who: 'stranger' }))).toBe('reviewer-undeclared');
  });

  it('refuses an unreadable state, a missing plan and an unparseable plan', () => {
    expect(reason(readings({ phase: '' }))).toBe('state-unreadable');
    expect(reason(readings({ phase: 'NONE' }))).toBe('state-unreadable');
    expect(reason(readings({ file: '' }))).toBe('plan-not-found');
    expect(reason(readings({ parsed: false }))).toBe('plan-unparseable');
  });

  it('requires a person on every review channel, ballot included', () => {
    for (const review of ['pr', 'NONE', 'in-session', 'ballot']) {
      expect(reason(readings({ review }), input({ who: '' }))).toBe('review-human');
    }
    expect(reason(readings({ review: 'ballot' }))).toBe('decided');
    expect(reason(readings({ review: 'mystery' }))).toBe('review-unrecognised');
  });

  it('reads an empty Review: answer as a plan-PR channel', () => {
    const out = approveSpike(readings({ review: '' }), input());
    expect(decided(out) && out.writes.map((w) => w.kind)[0]).toBe('pr-merge');
  });

  it('refuses a closed or absent PR and a rival PR', () => {
    expect(reason(readings({ pr: { number: 42, state: 'CLOSED', draft: false, branch: 'x' } }))).toBe('pr-closed');
    expect(reason(readings({ pr: { number: 0, state: 'NONE', draft: false, branch: 'x' } }))).toBe('pr-absent');
    expect(reason(readings({ pr: { number: 42, state: 'OPEN', draft: false, branch: 'x', rivals: [43] } }))).toBe('pr-ambiguous');
  });

  it('reads an absent spike record as none and an absent slice list as no spike', () => {
    const { spikeApprovedRecord: _record, ...noRecord } = readings();
    expect(reason(noRecord)).toBe('decided');
    const { slices: _slices, ...noSlices } = readings();
    expect(reason(noSlices)).toBe('spike-none');
  });

  it('pushes nowhere and merges nothing for a same-branch plan', () => {
    const out = approveSpike(readings({ impl: 'same-branch' }), input());
    expect(decided(out) && out.writes.map((w) => w.kind)).toEqual(['plan-record', 'hold-clear', 'commit', 'push']);
    expect(decided(out) && out.writes[3]).toMatchObject({ branch: '', onto: '' });
  });

  it('refuses on the first unmet precondition, with and without its detail', () => {
    const plan = { slug: 'x', phase: 'design' as const, review: 'pr' as const, approvedRecord: '', deliveredRecord: '', releasedRecord: '' };
    const base = { on: 'd', who: 'jwloka', channel: 'c', people: ['jwloka'], slices: SPIKE };
    const detailed = transition(plan, { ...base, preconditions: [{ name: 'pr', met: true }, { name: 'ci', met: false, detail: 'red' }] });
    expect(detailed).toMatchObject({ outcome: 'refused', reason: 'precondition-unmet' });
    expect(JSON.stringify(detailed)).toContain("the reading 'ci' refused: red");
    const bare = transition(plan, { ...base, preconditions: [{ name: 'ci', met: false }] });
    expect(JSON.stringify(bare)).toContain("the reading 'ci' is not met");
    expect(transition(plan, { ...base, preconditions: [{ name: 'ci', met: true }] }).outcome).toBe('decided');
  });

  it('is a transition that does not consult approvalArm', () => {
    const out = transition(
      { slug: 'x', phase: 'design', review: 'pr', approvedRecord: '', deliveredRecord: '', releasedRecord: '' },
      { on: 'd', who: 'jwloka', channel: 'c', people: ['jwloka'], slices: SPIKE },
    );
    expect(out.outcome).toBe('decided');
  });

  it('refuses a transition whose phase is unreadable', () => {
    const out = transition(
      { slug: 'x', phase: 'none', review: 'pr', approvedRecord: '', deliveredRecord: '', releasedRecord: '' },
      { on: 'd', who: 'jwloka', channel: 'c', people: ['jwloka'], slices: SPIKE },
    );
    expect(out.outcome === 'refused' && out.reason).toBe('state-unreadable');
  });

  it('refuses a transition whose reading is unmet', () => {
    const out = transition(
      { slug: 'x', phase: 'design', review: 'pr', approvedRecord: '', deliveredRecord: '', releasedRecord: '' },
      { on: 'd', who: 'jwloka', channel: 'c', people: ['jwloka'], slices: SPIKE, preconditions: [{ name: 'pr-open', met: false }] },
    );
    expect(out.outcome === 'refused' && out.reason).toBe('precondition-unmet');
  });
});

describe('the Spike approved gate', () => {
  const plan = (record: string) => `# P\n\n## Status\n\n- **State:** Design\n${record === '' ? '' : `- **Spike approved:** ${record}\n`}`;
  const path = 'docs/plans/2026-10-12-x.md';
  const read = (head: string | null, committed: string | null) => ({
    path,
    kind: 'plan' as const,
    head: head === null ? null : { text: head, link: false },
    committed: committed === null ? null : { text: committed, link: false },
  });
  const of = (head: string | null, committed: string | null) => stateTransitionsOf([read(head, committed)], 'docs/plans/', 'docs/sprints/');

  it('reads a spike record carried by a rename as an addition from the deleted file', () => {
    const renamed = { path: 'docs/plans/2026-10-11-x.md', head: plan('') };
    const moved = spikeTransitionOf(path, 'plan', null, plan('d, w, c'), renamed);
    expect(moved).toMatchObject({ before: '', after: 'd, w, c', renamedFrom: renamed.path });
    expect(spikeTransitionOf(path, 'plan', null, plan('d, w, c'))).not.toHaveProperty('renamedFrom');
  });

  it('reads the record', () => {
    expect(spikeApprovalOf(plan('2026-10-12, jwloka, in-session'))).toBe('2026-10-12, jwloka, in-session');
    expect(spikeApprovalOf(plan(''))).toBe('');
  });

  it('finds an addition, a change and a removal under the Spike approved receipt key', () => {
    const added = of(plan(''), plan('2026-10-12, jwloka, in-session'));
    expect(added).toHaveLength(1);
    expect(receiptOf(added[0])).toEqual({ key: `${path}#Spike approved`, value: '2026-10-12, jwloka, in-session' });
    expect(of(plan('a'), plan('b'))).toHaveLength(1);
    expect(of(plan('a'), plan(''))).toHaveLength(1);
    expect(of(plan('a'), plan('a'))).toEqual([]);
  });

  it('keeps the State receipt key and the spike key apart', () => {
    const both = of(plan(''), `${plan('2026-10-12, jwloka, in-session')}`.replace('Design', 'Approved'));
    expect(both.map((t) => receiptOf(t).key).sort()).toEqual([path, spikeReceiptKey(path)].sort());
    const [state, spike] = [...both].sort((a, b) => (a.field ? 1 : 0) - (b.field ? 1 : 0));
    expect(receiptOf(state).key).not.toBe(receiptOf(spike).key);
  });

  it('names the spike command for an addition and no command for a removal', () => {
    const [add] = of(plan(''), plan('d, w, c'));
    expect(stateTransitionRefusal([add])).toContain('plot-approve.mjs --spike');
    const [remove] = of(plan('d, w, c'), plan(''));
    const text = stateTransitionRefusal([remove]) ?? '';
    expect(text).toContain("No command removes a 'Spike approved:' line");
    expect(text).not.toContain('--spike <slug>');
  });
});

describe('the controller gate and the card', () => {
  it('names the spike body for a --spike command line only', () => {
    expect(carriesSpikeFlag('node plot-approve.mjs --spike --who jwloka x')).toBe(true);
    expect(carriesSpikeFlag('node plot-approve.mjs --who jwloka x')).toBe(false);
    expect(controllerRefusal('approve', '/s', true)).toContain('{"slug":"<slug>","spike":true}');
    expect(controllerRefusal('approve', '/s')).not.toContain('"spike":true');
    expect(controllerRefusal('deliver', '/s', true)).not.toContain('"spike":true');
  });

  it('offers Approve spike on a Design plan with an approvable spike only', () => {
    const base = { state: 'design', status: 'draft' as const, started: false, slices: SPIKE, spikeApproved: '' };
    expect(cardControls(base).approveSpike).toBe(true);
    expect(cardControls({ ...base, state: 'draft' }).approveSpike).toBe(false);
    expect(cardControls({ ...base, spikeApproved: 'x, y, z' }).approveSpike).toBe(false);
    expect(cardControls({ ...base, slices: [SPIKE[1], SPIKE[0]] }).approveSpike).toBe(false);
    expect(cardControls({ ...base, slices: [] }).approveSpike).toBe(false);
  });
});
