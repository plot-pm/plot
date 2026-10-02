import { describe, it, expect } from 'vitest';
import { handedTo, type HandedReading } from '../src/index.js';

/**
 * `handedTo` — which live agents the registry handed a branch to.
 *
 * NO BROWSER, NO REGISTRY AND NO PROCESS. Every case here is a plain record,
 * which is what taking readings as values buys: the three facts the rule reads
 * are already on the manifest the board loaded, so the rule needs nothing from
 * the world.
 *
 * **The state cases are the agreement with the board, and they are the reason
 * the list is spelled twice.** The domain may not import the board's
 * `LIVE_STATES`, so the two words live in both packages and these assertions
 * are what stops them drifting: `running` and `waiting` match, and the four
 * states a reader might mistake for live do not.
 */

const reading = (over: Partial<HandedReading> = {}): HandedReading => ({
  session: '334b3492',
  state: 'running',
  branch: 'bug/the-rule-names-a-usage-limit',
  ...over,
});

const BRANCH = 'bug/the-rule-names-a-usage-limit';

describe('handedTo — the live agents on a branch', () => {
  it('names the session of a running agent holding the branch', () => {
    expect(handedTo(BRANCH, [reading()])).toEqual(['334b3492']);
  });

  it('names the session of a waiting agent holding the branch', () => {
    // `waiting` is live: it holds a machine slot and renders in WORKING, so the
    // row must agree with the section its agent appears in.
    expect(handedTo(BRANCH, [reading({ state: 'waiting', session: '4b603822' })]))
      .toEqual(['4b603822']);
  });

  it('names nobody for a free agent holding no branch', () => {
    expect(handedTo(BRANCH, [reading({ branch: '' })])).toEqual([]);
  });

  it('names nobody for an agent on a different branch', () => {
    expect(handedTo(BRANCH, [reading({ branch: 'bug/a-closed-sprint-stops-filtering' })]))
      .toEqual([]);
  });

  // THE FOUR STATES THAT ARE NOT LIVE. Each stopped or holds no process, so no
  // worker is on the branch now and the row keeps the scan's answer — #1090's
  // reading, which absence must never overturn.
  for (const state of ['failed', 'stalled', 'finished', 'ended']) {
    it(`names nobody for a ${state} agent holding the branch`, () => {
      expect(handedTo(BRANCH, [reading({ state })])).toEqual([]);
    });
  }

  it('names both sessions, sorted, when two live agents hold one branch', () => {
    // A fault a person reads, so the pair must print the same way twice. The
    // input is reversed to prove the sort rather than the input order.
    expect(handedTo(BRANCH, [
      reading({ session: 'f00dbeef' }),
      reading({ session: '0ddba11', state: 'waiting' }),
    ])).toEqual(['0ddba11', 'f00dbeef']);
  });

  it('names nobody for an empty branch, however many free agents there are', () => {
    // `''` is a real value on both sides, not a gap: without this arm every
    // free agent would be handed to every branchless row.
    expect(handedTo('', [reading({ branch: '' }), reading({ branch: '' })])).toEqual([]);
  });

  it('names nobody when the registry is empty', () => {
    expect(handedTo(BRANCH, [])).toEqual([]);
  });
});
