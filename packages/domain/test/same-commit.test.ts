import { describe, expect, it } from 'vitest';

import { sameCommit } from '../src/rules/same-commit.js';

const HEAD40 = '66836536f8c9'.padEnd(40, 'a');

describe('sameCommit', () => {
  it('matches a 12-character head against the matching 40-character sha', () => {
    expect(sameCommit('66836536f8c9', HEAD40)).toBe(true);
  });

  it('matches in the other direction too: a short caller sha against a long head', () => {
    expect(sameCommit(HEAD40, '66836536f8c9')).toBe(true);
  });

  it('refuses a 6-character pin even when it is a true prefix of the head', () => {
    expect(sameCommit('668365', HEAD40)).toBe(false);
  });

  it('refuses a 12-character pin that differs from the head in its last character', () => {
    expect(sameCommit('66836536f8c8', HEAD40)).toBe(false);
  });

  it('matches ignoring case', () => {
    expect(sameCommit('66836536F8C9', HEAD40)).toBe(true);
  });

  it('refuses a non-hex pin of seven or more characters', () => {
    expect(sameCommit('g6836536f8c9', HEAD40)).toBe(false);
  });

  it('refuses two equal-length shas that differ', () => {
    expect(sameCommit('a'.repeat(40), 'b'.repeat(40))).toBe(false);
  });

  it('matches two equal 40-character shas', () => {
    expect(sameCommit(HEAD40, HEAD40)).toBe(true);
  });
});
