import { describe, expect, it } from 'vitest';

import { approve as transition, isRefusal, type ApproveInput as TransitionInput } from '../src/transitions/plan.js';
import { approve, decided, refused, type ApproveInput, type ApproveReadings } from '../src/workflows/index.js';
import { cardControls } from '../src/rules/card-controls.js';

const SPIKE = [
  { name: 'The spike', branches: [{ branch: 'feature/spike', spike: true }] },
  { name: 'The rest', branches: [{ branch: 'feature/rest' }] },
];
const MERGED = { name: 'feature/spike', met: true };
const PUSHED = { name: 'docs/plans/2026-10-12-a-plan.md', met: true };

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
  spikeApprovedRecord: '2026-10-12, jwloka, in-session',
  spikeMerged: MERGED,
  slicesPushed: PUSHED,
  pr: { number: 42, state: 'OPEN', draft: false, branch: 'idea/a-plan' },
  ...over,
});
const input = (): ApproveInput => ({ on: '2026-10-13', who: 'jwloka', channel: 'plan-PR #42 merged', people: ['jwloka'] });
const reason = (r: ApproveReadings) => {
  const out = approve(r, input());
  return refused(out) ? out.reason : decided(out) ? 'decided' : 'other';
};

describe('approve of a Design plan with a spike — the workflow', () => {
  it('approves when the spike has merged and the slices are pushed', () => {
    expect(reason(readings())).toBe('decided');
  });

  it('refuses spike-unmerged when the spike PR has not merged', () => {
    expect(reason(readings({ spikeMerged: { ...MERGED, met: false } }))).toBe('spike-unmerged');
  });

  it('refuses spike-unmerged when the merge was not read', () => {
    expect(reason(readings({ spikeMerged: undefined }))).toBe('spike-unmerged');
  });

  it('refuses slices-unpushed when the plan differs from the default branch', () => {
    expect(reason(readings({ slicesPushed: { ...PUSHED, met: false } }))).toBe('slices-unpushed');
  });

  it('refuses slices-unpushed when the push was not read', () => {
    expect(reason(readings({ slicesPushed: undefined }))).toBe('slices-unpushed');
  });

  it('refuses spike-unmerged for a Design plan whose annotated spike was never approved', () => {
    expect(reason(readings({ spikeApprovedRecord: '', spikeMerged: undefined, slicesPushed: undefined }))).toBe('spike-unmerged');
  });

  it('approves a Design plan whose spike annotation was removed, on the person arm', () => {
    const plain = [
      { name: 'The spike', branches: [{ branch: 'feature/spike' }] },
      { name: 'The rest', branches: [{ branch: 'feature/rest' }] },
    ];
    expect(reason(readings({ slices: plain, spikeMerged: undefined, slicesPushed: undefined, review: 'in-session' }))).toBe('decided');
  });

  it('approves a Design plan with two spike annotations, which has no spike', () => {
    const two = [
      { name: 'The spike', branches: [{ branch: 'feature/spike', spike: true }] },
      { name: 'The rest', branches: [{ branch: 'feature/rest', spike: true }] },
    ];
    expect(reason(readings({ slices: two, spikeMerged: undefined, slicesPushed: undefined, review: 'in-session' }))).toBe('decided');
  });

  it('reads the spike from confirmSlices where the bundle supplies the default branch\'s copy', () => {
    const plain = [
      { name: 'The spike', branches: [{ branch: 'feature/spike' }] },
      { name: 'The rest', branches: [{ branch: 'feature/rest' }] },
    ];
    expect(reason(readings({ slices: plain, confirmSlices: SPIKE, spikeMerged: undefined }))).toBe('spike-unmerged');
  });

  it('leaves a Draft plan unaffected', () => {
    expect(reason(readings({ phase: 'draft', spikeMerged: undefined, slicesPushed: undefined }))).toBe('decided');
  });
});

describe('approve of a Design plan with a spike — the transition', () => {
  const plan = (spikeApprovedRecord: string, phase: 'design' | 'draft' = 'design') => ({
    slug: 'a-plan',
    phase,
    review: 'in-session' as const,
    approvedRecord: '',
    deliveredRecord: '',
    releasedRecord: '',
    spikeApprovedRecord,
  });
  const base: TransitionInput = { on: '2026-10-13', who: 'jwloka', channel: 'plan-PR #42 merged', people: ['jwloka'], slices: SPIKE };
  const spikeOn = '2026-10-12, jwloka, in-session';

  it('refuses spike-unmerged without a merge reading', () => {
    const out = transition(plan(spikeOn), { ...base, slicesPushed: PUSHED });
    expect(isRefusal(out) && out.reason).toBe('spike-unmerged');
  });

  it('refuses slices-unpushed without a push reading', () => {
    const out = transition(plan(spikeOn), { ...base, spikeMerged: MERGED });
    expect(isRefusal(out) && out.reason).toBe('slices-unpushed');
  });

  it('transitions when both readings are met', () => {
    expect(isRefusal(transition(plan(spikeOn), { ...base, spikeMerged: MERGED, slicesPushed: PUSHED }))).toBe(false);
  });

  it('refuses spike-unmerged for a Design plan whose spike was never approved', () => {
    const out = transition(plan(''), base);
    expect(isRefusal(out) && out.reason).toBe('spike-unmerged');
  });

  it('transitions a Design plan with no spike annotation without either reading', () => {
    const plain = [{ name: 'The rest', branches: [{ branch: 'feature/rest' }] }];
    expect(isRefusal(transition(plan(spikeOn), { ...base, slices: plain }))).toBe(false);
  });

  it('transitions a Draft plan without either reading', () => {
    expect(isRefusal(transition(plan(spikeOn, 'draft'), base))).toBe(false);
  });
});

describe('the card and the approval give one answer about a Design plan', () => {
  const PLAIN = [{ name: 'The rest', branches: [{ branch: 'feature/rest' }] }];
  const TWO = [{ name: 'Both', branches: [{ branch: 'feature/a', spike: true }, { branch: 'feature/b', spike: true }] }];
  const cases = [
    { name: 'a spike never approved, unmerged', slices: SPIKE, record: '', merged: false },
    { name: 'a spike never approved, merged', slices: SPIKE, record: '', merged: true },
    { name: 'an approved spike, unmerged', slices: SPIKE, record: '2026-10-12, jwloka, in-session', merged: false },
    { name: 'an approved spike, merged', slices: SPIKE, record: '2026-10-12, jwloka, in-session', merged: true },
    { name: 'no spike annotation', slices: PLAIN, record: '', merged: false },
    { name: 'the annotation removed after the spike approval', slices: PLAIN, record: '2026-10-12, jwloka, in-session', merged: false },
    { name: 'two spike annotations', slices: TWO, record: '2026-10-12, jwloka, in-session', merged: false },
  ];

  for (const c of cases) {
    it(`agrees for ${c.name}`, () => {
      const card = cardControls({ state: 'design', status: 'open', started: false, slices: c.slices, spikeApproved: c.record, spikeMerged: c.merged });
      const out = approve(
        readings({
          review: 'in-session',
          slices: c.slices,
          spikeApprovedRecord: c.record,
          spikeMerged: { name: 'feature/spike', met: c.merged },
        }),
        input(),
      );
      expect(card.approve).toBe(decided(out));
    });
  }
});
