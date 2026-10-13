import { describe, expect, it } from 'vitest';
import {
  ISSUE_MAY_EXIST,
  PENDING_REASON,
  issueSteps,
  parseIssueState,
  renderIssueState,
  settleOpen,
} from '../src/rules/refuted-issues.js';
import type { RefutedClaim } from '../src/rules/verification-record.js';
import { foldVerification } from '../src/rules/verification.js';

const verdictsOf = (claims: string[], text: string) => {
  const fold = foldVerification(claims, [{ lens: 'a', text }]);
  if (fold.fold !== 'record') throw new Error('expected a record');
  return fold.verdicts;
};

const refuted = (claims: string[]) => verdictsOf(claims, claims.map((_, i) => `Claim-${i + 1}: refuted\n`).join(''));

const line = (claim: string, over: Partial<RefutedClaim> = {}): RefutedClaim => ({ n: 1, claim, issue: null, noIssue: null, ...over });

describe('issueSteps', () => {
  it('opens a refuted claim with no known issue and skips a supported one', () => {
    const verdicts = verdictsOf(['one', 'two'], 'Claim-1: refuted\nClaim-2: supported\n');
    expect(issueSteps(verdicts, [], {})).toEqual([{ step: 'open', claim: 'one', verdict: verdicts[0] }]);
  });

  it('reuses the id of a plan line by claim text when the state file is empty', () => {
    expect(issueSteps(refuted(['one']), [line('one', { n: 4, issue: '1712' })], {})).toEqual([
      { step: 'note', claim: 'one', note: { issue: '1712' } },
    ]);
  });

  it('prefers the state file id over the plan line', () => {
    expect(issueSteps(refuted(['one']), [line('one', { issue: '1' })], { one: { issue: 'PROJ-2' } })).toEqual([
      { step: 'note', claim: 'one', note: { issue: 'PROJ-2' } },
    ]);
  });

  it('reuses a plan id over a pending entry', () => {
    expect(issueSteps(refuted(['one']), [line('one', { issue: '9' })], { one: { pending: true } })).toEqual([
      { step: 'note', claim: 'one', note: { issue: '9' } },
    ]);
  });

  it('holds a pending claim and a may-exist claim', () => {
    const state = { one: { pending: true as const }, two: { mayExist: `${ISSUE_MAY_EXIST}timeout` } };
    expect(issueSteps(refuted(['one', 'two']), [], state)).toEqual([
      { step: 'note', claim: 'one', note: { noIssue: PENDING_REASON } },
      { step: 'note', claim: 'two', note: { noIssue: `${ISSUE_MAY_EXIST}timeout` } },
    ]);
  });

  it('holds a claim whose plan line says the issue may exist, and opens one whose line gave another reason', () => {
    const recorded = [line('one', { noIssue: `${ISSUE_MAY_EXIST}signal` }), line('two', { noIssue: 'no Tracker declared' })];
    const verdicts = refuted(['one', 'two']);
    expect(issueSteps(verdicts, recorded, {})).toEqual([
      { step: 'note', claim: 'one', note: { noIssue: `${ISSUE_MAY_EXIST}signal` } },
      { step: 'open', claim: 'two', verdict: verdicts[1] },
    ]);
  });

  it('gives one step to two claims of the same text', () => {
    expect(issueSteps(refuted(['one', 'one']), [], {})).toHaveLength(1);
  });
});

describe('settleOpen', () => {
  it('keeps the id of an opened issue', () => {
    expect(settleOpen({ opened: 'PROJ-12' }, 'jira')).toEqual({ entry: { issue: 'PROJ-12' }, note: { issue: 'PROJ-12' } });
  });

  it('keeps a may-exist refusal as mayExist', () => {
    const reason = `${ISSUE_MAY_EXIST}the call ended at its time bound`;
    expect(settleOpen({ refused: reason }, 'jira')).toEqual({ entry: { mayExist: reason }, note: { noIssue: reason } });
  });

  it('removes the entry on a plain refusal', () => {
    expect(settleOpen({ refused: 'no Tracker declared' }, 'jira')).toEqual({ entry: null, note: { noIssue: 'no Tracker declared' } });
  });

  it('names the tracker for a refusal with no text', () => {
    expect(settleOpen({ refused: null }, 'jira')).toEqual({ entry: null, note: { noIssue: 'jira refused with no reason' } });
  });
});

describe('the issue state file', () => {
  it('round-trips every entry shape', () => {
    const state = { a: { issue: '1' }, b: { pending: true as const }, c: { mayExist: 'm' } };
    expect(parseIssueState(renderIssueState(state))).toEqual(state);
  });

  it('reads a bare string as an issue id', () => {
    expect(parseIssueState('{"issues":{"a":"7"}}')).toEqual({ a: { issue: '7' } });
  });

  it('refuses text that is not JSON, has no issues object, or holds an unknown entry', () => {
    expect(parseIssueState('{')).toBeNull();
    expect(parseIssueState('null')).toBeNull();
    expect(parseIssueState('{}')).toBeNull();
    expect(parseIssueState('{"issues":[]}')).toBeNull();
    expect(parseIssueState('{"issues":{"a":3}}')).toBeNull();
    expect(parseIssueState('{"issues":{"a":null}}')).toBeNull();
    expect(parseIssueState('{"issues":{"a":{"pending":false}}}')).toBeNull();
  });
});
