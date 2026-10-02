import { describe, expect, it } from 'vitest';
import {
  unnamedBranchDetail,
  unnamedBranchRepair,
  unnamedBranches,
  type NamedSlice,
} from '../src/rules/slice-name.js';

/** A named slice holding one branch, which each test spoils in one way. */
const slice = (over: Partial<NamedSlice> = {}): NamedSlice => ({
  name: 'A named slice',
  branches: [{ branch: 'feature/one', deferred: false }],
  ...over,
});

describe('unnamedBranches', () => {
  it('answers an empty list for a plan whose every branch sits under a heading', () => {
    expect(unnamedBranches([slice(), slice({ name: 'Another' })])).toEqual([]);
  });

  it('names the branch of a slice whose heading is empty', () => {
    expect(unnamedBranches([slice({ name: '' })])).toEqual(['feature/one']);
  });

  it('reads a whitespace-only heading as no heading', () => {
    expect(unnamedBranches([slice({ name: '   ' })])).toEqual(['feature/one']);
  });

  it('names a DEFERRED branch too, because a deferred branch can return to the queue', () => {
    const deferred = slice({
      name: '',
      branches: [{ branch: 'feature/given-up', deferred: true }],
    });
    expect(unnamedBranches([deferred])).toEqual(['feature/given-up']);
  });

  it('names every branch of an unnamed slice, in plan order', () => {
    const many = slice({
      name: '',
      branches: [
        { branch: 'feature/a' },
        { branch: 'feature/b', deferred: true },
        { branch: 'feature/c' },
      ],
    });
    expect(unnamedBranches([many])).toEqual(['feature/a', 'feature/b', 'feature/c']);
  });

  it('answers in plan order across slices, skipping the named ones', () => {
    const slices = [
      slice({ name: '', branches: [{ branch: 'feature/first' }] }),
      slice({ name: 'Named', branches: [{ branch: 'feature/skipped' }] }),
      slice({ name: '', branches: [{ branch: 'feature/last' }] }),
    ];
    expect(unnamedBranches(slices)).toEqual(['feature/first', 'feature/last']);
  });

  it('answers an empty list for a plan that names no branch at all', () => {
    expect(unnamedBranches([])).toEqual([]);
    expect(unnamedBranches([slice({ name: '', branches: [] })])).toEqual([]);
  });

  it('ignores a blank branch name, which names nothing an operator could repair', () => {
    expect(unnamedBranches([slice({ name: '', branches: [{ branch: '  ' }] })])).toEqual([]);
  });

  it('reads a missing name as no heading rather than throwing', () => {
    const noName = { branches: [{ branch: 'feature/one' }] } as unknown as NamedSlice;
    expect(unnamedBranches([noName])).toEqual(['feature/one']);
  });
});

describe('the refusal wording', () => {
  it('names the heading to add for one branch', () => {
    expect(unnamedBranchRepair('bug/x')).toBe(
      "add '### <name> (Branch: bug/x)' above it under '## Slices'",
    );
  });

  it('names the plan, the branch and the repair', () => {
    const detail = unnamedBranchDetail('a-plan', ['bug/x']);
    expect(detail).toContain("plan 'a-plan'");
    expect(detail).toContain("'bug/x'");
    expect(detail).toContain("add '### <name> (Branch: bug/x)' above it under '## Slices'");
  });

  it('names every branch when several are unnamed', () => {
    const detail = unnamedBranchDetail('a-plan', ['bug/x', 'bug/y']);
    expect(detail).toContain('2 branches');
    expect(detail).toContain("'bug/x'");
    expect(detail).toContain("'bug/y'");
    expect(detail).toContain('(Branch: bug/y)');
  });
});
