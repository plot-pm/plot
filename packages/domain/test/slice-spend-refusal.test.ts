import { describe, expect, it } from 'vitest';

import { sliceSpendRefusal } from '../src/rules/slice-spend-refusal.js';
import type { SpendRead } from '../src/rules/slice-spend-record.js';

const read = (over: Partial<SpendRead> = {}): SpendRead => ({
  state: 'measured',
  latest: null,
  history: [],
  unreadable: 0,
  tokens: null,
  costUsd: 5,
  runCount: 1,
  turns: 1,
  models: [],
  ...over,
});

describe('sliceSpendRefusal', () => {
  it('allows the run where cost is under the limit', () => {
    expect(sliceSpendRefusal(read({ costUsd: 4 }), 5)).toBe(false);
  });

  it('refuses exactly at the limit', () => {
    expect(sliceSpendRefusal(read({ costUsd: 5 }), 5)).toBe(true);
  });

  it('refuses past the limit', () => {
    expect(sliceSpendRefusal(read({ costUsd: 6 }), 5)).toBe(true);
  });

  it('never refuses an unmeasured slice — absent is not spent everything', () => {
    expect(sliceSpendRefusal(read({ state: 'absent', costUsd: null }), 0)).toBe(false);
  });

  it('never refuses an unreadable record either', () => {
    expect(sliceSpendRefusal(read({ state: 'unreadable', costUsd: null }), 0)).toBe(false);
  });
});
