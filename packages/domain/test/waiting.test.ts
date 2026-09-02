import { describe, it, expect } from 'vitest';
import { nextWork, type SliceOutlookReading } from '../src/rules/waiting.js';
import type { BranchState, SliceVerdict } from '../src/entities/fleet.js';

/** One slice, spelled the way a plan reads: a verdict and `name:state` pairs. */
const slice = (verdict: SliceVerdict, ...branches: string[]): SliceOutlookReading => ({
  verdict,
  branches: branches.map((spec) => {
    const [name, state] = spec.split(':');
    return { name: name!, state: state as BranchState };
  }),
});

describe('nextWork — the two nothings', () => {
  it('says not-yet when a blocked slice holds an unstarted branch', () => {
    // The case this rule exists for: `--next` answers nothing, and the reason
    // is that the work is ahead of a slice that has not landed.
    expect(nextWork([
      slice('eligible', 'feature/seam:wip'),
      slice('blocked', 'feature/api:open'),
    ])).toEqual({ outlook: 'not-yet', blockers: ['feature/seam'] });
  });

  it('says none when every slice is complete', () => {
    expect(nextWork([
      slice('complete', 'feature/seam:merged'),
      slice('complete', 'feature/api:merged'),
    ])).toEqual({ outlook: 'none', blockers: [] });
  });

  it('says none when the blocked slice is already somebody else’s', () => {
    // A worker that waited here would wait for a desk somebody is sitting at.
    // The branch will never come free by anything landing.
    expect(nextWork([
      slice('eligible', 'feature/seam:wip'),
      slice('blocked', 'feature/api:claimed'),
    ])).toEqual({ outlook: 'none', blockers: [] });
  });

  it('says none for an unapproved plan, however much work it holds', () => {
    // `unapproved` resolves by a person, not by work landing. A worker holding
    // a desk until somebody approves a plan is worse than one that ends.
    expect(nextWork([
      slice('unapproved', 'feature/seam:open'),
      slice('unapproved', 'feature/api:open'),
    ])).toEqual({ outlook: 'none', blockers: [] });
  });

  it('says none for a plan with no slices at all', () => {
    expect(nextWork([])).toEqual({ outlook: 'none', blockers: [] });
  });
});

describe('nextWork — available outranks both', () => {
  it('reports the claimable branch rather than a wait', () => {
    // Caller and rule disagreeing is worth saying out loud: the caller should
    // act on the branch, not on this.
    expect(nextWork([slice('eligible', 'feature/seam:open')]))
      .toEqual({ outlook: 'available', blockers: [] });
  });

  it('finds a claimable branch in a later eligible slice', () => {
    expect(nextWork([
      slice('complete', 'feature/seam:merged'),
      slice('eligible', 'feature/api:open'),
    ])).toEqual({ outlook: 'available', blockers: [] });
  });
});

describe('nextWork — what a not-yet is waiting on', () => {
  it('names every unsettled branch of the slices ahead', () => {
    expect(nextWork([
      slice('eligible', 'feature/one:wip', 'feature/two:claimed'),
      slice('blocked', 'feature/api:open'),
    ])).toEqual({ outlook: 'not-yet', blockers: ['feature/one', 'feature/two'] });
  });

  it('skips the merged and the deferred, which will never move again', () => {
    // A blocker that has already landed cannot land a second time, so a waiter
    // watching its ref would watch a ref that never changes.
    expect(nextWork([
      slice('eligible', 'feature/done:merged', 'feature/dropped:deferred', 'feature/live:wip'),
      slice('blocked', 'feature/api:open'),
    ])).toEqual({ outlook: 'not-yet', blockers: ['feature/live'] });
  });

  it('carries the blockers of every slice ahead, not just the nearest', () => {
    expect(nextWork([
      slice('eligible', 'feature/one:wip'),
      slice('blocked', 'feature/two:wip'),
      slice('blocked', 'feature/three:open'),
    ])).toEqual({ outlook: 'not-yet', blockers: ['feature/one', 'feature/two'] });
  });

  it('never returns not-yet with nothing to wait on', () => {
    // A wait with no nameable blocker is a wait that cannot end. The rule
    // answers `none` instead — which is the property that keeps a waiting
    // worker from outliving its plan.
    const answers = [
      nextWork([slice('blocked', 'feature/api:open')]),
      nextWork([slice('complete'), slice('blocked', 'feature/api:open')]),
    ];
    for (const answer of answers) {
      expect(answer.outlook).toBe('none');
      expect(answer.blockers).toEqual([]);
    }
  });
});
