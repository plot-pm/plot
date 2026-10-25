import { describe, expect, it } from 'vitest';

import { answered, failed, unaskable } from '../src/port-result.js';
import { asksOtherHost, crossRepoAnswer } from '../src/rules/cross-repo-probe.js';

const isNull = (v: string | null): boolean => v === null;
const MISS = answered<string | null>(null);
const HIT = answered<string | null>('pr');

describe('asksOtherHost', () => {
  it('asks on a clean miss only', () => {
    expect(asksOtherHost(MISS, isNull)).toBe(true);
    expect(asksOtherHost(HIT, isNull)).toBe(false);
    expect(asksOtherHost(failed<string | null>(), isNull)).toBe(false);
    expect(asksOtherHost(unaskable<string | null>(), isNull)).toBe(false);
  });
});

describe('crossRepoAnswer', () => {
  it('answers what the other backend holds', () => {
    expect(crossRepoAnswer(MISS, HIT, isNull)).toBe(HIT);
  });

  it('keeps the first miss where the other backend misses too', () => {
    expect(crossRepoAnswer(MISS, answered<string | null>(null), isNull)).toBe(MISS);
  });

  it('fails where the other backend could not be asked', () => {
    expect(crossRepoAnswer(MISS, failed<string | null>(), isNull)).toEqual({ ok: false, why: 'failed' });
  });

  it('keeps the first miss where the other backend has no answer at all', () => {
    expect(crossRepoAnswer(MISS, unaskable<string | null>(), isNull)).toBe(MISS);
  });
});
