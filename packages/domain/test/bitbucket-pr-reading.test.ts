import { describe, expect, it } from 'vitest';

import { bitbucketPrState, bitbucketReview } from '../src/rules/bitbucket-pr-reading.js';

const pr = (over: Record<string, unknown> = {}) => ({
  id: 7,
  state: 'OPEN',
  links: { html: { href: 'https://bb/pr/7' } },
  destination: { branch: { name: 'main' } },
  source: { branch: { name: 'feature/a' }, commit: { hash: 'sha-head' } },
  ...over,
});

describe('bitbucketPrState', () => {
  it('reads a missing pull request as NONE with no check', () => {
    expect(bitbucketPrState(null, {}, null)).toEqual({ number: 0, state: 'NONE', draft: false, url: '', mergeCommit: '' });
  });

  it('names the head and reads the check unknown where no Jenkins reading exists', () => {
    expect(bitbucketPrState(pr(), null, null)).toMatchObject({ headSha: 'sha-head', checks: 'unknown', checksSha: '' });
  });

  it('reads none where Jenkins answered and has no job for the branch', () => {
    expect(bitbucketPrState(pr(), {}, null)).toMatchObject({ checks: 'none', checksSha: '' });
  });

  it('leaves the branch colour unbound when no sha reading exists', () => {
    expect(bitbucketPrState(pr(), { 'feature/a': { checks: 'green', job: 'j' } }, null)).toMatchObject({
      checks: 'green',
      checksSha: '',
    });
  });

  it('prefers the reading bound to the head over the branch colour', () => {
    const bound = { 'feature/a': { checks: 'pending' as const, job: 'j', checksSha: '' } };
    expect(bitbucketPrState(pr(), { 'feature/a': { checks: 'green', job: 'j' } }, bound).checks).toBe('pending');
    const built = { 'feature/a': { checks: 'failing' as const, job: 'j', checksSha: 'sha-head' } };
    expect(bitbucketPrState(pr(), { 'feature/a': { checks: 'green', job: 'j' } }, built)).toMatchObject({
      checks: 'failing',
      checksSha: 'sha-head',
    });
  });

  it('maps DECLINED to CLOSED and carries the merge commit', () => {
    expect(bitbucketPrState(pr({ state: 'DECLINED', merge_commit: { hash: 'm1' } }), null, null)).toMatchObject({
      state: 'CLOSED',
      mergeCommit: 'm1',
    });
  });
});

describe('bitbucketReview', () => {
  it('reads the newest plot/review status, not the CI status beside it', () => {
    const statuses = [
      { key: 'ci/build', state: 'SUCCESSFUL' },
      { key: 'plot/review', state: 'FAILED' },
      { key: 'plot/review', state: 'SUCCESSFUL' },
    ];
    expect(bitbucketReview('s', statuses, [])).toEqual({ sha: 's', state: 'failure', bypass: false });
  });

  it.each([
    ['SUCCESSFUL', 'success'],
    ['INPROGRESS', 'pending'],
    ['STOPPED', 'error'],
  ])('words %s as %s', (word, expected) => {
    expect(bitbucketReview('s', [{ key: 'plot/review', state: word }], []).state).toBe(expected);
  });

  it('answers absent where no plot/review status exists', () => {
    expect(bitbucketReview('s', [{ key: 'ci/build', state: 'SUCCESSFUL' }], []).state).toBe('absent');
  });

  it('reports a comment starting review-bypass:', () => {
    expect(bitbucketReview('s', [], [{ content: { raw: 'ok' } }, { content: { raw: 'review-bypass: stuck' } }]).bypass).toBe(true);
  });
});
