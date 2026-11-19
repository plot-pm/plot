import { describe, expect, it } from 'vitest';
import { carriedReview, diffIdentity } from '../src/rules/review-carry.js';

const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
const PASSED = 'Findings: HIGH 0, MEDIUM 1, LOW 0\n';

const diffAt = (index: string, line: number, context = ' const a = 1;') =>
  [
    'diff --git a/src/x.ts b/src/x.ts',
    `index ${index} 100644`,
    '--- a/src/x.ts',
    '+++ b/src/x.ts',
    `@@ -${line},3 +${line},4 @@ export const f = () => {`,
    context,
    '+const b = 2;',
    ' const c = 3;',
    '',
  ].join('\n');

describe('diffIdentity', () => {
  it('ignores index lines and hunk line numbers', () => {
    expect(diffIdentity(diffAt('1111111..2222222', 10))).toBe(diffIdentity(diffAt('3333333..4444444', 42)));
  });

  it('keeps a changed context line', () => {
    expect(diffIdentity(diffAt('1111111..2222222', 10))).not.toBe(diffIdentity(diffAt('1111111..2222222', 10, ' const a = 9;')));
  });

  it('keeps an added line that reads like an index line', () => {
    expect(diffIdentity('+index 1..2 100644\n')).toBe('+index 1..2 100644\n');
  });
});

describe('carriedReview', () => {
  it('carries a passed verdict whose diff moved only in position', () => {
    const prior = { head: OLD, diff: diffAt('1111111..2222222', 10), verdictText: PASSED };
    expect(carriedReview(NEW, diffAt('5555555..6666666', 80), [prior])).toEqual({
      from: OLD,
      verdictText: PASSED,
      counts: { high: 0, medium: 1, low: 0 },
    });
  });

  it('carries nothing where the change differs', () => {
    const prior = { head: OLD, diff: diffAt('1111111..2222222', 10), verdictText: PASSED };
    expect(carriedReview(NEW, diffAt('1111111..2222222', 10, ' const a = 9;'), [prior])).toBeNull();
  });

  it('carries nothing from a verdict with a HIGH finding', () => {
    const prior = { head: OLD, diff: diffAt('1111111..2222222', 10), verdictText: 'Findings: HIGH 1, MEDIUM 0, LOW 0\n' };
    expect(carriedReview(NEW, diffAt('1111111..2222222', 10), [prior])).toBeNull();
  });

  it('carries nothing from an unreadable verdict', () => {
    const prior = { head: OLD, diff: diffAt('1111111..2222222', 10), verdictText: 'no counts here' };
    expect(carriedReview(NEW, diffAt('1111111..2222222', 10), [prior])).toBeNull();
  });

  it('carries nothing from a review of the same head', () => {
    const prior = { head: NEW, diff: diffAt('1111111..2222222', 10), verdictText: PASSED };
    expect(carriedReview(NEW, diffAt('1111111..2222222', 10), [prior])).toBeNull();
  });

  it('carries nothing for an empty diff', () => {
    expect(carriedReview(NEW, '', [{ head: OLD, diff: '', verdictText: PASSED }])).toBeNull();
  });

  it('takes the first qualifying review in input order', () => {
    const other = 'c'.repeat(40);
    const priors = [
      { head: other, diff: diffAt('1111111..2222222', 10, ' const z = 0;'), verdictText: PASSED },
      { head: OLD, diff: diffAt('1111111..2222222', 10), verdictText: PASSED },
    ];
    expect(carriedReview(NEW, diffAt('1111111..2222222', 12), priors)?.from).toBe(OLD);
  });
});
