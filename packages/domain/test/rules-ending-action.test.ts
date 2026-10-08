import { describe, it, expect } from 'vitest';
import { endingAction, type EndingActionReadings } from '../src/rules/ending-action.js';
import { EndingReasonSchema } from '../src/entities/ending.js';

const readings = (over: Partial<EndingActionReadings> = {}): EndingActionReadings => ({
  ending: 'nothing-done',
  branch: 'infra/x',
  hasManifest: false,
  priorFreshSessions: 0,
  commitBeyondClaim: 'no',
  prOpen: false,
  ...over,
});

describe('endingAction', () => {
  it('releases the claim on nothing-done with no manifest, no commit beyond the claim, no PR', () => {
    expect(endingAction(readings())).toBe('release-claim');
  });

  it('leaves a manifest-named desk alone, whatever the ending says', () => {
    expect(endingAction(readings({ hasManifest: true }))).toBe('leave');
  });

  it('leaves every ending but nothing-done alone', () => {
    for (const ending of EndingReasonSchema.options.filter((r) => r !== 'nothing-done')) {
      expect(endingAction(readings({ ending }))).toBe('leave');
    }
  });

  it('leaves a nothing-done ending with a commit beyond the claim alone', () => {
    expect(endingAction(readings({ commitBeyondClaim: 'yes' }))).toBe('leave');
  });

  it('leaves a nothing-done ending with an unanswerable commit read alone — absent is not false', () => {
    expect(endingAction(readings({ commitBeyondClaim: 'unanswerable' }))).toBe('leave');
  });

  it('leaves a nothing-done ending with an open PR alone', () => {
    expect(endingAction(readings({ prOpen: true }))).toBe('leave');
  });

  it('leaves a missing ending alone', () => {
    expect(endingAction(readings({ ending: null }))).toBe('leave');
  });

  it('a manifest-named desk answers leave for every ending', () => {
    for (const ending of EndingReasonSchema.options) {
      expect(endingAction(readings({ ending, hasManifest: true }))).toBe('leave');
    }
  });
});
