import { describe, expect, it } from 'vitest';

import { approve as transition, isRefusal, type ApproveInput as TransitionInput } from '../src/transitions/plan.js';
import { approve, decided, refused, type ApproveInput, type ApproveReadings } from '../src/workflows/index.js';

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

describe('approve of a Design plan whose spike is approved — the workflow', () => {
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

  it('leaves a Design plan with no approved spike unaffected', () => {
    expect(reason(readings({ spikeApprovedRecord: '', spikeMerged: undefined, slicesPushed: undefined }))).toBe('decided');
  });

  it('leaves a Draft plan unaffected', () => {
    expect(reason(readings({ phase: 'draft', spikeMerged: undefined, slicesPushed: undefined }))).toBe('decided');
  });
});

describe('approve of a Design plan whose spike is approved — the transition', () => {
  const plan = (spikeApprovedRecord: string, phase: 'design' | 'draft' = 'design') => ({
    slug: 'a-plan',
    phase,
    review: 'in-session' as const,
    approvedRecord: '',
    deliveredRecord: '',
    releasedRecord: '',
    spikeApprovedRecord,
  });
  const base: TransitionInput = { on: '2026-10-13', who: 'jwloka', channel: 'plan-PR #42 merged', people: ['jwloka'] };
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

  it('transitions a Design plan with no approved spike without either reading', () => {
    expect(isRefusal(transition(plan(''), base))).toBe(false);
  });

  it('transitions a Draft plan without either reading', () => {
    expect(isRefusal(transition(plan(spikeOn, 'draft'), base))).toBe(false);
  });
});
