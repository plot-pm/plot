import { describe, it, expect } from 'vitest';
import { awaitsSpike, confirmRefusal, slicesPushedOf, spikeCardState, type ConfirmReadings, type PlanCopies } from '../src/rules/spike-confirm.js';

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
  slices,
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

  it('answers nothing for a design plan with no spike annotation', () => {
    const plain = [{ name: 'A', branches: [{ branch: 'feature/a' }] }];
    expect(confirmRefusal(ready({ slices: plain, spikeMerged: undefined, slicesPushed: undefined }))).toBeUndefined();
  });

  it('answers nothing for a design plan with two spike annotations', () => {
    const two = [{ name: 'A', branches: [{ branch: 'feature/a', spike: true }, { branch: 'feature/b', spike: true }] }];
    expect(confirmRefusal(ready({ slices: two, spikeMerged: undefined, slicesPushed: undefined }))).toBeUndefined();
  });

  it('refuses spike-unmerged when the spike PR has not merged', () => {
    const r = confirmRefusal(ready({ spikeMerged: { name: 'feature/spike', met: false, detail: 'the host holds no merged PR for it' } }));
    expect(r?.reason).toBe('spike-unmerged');
    expect(r?.detail).toContain('/plot-approve beans');
    expect(r?.detail).toContain('<!-- spike -->');
  });

  it('refuses spike-unmerged when the merge reading is absent, naming the branch and the missing reading', () => {
    const r = confirmRefusal(ready({ spikeMerged: undefined }));
    expect(r?.reason).toBe('spike-unmerged');
    expect(r?.detail).toContain("'feature/spike'");
    expect(r?.detail).toContain('its merge was not read');
  });

  it('names the spike branch from the slices, not from the reading', () => {
    const r = confirmRefusal(ready({ spikeMerged: { name: 'elsewhere', met: false } }));
    expect(r?.detail).toContain("the spike 'feature/spike' of 'beans' has not merged.");
  });

  it('refuses slices-unpushed when the plan differs from the default branch', () => {
    const r = confirmRefusal(ready({ slicesPushed: { name: 'docs/plans/beans.md', met: false } }));
    expect(r?.reason).toBe('slices-unpushed');
    expect(r?.detail).toContain('docs/plans/beans.md');
  });

  it('words a slices-unpushed refusal with the reading\'s detail', () => {
    const r = confirmRefusal(ready({ slicesPushed: { name: 'docs/plans/beans.md', met: false, detail: 'is behind origin/main. Pull it' } }));
    expect(r?.detail).toBe('docs/plans/beans.md is behind origin/main. Pull it, then run /plot-approve beans again.');
  });

  it('words a slices-unpushed refusal with no detail as a push', () => {
    const r = confirmRefusal(ready({ slicesPushed: { name: 'docs/plans/beans.md', met: false } }));
    expect(r?.detail).toContain('Commit and push the rewritten slices');
  });

  it('refuses slices-unpushed when the push reading is absent', () => {
    expect(confirmRefusal(ready({ slicesPushed: undefined }))?.reason).toBe('slices-unpushed');
  });

  it('asks about the spike before the slices', () => {
    const r = confirmRefusal(ready({ spikeMerged: undefined, slicesPushed: undefined }));
    expect(r?.reason).toBe('spike-unmerged');
  });
});

describe('awaitsSpike', () => {
  it('holds for a design plan whose spike has not merged', () => {
    expect(awaitsSpike('design', slices, false)).toBe(true);
  });

  it('lets go once the spike has merged', () => {
    expect(awaitsSpike('design', slices, true)).toBe(false);
  });

  it('never holds outside design', () => {
    expect(awaitsSpike('draft', slices, false)).toBe(false);
  });

  it('never holds a design plan with no single spike', () => {
    expect(awaitsSpike('design', [{ branches: [{ branch: 'feature/a' }] }], false)).toBe(false);
  });
});

describe('slicesPushedOf', () => {
  const copies = (over: Partial<PlanCopies> = {}): PlanCopies => ({
    file: 'docs/plans/beans.md', main: 'main', working: 'B', head: 'B', base: 'A', remote: 'B', ...over,
  });

  it('is met when the working tree matches the default branch', () => {
    expect(slicesPushedOf(copies())).toEqual({ name: 'docs/plans/beans.md', met: true });
  });

  it('is met when the working tree matches the default branch whatever HEAD holds', () => {
    expect(slicesPushedOf(copies({ head: 'A' })).met).toBe(true);
  });

  it('tells a plan the default branch does not hold to be pushed', () => {
    const r = slicesPushedOf(copies({ remote: undefined }));
    expect(r.met).toBe(false);
    expect(r.detail).toBe('is not on origin/main. Commit it and push it to the default branch');
  });

  it('refuses a working copy that could not be read', () => {
    expect(slicesPushedOf(copies({ working: undefined })).detail).toContain('could not be read in this checkout');
  });

  it('tells uncommitted edits to be committed and pushed', () => {
    const r = slicesPushedOf(copies({ working: 'C' }));
    expect(r.met).toBe(false);
    expect(r.detail).toContain('not committed. Commit them and push them');
  });

  it('tells a checkout that is only behind to pull, not to push', () => {
    const r = slicesPushedOf(copies({ working: 'A', head: 'A', base: 'A', remote: 'B' }));
    expect(r.met).toBe(false);
    expect(r.detail).toBe('in this checkout is behind origin/main. Pull the default branch and read the slices again');
  });

  it('tells a checkout with unpushed commits to push', () => {
    const r = slicesPushedOf(copies({ working: 'C', head: 'C', base: 'B', remote: 'B' }));
    expect(r.detail).toBe('has commits in this checkout that origin/main does not hold. Push them to the default branch');
  });

  it('tells a checkout that diverged to pull, then push', () => {
    const r = slicesPushedOf(copies({ working: 'C', head: 'C', base: 'A', remote: 'B' }));
    expect(r.detail).toContain('Pull the default branch, then push');
  });

  it('reads an unread merge base as diverged', () => {
    const r = slicesPushedOf(copies({ working: 'C', head: 'C', base: undefined, remote: 'B' }));
    expect(r.detail).toContain('Pull the default branch, then push');
  });
});
