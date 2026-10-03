import { describe, expect, it } from 'vitest';

import { type CommitReading, isEmptyClaim, realCommits } from '../src/rules/empty-claim.js';

const CLAIM: CommitReading = { subject: 'plot: claim feature/x', tree: 't1', parentTree: 't1' };

describe('isEmptyClaim', () => {
  it('answers true for a claim subject over an unchanged tree', () => {
    expect(isEmptyClaim(CLAIM)).toBe(true);
  });

  it('answers false for a claim subject that changes a file', () => {
    expect(isEmptyClaim({ ...CLAIM, tree: 't2' })).toBe(false);
  });

  it('answers false for an unchanged tree under another subject', () => {
    expect(isEmptyClaim({ ...CLAIM, subject: 'chore: nothing' })).toBe(false);
  });

  it('answers false for a subject that is the prefix without its space', () => {
    expect(isEmptyClaim({ ...CLAIM, subject: 'plot: claimed x' })).toBe(false);
  });

  it('answers false where the parent tree is missing', () => {
    expect(isEmptyClaim({ ...CLAIM, parentTree: null })).toBe(false);
  });

  it('answers false where both trees are empty strings', () => {
    expect(isEmptyClaim({ ...CLAIM, tree: '', parentTree: '' })).toBe(false);
  });
});

describe('realCommits', () => {
  it('counts nothing in an empty list', () => {
    expect(realCommits([])).toBe(0);
  });

  it('counts nothing when every commit is an empty claim', () => {
    expect(realCommits([CLAIM, CLAIM])).toBe(0);
  });

  it('counts each commit that is not an empty claim', () => {
    expect(
      realCommits([
        CLAIM,
        { ...CLAIM, tree: 't2' },
        { subject: 'work', tree: 't3', parentTree: 't2' },
      ]),
    ).toBe(2);
  });
});
