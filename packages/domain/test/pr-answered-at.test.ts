import { describe, expect, it } from 'vitest';

import { prAnsweredAt } from '../src/rules/pr-answered-at.js';

describe('prAnsweredAt', () => {
  const rowsChanged = Date.parse('2026-11-25T10:00:00Z');
  const lastAnswer = Date.parse('2026-11-25T13:57:30Z');

  it('takes the last answer where it is later than the last change of the rows', () => {
    expect(prAnsweredAt(rowsChanged, lastAnswer)).toBe(lastAnswer);
  });

  it('takes the reading time where the reader published no answer time', () => {
    expect(prAnsweredAt(rowsChanged, null)).toBe(rowsChanged);
    expect(prAnsweredAt(rowsChanged, undefined)).toBe(rowsChanged);
  });

  it('never moves the age back to an answer older than the reading', () => {
    expect(prAnsweredAt(lastAnswer, rowsChanged)).toBe(lastAnswer);
  });
});
