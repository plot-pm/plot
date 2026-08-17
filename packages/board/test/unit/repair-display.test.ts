import { describe, it, expect } from 'vitest';
import { repairWord, offersAction } from '../../src/app/components/AgentList.js';
import {
  RepairSchema, StuckStateSchema, type Repair, type StuckState,
} from '../../src/contract/schema.js';
import { dispatchAvailability } from '../../src/server/dispatch.js';

/**
 * WHAT THE ROW SAYS ABOUT THE ONE AUTOMATIC WRITE.
 *
 * **A silent automatic write is indistinguishable from a defect** — the failure
 * mode the whole stuck-branch plan exists to remove, and the one that would
 * arrive precisely here. The branch stays `artifact-conflict` for the entire
 * repair (nothing about the refs changes until the push lands), so a row that
 * reported only `stuck` would sit unchanged for five minutes while a machine
 * wrote to the branch. From the outside that is identical to the pulse ignoring
 * it.
 *
 * The decisions live in an exported pure function, in this repo's recent
 * practice, and are asserted without a page.
 */

const repair = (over: Partial<Repair> = {}): Repair => ({
  branch: 'feature/x',
  state: 'finished',
  outcome: 'pushed',
  reason: '',
  at: 0,
  log: '',
  ...over,
});

describe('repairWord — every repair is reported', () => {
  it('says a repair is running while it runs', () => {
    const word = repairWord(repair({ state: 'running', outcome: '' }));
    expect(word).not.toBe('');
    expect(word).toMatch(/repair/i);
  });

  it('says a repair succeeded', () => {
    expect(repairWord(repair({ outcome: 'pushed' }))).toMatch(/repaired/i);
  });

  // THE FAILURES ARE REPORTED AS LOUDLY AS THE SUCCESS. An implementation that
  // reported only `pushed` passes every assertion that a successful repair is
  // visible, and goes quiet exactly when a reader needs it — a repair that gave
  // up leaves a conflict that is now a human's.
  it('says a repair was abandoned, and that nothing was pushed', () => {
    const word = repairWord(repair({ outcome: 'abandoned', reason: 'tests-failed' }));
    expect(word).toMatch(/abandon/i);
    expect(word).toMatch(/nothing was pushed/i);
    // The script's own word travels rather than being translated: two gates end
    // in the same place for the reader and different places for whoever opens
    // the log.
    expect(word).toContain('tests-failed');
  });

  it('says a repair was refused, naming why', () => {
    expect(repairWord(repair({ outcome: 'refused', reason: 'not-artifact-only' })))
      .toContain('not-artifact-only');
  });

  it('every outcome the contract declares produces a word', () => {
    const outcomes = RepairSchema.shape.outcome
      .safeParse('pushed').success ? ['pushed', 'abandoned', 'refused'] as const : [];
    for (const outcome of outcomes) {
      expect(repairWord(repair({ outcome }))).not.toBe('');
    }
    // Running has no outcome yet and must still say something.
    expect(repairWord(repair({ state: 'running', outcome: '' }))).not.toBe('');
  });

  it('a branch nothing was attempted on says nothing at all', () => {
    // The common case, and it must cost nothing: most rows carry no repair, and
    // a line on every row would make the repaired ones invisible.
    expect(repairWord(null)).toBe('');
    expect(repairWord(undefined)).toBe('');
  });
});

describe('the resolver widens nothing that already existed', () => {
  // THE LOCALHOST GUARD IS UNCHANGED. The resolver is a separate path — it
  // rides the scan timer and is not a route at all — and it must not have
  // loosened the two routes that are. `/api/dispatch` and `/api/approve` share
  // this one availability function, and the HTTP-level refusals are asserted in
  // `dispatch.test.mjs` and `approve.test.mjs` against a really-bound server.
  it('still refuses a non-localhost binding for the guarded routes', () => {
    expect(dispatchAvailability('localhost').available).toBe(true);
    expect(dispatchAvailability('127.0.0.1').available).toBe(true);
    expect(dispatchAvailability('::1').available).toBe(true);

    for (const host of ['0.0.0.0', '192.168.1.10', 'board.tail1234.ts.net']) {
      const verdict = dispatchAvailability(host);
      expect(verdict.available).toBe(false);
      // And it NAMES the reason — the cue shows there while the action refuses.
      expect(verdict.reason).not.toBe('');
    }
  });

  // WAVE 2's OFFER SET IS UNTOUCHED. `artifact-conflict` offers no action
  // because the pulse repairs it, and `unpushed` offers none because pushing
  // someone else's judgement is not mechanical. A wave that quietly added a
  // button to either would be widening the surface this one is fenced away
  // from.
  it('offers actions on exactly the two states wave 2 chose', () => {
    const states = StuckStateSchema.options as readonly StuckState[];
    expect(states.filter(offersAction).sort())
      .toEqual(['ci-failing', 'conflict']);
  });
});
