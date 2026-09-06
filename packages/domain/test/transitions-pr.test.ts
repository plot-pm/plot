import { describe, expect, it } from 'vitest';
import { PrStateSchema, type Pr, type PrState } from '../src/entities/pr.js';
import {
  isDecision,
  isRefusal,
  observePrState,
  prId,
  prStateObservable,
  PR_LIFECYCLE,
} from '../src/transitions/pr.js';

const prWith = (over: Partial<Pr> = {}): Pr => ({
  number: 736,
  repo: '',
  head: 'feature/six-lifecycles-declare-their-rules',
  state: 'OPEN',
  mergedAt: null,
  mergeCommit: '',
  draft: false,
  mergeable: 'mergeable',
  review: 'APPROVED',
  checks: 'green',
  failingChecks: [],
  url: 'https://github.com/plot-pm/plot/pull/736',
  ...over,
});

const move = (from: PrState, to: string, over: Partial<Pr> = {}) =>
  observePrState(prWith({ state: from, ...over }), { to });

/** What the host reports for a pull request that merged. */
const merged = { mergedAt: '2026-09-06T10:00:00Z', mergeCommit: 'abc1234' };

describe('the states are consumed, never redeclared', () => {
  it('names the states the entity owns, in the order it draws them', () => {
    expect([...PR_LIFECYCLE]).toEqual([...PrStateSchema.options]);
  });

  it('identifies a pull request by repo AND number, because numbering restarts', () => {
    expect(prId('plot-pm/plot', 736)).toBe('plot-pm/plot#736');
    expect(prId('', 736)).toBe('#736');
  });
});

describe('a pull request opens, then merges or closes', () => {
  it('merges where the record carries the merge', () => {
    expect(isDecision(move('OPEN', 'MERGED', merged))).toBe(true);
  });

  it('closes where nothing merged', () => {
    expect(isDecision(move('OPEN', 'CLOSED'))).toBe(true);
  });

  it('reads landing from mergedAt and never from the state word', () => {
    const result = move('OPEN', 'MERGED', merged);
    expect(isDecision(result) && result.landed).toBe(true);
    const closed = move('OPEN', 'CLOSED');
    expect(isDecision(closed) && closed.landed).toBe(false);
  });

  it('answers the same question through the callable-alone form', () => {
    expect(prStateObservable(prWith(merged), 'MERGED')).toBe(true);
    expect(prStateObservable(prWith({ state: 'MERGED', ...merged }), 'OPEN')).toBe(false);
  });
});

describe('the state alone is not the answer', () => {
  it('refuses a CLOSED reading over a merge record', () => {
    // THE MEASUREMENT THIS FILE EXISTS FOR. A merged pull request reports
    // CLOSED, which is why `plot-pr-merged.sh` reads `mergedAt`. Without this
    // gate the reading passes as a legal OPEN -> CLOSED and the landing is lost.
    const result = move('OPEN', 'CLOSED', merged);
    expect(isRefusal(result) && result.reason).toBe('merged-reported-closed');
  });

  it('names the merge date in the refusal, so the caller knows where to look', () => {
    const result = move('OPEN', 'CLOSED', merged);
    expect(isRefusal(result) && result.detail).toContain('2026-09-06T10:00:00Z');
  });

  it('refuses a MERGED reading with no merge record, from the other side', () => {
    const result = move('OPEN', 'MERGED');
    expect(isRefusal(result) && result.reason).toBe('merge-record-missing');
  });

  it('refuses a draft that claims to have merged', () => {
    const result = move('OPEN', 'MERGED', { ...merged, draft: true });
    expect(isRefusal(result) && result.reason).toBe('draft-cannot-merge');
  });

  it('admits CLOSED where nothing merged, which is a real close', () => {
    expect(isDecision(move('OPEN', 'CLOSED', { mergedAt: null }))).toBe(true);
  });
});

describe('it refuses what the lifecycle does not admit', () => {
  it('refuses an unrecognised state', () => {
    const result = move('OPEN', 'DRAFT');
    expect(isRefusal(result) && result.reason).toBe('state-unrecognised');
  });

  it('refuses a move to the state it already holds', () => {
    const result = move('OPEN', 'OPEN');
    expect(isRefusal(result) && result.reason).toBe('state-unchanged');
  });

  it('refuses to reopen a merged pull request', () => {
    const result = move('MERGED', 'OPEN', merged);
    expect(isRefusal(result) && result.reason).toBe('state-terminal');
  });

  it('refuses to reopen a closed one — a reopen arrives as a fresh reading', () => {
    const result = move('CLOSED', 'OPEN');
    expect(isRefusal(result) && result.reason).toBe('state-terminal');
  });

  it('refuses CLOSED -> MERGED, which is one reading and not two states', () => {
    // Resolved by reading `mergedAt` rather than by admitting a transition that
    // never happened.
    const result = move('CLOSED', 'MERGED', merged);
    expect(isRefusal(result) && result.reason).toBe('state-terminal');
  });

  it('refuses on an unmet precondition, quoting what the source said', () => {
    const result = observePrState(prWith(merged), {
      to: 'MERGED',
      preconditions: [{ name: 'host-asked', met: false, detail: 'gh exited 1' }],
    });
    expect(isRefusal(result) && result.reason).toBe('precondition-unmet');
    expect(isRefusal(result) && result.detail).toContain('gh exited 1');
  });

  it('names an unmet reading that said nothing', () => {
    const result = observePrState(prWith(merged), {
      to: 'MERGED',
      preconditions: [{ name: 'host-asked', met: false }],
    });
    expect(isRefusal(result) && result.detail).toBe("the reading 'host-asked' is not met");
  });
});
