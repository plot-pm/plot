import { describe, expect, it } from 'vitest';

import {
  BRIEF_ASK_RETRIES,
  briefAskBudget,
  briefAskState,
  outstandingAsks,
  outstandingEnds,
  outstandingWaits,
} from '../src/rules/brief-budget.js';

describe('outstandingAsks', () => {
  it('drops an ask whose brief landed', () => {
    const asked = new Set(['feature/a']);
    expect(outstandingAsks(asked, new Set())).toEqual(new Set());
  });

  it('keeps an ask whose brief is still missing', () => {
    const asked = new Set(['feature/a']);
    expect(outstandingAsks(asked, new Set(['feature/a']))).toEqual(new Set(['feature/a']));
  });

  it('drops an ask for a branch absent from the pulse', () => {
    // The branch left the candidates, so `missingBriefs` does not name it,
    // while another branch is still missing its brief.
    const asked = new Set(['feature/gone', 'feature/b']);
    expect(outstandingAsks(asked, new Set(['feature/b', 'feature/c'])))
      .toEqual(new Set(['feature/b']));
  });

  it('returns a new set and leaves the asked set unchanged', () => {
    const asked = new Set(['feature/a', 'feature/b']);
    const kept = outstandingAsks(asked, new Set(['feature/b']));
    expect(kept).not.toBe(asked);
    expect(asked).toEqual(new Set(['feature/a', 'feature/b']));
  });
});

describe('outstandingAsks — usage-limit waits', () => {
  const missing = new Set(['feature/a']);

  it('keeps an ask whose reset lies ahead', () => {
    const kept = outstandingAsks(new Set(['feature/a']), missing, new Map([['feature/a', 200]]), new Map(), 199);
    expect(kept).toEqual(new Set(['feature/a']));
  });

  it('drops an ask at its reset second, so the next pass asks again', () => {
    const kept = outstandingAsks(new Set(['feature/a']), missing, new Map([['feature/a', 200]]), new Map(), 200);
    expect(kept).toEqual(new Set());
  });

  it('ignores a wait for a branch that is not asked', () => {
    const kept = outstandingAsks(new Set(), missing, new Map([['feature/a', 100]]), new Map(), 200);
    expect(kept).toEqual(new Set());
  });
});

describe('outstandingWaits', () => {
  it('keeps a wait only for a branch still asked', () => {
    const waits = new Map([['feature/a', 200], ['feature/b', 300]]);
    expect(outstandingWaits(waits, new Set(['feature/b']))).toEqual(new Map([['feature/b', 300]]));
  });
});

describe('briefAskBudget', () => {
  it('answers the cap minus every charged slot', () => {
    expect(briefAskBudget({ cap: 8, busyAgents: 2, inFlight: 1, outstanding: 3 })).toBe(2);
  });

  it('never goes below 0', () => {
    expect(briefAskBudget({ cap: 2, busyAgents: 3, inFlight: 1, outstanding: 4 })).toBe(0);
  });

  it('does not count a free agent', () => {
    // Cap 8 with one free agent and nothing busy: the caller passes
    // busyAgents 0, so the free agent leaves all 8 slots open.
    expect(briefAskBudget({ cap: 8, busyAgents: 0, inFlight: 0, outstanding: 0 })).toBe(8);
  });

  it('reaches 0 with busy agents alone', () => {
    expect(briefAskBudget({ cap: 3, busyAgents: 3, inFlight: 0, outstanding: 0 })).toBe(0);
  });
});

describe('briefAskState', () => {
  const missing = new Set(['feature/a']);

  it('answers free for a branch never asked', () => {
    expect(briefAskState('feature/a', { asked: new Set(), missingBriefs: missing })).toBe('free');
  });

  it('answers asked while a run is live', () => {
    expect(briefAskState('feature/a', { asked: new Set(['feature/a']), missingBriefs: missing })).toBe('asked');
  });

  it('answers asked while a usage-limit wait lies before its reset', () => {
    const readings = { asked: new Set(['feature/a']), missingBriefs: missing, waits: new Map([['feature/a', 200]]), now: 199 };
    expect(briefAskState('feature/a', readings)).toBe('asked');
  });

  it('answers free once the reset has come', () => {
    const readings = { asked: new Set(['feature/a']), missingBriefs: missing, waits: new Map([['feature/a', 200]]), now: 200 };
    expect(briefAskState('feature/a', readings)).toBe('free');
  });

  it('answers free for an ended run with retries left', () => {
    expect(BRIEF_ASK_RETRIES).toBe(1);
    expect(briefAskState('feature/a', { asked: new Set(), missingBriefs: missing, ends: new Map([['feature/a', 1]]) })).toBe('free');
  });

  it('answers spent after a second end with the brief still missing', () => {
    expect(briefAskState('feature/a', { asked: new Set(), missingBriefs: missing, ends: new Map([['feature/a', 2]]) })).toBe('spent');
  });

  it('answers free for two ends once the brief landed', () => {
    expect(briefAskState('feature/a', { asked: new Set(), missingBriefs: new Set(), ends: new Map([['feature/a', 2]]) })).toBe('free');
  });
});

describe('outstandingAsks — end counts', () => {
  it('keeps no spent branch, so briefAskBudget does not count it', () => {
    const missing = new Set(['feature/a', 'feature/b']);
    const kept = outstandingAsks(new Set(['feature/a', 'feature/b']), missing, new Map(), new Map([['feature/b', 2]]));
    expect(kept).toEqual(new Set(['feature/a']));
    expect(briefAskBudget({ cap: 2, busyAgents: 0, inFlight: 0, outstanding: kept.size })).toBe(1);
  });
});

describe('outstandingEnds', () => {
  it('drops the count of a landed brief and keeps a missing one', () => {
    const ends = new Map([['feature/landed', 1], ['feature/missing', 2]]);
    expect(outstandingEnds(ends, new Set(['feature/missing']))).toEqual(new Map([['feature/missing', 2]]));
  });

  it('returns a new map and leaves the counts unchanged', () => {
    const ends = new Map([['feature/a', 1]]);
    const kept = outstandingEnds(ends, new Set());
    expect(kept).not.toBe(ends);
    expect(ends).toEqual(new Map([['feature/a', 1]]));
  });
});
