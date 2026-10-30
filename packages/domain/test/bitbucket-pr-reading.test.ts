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

  it('reads a payload with no source or destination as empty head, base and branch', () => {
    const sparse = { id: 4, state: 'OPEN', links: { html: { href: 'https://bb/pr/4' } } };
    expect(bitbucketPrState(sparse, { '': { checks: 'green' } }, null)).toMatchObject({
      headSha: '',
      base: '',
      checks: 'green',
      checksSha: '',
    });
    expect(bitbucketPrState(pr({ source: { branch: { name: 'feature/a' } } }), {}, null).headSha).toBe('');
  });

  it('maps DECLINED to CLOSED and carries the merge commit', () => {
    expect(bitbucketPrState(pr({ state: 'DECLINED', merge_commit: { hash: 'm1' } }), null, null)).toMatchObject({
      state: 'CLOSED',
      mergeCommit: 'm1',
    });
  });

  it('reads unknown with checksLookup set where a named row has no bound entry', () => {
    const colours = { 'feature/a': { checks: 'green', job: 'j' } };
    expect(bitbucketPrState(pr(), colours, null, true)).toMatchObject({
      checks: 'unknown',
      checksSha: '',
      checksLookup: 'broken',
    });
  });

  it('is unaffected by wasNamed once a bound entry exists', () => {
    const colours = { 'feature/a': { checks: 'green', job: 'j' } };
    const bound = { 'feature/a': { checks: 'failing' as const, job: 'j', checksSha: 'sha-head' } };
    const row = bitbucketPrState(pr(), colours, bound, true);
    expect(row.checks).toBe('failing');
    expect(row.checksSha).toBe('sha-head');
    expect(row.checksLookup).toBeUndefined();
  });

  it('is unaffected by wasNamed where the colour is not ambiguous', () => {
    const colours = { 'feature/a': { checks: 'none', job: 'j' } };
    const row = bitbucketPrState(pr(), colours, null, true);
    expect(row.checks).toBe('none');
    expect(row.checksLookup).toBeUndefined();
  });

  it('defaults wasNamed to false, so an unbound ambiguous colour still stands', () => {
    const colours = { 'feature/a': { checks: 'green', job: 'j' } };
    const row = bitbucketPrState(pr(), colours, null);
    expect(row.checks).toBe('green');
    expect(row.checksLookup).toBeUndefined();
  });

  it('#2238: reads mergedAt from updated_on for a MERGED pull request, the same stand-in pr-list already uses', () => {
    const row = bitbucketPrState(pr({ state: 'MERGED', updated_on: '2026-10-01T00:00:00.123456+00:00' }), null, null);
    expect(row.mergedAt).toBe('2026-10-01T00:00:00.123456+00:00');
  });

  it('#2238: reads mergedAt as empty for anything other than MERGED, however recently updated_on moved', () => {
    const row = bitbucketPrState(pr({ state: 'OPEN', updated_on: '2026-10-01T00:00:00Z' }), null, null);
    expect(row.mergedAt).toBe('');
  });

  it('#2238: reads mergedAt as empty for a MERGED pull request with no updated_on at all', () => {
    const row = bitbucketPrState(pr({ state: 'MERGED' }), null, null);
    expect(row.mergedAt).toBe('');
  });
});

describe('bitbucketReview', () => {
  it('reads the newest plot/review status, not the CI status beside it', () => {
    const statuses = [
      { key: 'ci/build', state: 'SUCCESSFUL' },
      { key: 'plot/review', state: 'FAILED' },
      { key: 'plot/review', state: 'SUCCESSFUL' },
    ];
    expect(bitbucketReview('s', statuses, [])).toEqual({ sha: 's', state: 'failure', description: '', time: '', bypass: false });
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

  it('reads a comment with no content as no bypass', () => {
    expect(bitbucketReview('s', [], [{}, { content: {} }]).bypass).toBe(false);
  });

  it('reports a comment starting review-bypass:', () => {
    expect(bitbucketReview('s', [], [{ content: { raw: 'ok' } }, { content: { raw: 'review-bypass: stuck' } }]).bypass).toBe(true);
  });
});
