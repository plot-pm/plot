import { describe, expect, it } from 'vitest';

import { briefAskBudget, outstandingAsks } from '../src/rules/brief-budget.js';

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
