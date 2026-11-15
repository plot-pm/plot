import { describe, expect, it } from 'vitest';
import { bitbucketPlainRow } from '../src/rules/bitbucket-pr-row.js';

describe('the plain Bitbucket row', () => {
  it('writes null for the keys a bare pull request lacks and the empty word for the rest', () => {
    expect(bitbucketPlainRow({})).toEqual({
      number: null,
      title: null,
      state: null,
      head: null,
      draft: false,
      url: '',
      updatedAt: '',
      headSha: '',
      mergedAt: '',
      author: '',
      base: '',
    });
  });

  it('names a declined pull request closed and a merged one by its update time', () => {
    expect(bitbucketPlainRow({ state: 'DECLINED', updated_on: 't' })).toMatchObject({ state: 'CLOSED', mergedAt: '' });
    expect(bitbucketPlainRow({ state: 'MERGED', updated_on: 't' })).toMatchObject({ state: 'MERGED', mergedAt: 't' });
  });
});
