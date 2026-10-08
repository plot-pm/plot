import { describe, it, expect } from 'vitest';
import { isTerminalRow, mergedRowByHead } from '../src/rules/merged-row.js';
import type { PrIndex, PrIndexRow } from '../src/entities/pr-index.js';

const row = (number: number, head: string, state: string, draft = false): PrIndexRow => ({
  number,
  head,
  state,
  draft,
  checks: 'none',
  review: '',
  url: '',
});

const store = (rows: readonly PrIndexRow[]): PrIndex => ({
  v: 3,
  connector: 'github',
  watermark: null,
  complete: true,
  at: '2026-10-08T00:00:00Z',
  rows: [...rows],
});

describe('isTerminalRow', () => {
  it('trusts a MERGED row in any case', () => {
    expect(isTerminalRow(row(1, 'a', 'merged'))).toBe(true);
  });

  it('does not trust OPEN, CLOSED or a draft', () => {
    expect(isTerminalRow(row(1, 'a', 'OPEN'))).toBe(false);
    expect(isTerminalRow(row(1, 'a', 'CLOSED'))).toBe(false);
    expect(isTerminalRow(row(1, 'a', 'MERGED', true))).toBe(false);
  });
});

describe('mergedRowByHead', () => {
  it('is undefined for a branch with no terminal row', () => {
    expect(mergedRowByHead(store([row(1, 'feature/a', 'OPEN')]), 'feature/a')).toBeUndefined();
  });

  it('ignores a merged row for another head', () => {
    expect(mergedRowByHead(store([row(1, 'feature/b', 'MERGED')]), 'feature/a')).toBeUndefined();
  });

  it('picks the lowest-numbered merged row where several match', () => {
    const held = store([row(5, 'feature/a', 'MERGED'), row(2, 'feature/a', 'MERGED')]);
    expect(mergedRowByHead(held, 'feature/a')?.number).toBe(2);
  });
});
