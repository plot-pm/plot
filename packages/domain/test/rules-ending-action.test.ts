import { describe, it, expect } from 'vitest';
import {
  endingAction,
  endingAsksFreshStart,
  endingReleaseBranch,
  holdingWorkAnswer,
  boundAnswer,
  needsPersonMarker,
  secondFreshSessionMarker,
  NEEDS_PERSON_ENDINGS,
  type EndingActionReadings,
} from '../src/rules/ending-action.js';
import { EndingReasonSchema, type EndingReading, type EndingReason } from '../src/entities/ending.js';

const readings = (over: Partial<EndingActionReadings> = {}): EndingActionReadings => ({
  ending: 'nothing-done',
  branch: 'infra/x',
  refusedAssignment: '',
  hasManifest: false,
  priorFreshSessions: 0,
  commitBeyondClaim: 'no',
  prOpen: false,
  dirtyTree: 'no',
  prMerged: 'not-merged',
  endingAsked: false,
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

  const NEEDS_PERSON_OUTRIGHT = ['blocked', 'spend-limit', 'unstarted', 'run-limit', 'checks-unanswered'];

  it('leaves every ending but nothing-done, corrections-spent, turn-limit, holding-work, bound, unreadable and the five outright needs-a-person reasons alone', () => {
    const handled = new Set([
      'nothing-done',
      'corrections-spent',
      'turn-limit',
      'holding-work',
      'bound',
      'unreadable',
      ...NEEDS_PERSON_OUTRIGHT,
    ]);
    for (const ending of EndingReasonSchema.options.filter((r) => !handled.has(r))) {
      expect(endingAction(readings({ ending }))).toBe('leave');
    }
  });

  for (const reason of ['bound', 'unreadable'] as const) {
    describe(`${reason}`, () => {
      it(`releases the claim on a first ${reason} ending whose branch holds nothing beyond its claim`, () => {
        expect(endingAction(readings({ ending: reason }))).toBe('release-claim');
      });

      it(`starts a fresh session on a first ${reason} ending whose branch holds a commit beyond its claim`, () => {
        expect(endingAction(readings({ ending: reason, commitBeyondClaim: 'yes' }))).toBe('start-fresh');
      });

      it(`starts a fresh session on a first ${reason} ending whose branch holds an open PR`, () => {
        expect(endingAction(readings({ ending: reason, prOpen: true }))).toBe('start-fresh');
      });

      it(`starts a fresh session on a first ${reason} ending whose branch holds a dirty tree and no commit — a row that reads only commitBeyondClaim/prOpen wrongly releases here`, () => {
        expect(endingAction(readings({ ending: reason, commitBeyondClaim: 'no', prOpen: false, dirtyTree: 'yes' }))).toBe('start-fresh');
      });

      it(`takes the protective arm on an unanswerable reading rather than releasing — absent is not false`, () => {
        expect(endingAction(readings({ ending: reason, commitBeyondClaim: 'unanswerable' }))).toBe('start-fresh');
        expect(endingAction(readings({ ending: reason, prOpen: 'unanswerable' }))).toBe('start-fresh');
        expect(endingAction(readings({ ending: reason, dirtyTree: 'unanswerable' }))).toBe('start-fresh');
      });

      it(`asks a person on a second ${reason} ending for the same slice`, () => {
        expect(endingAction(readings({ ending: reason, commitBeyondClaim: 'yes', priorFreshSessions: 1 }))).toBe('needs-a-person');
      });

      it(`leaves a ${reason} ending whose branch's PR merged — no fresh session, no marker, no release`, () => {
        expect(endingAction(readings({ ending: reason, commitBeyondClaim: 'yes', prMerged: 'merged' }))).toBe('leave');
        expect(endingAction(readings({ ending: reason, commitBeyondClaim: 'yes', priorFreshSessions: 1, prMerged: 'merged' }))).toBe('leave');
        expect(endingAction(readings({ ending: reason, prMerged: 'merged' }))).toBe('leave');
      });

      it(`reads an unanswerable merge as not merged on a ${reason} ending`, () => {
        expect(endingAction(readings({ ending: reason, commitBeyondClaim: 'yes', prMerged: 'unanswerable' }))).toBe('start-fresh');
      });
    });
  }

  it('reads one fresh-session count for bound and the three other fresh-session endings alike — no allowance per ending', () => {
    for (const ending of ['bound', 'corrections-spent', 'turn-limit', 'holding-work'] as const) {
      expect(endingAction(readings({ ending, commitBeyondClaim: 'yes', priorFreshSessions: 0 })), ending).toBe('start-fresh');
      expect(endingAction(readings({ ending, commitBeyondClaim: 'yes', priorFreshSessions: 1 })), ending).toBe('needs-a-person');
    }
  });

  it('asks a person outright for blocked, spend-limit, unstarted, run-limit and checks-unanswered, with no fresh session first', () => {
    for (const ending of NEEDS_PERSON_OUTRIGHT) {
      expect(endingAction(readings({ ending: ending as EndingReason }))).toBe('needs-a-person');
      // NO priorFreshSessions BRANCH: a slice's first time at one of these five
      // still goes straight to a person, unlike corrections-spent/turn-limit/holding-work.
      expect(endingAction(readings({ ending: ending as EndingReason, priorFreshSessions: 0 }))).toBe('needs-a-person');
    }
  });

  it('leaves an outright needs-a-person ending alone once its PR merged — nobody sees a merged row, and a marker would refuse the reap', () => {
    for (const ending of NEEDS_PERSON_OUTRIGHT) {
      expect(endingAction(readings({ ending: ending as EndingReason, prMerged: 'merged' }))).toBe('leave');
    }
  });

  it('still asks a person where the host could not say whether the PR merged — absent is not false', () => {
    for (const ending of NEEDS_PERSON_OUTRIGHT) {
      expect(endingAction(readings({ ending: ending as EndingReason, prMerged: 'unanswerable' }))).toBe('needs-a-person');
    }
  });

  it('leaves an ending a person was already asked about — the answer removes the marker, not the ending', () => {
    for (const ending of [...NEEDS_PERSON_OUTRIGHT, 'corrections-spent', 'turn-limit', 'holding-work', 'bound', 'unreadable']) {
      const asked = readings({ ending: ending as EndingReason, commitBeyondClaim: 'yes', priorFreshSessions: 1, endingAsked: true });
      expect(endingAction(asked)).toBe('leave');
      expect(endingAction({ ...asked, endingAsked: false })).toBe('needs-a-person');
    }
  });

  it('an asked ending never stops a release or a first fresh session — the reading only answers for a person', () => {
    expect(endingAction(readings({ endingAsked: true }))).toBe('release-claim');
    expect(endingAction(readings({ ending: 'corrections-spent', endingAsked: true }))).toBe('start-fresh');
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

describe('needsPersonMarker', () => {
  it('names a broken invocation and a prompt or command fix for unstarted', () => {
    const text = needsPersonMarker('unstarted', 'infra/x', 'exit 1: Session ID is already in use');
    expect(text).toContain('infra/x');
    expect(text).toContain('never ran a slice');
    expect(text).toContain('fix the prompt or command');
    expect(text).toContain('exit 1: Session ID is already in use');
  });

  it('names a spent spend-limit and asks whether to continue', () => {
    const text = needsPersonMarker('spend-limit', 'infra/x', 'Agent max spend reached: $12.00');
    expect(text).toContain('spend limit');
    expect(text).toContain('$12.00');
    expect(text).toContain('raise the spend limit');
  });

  it('names a spent run-limit and asks whether to continue', () => {
    const text = needsPersonMarker('run-limit', 'infra/x', 'Slice max runs reached: 5');
    expect(text).toContain('run limit');
    expect(text).toContain('5');
    expect(text).toContain('used every run');
  });

  it('names a no-answer checks-unanswered as an unwatched build', () => {
    const text = needsPersonMarker('checks-unanswered', 'infra/x', 'no-answer: Checks wait expired after 1800s');
    expect(text).toContain('No build ever answered');
    expect(text).toContain('nothing from the build connector');
    expect(text).not.toContain('remote tip moved');
  });

  it('names a tip-moved checks-unanswered as another commit shadowing this one', () => {
    const text = needsPersonMarker('checks-unanswered', 'infra/x', 'tip-moved: remote tip is 0e64fafd, agent pushed f743e573');
    expect(text).toContain('remote tip moved');
    expect(text).toContain('0e64fafd');
    expect(text).not.toContain('nothing from the build connector');
  });

  it('names a blocked agent\'s own report and asks how it should proceed', () => {
    const text = needsPersonMarker('blocked', 'infra/x', 'the agent asked whether to drop the migration');
    expect(text).toContain('reported it could not proceed');
    expect(text).toContain('whether to drop the migration');
    expect(text).toContain('how it should proceed');
  });

  it('gives every reason meaningfully distinct wording — no two share a sentence', () => {
    const reasons: EndingReason[] = ['unstarted', 'spend-limit', 'run-limit', 'checks-unanswered', 'blocked'];
    const texts = reasons.map((reason) => needsPersonMarker(reason, 'infra/x', 'the same detail'));
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('composes non-empty text naming the branch for every reason in NEEDS_PERSON_ENDINGS', () => {
    expect(NEEDS_PERSON_ENDINGS.size).toBe(5);
    for (const reason of NEEDS_PERSON_ENDINGS) {
      const text = needsPersonMarker(reason, 'infra/x', 'd');
      expect(text).toContain('infra/x');
      expect(text).toContain('Decide');
    }
  });

  it('composes the second-fresh-session question for corrections-spent, turn-limit, holding-work, bound and unreadable', () => {
    for (const reason of ['corrections-spent', 'turn-limit', 'holding-work', 'bound', 'unreadable'] as const) {
      const text = needsPersonMarker(reason, 'infra/x', 'ignored');
      expect(text).toBe(secondFreshSessionMarker(reason, 'infra/x'));
      expect(text).toContain('already had its one fresh session');
      expect(text).toContain(`(${reason})`);
    }
  });

  it('refuses to compose for an ending outside its five', () => {
    expect(() => needsPersonMarker('nothing-done', 'infra/x', '')).toThrow();
  });

  it('says no detail was recorded when the ending carried none, for every reason that can fall back', () => {
    for (const ending of ['unstarted', 'spend-limit', 'run-limit', 'blocked'] as const) {
      expect(needsPersonMarker(ending, 'infra/x', '')).toContain('no detail was recorded');
    }
    expect(needsPersonMarker('checks-unanswered', 'infra/x', '')).toContain('no detail was recorded');
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

describe('boundAnswer', () => {
  it('names the branch, the time-out, and every held file', () => {
    const answer = boundAnswer('infra/prior', ['a.ts', 'b/c.ts']);
    expect(answer).toContain('`infra/prior`');
    expect(answer).toContain('time bound');
    expect(answer).toContain('- a.ts');
    expect(answer).toContain('- b/c.ts');
  });

  it('says the files could not be listed rather than giving an empty list — absent is not false', () => {
    const answer = boundAnswer('infra/prior', null);
    expect(answer).toContain('could not be listed');
    expect(answer).not.toContain('- ');
  });

  it('says so when no file was listed as held', () => {
    const answer = boundAnswer('infra/prior', []);
    expect(answer).toContain('No file was listed as held');
  });
});

describe('endingAsksFreshStart', () => {
  const ended = (reason: string, branch = 'infra/x', refusedAssignment = ''): EndingReading => ({
    read: 'ended',
    ending: { reason, actor: 'agent', branch, detail: '', refusedAssignment } as never,
  });

  it('answers true for exactly the endings endingAction starts a first fresh session for, outside bound/unreadable', () => {
    // bound/unreadable are excluded here because their start-fresh answer is
    // conditional on readings this function never sees (commitBeyondClaim,
    // prOpen, dirtyTree) — see the dedicated assertions below.
    for (const reason of EndingReasonSchema.options.filter((r) => r !== 'bound' && r !== 'unreadable')) {
      const expected = endingAction(readings({ ending: reason })) === 'start-fresh';
      expect(endingAsksFreshStart(ended(reason), 'infra/x'), reason).toBe(expected);
    }
  });

  it('answers true for an after-prompt holding-work, turn-limit and corrections-spent', () => {
    for (const reason of ['holding-work', 'turn-limit', 'corrections-spent']) {
      expect(endingAsksFreshStart(ended(reason), 'infra/x'), reason).toBe(true);
    }
  });

  it('answers true for bound and unreadable on the ending\'s own branch and false for another branch', () => {
    for (const reason of ['bound', 'unreadable']) {
      expect(endingAsksFreshStart(ended(reason, 'infra/x'), 'infra/x'), reason).toBe(true);
      expect(endingAsksFreshStart(ended(reason, 'infra/other'), 'infra/x'), reason).toBe(false);
    }
  });

  it('answers true for a holding-work whose refused assignment is its own branch', () => {
    expect(endingAsksFreshStart(ended('holding-work', 'infra/x', 'infra/x'), 'infra/x')).toBe(true);
  });

  it('answers false for a take-up holding-work', () => {
    expect(endingAsksFreshStart(ended('holding-work', 'infra/x', 'infra/other'), 'infra/x')).toBe(false);
  });

  it('answers false for an ending written for another branch', () => {
    expect(endingAsksFreshStart(ended('holding-work', 'infra/other'), 'infra/x')).toBe(false);
  });

  it('answers false for an absent or unreadable ending', () => {
    expect(endingAsksFreshStart({ read: 'absent' }, 'infra/x')).toBe(false);
    expect(endingAsksFreshStart({ read: 'unreadable', why: 'not JSON' }, 'infra/x')).toBe(false);
  });
});
