import { describe, it, expect } from 'vitest';
import { storeRow, type PrRecord } from '../../src/shared/pr-refresh.js';

const record = (over: Partial<PrRecord> = {}): PrRecord => ({
  number: 7, head: 'feature/a', state: 'OPEN', draft: false, checks: 'green', review: '', url: 'u', ...over,
});

describe('storeRow and the base branch', () => {
  it('copies a non-empty base', () => {
    expect(storeRow(record({ base: 'sprint/card-1' })).base).toBe('sprint/card-1');
  });

  it('writes no base key for a PR whose host answered an empty base', () => {
    expect('base' in storeRow(record({ base: '' }))).toBe(false);
  });

  it('writes no base key for a PR with no base', () => {
    expect('base' in storeRow(record())).toBe(false);
  });
});
