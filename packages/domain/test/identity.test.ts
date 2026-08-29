import { describe, it, expect } from 'vitest';
import {
  IdentityKindSchema,
  StateSourceSchema,
  identityFailureMode,
  stateFailureMode,
  reading,
  readingAge,
} from '../src/index.js';

/**
 * The two vocabularies DESIGN-review.md names, which no single spec carried.
 *
 * Each entity records its identity kind and its state source, and the estate's
 * design rules follow from which one it is: a STATED state can be wrong so
 * transitions are gated; a DERIVED state is a claim about a moment so it is
 * re-run; a MEASURED value is only true when taken so it carries `measuredAt`.
 */

describe('identity falls into three kinds', () => {
  it('names the three and refuses a fourth', () => {
    expect(IdentityKindSchema.options).toEqual(['slug', 'natural-key', 'minted']);
    expect(IdentityKindSchema.safeParse('uuid').success).toBe(false);
  });

  it('predicts each kind’s failure', () => {
    // The kind predicts the failure: a slug collides, a natural key inherits
    // the source's lie, and a minted identity fails by nobody minting it —
    // measured as 0 manifests against 13 worktrees.
    expect(identityFailureMode('slug')).toBe('collision');
    expect(identityFailureMode('natural-key')).toBe('the source lying');
    expect(identityFailureMode('minted')).toBe('nobody minting');
  });
});

describe('state comes from four sources', () => {
  it('names the four and refuses a fifth', () => {
    expect(StateSourceSchema.options).toEqual(['stated', 'derived', 'foreign', 'measured']);
    expect(StateSourceSchema.safeParse('cached').success).toBe(false);
  });

  it('predicts each source’s failure', () => {
    expect(stateFailureMode('stated')).toBe('being wrong');
    expect(stateFailureMode('derived')).toBe('staleness');
    expect(stateFailureMode('foreign')).toBe('the surface disagreeing');
    expect(stateFailureMode('measured')).toBe('decaying instantly');
  });
});

describe('a measured value carries when it was taken', () => {
  it('pairs the value with its measurement time', () => {
    expect(reading(0.75, 1_000)).toEqual({ value: 0.75, measuredAt: 1_000 });
  });

  it('ages against a clock passed in, never one it reaches for', () => {
    // The domain may not read a clock; `now` arrives from the Clock port. That
    // is what makes decay testable with two numbers and no fake timers.
    expect(readingAge(reading('x', 1_000), 3_500)).toBe(2_500);
  });

  it('reports zero rather than a negative age for a reading from the future', () => {
    // Clock skew between the reader and the caller must not surface as a
    // negative duration a consumer would render.
    expect(readingAge(reading('x', 5_000), 1_000)).toBe(0);
  });
});
