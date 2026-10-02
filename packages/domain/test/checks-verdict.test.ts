import { describe, it, expect } from 'vitest';
import { checksVerdict, evidenceSha, type ChecksReadings } from '../src/rules/checks-verdict.js';

const HEAD = 'c11e74e2b7a1f0d9e8c7b6a5f4e3d2c1b0a9f8e7';
const OLD = '5a1d7ee2aaaabbbbccccddddeeeeffff00001111';
const BRANCH = 'bug/a-started-agent-leaves-its-starters-group';

const base: ChecksReadings = {
  branch: BRANCH,
  head: HEAD,
  pushed: true,
  prOpen: true,
  last: null,
  waitedSeconds: 0,
  boundSeconds: 1800,
};

const finding = (word: string, sha: string | null = HEAD, branch = BRANCH) => ({ finding: word, branch, sha });

describe('checksVerdict', () => {
  it('waits while the pushed head of an open PR has no result', () => {
    expect(checksVerdict(base)).toBe('wait');
  });

  it('is settled by a failed run for the head', () => {
    expect(checksVerdict({ ...base, last: finding('build failed') })).toBe('settled');
  });

  it('is settled by a passing run and by a run needing approval', () => {
    expect(checksVerdict({ ...base, last: finding('build passed') })).toBe('settled');
    expect(checksVerdict({ ...base, last: finding('build needs approval') })).toBe('settled');
  });

  it('keeps waiting on a result for a superseded commit', () => {
    expect(checksVerdict({ ...base, last: finding('build failed', OLD) })).toBe('wait');
  });

  it('keeps waiting on a result for another branch the desk held before', () => {
    expect(checksVerdict({ ...base, last: finding('build passed', HEAD, 'bug/the-previous-slice') })).toBe('wait');
  });

  it('keeps waiting on a head-moved finding, which is no result', () => {
    expect(checksVerdict({ ...base, last: finding('head moved') })).toBe('wait');
  });

  it('is settled by a result whose evidence names no commit', () => {
    expect(checksVerdict({ ...base, last: finding('build failed', null) })).toBe('settled');
  });

  it('expires at the bound, and not before', () => {
    expect(checksVerdict({ ...base, waitedSeconds: 1799 })).toBe('wait');
    expect(checksVerdict({ ...base, waitedSeconds: 1800 })).toBe('expired');
  });

  it('answers none where no result is coming', () => {
    expect(checksVerdict({ ...base, pushed: false })).toBe('none');
    expect(checksVerdict({ ...base, prOpen: false })).toBe('none');
    expect(checksVerdict({ ...base, boundSeconds: 0 })).toBe('none');
  });

  it('prefers a result over an expired wait', () => {
    expect(checksVerdict({ ...base, waitedSeconds: 5000, last: finding('build failed') })).toBe('settled');
  });
});

describe('evidenceSha', () => {
  it('reads the commit out of the monitor sentence', () => {
    expect(
      evidenceSha(`the run at https://github.com/o/r/actions/runs/1 for ${HEAD} concluded failure`),
    ).toBe(HEAD);
  });

  it('answers null for a sentence of another shape', () => {
    expect(evidenceSha('a newer sha exists')).toBeNull();
    expect(evidenceSha('')).toBeNull();
  });
});
