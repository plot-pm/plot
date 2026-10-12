import { describe, it, expect } from 'vitest';
import { spikeOf, spikeSliceOf } from '../src/rules/spike.js';

describe('spikeOf', () => {
  it('names the annotated branch and its slice', () => {
    const slices = [
      { name: 'The spike', branches: [{ branch: 'feature/a', spike: true }] },
      { name: 'The rest', branches: [{ branch: 'feature/b' }] },
    ];
    expect(spikeOf(slices)).toEqual({ branch: 'feature/a', slice: 0 });
  });

  it('finds a spike in a later slice', () => {
    const slices = [
      { branches: [{ branch: 'feature/a', spike: false }] },
      { branches: [{ branch: 'feature/b' }, { branch: 'feature/c', spike: true }] },
    ];
    expect(spikeOf(slices)).toEqual({ branch: 'feature/c', slice: 1 });
  });

  it('answers nothing, not false, for a plan with no annotation', () => {
    const slices = [{ branches: [{ branch: 'feature/a' }, { branch: 'feature/b', spike: false }] }];
    expect(spikeOf(slices)).toBeUndefined();
    expect(spikeOf([])).toBeUndefined();
  });

  it('answers nothing when a plan carries two annotations', () => {
    expect(spikeOf([
      { branches: [{ branch: 'feature/a', spike: true }] },
      { branches: [{ branch: 'feature/b', spike: true }] },
    ])).toBeUndefined();
    expect(spikeOf([
      { branches: [{ branch: 'feature/a', spike: true }, { branch: 'feature/b', spike: true }] },
    ])).toBeUndefined();
  });
});

describe('spikeSliceOf', () => {
  it('names the shown slice that holds the plan\'s one annotated branch', () => {
    expect(spikeSliceOf([0, 1, 0], 1)).toBe(1);
  });

  it('answers nothing for a plan with no annotation or with two', () => {
    expect(spikeSliceOf([0, 0], 0)).toBeUndefined();
    expect(spikeSliceOf([1, 1], 2)).toBeUndefined();
    expect(spikeSliceOf([2, 0], 2)).toBeUndefined();
  });

  it('counts an annotation in an unshown slice, so a second spike there admits nothing', () => {
    expect(spikeSliceOf([1, 0], 2)).toBeUndefined();
    expect(spikeSliceOf([0, 0], 1)).toBeUndefined();
  });
});
