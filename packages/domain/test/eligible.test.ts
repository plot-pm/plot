import { describe, it, expect } from 'vitest';
import {
  sliceVerdict,
  sliceVerdicts,
  isClaimable,
  type SliceReadings,
} from '../src/rules/eligible.js';

/**
 * A slice with work left, under a plan somebody approved.
 *
 * The base case is the STARTABLE one, so every test below names the one reading
 * it changes and what withholds the word is visible in the test.
 */
const owed = (over: Partial<SliceReadings> = {}): SliceReadings => ({
  outstanding: 1,
  phase: 'approved',
  ...over,
});

describe('sliceVerdict — the four words', () => {
  it('is eligible when work is owed, the plan is approved, and nothing precedes it', () => {
    expect(sliceVerdict(owed(), true)).toBe('eligible');
  });

  it('is complete when nothing is outstanding', () => {
    expect(sliceVerdict(owed({ outstanding: 0 }), true)).toBe('complete');
  });

  it('is blocked when an earlier slice has not landed', () => {
    expect(sliceVerdict(owed(), false)).toBe('blocked');
  });

  it('is unapproved when the plan is not approved', () => {
    expect(sliceVerdict(owed({ phase: 'draft' }), true)).toBe('unapproved');
  });
});

describe('sliceVerdict — complete outranks everything', () => {
  // A slice whose branches have all merged IS complete whatever its plan says:
  // that is a statement about work that already landed, not an invitation to
  // start any. Only the word a reader ACTS on is withheld.
  it('calls a landed slice complete even under a draft plan', () => {
    expect(sliceVerdict({ outstanding: 0, phase: 'draft' }, true)).toBe('complete');
  });

  it('calls a landed slice complete even behind an unlanded one', () => {
    expect(sliceVerdict({ outstanding: 0, phase: 'approved' }, false)).toBe('complete');
  });
});

describe('sliceVerdict — the phase is an allowlist of one', () => {
  // A denylist testing for `draft` would let every other unreadable answer
  // inherit the good word. Measured 2026-08-27: six of six one-slice plans read
  // `eligible` on the live board while `plot-dispatch.sh` refused all six.
  it.each(['draft', 'design', 'delivered', 'released', 'UNKNOWN', 'NONE', '', 'Approved'])(
    'withholds eligible under phase %o',
    (phase) => {
      expect(sliceVerdict(owed({ phase }), true)).toBe('unapproved');
    },
  );

  it('accepts only the lowercase spelling the parser emits', () => {
    expect(sliceVerdict(owed({ phase: 'approved' }), true)).toBe('eligible');
  });
});

describe('sliceVerdict — unapproved is not blocked', () => {
  // They resolve differently: `blocked` by merging work, `unapproved` by a
  // person approving the plan. `blocked by <slice> — 1 branch` is a sentence a
  // row in the second state cannot truthfully complete.
  it('says unapproved rather than blocked when both would apply', () => {
    expect(sliceVerdict(owed({ phase: 'draft' }), false)).toBe('unapproved');
  });
});

describe('sliceVerdicts — the fold', () => {
  it('holds the ordering: only a complete slice lets the next one be eligible', () => {
    expect(sliceVerdicts([
      { outstanding: 0, phase: 'approved' },
      { outstanding: 2, phase: 'approved' },
      { outstanding: 1, phase: 'approved' },
    ])).toEqual(['complete', 'eligible', 'blocked']);
  });

  it('never re-opens the chain once it is broken', () => {
    // A complete slice AFTER an outstanding one does not restore eligibility to
    // the slice behind it — this is exactly what `prior_ok=0` could not undo,
    // and the property a per-slice call would leak back to the caller.
    expect(sliceVerdicts([
      { outstanding: 1, phase: 'approved' },
      { outstanding: 0, phase: 'approved' },
      { outstanding: 1, phase: 'approved' },
    ])).toEqual(['eligible', 'complete', 'blocked']);
  });

  it('stops the chain on unapproved too — a plan nobody approved has landed nothing', () => {
    expect(sliceVerdicts([
      { outstanding: 1, phase: 'draft' },
      { outstanding: 1, phase: 'draft' },
    ])).toEqual(['unapproved', 'unapproved']);
  });

  it('makes the first slice eligible with nothing before it', () => {
    expect(sliceVerdicts([{ outstanding: 3, phase: 'approved' }])).toEqual(['eligible']);
  });

  it('answers nothing for no slices', () => {
    expect(sliceVerdicts([])).toEqual([]);
  });

  it('answers once per slice, in order', () => {
    const slices = Array.from({ length: 7 }, (_, i) => ({
      outstanding: i % 2, phase: 'approved',
    }));
    expect(sliceVerdicts(slices)).toHaveLength(7);
  });
});

describe('isClaimable — what --next may push a ref for', () => {
  it('claims an open branch of an eligible slice', () => {
    expect(isClaimable('eligible', 'open')).toBe(true);
  });

  it.each(['wip', 'merged', 'claimed', 'deferred', 'unknown'] as const)(
    'refuses a %s branch even of an eligible slice',
    (state) => {
      expect(isClaimable('eligible', state)).toBe(false);
    },
  );

  it.each(['complete', 'blocked', 'unapproved'] as const)(
    'refuses an open branch of a %s slice',
    (verdict) => {
      expect(isClaimable(verdict, 'open')).toBe(false);
    },
  );
});
