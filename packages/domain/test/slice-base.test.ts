import { describe, it, expect } from 'vitest';
import type { PlanRecord } from '../src/ports/plan-store.js';
import { chooseSprintPlans, planBaseOf, sliceBaseRef, sprintPlanReads } from '../src/rules/slice-base.js';

const record = (file: string, sprint: string, error?: string): PlanRecord =>
  ({ file, sprint, ...(error === undefined ? {} : { error }) }) as unknown as PlanRecord;

describe('sprintPlanReads', () => {
  it('reads nothing from a sprint branch for a plan the default branch holds', () => {
    const reads = sprintPlanReads(['docs/plans/a.md'], [{ branch: 'sprint/s', files: ['docs/plans/a.md'], inDefault: false }]);
    expect(reads).toEqual([]);
  });

  it('reads a plan only a sprint branch holds, from that branch', () => {
    const reads = sprintPlanReads(
      ['docs/plans/a.md'],
      [{ branch: 'sprint/s', files: ['docs/plans/a.md', 'docs/plans/b.md'], inDefault: false }],
    );
    expect(reads).toEqual([{ branch: 'sprint/s', files: ['docs/plans/b.md'] }]);
  });

  it('skips a sprint branch the default branch already contains', () => {
    const reads = sprintPlanReads([], [{ branch: 'sprint/merged', files: ['docs/plans/old-name.md'], inDefault: true }]);
    expect(reads).toEqual([]);
  });

  it('ignores a listing that is not a sprint branch', () => {
    const reads = sprintPlanReads([], [{ branch: 'feature/x', files: ['docs/plans/b.md'], inDefault: false }]);
    expect(reads).toEqual([]);
  });

  it('keeps every sprint branch that holds a plan off the default branch, in ref order', () => {
    const reads = sprintPlanReads(
      [],
      [
        { branch: 'sprint/a', files: ['docs/plans/b.md'], inDefault: false },
        { branch: 'sprint/b', files: ['docs/plans/b.md'], inDefault: false },
      ],
    );
    expect(reads.map((read) => read.branch)).toEqual(['sprint/a', 'sprint/b']);
  });
});

describe('chooseSprintPlans', () => {
  it('takes the sprint branch the plan names when several hold it', () => {
    const chosen = chooseSprintPlans([
      { record: record('docs/plans/b.md', 'two'), base: 'sprint/one' },
      { record: record('docs/plans/b.md', 'two'), base: 'sprint/two' },
    ]);
    expect(chosen.map((plan) => plan.base)).toEqual(['sprint/two']);
  });

  it('takes the first branch in ref order when the plan names none of them', () => {
    const chosen = chooseSprintPlans([
      { record: record('docs/plans/b.md', ''), base: 'sprint/one' },
      { record: record('docs/plans/b.md', ''), base: 'sprint/two' },
    ]);
    expect(chosen.map((plan) => plan.base)).toEqual(['sprint/one']);
  });

  it('keeps one plan per file and drops a record the parser could not read', () => {
    const chosen = chooseSprintPlans([
      { record: record('docs/plans/b.md', 's'), base: 'sprint/s' },
      { record: record('docs/plans/c.md', 's', 'file not found'), base: 'sprint/s' },
      { record: record('docs/plans/d.md', 's'), base: 'sprint/s' },
    ]);
    expect(chosen.map((plan) => plan.record.file)).toEqual(['docs/plans/b.md', 'docs/plans/d.md']);
  });
});

describe('sliceBaseRef', () => {
  it('answers the default ref for a slice on the default branch', () => {
    expect(sliceBaseRef('', 'origin/main')).toBe('origin/main');
    expect(sliceBaseRef(' ', 'origin/main')).toBe('origin/main');
  });

  it('answers the sprint branch on origin for a sprint slice', () => {
    expect(sliceBaseRef('sprint/triggers-and-connectors', 'origin/main')).toBe('origin/sprint/triggers-and-connectors');
  });
});

describe('planBaseOf', () => {
  it('answers the default branch for a plan the default branch holds, whatever its sprint', () => {
    expect(planBaseOf({ onDefault: true, sprint: 's', carriers: ['sprint/s'] })).toBe('');
  });

  it('answers the sprint branch the plan names where it carries the plan', () => {
    expect(planBaseOf({ onDefault: false, sprint: 's', carriers: ['sprint/a', 'sprint/s'] })).toBe('sprint/s');
  });

  it('answers the first carrier where the plan names no carrier', () => {
    expect(planBaseOf({ onDefault: false, sprint: 'other', carriers: ['sprint/a', 'sprint/s'] })).toBe('sprint/a');
    expect(planBaseOf({ onDefault: false, sprint: '', carriers: ['sprint/a'] })).toBe('sprint/a');
  });

  it('answers the default branch where no sprint branch carries the plan', () => {
    expect(planBaseOf({ onDefault: false, sprint: 's', carriers: [] })).toBe('');
  });
});
