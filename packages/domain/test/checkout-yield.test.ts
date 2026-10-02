import { describe, expect, it } from 'vitest';

import {
  checkoutYield,
  type CheckoutReadings,
  type CheckoutYieldCondition,
} from '../src/rules/checkout-yield.js';

/**
 * The measured case from #1151: the checkout agent `11945014` was blocked by
 * held `bug/the-merge-subject-is-one-rule` with no change, no commit and no
 * `.plot-worker.*` file.
 */
const CLEAN: CheckoutReadings = {
  liveWorker: false,
  blockedMarker: false,
  uncommittedChanges: false,
  unpushedCommits: false,
  registered: false,
  mainCheckout: false,
};

/** Each condition and the reading that holds it, in the order tested. */
const ROWS: readonly (readonly [CheckoutYieldCondition, keyof CheckoutReadings])[] = [
  ['live-worker', 'liveWorker'],
  ['blocked-marker', 'blockedMarker'],
  ['uncommitted-changes', 'uncommittedChanges'],
  ['unpushed-commits', 'unpushedCommits'],
  ['registered', 'registered'],
  ['main-checkout', 'mainCheckout'],
];

describe('checkoutYield', () => {
  it('yields the clean worker-less checkout that blocked agent 11945014', () => {
    expect(checkoutYield(CLEAN)).toEqual({ yields: true });
  });

  describe('each condition keeps the checkout, and names itself', () => {
    it.each(ROWS)('refuses %s when %s is true', (condition, field) => {
      expect(checkoutYield({ ...CLEAN, [field]: true })).toEqual({ yields: false, condition });
    });
  });

  // ABSENT IS NOT FALSE. A reading the shell could not take keeps the checkout,
  // because `git worktree remove` deletes its only copy of whatever the reading
  // missed. `desk_reset_refusal` treats the same `unknown` as no refusal, and a
  // reviewer copying that polarity here would remove a checkout holding
  // unpushed work.
  describe('an unknown reading keeps the checkout', () => {
    it.each(ROWS)('refuses %s when %s is unknown', (condition, field) => {
      expect(checkoutYield({ ...CLEAN, [field]: 'unknown' })).toEqual({ yields: false, condition });
    });
  });

  // THE ORDER IS WHAT THIS PINS. A rule testing in a different order passes
  // every single-condition case above and fails here, so the word the agent's
  // PLOT-BLOCKED carries is fixed rather than incidental.
  describe('two conditions at once name the first tested', () => {
    it('names live-worker over uncommitted-changes', () => {
      expect(checkoutYield({ ...CLEAN, liveWorker: true, uncommittedChanges: true })).toEqual({
        yields: false,
        condition: 'live-worker',
      });
    });

    it('names blocked-marker over registered', () => {
      expect(checkoutYield({ ...CLEAN, blockedMarker: true, registered: true })).toEqual({
        yields: false,
        condition: 'blocked-marker',
      });
    });

    it('names uncommitted-changes over unpushed-commits', () => {
      expect(checkoutYield({ ...CLEAN, uncommittedChanges: true, unpushedCommits: true })).toEqual({
        yields: false,
        condition: 'uncommitted-changes',
      });
    });

    it('names unpushed-commits over main-checkout', () => {
      expect(checkoutYield({ ...CLEAN, unpushedCommits: true, mainCheckout: true })).toEqual({
        yields: false,
        condition: 'unpushed-commits',
      });
    });

    it('names registered over main-checkout', () => {
      expect(checkoutYield({ ...CLEAN, registered: true, mainCheckout: true })).toEqual({
        yields: false,
        condition: 'registered',
      });
    });

    it('names live-worker when every condition holds', () => {
      const held: CheckoutReadings = {
        liveWorker: true,
        blockedMarker: true,
        uncommittedChanges: true,
        unpushedCommits: true,
        registered: true,
        mainCheckout: true,
      };
      expect(checkoutYield(held)).toEqual({ yields: false, condition: 'live-worker' });
    });
  });

  // THE MAIN CHECKOUT IS NEVER REMOVED. Git refuses it itself, and the reading
  // exists so the refusal names `main-checkout` rather than git's own sentence.
  it('refuses the main checkout even with nothing else on it', () => {
    expect(checkoutYield({ ...CLEAN, mainCheckout: true })).toEqual({
      yields: false,
      condition: 'main-checkout',
    });
  });
});
