import { describe, it, expect } from 'vitest';
import { confirmRefusal, spikeCardState, type ConfirmReadings } from '../src/rules/spike-confirm.js';

const slices = [
  { name: 'Spike', branches: [{ branch: 'feature/spike', spike: true }] },
  { name: 'Rest', branches: [{ branch: 'feature/rest' }] },
];

describe('spikeCardState', () => {
  it('answers null for a plan that is not in design', () => {
    expect(spikeCardState({ state: 'draft', slices })).toBeNull();
  });

  it('answers null for a design plan with no spike', () => {
    expect(spikeCardState({ state: 'design', slices: [{ name: 'A', branches: [{ branch: 'feature/a' }] }] })).toBeNull();
  });

  it('answers spike-not-approved while the record is empty', () => {
    expect(spikeCardState({ state: 'design', slices, spikeApproved: '  ', spikeMerged: true })).toBe('spike-not-approved');
  });

  it('answers spike-not-approved when no record was read', () => {
    expect(spikeCardState({ state: 'design', slices })).toBe('spike-not-approved');
  });

  it('answers spike-approved while the approved spike has not merged', () => {
    expect(spikeCardState({ state: 'design', slices, spikeApproved: '2026-10-13 by jwloka' })).toBe('spike-approved');
  });

  it('answers spike-merged once the spike has merged', () => {
    expect(spikeCardState({ state: 'design', slices, spikeApproved: '2026-10-13 by jwloka', spikeMerged: true })).toBe('spike-merged');
  });
});

const ready = (over: Partial<ConfirmReadings> = {}): ConfirmReadings => ({
  slug: 'beans',
  phase: 'design',
  spikeApproved: '2026-10-13 by jwloka',
  spikeMerged: { name: 'feature/spike', met: true },
  slicesPushed: { name: 'docs/plans/beans.md', met: true },
  ...over,
});

describe('confirmRefusal', () => {
  it('answers nothing when both readings are met', () => {
    expect(confirmRefusal(ready())).toBeUndefined();
  });

  it('answers nothing outside design', () => {
    expect(confirmRefusal(ready({ phase: 'draft', spikeMerged: undefined, slicesPushed: undefined }))).toBeUndefined();
  });

  it('answers nothing for a design plan with no approved spike', () => {
    expect(confirmRefusal(ready({ spikeApproved: '', spikeMerged: undefined, slicesPushed: undefined }))).toBeUndefined();
  });

  it('refuses spike-unmerged when the spike PR has not merged', () => {
    const r = confirmRefusal(ready({ spikeMerged: { name: 'feature/spike', met: false, detail: 'the host holds no merged PR for it' } }));
    expect(r?.reason).toBe('spike-unmerged');
    expect(r?.detail).toContain('/plot-approve beans');
    expect(r?.detail).toContain('<!-- spike -->');
  });

  it('refuses spike-unmerged when the merge reading is absent', () => {
    expect(confirmRefusal(ready({ spikeMerged: undefined }))?.reason).toBe('spike-unmerged');
  });

  it('refuses slices-unpushed when the plan differs from the default branch', () => {
    const r = confirmRefusal(ready({ slicesPushed: { name: 'docs/plans/beans.md', met: false } }));
    expect(r?.reason).toBe('slices-unpushed');
    expect(r?.detail).toContain('docs/plans/beans.md');
  });

  it('quotes the source detail on a slices-unpushed refusal', () => {
    const r = confirmRefusal(ready({ slicesPushed: { name: 'docs/plans/beans.md', met: false, detail: 'origin copy differs' } }));
    expect(r?.detail).toContain('(origin copy differs)');
  });

  it('refuses slices-unpushed when the push reading is absent', () => {
    expect(confirmRefusal(ready({ slicesPushed: undefined }))?.reason).toBe('slices-unpushed');
  });

  it('asks about the spike before the slices', () => {
    const r = confirmRefusal(ready({ spikeMerged: undefined, slicesPushed: undefined }));
    expect(r?.reason).toBe('spike-unmerged');
  });
});
