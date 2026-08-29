import { describe, it, expect } from 'vitest';
import {
  answered,
  failed,
  unaskable,
  isAnswered,
  valueOr,
  type PortResult,
} from '../src/index.js';

/**
 * The three-outcome result, pinned as a type rather than a discipline.
 *
 * The estate has paid for the two-outcome version repeatedly — a `--no-fetch`
 * scan reading 43 merged branches as open, `state: CLOSED` on a merged PR. The
 * tests that matter here are the ones asserting the THIRD value survives.
 */

describe('a port answers, breaks, or cannot be asked', () => {
  it('carries the value when the source answered', () => {
    expect(answered(7)).toEqual({ ok: true, value: 7 });
  });

  it('treats an empty answer as an answer, not a failure', () => {
    // `this branch has no PR` and `I could not ask about this branch` are
    // different facts; exit 0 with a NONE payload is the first one.
    const empty = answered([]);
    expect(empty.ok).toBe(true);
    expect(isAnswered(empty) && empty.value).toEqual([]);
  });

  it('keeps failed and unaskable apart', () => {
    // An expired token is an incident; a Bitbucket repo with no tracker is a
    // config fact. Collapsing them loses the only value that made this safe.
    expect(failed()).toEqual({ ok: false, why: 'failed' });
    expect(unaskable()).toEqual({ ok: false, why: 'unaskable' });
    expect(failed()).not.toEqual(unaskable());
  });

  it('narrows to the answered arm and refuses both failures', () => {
    expect(isAnswered(answered('x'))).toBe(true);
    expect(isAnswered(failed<string>())).toBe(false);
    expect(isAnswered(unaskable<string>())).toBe(false);
  });

  it('falls back for either failure, and never for an answer', () => {
    expect(valueOr(answered('real'), 'fallback')).toBe('real');
    expect(valueOr(failed<string>(), 'fallback')).toBe('fallback');
    expect(valueOr(unaskable<string>(), 'fallback')).toBe('fallback');
  });

  it('falls back for an answered value that is itself falsy', () => {
    // The bug a truthiness check would introduce: 0 and '' are answers.
    expect(valueOr(answered(0), 99)).toBe(0);
    expect(valueOr(answered(''), 'fallback')).toBe('');
  });

  it('discriminates the union exhaustively on `why`', () => {
    // The compiler enforces this; the test states it, so a fourth outcome
    // added without a reader here fails visibly rather than silently.
    const describeResult = (r: PortResult<number>): string =>
      r.ok ? `value ${r.value}` : r.why;
    expect(describeResult(answered(1))).toBe('value 1');
    expect(describeResult(failed())).toBe('failed');
    expect(describeResult(unaskable())).toBe('unaskable');
  });
});
