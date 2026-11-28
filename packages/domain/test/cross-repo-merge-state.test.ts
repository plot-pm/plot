import { describe, expect, it } from 'vitest';
import { answered, failed, unaskable } from '../src/port-result.js';
import { crossRepoMergeState, type CrossRepoAnswer } from '../src/rules/cross-repo-merge-state.js';

const A = { repo: 'ws/portal', number: 31 };
const B = { repo: 'ws/apps-infra', number: 176 };
const merged = (reference: typeof A): CrossRepoAnswer => ({ reference, answer: answered({ state: 'MERGED' }) });
const open = (reference: typeof A): CrossRepoAnswer => ({ reference, answer: answered({ state: 'OPEN' }) });

describe('crossRepoMergeState', () => {
  it('answers merged where every reference merged, holding none', () => {
    expect(crossRepoMergeState([merged(A), merged(B)])).toEqual({ state: 'merged', held: [] });
  });

  it('answers not-merged for an open, closed or absent PR, holding those references', () => {
    expect(crossRepoMergeState([merged(A), open(B)])).toEqual({ state: 'not-merged', held: [B] });
    expect(crossRepoMergeState([{ reference: A, answer: answered({ state: 'CLOSED' }) }])).toEqual({ state: 'not-merged', held: [A] });
    expect(crossRepoMergeState([{ reference: A, answer: answered(null) }])).toEqual({ state: 'not-merged', held: [A] });
  });

  it('answers unknown over not-merged for a failed or unaskable read, holding only the unread references', () => {
    expect(crossRepoMergeState([open(A), { reference: B, answer: failed() }])).toEqual({ state: 'unknown', held: [B] });
    expect(crossRepoMergeState([{ reference: A, answer: unaskable('no token') }, merged(B)])).toEqual({ state: 'unknown', held: [A] });
  });

  it('answers unknown for no reference at all', () => {
    expect(crossRepoMergeState([])).toEqual({ state: 'unknown', held: [] });
  });
});
