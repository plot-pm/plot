import { describe, it, expect } from 'vitest';
import {
  endingAction,
  endingReleaseBranch,
  holdingWorkAnswer,
  type EndingActionReadings,
} from '../src/rules/ending-action.js';
import { EndingReasonSchema } from '../src/entities/ending.js';

const readings = (over: Partial<EndingActionReadings> = {}): EndingActionReadings => ({
  ending: 'nothing-done',
  branch: 'infra/x',
  refusedAssignment: '',
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

  it('leaves a nothing-done ending alone when the host could not say whether a PR is open — absent is not false', () => {
    expect(endingAction(readings({ prOpen: 'unanswerable' }))).toBe('leave');
  });

  it('releases the nothing-done ending\'s own branch', () => {
    expect(endingReleaseBranch(readings())).toBe('infra/x');
  });

  it('releases the refused assignment, never the desk\'s branch, for a take-up holding-work (#1281)', () => {
    const takeUp = readings({ ending: 'holding-work', branch: 'infra/prior', refusedAssignment: 'infra/x', commitBeyondClaim: 'yes', prOpen: true });
    expect(endingAction(takeUp)).toBe('release-claim');
    expect(endingReleaseBranch(takeUp)).toBe('infra/x');
  });

  it('starts a fresh session for an after-prompt holding-work ending that refused no assignment', () => {
    expect(endingAction(readings({ ending: 'holding-work', branch: 'infra/prior' }))).toBe('start-fresh');
  });

  it('starts a fresh session for a holding-work ending whose refused assignment is the desk\'s own branch', () => {
    expect(endingAction(readings({ ending: 'holding-work', branch: 'infra/x', refusedAssignment: 'infra/x' }))).toBe('start-fresh');
  });

  it('asserts both arms of holding-work in one test — an empty refusedAssignment is never mistaken for a take-up', () => {
    const takeUp = readings({ ending: 'holding-work', branch: 'infra/prior', refusedAssignment: 'infra/x', commitBeyondClaim: 'yes', prOpen: true });
    const afterPrompt = readings({ ending: 'holding-work', branch: 'infra/prior', refusedAssignment: '' });
    expect(endingAction(takeUp)).toBe('release-claim');
    expect(endingReleaseBranch(takeUp)).toBe('infra/x');
    expect(endingAction(afterPrompt)).toBe('start-fresh');
  });

  it('asks a person on a second after-prompt holding-work ending for the same slice', () => {
    expect(endingAction(readings({ ending: 'holding-work', branch: 'infra/prior', priorFreshSessions: 1 }))).toBe('needs-a-person');
  });

  it('starts one fresh session the first time a slice reaches corrections-spent', () => {
    expect(endingAction(readings({ ending: 'corrections-spent' }))).toBe('start-fresh');
  });

  it('asks a person on a second corrections-spent ending for the same slice', () => {
    expect(endingAction(readings({ ending: 'corrections-spent', priorFreshSessions: 1 }))).toBe('needs-a-person');
  });

  it('starts one fresh session the first time a slice reaches turn-limit', () => {
    expect(endingAction(readings({ ending: 'turn-limit' }))).toBe('start-fresh');
  });

  it('asks a person on a second turn-limit ending for the same slice', () => {
    expect(endingAction(readings({ ending: 'turn-limit', priorFreshSessions: 1 }))).toBe('needs-a-person');
  });

  it('asks a person after corrections-spent then holding-work — the count is shared across endings, not kept per-ending', () => {
    // CATCHES A PER-ENDING COUNTER: a rule that gave corrections-spent and
    // holding-work separate allowances would answer start-fresh here, having
    // never seen a second holding-work ending for this slice.
    expect(endingAction(readings({ ending: 'holding-work', branch: 'infra/prior', priorFreshSessions: 1 }))).toBe('needs-a-person');
  });

  it('leaves every ending but nothing-done, corrections-spent, turn-limit and holding-work alone', () => {
    const handled = new Set(['nothing-done', 'corrections-spent', 'turn-limit', 'holding-work']);
    for (const ending of EndingReasonSchema.options.filter((r) => !handled.has(r))) {
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
      expect(endingAction(readings({ ending, hasManifest: true, branch: 'infra/prior', refusedAssignment: 'infra/x' }))).toBe('leave');
    }
  });
});

describe('holdingWorkAnswer', () => {
  it('names the branch and every held file', () => {
    const answer = holdingWorkAnswer('infra/prior', ['a.ts', 'b/c.ts']);
    expect(answer).toContain('`infra/prior`');
    expect(answer).toContain('- a.ts');
    expect(answer).toContain('- b/c.ts');
  });

  it('says the files could not be listed rather than giving an empty list — absent is not false', () => {
    const answer = holdingWorkAnswer('infra/prior', null);
    expect(answer).toContain('could not be listed');
    expect(answer).not.toContain('- ');
  });

  it('says so when the ending reported held work but no file was listed', () => {
    const answer = holdingWorkAnswer('infra/prior', []);
    expect(answer).toContain('No file was listed as held');
  });
});
